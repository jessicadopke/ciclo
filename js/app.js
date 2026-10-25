// Ciclo: ponto de entrada. O código fica em js/app/*.js; aqui ficam a versão, os eventos e a inicialização.
import { $, brl, esc, toast } from "./app/util.js";
import { cardById, config, S, visibleCards } from "./app/estado.js";
import { amountModeOf, creditInfo } from "./app/periodos.js";
import { IDB, migrateOldDb, Store } from "./app/armazenamento.js";
import { geminiSheet } from "./app/gemini-ui.js";
import { applyUpdate, checkUpdate } from "./app/atualizacao.js";
import { closeSheet, confirmSheet, hist, txSheet } from "./app/folhas.js";
import { changeMasterSheet, lockVault, secretsSheet, touchVault, vaultSheet } from "./app/cofre.js";
import { adjustSheet, cardSheet, deleteCard, groupOpen, layoutNow, renderCardArea } from "./app/cartoes.js";
import { openCamera, openGallery, receiptSheet, startScan } from "./app/cupom.js";
import { aboutSheet, backupSheet, driveAutomatico, driveSheet, exportarPlanilha, importFile, photosSheet, restaurarDoDrive, salvarNoDrive } from "./app/backup.js";
import { avisoDesligar, avisoLigar, creditBatchSheet, creditSheet, pendingCredits, registerCredit } from "./app/inicio.js";
import { actionSheet, applyTheme, deleteTx, goTab, navigate, openCard, render, renderTop, renderTxArea, run, themeNow, themeSheet } from "./app/telas.js";

// Versão do app (SemVer: MAJOR.MINOR.PATCH). Ao mudar, atualize também CHANGELOG.md e VERSION em sw.js.
const APP_VERSION = "1.13.1";
config.APP_VERSION = APP_VERSION;

window.addEventListener("popstate", () => {
  if (hist.pending) {
    hist.pending = false;
    const fns = hist.after.splice(0);
    fns.forEach(f => f());
    return;
  }
  if ($("scrim")) { closeSheet(true); return; }
  if (S.view.name === "card") { navigate(() => { S.view = { name: "home" }; render(); }, "back"); return; }
  if (S.tab !== "home" && !(history.state && history.state.tab)) navigate(() => { S.tab = "home"; render(); }, "back");
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("scrim")) closeSheet(); });

