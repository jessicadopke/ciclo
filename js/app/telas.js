// Desenho das telas principais, navegação, tema e ações gerais.
import { $, brl, esc, explain, fmtDay, fmtInput, fold, ICON, toast, uid } from "./util.js";
import { cardById, config, S, txSort, ui, visibleCards } from "./estado.js";
import { hasCrypto } from "./cripto.js";
import { isBenefitCredit, periodAt, periodShift } from "./periodos.js";
import { IDB, Store } from "./armazenamento.js";
import { closeSheet, openSheet, txSheet, whenHistoryIdle } from "./folhas.js";
import { decryptCards, renderCofre } from "./cofre.js";
import { cardSheet, layoutNow, renderCard } from "./cartoes.js";
import { openCamera, openGallery } from "./cupom.js";
import { driveOn } from "./backup.js";
import { renderAvisoCredito, renderHome, syncAgenda } from "./inicio.js";

// ---------- ações ----------
export async function run(fn, okMsg) {
  if (S.busy) return false;
  S.busy = true;
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) { console.error(e); toast(explain(e)); return false; }
  finally { S.busy = false; render(); }
}
// Grava lançamentos de um cartão. O saldo é derivado dos lançamentos (não se grava mais no cartão).
export async function postTxs(card, list) {
  for (const t of list) {
    const tx = { id: uid(), cardId: card.id, cat: "", source: "manual", createdAt: Date.now(), ...t };
    await Store.put("txs", tx);
  }
  return cardById(card.id).balance;
}
export async function deleteTx(tx) {
  await Store.remove("txs", tx.id);
  // A foto pode ser compartilhada pelas partes de uma compra dividida: só apaga quando ninguém mais usa.
  if (tx.receiptId && !S.txs.some(t => t.receiptId === tx.receiptId)) await IDB.del("receipts", tx.receiptId);
}

export function renderTop() {
  $("lockBtn").hidden = !S.key;
  $("installBtn").hidden = !S.installEvt;
  const hide = !!S.meta.hideValues;
  document.body.classList.toggle("hide-values", hide);
  $("eyeBtn").setAttribute("aria-pressed", String(hide));
  $("eyeBtn").setAttribute("aria-label", hide ? "Mostrar valores" : "Esconder valores");
  $("tabbar").hidden = !S.loaded;
  const tab = S.view.name === "card" ? "home" : S.tab;
  document.querySelectorAll(".tab").forEach(t => t.toggleAttribute("aria-current", t.dataset.tab === tab));
  document.querySelectorAll(".tab[aria-current]").forEach(t => t.setAttribute("aria-current", "page"));
}

// ---------- renderização ----------
export function render() {
  const view = $("view");
  renderTop();
  if (!S.loaded) return;
  if (S.view.name === "card" && cardById(S.view.id)) view.innerHTML = renderCard(cardById(S.view.id));
  else {
    S.view = { name: "home" };
    view.innerHTML = S.tab === "extrato" ? renderExtrato() : S.tab === "cofre" ? renderCofre() : S.tab === "ajustes" ? renderAjustes() : renderHome();
  }
  if (S.cards.length) decryptCards();
  syncAgenda();
}
// Troca de tela com transição: animação nativa do Chrome quando existe, senão entrada suave dos blocos.
export const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
export function navigate(fn, dir = "fade") {
  const vt = !!document.startViewTransition && !reduceMotion();
  const apply = () => {
    fn(); window.scrollTo(0, 0);
    if (vt) return;
    const v = $("view"); v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
    clearTimeout(navigate.t); navigate.t = setTimeout(() => v.classList.remove("enter"), 700);
  };
  if (vt) { document.documentElement.dataset.nav = dir; document.startViewTransition(apply); }
  else apply();
}

// Cartões cujo crédito já deveria ter caído e ainda não foi registrado.

