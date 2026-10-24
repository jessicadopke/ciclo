// Backup em arquivo e no Drive, restauração, fotos e planilha.
import { $, esc, isoDay, toast, todayISO } from "./util.js";
import { S } from "./estado.js";
import { askPersist, IDB, Store } from "./armazenamento.js";
import { closeSheet, confirmSheet, openSheet } from "./folhas.js";
import { extratoFiltrado, render, run } from "./telas.js";

const BACKUP_VERSION = 1;

export async function exportarPlanilha() {
  const list = extratoFiltrado();
  if (!list.length) { toast("Nada para exportar."); return; }
  const name = `ciclo-extrato-${todayISO()}.csv`;
  const file = new File([Csv.montar(list, S.cards)], name, { type: "text/csv;charset=utf-8" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Extrato do Ciclo" }); toast("Planilha enviada."); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast("Planilha salva em Downloads.");
}

// ---------- backup ----------
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataURLToBlob = async u => (await fetch(u)).blob();

export async function photosSheet() {
  const recs = await IDB.all("receipts");
  const dateOf = {};
  for (const t of S.txs) if (t.receiptId) dateOf[t.receiptId] = t.date;
  const mb = b => (b / 1048576).toFixed(1).replace(".", ",") + " MB";
  const total = recs.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0);
  const olderThan = months => {
    const lim = new Date(); lim.setMonth(lim.getMonth() - months);
    const iso = isoDay(lim);
    return recs.filter(r => (dateOf[r.id] || isoDay(new Date(r.createdAt || 0))) < iso);
  };
  const opts = [3, 6, 12].map(m => ({ m, list: olderThan(m) }));
  openSheet(`
    <h3>Fotos dos cupons</h3>
    <p><b class="num">${recs.length}</b> ${recs.length === 1 ? "foto ocupa" : "fotos ocupam"} <b class="num">${mb(total)}</b> neste celular.</p>
    <p class="hint">Apagar fotos não mexe nos lançamentos nem nos saldos; só some o botão “foto” do extrato. Faça backup com fotos antes, se quiser guardá-las.</p>
    <div class="menu">
      ${opts.map(o => `<button data-del="${o.m}" ${o.list.length ? "" : "disabled"}><span class="t">Apagar fotos com mais de ${o.m} meses</span><span class="s num">${o.list.length} ${o.list.length === 1 ? "foto" : "fotos"} · ${mb(o.list.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0))}</span></button>`).join("")}
    </div>
    <div class="btnrow"><button class="btn" data-close>Fechar</button></div>`, sheet => {
    sheet.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      const o = opts.find(x => x.m === +b.dataset.del);
      confirmSheet("Apagar fotos antigas?", `${o.list.length} ${o.list.length === 1 ? "foto de cupom com mais de " + o.m + " meses será apagada" : "fotos de cupons com mais de " + o.m + " meses serão apagadas"}. Os lançamentos continuam.`, "Apagar fotos", () => run(async () => {
        const ids = new Set(o.list.map(r => r.id));
        for (const id of ids) await IDB.del("receipts", id);
        for (const t of S.txs.filter(t => ids.has(t.receiptId))) await Store.patch("txs", t.id, { receiptId: null });
      }, "Fotos apagadas."));
    }));
  });
}

export async function aboutSheet() {
  let usage = "";
  try { const est = await navigator.storage.estimate(); usage = `Espaço usado pelo app: ${(est.usage / 1048576).toFixed(1)} MB.`; } catch (e) {}
  let persisted = false;
  try { persisted = await navigator.storage.persisted(); } catch (e) {}
  openSheet(`
    <h3>Onde ficam seus dados</h3>
    <p>Tudo fica guardado apenas neste celular, dentro do app. Nada é enviado para a internet, a menos que você ligue por conta própria o backup no Drive (a cópia vai para o seu Google Drive) ou a leitura com o Gemini (as fotos vão para o Google). As senhas do cofre só saem do celular dentro do backup, e criptografadas.</p>
    <p>Se você desinstalar o app, limpar os dados do Chrome ou trocar de celular, os dados se perdem. Faça backup e guarde o arquivo no Google Drive ou envie para você mesmo.</p>
    <p class="hint">${esc(usage)} ${persisted ? "O Android foi avisado para não apagar estes dados sozinho." : ""}</p>
    <div class="btnrow"><button class="btn primary" id="abBk">Fazer backup agora</button><button class="btn" data-close>Fechar</button></div>`, () => {
    $("abBk").addEventListener("click", backupSheet);
  });
}