// ---------- eventos ----------
async function toggleEye() { await run(() => Store.setMeta({ ...S.meta, hideValues: !S.meta.hideValues })); }
async function installApp() {
  if (!S.installEvt) return;
  S.installEvt.prompt();
  await S.installEvt.userChoice.catch(() => null);
  S.installEvt = null; render();
}
document.addEventListener("click", async e => {
  touchVault();
  const el = e.target.closest("[data-act]");
  if (!el || el.closest(".sheet")) return;
  const { act, id } = el.dataset;
  const card = id ? cardById(id) : null;
  switch (act) {
    case "open-card": openCard(id); break;
    case "home":
      if (history.state && history.state.card) history.back();
      else navigate(() => { S.view = { name: "home" }; render(); }, "back");
      break;
    case "person": S.person = el.dataset.all ? null : el.dataset.p; render(); break;
    case "gf-view": S.gfView = el.dataset.v; render(); break;
    case "gf-off": S.gfOffset = Math.max(-36, Math.min(0, S.gfOffset + Number(el.dataset.d))); render(); break;
    case "per": S.periodOffset = Math.min(0, S.periodOffset + Number(el.dataset.d)); render(); break;
    case "new-card": cardSheet(null); break;
    case "edit-card": card && cardSheet(card); break;
    case "new-tx": txSheet(id, el.dataset.kind); break;
    case "adjust": card && adjustSheet(card); break;
    case "scan": openCamera(id || null); break;
    case "scan-gallery": openGallery(id || null); break;
    case "vault": vaultSheet(); break;
    case "backup": backupSheet(); break;
    case "import": $("importIn").click(); break;
    case "edit-secrets": card && secretsSheet(card); break;
    case "reveal": {
      const k = id + el.dataset.k;
      if (S.reveal.has(k)) S.reveal.delete(k); else { S.reveal.add(k); setTimeout(() => { S.reveal.delete(k); render(); }, 20000); }
      render(); break;
    }
    case "copy": {
      const v = (S.plain[id] || {})[el.dataset.k] || "";
      navigator.clipboard.writeText(v).then(() => toast("Copiado."), () => toast("Não foi possível copiar. Toque em Mostrar e copie à mão."));
      break;
    }
    case "view-receipt": { const tx = S.txs.find(t => t.id === id); tx && receiptSheet(tx); break; }
    case "del-card":
      card && confirmSheet("Excluir cartão?", `O cartão <b>${esc(card.name)}</b>, todo o extrato, as fotos de cupons e as senhas guardadas dele serão apagados. Não dá para desfazer.`, "Excluir",
        async () => { const ok = await run(() => deleteCard(card), "Cartão excluído."); if (ok) { S.view = { name: "home" }; } return ok; });
      break;
    case "del-tx": {
      const tx = S.txs.find(t => t.id === id);
      const siblings = tx ? S.txs.filter(t => t.groupId && t.groupId === tx.groupId && t.id !== tx.id).length : 0;
      tx && confirmSheet("Apagar lançamento?", `“${esc(tx.desc)}” de <span class="num">${brl(tx.amount)}</span> sai do extrato e o saldo do cartão é recalculado.${siblings ? ` Esta compra foi dividida: ${siblings === 1 ? "a outra parte continua" : `as outras ${siblings} partes continuam`} nos outros vales.` : tx.receiptId ? " A foto do cupom também é apagada." : ""}`, "Apagar",
        () => run(() => deleteTx(tx), "Lançamento apagado."));
      break;
    }
    case "credit-confirm": {
      const ci = card && creditInfo(card);
      if (!ci) break;
      // Valor e dia fixos: registra direto. Se algo varia, pergunta o valor e a data.
      if (!ci.estimated && amountModeOf(card) === "fixed") await run(() => registerCredit(card, card.monthlyCredit, ci.period.startISO), "Crédito registrado.");
      else creditSheet(card);
      break;
    }
    case "credito-prev-confirm": card && creditSheet(card); break;
    case "credito-aviso-ligar": avisoLigar(); break;
    case "credito-aviso-desligar": avisoDesligar(); break;
    case "credit-skip": S.skipped.add(id); render(); break;
    case "credit-batch": creditBatchSheet(); break;
    case "credit-later": pendingCredits(visibleCards()).forEach(({ c }) => S.skipped.add(c.id)); render(); break;
    case "layout": {
      const next = layoutNow() === "list" ? "grid" : "list";
      await run(() => Store.setMeta({ ...S.meta, layout: next }));
      break;
    }
    case "grp": {
      const h = el.dataset.h; S.groups[h] = !groupOpen(h); $("cardArea").innerHTML = renderCardArea();
      if (S.groups[h]) { const g = [...document.querySelectorAll(".grp-head")].find(b => b.dataset.h === h); g && g.parentElement.classList.add("opened"); }
      break;
    }
    case "tab": goTab(el.dataset.tab); break;
    case "more-tx": S.txLimit += 100; $("txArea").innerHTML = renderTxArea(); break;
    case "lock": lockVault("Cofre trancado."); break;
    case "eye": toggleEye(); break;
    case "recorte-auto": run(() => Store.setMeta({ ...S.meta, recorteAuto: !Recorte.autoLigado(S.meta) })); break;
    case "install": installApp(); break;
    case "m-backup": backupSheet(); break;
    case "export-csv": exportarPlanilha(); break;
    case "m-drive": driveSheet(); break;
    case "drive-save": salvarNoDrive(); break;
    case "drive-restore": restaurarDoDrive(); break;
    case "m-photos": photosSheet(); break;
    case "m-about": aboutSheet(); break;
    case "m-master": changeMasterSheet(); break;
    case "m-theme": themeSheet(); break;
    case "m-gemini": geminiSheet(); break;
    case "update-check": {
      el.querySelector(".s").textContent = "Verificando…";
      await checkUpdate(true);
      render(); break;
    }
    case "update-now": applyUpdate(); break;
    case "update-force":
      confirmSheet("Recarregar o app?", "O app baixa de novo todos os seus arquivos e reinicia. Seus cartões, extratos, fotos e senhas não são afetados. Precisa de internet.", "Recarregar", async () => { applyUpdate(); return true; });
      break;
  }
});
// As buscas redesenham só a própria lista, para o teclado não fechar a cada letra.
document.addEventListener("input", e => {
  if (e.target.id === "cardSearch") { S.cardQuery = e.target.value; $("cardArea").innerHTML = renderCardArea(); }
  else if (e.target.id === "txSearch") { S.txQuery = e.target.value; S.txLimit = 100; $("txArea").innerHTML = renderTxArea(); }
});
document.addEventListener("keydown", touchVault);
$("tabbar").addEventListener("click", e => {
  const t = e.target.closest(".tab");
  if (t) goTab(t.dataset.tab);
});
$("plusBtn").addEventListener("click", actionSheet);
$("eyeBtn").addEventListener("click", toggleEye);
$("lockBtn").addEventListener("click", () => lockVault("Cofre trancado."));
$("fileIn").addEventListener("change", e => { const files = e.target.files; if (files && files.length) startScan(files, S.scanCard); e.target.value = ""; });
$("camIn").addEventListener("change", e => { const files = e.target.files; if (files && files.length) startScan(files, S.scanCard); e.target.value = ""; });
$("importIn").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
$("installBtn").addEventListener("click", installApp);
window.addEventListener("scroll", () => $("appbar").classList.toggle("scrolled", window.scrollY > 4), { passive: true });
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; renderTop(); });
window.addEventListener("appinstalled", () => { S.installEvt = null; renderTop(); toast("App instalado."); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { lockVault(); return; }
  // ao voltar para o app, verifica de novo se passou mais de 6 horas
  if (!S.lastUpdateCheck || Date.now() - S.lastUpdateCheck > 6 * 3600 * 1000) checkUpdate(false);
});