// ---------- gráficos de gastos ----------
const periodoDeCartao = (c, n) => periodShift(c, periodAt(c, new Date()), n);
// Painel "Gastos do período": offset 0 = período atual, -1 = o anterior... Cada cartão usa o seu período.
// nav: botões ‹ › próprios (aba Extrato); na tela do cartão quem navega é o painel "Período".
export function renderGraficos(cards, offset, nav) {
  const sel = Graficos.selecionar(S.txs, cards, offset, periodoDeCartao);
  const atual = Graficos.somarGastos(sel.atual, cards);
  const ant = Graficos.somarGastos(sel.anterior, cards);
  const multi = atual.titulares.todos.length > 1;
  const view = S.gfView === "titulares" && !multi ? "categorias" : (["categorias", "lojas", "titulares"].includes(S.gfView) ? S.gfView : "categorias");
  const abas = [["categorias", "Categorias"], ["lojas", "Lojas"]].concat(multi ? [["titulares", "Titulares"]] : []);
  const comp = Graficos.comparar(atual[view], ant[view]);
  const navHtml = nav ? `
    <div class="pernav">
      <button class="iconbtn" data-act="gf-off" data-d="-1" aria-label="Período anterior" ${offset <= -36 ? "disabled" : ""}>‹</button>
      <span class="p num">${offset === 0 ? "Atual" : (-offset) + "º atrás"}</span>
      <button class="iconbtn" data-act="gf-off" data-d="1" aria-label="Próximo período" ${offset === 0 ? "disabled" : ""}>›</button>
    </div>` : "";
  return `
    <section class="panel" id="gfPanel">
      <div class="panel-head"><h2>Gastos do período</h2>${navHtml}</div>
      ${nav ? `<p class="hint">Período de cada cartão${offset === 0 ? "" : `, ${-offset} ${offset === -1 ? "período" : "períodos"} atrás`}.</p>` : ""}
      ${atual.total ? `<div class="gf-tabs" role="group" aria-label="Agrupar gastos por">${abas.map(([k, n]) => `<button data-act="gf-view" data-v="${k}" aria-pressed="${view === k}">${n}</button>`).join("")}</div>` : ""}
      ${Graficos.desenhar(atual[view], brl, esc, comp)}
      ${atual.total ? `<p class="gf-frase gv">${esc(Graficos.frase(comp, brl))}</p>` : ""}
    </section>`;
}

// ---------- aba Extrato ----------
function renderExtrato() {
  if (!S.cards.length) return renderHome();
  return `
    <h1 class="page-title">Extrato</h1>
    <div class="toolbar"><input id="txSearch" class="search" type="search" placeholder="Buscar loja, categoria, cartão, titular ou valor" value="${esc(S.txQuery)}" autocomplete="off" aria-label="Buscar no extrato"></div>
    ${renderGraficos(visibleCards(), S.gfOffset, true)}
    <div id="txArea">${renderTxArea()}</div>`;
}
// Lançamentos do extrato conforme a busca da tela (usado na lista e na planilha).
export function extratoFiltrado() {
  const words = fold(S.txQuery.trim()).split(/\s+/).filter(Boolean);
  return S.txs.filter(t => {
    if (!words.length) return true;
    const c = cardById(t.cardId);
    const hay = fold([t.desc, t.cat, c && c.name, c && c.holder, c && c.issuer, fmtInput(t.amount), (t.date || "").split("-").reverse().join("/"), t.kind === "credit" ? "credito" : "gasto"].join(" "));
    return words.every(w => hay.includes(w));
  }).sort(txSort);
}

export function renderTxArea() {
  const list = extratoFiltrado();
  const spent = list.filter(t => t.kind === "debit" && t.source !== "ajuste").reduce((s, t) => s + t.amount, 0);
  const got = list.filter(isBenefitCredit).reduce((s, t) => s + t.amount, 0);
  const shown = list.slice(0, S.txLimit);
  return `
    <div class="tots">
      <div class="tot"><span class="k">Gastos</span><span class="v num">${brl(spent)}</span></div>
      <div class="tot"><span class="k">Créditos</span><span class="v num in">${brl(got)}</span></div>
    </div>
    <section class="panel">${list.length ? renderTxList(shown, true) : `<div class="empty">Nada encontrado para “${esc(S.txQuery)}”.</div>`}</section>
    ${list.length > shown.length ? `<button class="btn more" data-act="more-tx">Mostrar mais (${list.length - shown.length} restantes)</button>` : ""}
    ${list.length ? `<button class="btn more" data-act="export-csv">Exportar planilha</button>` : ""}`;
}