async function coletarFotos() {
  const out = [];
  for (const r of await IDB.all("receipts")) out.push({ id: r.id, createdAt: r.createdAt, data: await blobToDataURL(r.blob) });
  return out;
}

// ---------- backup no Drive (opcional; veja js/drive.js e apps-script/backup.gs) ----------
export const driveOn = () => !!(S.meta.drive && S.meta.drive.ligado && S.meta.drive.url && S.meta.drive.secret);
// Gera o backup e manda ao script. Lança Error com texto em português se não der.
async function enviarAoDrive() {
  const d = S.meta.drive, fotos = !!d.fotos;
  const receipts = fotos ? await coletarFotos() : [];
  const conteudo = JSON.stringify(Drive.montarBackup({ cards: S.cards, txs: S.txs, meta: S.meta, receipts }, fotos));
  if (!Drive.cabe(conteudo)) throw new Error("Com as fotos o backup passa do limite do Drive. Salve sem fotos ou apague fotos antigas em Ajustes → Fotos.");
  await Drive.chamar(d, { acao: "salvar", nome: Drive.nomeArquivo(new Date()), conteudo });
  const agora = Date.now();
  await Store.setMeta({ ...S.meta, lastBackup: agora, drive: { ...S.meta.drive, ultimo: agora, ultimoErro: null } });
}
export async function salvarNoDrive() {
  if (!driveOn()) { driveSheet(); return; }
  toast("Salvando no Drive…");
  const ok = await run(enviarAoDrive, "Backup salvo no Drive.");
  return ok;
}
// Ao abrir o app: em segundo plano, sem aviso de erro (tenta de novo na próxima abertura).
export async function driveAutomatico() {
  if (!driveOn() || !navigator.onLine) return;
  const d = S.meta.drive;
  const novos = d.ultimo ? S.txs.filter(t => (t.createdAt || 0) > d.ultimo).length : S.txs.length;
  if (!Drive.precisaSalvar({ ligado: true, ultimo: d.ultimo, novos, agora: Date.now() })) return;
  try { await enviarAoDrive(); }
  catch (e) {
    console.warn("backup no Drive", e);
    try { await Store.setMeta({ ...S.meta, drive: { ...S.meta.drive, ultimoErro: Date.now() } }); } catch (e2) {}
  }
  if (!S.busy && !$("scrim")) render();
}
export async function restaurarDoDrive() {
  if (!driveOn()) { driveSheet(); return; }
  toast("Buscando backups no Drive…");
  let itens;
  try { itens = (await Drive.chamar(S.meta.drive, { acao: "listar" })).itens || []; }
  catch (e) { toast(e.message); return; }
  if (!itens.length) { toast("Ainda não há backups no Drive."); return; }
  const fmtTam = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  openSheet(`
    <h3>Restaurar do Drive</h3>
    <p class="hint">Escolha o backup. Antes de trocar os dados deste celular, o app pede a sua confirmação.</p>
    <div class="menu">${itens.map((it, i) => `<button data-i="${i}"><span class="t">${esc(new Date(it.data).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))}</span><span class="s num">${fmtTam(it.tamanho)}</span></button>`).join("")}</div>
    <div class="btnrow"><button class="btn" data-close>Cancelar</button></div>`, sheet => {
    sheet.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const r = await Drive.chamar(S.meta.drive, { acao: "ler", id: itens[+b.dataset.i].id });
        importFile(JSON.parse(r.conteudo));
      } catch (e) { b.disabled = false; toast(e instanceof SyntaxError ? "Este backup do Drive não é válido." : e.message); }
    }));
  });
}
export function driveSheet() {
  const d = S.meta.drive || {};
  let secret = d.secret || Drive.gerarSegredo();
  openSheet(`
    <h3>Backup no Drive</h3>
    <p class="hint">O Ciclo guarda uma cópia dos seus dados numa pasta do seu Google Drive, sozinho, a cada 7 dias ou 30 lançamentos novos. Se perder o celular, você restaura de lá. É preciso fazer uma vez a configuração abaixo, no computador.</p>
    <form id="dForm" class="sform" autocomplete="off">
      <label class="field"><span>Código secreto (copie e use no passo 2)</span>
        <input id="dSec" type="text" readonly value="${esc(secret)}"></label>
      <div class="btnrow"><button class="btn small" type="button" id="dCopy">Copiar código</button><button class="btn small" type="button" id="dNew">Gerar outro</button></div>
      <ol class="hint">
        <li>No computador, abra script.google.com, crie um projeto e cole o arquivo <b>apps-script/backup.gs</b> do Ciclo.</li>
        <li>Troque o texto da linha SEGREDO_LOCAL pelo código acima e rode a função <b>configurar</b>.</li>
        <li>Implante como <b>App da Web</b> (executar como você; acesso: qualquer pessoa) e copie o link.</li>
        <li>Cole o link aqui e toque em <b>Testar conexão</b>.</li>
      </ol>
      <label class="field"><span>Link do script</span><input id="dUrl" type="url" inputmode="url" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(d.url || "")}"></label>
      <label class="check"><input type="checkbox" id="dOn" ${d.ligado ? "checked" : ""}> <span>Salvar no Drive automaticamente</span></label>
      <label class="check"><input type="checkbox" id="dFotos" ${d.fotos ? "checked" : ""}> <span>Incluir fotos (o backup fica bem maior e pode passar do limite de 20 MB)</span></label>
      <p class="hint">Quem tiver o link e o código consegue ler os backups. Não compartilhe os dois. O link e o código ficam só neste celular e não entram no backup.</p>
      <div class="err" id="dErr"></div>
      <p class="hint" id="dOk"></p>
      <div class="btnrow">
        <button class="btn primary" type="submit" id="dSave">Salvar</button>
        <button class="btn" type="button" id="dTest">Testar conexão</button>
        <button class="btn" type="button" data-close>Fechar</button>
      </div>
    </form>`, () => {
    const cfg = () => ({ url: $("dUrl").value.trim(), secret });
    $("dCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(secret); toast("Código copiado."); } catch (e) { $("dSec").select(); toast("Selecione e copie o código."); }
    });
    $("dNew").addEventListener("click", () => { secret = Drive.gerarSegredo(); $("dSec").value = secret; $("dOk").textContent = "Código novo. Troque também no script e rode “configurar” de novo."; });
    $("dTest").addEventListener("click", async () => {
      $("dErr").textContent = ""; $("dOk").textContent = "";
      if (!/^https:\/\//i.test(cfg().url)) { $("dErr").textContent = "Cole o link do App da Web (começa com https://)."; return; }
      $("dTest").disabled = true; $("dTest").textContent = "Testando…";
      try { await Drive.chamar(cfg(), { acao: "listar" }); $("dOk").textContent = "Conectado."; }
      catch (e) { $("dErr").textContent = e.message; }
      $("dTest").disabled = false; $("dTest").textContent = "Testar conexão";
    });
    $("dForm").addEventListener("submit", async e => {
      e.preventDefault();
      const { url } = cfg(), ligado = $("dOn").checked;
      $("dErr").textContent = "";
      if (ligado && !/^https:\/\//i.test(url)) { $("dErr").textContent = "Cole o link do App da Web (começa com https://) para ligar."; return; }
      const drive = { ...d, url, secret, ligado, fotos: $("dFotos").checked };
      if (ligado && !d.ligado) { drive.ligadoEm = Date.now(); drive.ultimoErro = null; }
      const ok = await run(() => Store.setMeta({ ...S.meta, drive }), ligado ? "Backup no Drive ligado." : "Configuração salva.");
      if (ok) { closeSheet(); if (ligado && !d.ligado) driveAutomatico(); }
    });
  }, { secret: true });
}

export function backupSheet() {
  openSheet(`
    <h3>Fazer backup</h3>
    <p class="hint">O arquivo leva os cartões, os extratos e o cofre. As senhas continuam criptografadas e só abrem com a sua senha mestra.</p>
    <label class="check"><input type="checkbox" id="bkPhotos"> Incluir as fotos dos cupons (o arquivo fica bem maior)</label>
    <div class="err" id="bkErr"></div>
    <div class="btnrow"><button class="btn primary" id="bkGo">Gerar arquivo</button><button class="btn" data-close>Cancelar</button></div>`, () => {
    $("bkGo").addEventListener("click", async () => {
      $("bkGo").disabled = true; $("bkGo").textContent = "Gerando…";
      try {
        const fotos = $("bkPhotos").checked;
        const data = Drive.montarBackup({ cards: S.cards, txs: S.txs, meta: S.meta, receipts: fotos ? await coletarFotos() : [] }, fotos);
        const name = `ciclo-backup-${todayISO()}.json`;
        const file = new File([JSON.stringify(data)], name, { type: "application/json" });
        let shared = false;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: "Backup do Ciclo" }); shared = true; }
          catch (e) { if (e.name === "AbortError") { $("bkGo").disabled = false; $("bkGo").textContent = "Gerar arquivo"; return; } }
        }
        if (!shared) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(file); a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }
        await Store.setMeta({ ...S.meta, lastBackup: Date.now() });
        toast(shared ? "Backup enviado." : "Backup salvo em Downloads.");
        closeSheet(); render();
      } catch (e) {
        console.error(e);
        $("bkErr").textContent = "Não foi possível gerar o backup.";
        $("bkGo").disabled = false; $("bkGo").textContent = "Gerar arquivo";
      }
    });
  });
}