// ---------- inicialização ----------
// Tira a tela de carregamento (#abertura, no index.html): devolve a cor da barra de cima, esmaece em 150 ms e remove.
function fecharAbertura() {
  const el = document.getElementById("abertura");
  if (!el) return;
  const claro = document.getElementById("tcClaro"), escuro = document.getElementById("tcEscuro");
  if (claro) claro.content = "#f3f7f7";
  if (escuro) escuro.content = "#081417";
  el.classList.add("saindo");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) el.remove();
  else setTimeout(() => el.remove(), 170);
}

(async () => {
  try {
    applyTheme(themeNow());
    await IDB.open();
    const migrated = await migrateOldDb().catch(e => { console.warn("migração", e); return false; });
    if (migrated) setTimeout(() => toast("Seus dados foram trazidos da versão anterior."), 600);
    const [cards, txs, meta] = await Promise.all([IDB.all("cards"), IDB.all("txs"), IDB.get("meta", "main")]);
    S.meta = meta || {};
    await Store.carregar({ cards, txs });
    S.loaded = true;
    history.replaceState({ home: true }, "");
    render();
    fecharAbertura();
    setTimeout(() => checkUpdate(false), 1500);
    setTimeout(driveAutomatico, 3000);
    const acao = new URLSearchParams(location.search).get("acao");
    if (acao && S.cards.length) {
      history.replaceState({ home: true }, "", location.pathname);
      if (acao === "gasto") txSheet(null, "debit");
      // "Ler cupom" pelo atalho do ícone: o navegador exige um toque para abrir a câmera
      if (acao === "cupom") toast("Toque em “Ler cupom” para tirar a foto.");
    }
  } catch (e) {
    console.error(e);
    $("view").innerHTML = `<div class="notice">Não foi possível abrir os dados do app neste navegador. Verifique se o Chrome não está em modo anônimo.</div>`;
    fecharAbertura();
  }
})();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("service worker", e));
  // O aviso de crédito por notificação só aparece com periodicSync e o app instalado.
  navigator.serviceWorker.ready.then(reg => {
    const instalado = window.matchMedia && matchMedia("(display-mode: standalone)").matches;
    S.periodicOk = "periodicSync" in reg && instalado;
    if (S.periodicOk && S.loaded && S.tab === "ajustes") render();
  }).catch(e => console.warn("service worker", e));
}