// ---------- aba Ajustes ----------
function renderAjustes() {
  const list = layoutNow() === "list";
  return `
    <h1 class="page-title">Ajustes</h1>
    <div class="section-head"><h2>Seus dados</h2></div>
    <div class="menu">
      <button data-act="m-backup"><span class="t">Fazer backup</span><span class="s">Arquivo com cartões, extratos e senhas (as senhas continuam criptografadas).</span></button>
      <button data-act="import"><span class="t">Restaurar backup</span><span class="s">Substitui os dados deste celular pelos do arquivo.</span></button>
      <button data-act="m-drive"><span class="t">Backup no Drive</span><span class="s">${driveOn() ? "Ligado: o app guarda uma cópia no seu Google Drive sozinho." : "Guarda uma cópia sozinha no seu Google Drive."}</span></button>
      ${driveOn() ? `<button data-act="drive-save"><span class="t">Salvar no Drive</span><span class="s">${S.meta.drive.ultimo ? "Último: " + new Date(S.meta.drive.ultimo).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + "." : "Ainda não salvou."}</span></button>
      <button data-act="drive-restore"><span class="t">Restaurar do Drive</span><span class="s">Escolha um backup do Drive para trazer de volta.</span></button>` : ""}
      <button data-act="m-photos"><span class="t">Fotos dos cupons</span><span class="s">Espaço usado e limpeza de fotos antigas.</span></button>
      <button data-act="m-about"><span class="t">Onde ficam os dados</span><span class="s">Como não perder nada ao trocar de celular.</span></button>
    </div>
    <div class="section-head"><h2>Leitura de fotos</h2></div>
    <div class="menu">
      <button data-act="m-gemini"><span class="t">Gemini</span><span class="s">${S.meta.gemini && S.meta.gemini.enabled && S.meta.gemini.key ? "Ligado: cupons e cartões são lidos pelo Gemini, com o leitor do celular como reserva." : "Desligado: cupons e cartões são lidos só no celular, sem internet."}</span></button>
      <button data-act="recorte-auto"><span class="t">Recortar o cupom sem perguntar</span><span class="s">${Recorte.autoLigado(S.meta) ? "Ligado: o app recorta a foto do cupom sozinho e mostra o recorte depois da leitura." : "Desligado: antes de ler, o app mostra o recorte para você conferir e ajustar."}</span></button>
    </div>
    <div class="section-head"><h2>Avisos</h2></div>
    ${renderAvisoCredito()}
    <div class="section-head"><h2>Aparência</h2></div>
    <div class="menu">
      <button data-act="m-theme"><span class="t">Tema</span><span class="s">Agora: ${THEMES[themeNow()].toLowerCase()}. ${THEME_HINT[themeNow()]}</span></button>
      <button data-act="layout"><span class="t">Mostrar cartões ${list ? "como cartões" : "em lista"}</span><span class="s">Agora: ${list ? "lista compacta" : "cartões grandes"}.</span></button>
      <button data-act="eye"><span class="t">${S.meta.hideValues ? "Mostrar valores" : "Esconder valores"}</span><span class="s">O mesmo que o botão de olho no topo.</span></button>
    </div>
    ${hasCrypto && S.meta.vault ? `<div class="section-head"><h2>Cofre</h2></div><div class="menu"><button data-act="m-master"><span class="t">Trocar senha mestra</span><span class="s">Recriptografa todas as senhas guardadas.</span></button></div>` : ""}
    <div class="section-head"><h2>Sobre o app</h2></div>
    <div class="menu">
      ${S.updateAvailable
        ? `<button data-act="update-now"><span class="t">Atualizar para a versão ${esc(S.updateAvailable)}</span><span class="s">Você está na ${config.APP_VERSION}. Seus cartões, extratos e senhas não são afetados.</span></button>`
        : `<button data-act="update-check"><span class="t">Buscar atualização</span><span class="s">Versão instalada: ${config.APP_VERSION}${S.lastUpdateCheck ? ` · verificado às ${new Date(S.lastUpdateCheck).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}.</span></button>`}
      <button data-act="update-force"><span class="t">Recarregar o app</span><span class="s">Baixa de novo todos os arquivos do app. Use se algo parecer desatualizado.</span></button>
      ${S.installEvt ? `<button data-act="install"><span class="t">Instalar o app</span><span class="s">Ícone na tela inicial, tela cheia e uso sem internet.</span></button>` : ""}
    </div>
    <p class="foot num">Ciclo · do crédito ao próximo crédito · versão ${config.APP_VERSION}</p>`;
}

// ---------- tema: automático (segue o celular), claro ou escuro ----------
// Fica no localStorage para ser aplicado antes do primeiro desenho da tela (ver index.html).
const THEMES = { auto: "Automático", light: "Claro", dark: "Escuro" };
const THEME_HINT = { auto: "Segue o modo claro ou escuro do celular.", light: "Sempre claro, mesmo à noite.", dark: "Sempre escuro, cansa menos a vista." };
export const themeNow = () => { try { return localStorage.getItem("ciclo-tema") || "auto"; } catch (e) { return "auto"; } };
export function applyTheme(t) {
  try { if (t === "auto") localStorage.removeItem("ciclo-tema"); else localStorage.setItem("ciclo-tema", t); } catch (e) {}
  const root = document.documentElement;
  if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const dark = t === "auto" ? /dark/.test(m.media) : t === "dark";
    m.content = dark ? "#081417" : "#f3f7f7";
  });
}
export function themeSheet() {
  const cur = themeNow();
  openSheet(`
    <h3>Tema</h3>
    <div class="menu">
      ${Object.keys(THEMES).map(k => `<button data-t="${k}" aria-pressed="${k === cur}"><span class="t">${THEMES[k]}${k === cur ? " · em uso" : ""}</span><span class="s">${THEME_HINT[k]}</span></button>`).join("")}
    </div>`, sheet => {
    sheet.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => {
      const t = b.dataset.t;
      const go = () => { applyTheme(t); render(); };
      if (document.startViewTransition && !reduceMotion()) { document.documentElement.dataset.nav = "fade"; document.startViewTransition(go); } else go();
      closeSheet();
    }));
  });
}

// ---------- botão + ----------
export function actionSheet() {
  if (!S.cards.length) { cardSheet(null); return; }
  const cardId = S.view.name === "card" ? S.view.id : null;
  $("plusBtn").classList.add("open");
  openSheet(`
    <h3>Novo lançamento</h3>
    <div class="actions-grid">
      <button class="qa primary" data-q="gasto">${ICON.gasto}Gasto</button>
      <button class="qa" data-q="cupom">${ICON.cupom}Ler cupom</button>
      <button class="qa" data-q="credito">${ICON.credito}Crédito</button>
      <button class="qa" data-q="cartao">${ICON.cartao}Cartão</button>
    </div>
    <button class="linkbtn" data-q="galeria">Ler cupom de uma foto da galeria</button>`, sheet => {
    ui.sheetCleanup = () => $("plusBtn").classList.remove("open");
    sheet.querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => {
      const q = b.dataset.q;
      if (q === "cupom") { closeSheet(); openCamera(cardId); }
      else if (q === "galeria") { closeSheet(); openGallery(cardId); }
      else if (q === "gasto") txSheet(cardId, "debit");
      else if (q === "credito") txSheet(cardId, "credit");
      else cardSheet(null);
    }));
  });
}
export function goTab(t) {
  if (t === S.tab && S.view.name !== "card") { window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); return; }
  navigate(() => { S.tab = t; S.view = { name: "home" }; S.gfOffset = 0; render(); });
  const st = history.state || {};
  if (t !== "home") whenHistoryIdle(() => st.tab ? history.replaceState({ tab: t }, "") : history.pushState({ tab: t }, ""));
}

export function renderTxList(list, showCard) {
  if (!list.length) return `<div class="empty">Nenhum lançamento ainda. Use “+ Gasto” ou “Ler cupom”.</div>`;
  const groups = [];
  for (const t of list) {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
  }
  return `<div class="txlist">${groups.map(g => `
    <div class="daygrp">
      <span class="label">${esc(fmtDay(g.date))}</span>
      ${g.items.map(t => {
        const c = cardById(t.cardId);
        const who = showCard && c ? [c.name, c.holder].filter(Boolean).join(" · ") : "";
        const part = t.groupId && t.purchaseTotal && t.purchaseTotal !== t.amount ? `parte de uma compra de ${brl(t.purchaseTotal)}` : "";
        const sub = [t.cat, t.source === "cupom" ? "via cupom" : "", part, who].filter(Boolean).join(" · ") || (t.kind === "credit" ? "Crédito" : "Gasto");
        const ic = t.source === "ajuste" ? "±" : t.kind === "credit" ? "+" : (t.cat || t.desc || "?").slice(0, 2);
        return `
        <div class="tx ${t.kind === "credit" ? "in" : ""}">
          <span class="ic">${esc(ic)}</span>
          <div class="d"><div class="t">${esc(t.desc || (t.kind === "credit" ? "Crédito" : "Compra"))}</div><div class="s">${esc(sub)}</div></div>
          <span class="a num ${t.kind === "credit" ? "in" : ""}">${t.kind === "credit" ? "+" : "−"}${brl(t.amount)}${typeof t.reportedBalance === "number" ? `<span class="rb" title="Saldo impresso no cupom">saldo ${brl(t.reportedBalance)}</span>` : ""}</span>
          <span class="acts">
            ${t.receiptId ? `<button class="mini" data-act="view-receipt" data-id="${t.id}" aria-label="Ver foto do cupom">foto</button>` : ""}
            <button class="mini x" aria-label="Apagar lançamento" data-act="del-tx" data-id="${t.id}">×</button>
          </span>
        </div>`;
      }).join("")}
    </div>`).join("")}</div>`;
}

export function openCard(id) {
  navigate(() => { S.view = { name: "card", id }; S.periodOffset = 0; render(); }, "forward");
  whenHistoryIdle(() => history.pushState({ card: id }, ""));
}