// Aceita o arquivo escolhido ou os dados já lidos (restaurar do Drive).
export async function importFile(file) {
  let data;
  try { data = typeof file.text === "function" ? JSON.parse(await file.text()) : file; } catch (e) { toast("Este arquivo não é um backup válido."); return; }
  if (!data || !["ciclo", "carteira-vales"].includes(data.app) || !Array.isArray(data.cards) || !Array.isArray(data.txs)) { toast("Este arquivo não é um backup do Ciclo."); return; }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString("pt-BR") : "data desconhecida";
  confirmSheet("Restaurar backup?", `O backup de <b>${esc(when)}</b> tem ${data.cards.length} cartões e ${data.txs.length} lançamentos. Os dados atuais deste celular serão <b>substituídos</b>.`, "Restaurar", async () => {
    const ok = await run(async () => {
      for (const s of ["cards", "txs", "receipts"]) await IDB.clear(s);
      for (const c of data.cards) await IDB.put("cards", c);
      for (const t of data.txs) await IDB.put("txs", t);
      for (const r of data.receipts || []) { try { await IDB.put("receipts", { id: r.id, createdAt: r.createdAt, blob: await dataURLToBlob(r.data) }); } catch (e) {} }
      const meta = { ...S.meta, vault: data.meta && data.meta.vault ? data.meta.vault : null };
      await IDB.put("meta", meta, "main");
      S.cards = data.cards; S.txs = data.txs; S.meta = meta;
      S.key = null; S.plain = {}; S.plainSig = {};
    }, "Backup restaurado.");
    if (ok) { S.view = { name: "home" }; S.person = null; render(); askPersist(); }
    return ok;
  });
}
