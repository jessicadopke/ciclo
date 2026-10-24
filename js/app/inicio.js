// Tela Início: créditos pendentes, previstos, aviso de crédito.
import { $, brl, esc, fmtInput, monthKey, MONTHS, parseMoney, shortDate, toast, todayISO } from "./util.js";
import { cardById, holders, S, txSort, visibleCards } from "./estado.js";
import { amountModeOf, benefitCredits, creditInfo, dayModeOf, expectedAmount, fromISO, isBenefitCredit, periodAt } from "./periodos.js";
import { IDB, Store } from "./armazenamento.js";
import { renderUpdateNotice } from "./atualizacao.js";
import { closeSheet, openSheet } from "./folhas.js";
import { renderCardArea, renderCardToolbar } from "./cartoes.js";
import { postTxs, render, renderTxList, run } from "./telas.js";

export function pendingCredits(cards) {
  return cards.map(c => ({ c, ci: creditInfo(c) })).filter(({ c, ci }) => {
    if (!ci || S.skipped.has(c.id)) return false;
    if (ci.estimated) return ci.overdue;
    if (amountModeOf(c) === "fixed" && !(c.monthlyCredit > 0)) return false;
    if (c.lastCreditMonth === ci.period.key) return false;
    return !benefitCredits(c).some(t => t.date >= ci.period.startISO);
  });
}
export function renderNotices(list) {
  return list.map(({ c, ci }) => {
    const who = `<b>${esc(c.name)}</b>${c.holder ? ` (${esc(c.holder)})` : ""}`;
    const amt = amountModeOf(c) === "fixed" ? `, <span class="num">${brl(c.monthlyCredit)}</span>,` : "";
    const text = ci.estimated
      ? `O crédito do ${who} estava previsto para <span class="num">${shortDate(ci.next)}</span>. Já caiu?`
      : `O crédito de ${MONTHS[ci.period.start.getMonth()]} do ${who}${amt} já caiu?`;
    return `
    <div class="notice">
      <span>${text}</span>
      <span class="actions">
        <button class="btn small primary" data-act="credit-confirm" data-id="${c.id}">Registrar crédito</button>
        <button class="btn small ghost" data-act="credit-skip" data-id="${c.id}">Ainda não veio</button>
      </span>
    </div>`;
  }).join("");
}
// Data padrão do lançamento do crédito: o dia fixo do período, ou hoje quando o dia varia.
const creditDateFor = (c, ci) => ci && !ci.estimated && ci.period.startISO <= todayISO() ? ci.period.startISO : todayISO();

// Registro de um crédito do benefício com valor e data editáveis.
export function creditSheet(card) {
  const ci = creditInfo(card);
  const amt = expectedAmount(card);
  const variable = amountModeOf(card) === "variable";
  openSheet(`
    <h3>Registrar crédito · ${esc(card.name)}</h3>
    <form id="crForm" class="sform">
      <label class="field"><span>Valor que caiu</span><input id="crAmount" class="money num" inputmode="decimal" placeholder="0,00" value="${amt > 0 ? fmtInput(amt) : ""}" autofocus></label>
      ${variable ? `<span class="hint">O valor deste cartão varia. ${amt > 0 ? "Preenchi com o último crédito; confira no app do emissor." : "Confira o valor no app do emissor."}</span>` : ""}
      <label class="field"><span>Data em que caiu</span><input id="crDate" type="date" value="${creditDateFor(card, ci)}"></label>
      <div class="err" id="crErr"></div>
      <div class="btnrow"><button class="btn primary" type="submit">Registrar crédito</button><button class="btn" type="button" data-close>Cancelar</button></div>
    </form>`, () => {
    $("crAmount").select();
    $("crForm").addEventListener("submit", async e => {
      e.preventDefault();
      const v = parseMoney($("crAmount").value);
      const date = $("crDate").value || todayISO();
      if (!(v > 0)) { $("crErr").textContent = "Informe o valor do crédito, por exemplo 812,40."; return; }
      const ok = await run(() => registerCredit(card, v, date), "Crédito registrado.");
      if (ok) closeSheet();
    });
  });
}
export async function registerCredit(card, amount, date) {
  const d = fromISO(date);
  await postTxs(card, [{ kind: "credit", amount, desc: `Crédito de ${MONTHS[d.getMonth()]}`, date, benefit: true }]);
  if (dayModeOf(card) === "fixed") await Store.patch("cards", card.id, { lastCreditMonth: periodAt(card, d).key });
}

// ---------- créditos previstos: hoje e próximos dias ----------
// Cartões visíveis com crédito de hoje até 3 dias, menos os que ela já adiou nesta sessão.
const previstos = cards => Credito.proximos(cards, new Date(), 3, S.txs).filter(p => !S.skipped.has(p.cardId));
const previstosHoje = cards => previstos(cards).filter(p => p.faltam === 0);
function renderPrevistos(cards) {
  const list = previstos(cards);
  if (!list.length) return "";
  const hoje = list.filter(p => p.faltam === 0);
  const emLote = hoje.length > 1 && hoje.every(p => pendingCredits(cards).some(x => x.c.id === p.cardId));
  const rows = list.map(p => {
    const c = cardById(p.cardId);
    const quando = `${p.estimado ? "~" : ""}${Credito.rotulo(p.faltam)}`;
    const amt = expectedAmount(c);
    const valor = amountModeOf(c) === "variable"
      ? `${amt > 0 ? `<span class="num">${brl(amt)}</span> · ` : ""}valor varia`
      : `<span class="num">${brl(amt)}</span>`;
    const acoes = p.faltam === 0 && !emLote
      ? `<span class="actions"><button class="btn small primary" data-act="credito-prev-confirm" data-id="${c.id}">Confirmar valor</button><button class="btn small ghost" data-act="credit-skip" data-id="${c.id}">Ainda não veio</button></span>` : "";
    return `<div class="prev-row"><span><b>${esc(c.name)}</b>${c.holder ? ` (${esc(c.holder)})` : ""}: <b>${quando}</b> · ${valor}</span>${acoes}</div>`;
  }).join("");
  const lote = emLote ? `<span class="actions"><button class="btn small primary" data-act="credit-batch">Confirmar valores</button><button class="btn small ghost" data-act="credit-later">Depois</button></span>` : "";
  return `<div class="notice prev"><div class="prev-title">Créditos previstos</div>${rows}${lote}</div>`;
}

// ---------- aviso por notificação (experimento) ----------
// A agenda dos próximos 14 dias (só data e quantidade) fica em meta.avisoCredito, fora do backup, para o service worker ler.
export function syncAgenda() {
  const a = S.meta && S.meta.avisoCredito;
  if (!S.loaded || !a || !a.ligado) return;
  const datas = Credito.montarAgenda(S.cards, new Date(), S.txs);
  if (JSON.stringify(datas) === JSON.stringify(a.datas || [])) return;
  S.meta = { ...S.meta, avisoCredito: { ...a, datas } };
  IDB.put("meta", S.meta, "main").catch(e => console.warn("agenda do aviso", e));
}
// Só mostra o interruptor quando o aparelho permite: periodicSync (Chrome) e app instalado.
const avisoSuportado = () => !!S.periodicOk && "Notification" in window;
export async function avisoLigar() {
  try {
    if (!avisoSuportado()) { toast("Seu aparelho ou navegador não permite este aviso."); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Sem permissão para avisar. Ative as notificações do Ciclo nas configurações do celular e tente de novo."); return; }
    const reg = await navigator.serviceWorker.ready;
    await reg.periodicSync.register("ciclo-credito", { minInterval: 12 * 3600 * 1000 });
    await Store.setMeta({ ...S.meta, avisoCredito: { ligado: true, datas: Credito.montarAgenda(S.cards, new Date(), S.txs) } });
    toast("Aviso ligado. Ele pode atrasar ou não chegar; confie no quadro do Início.");
  } catch (e) {
    console.warn("aviso de crédito", e);
    toast("Não consegui ligar o aviso neste aparelho. O quadro do Início continua funcionando.");
  }
  render();
}
export async function avisoDesligar() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.periodicSync) await reg.periodicSync.unregister("ciclo-credito");
  } catch (e) { console.warn("aviso de crédito", e); }
  try { await Store.setMeta({ ...S.meta, avisoCredito: { ligado: false, datas: [] } }); } catch (e) { console.warn(e); }
  toast("Aviso desligado.");
  render();
}
export function renderAvisoCredito() {
  const on = !!(S.meta.avisoCredito && S.meta.avisoCredito.ligado);
  if (!avisoSuportado()) return `<div class="menu"><div class="menu-note"><span class="t">Aviso de crédito (experimento)</span><span class="s">Seu aparelho ou navegador não permite este aviso. O quadro do Início continua funcionando.</span></div></div>`;
  return `<div class="menu"><button data-act="${on ? "credito-aviso-desligar" : "credito-aviso-ligar"}"><span class="t">Aviso de crédito (experimento): ${on ? "ligado" : "desligado"}</span><span class="s">O Android decide quando o app roda em segundo plano; o aviso pode atrasar ou não chegar. Confie no quadro do Início. Toque para ${on ? "desligar" : "ligar"}.</span></button></div>`;
}

export function renderHome() {
  if (S.cards.length === 0) {
    return `
    <div class="hero-empty">
      <span class="label">Comece por aqui</span>
      <h2>Cadastre os cartões de benefício da família</h2>
      <p>Cadastre cada cartão com o titular, o emissor (VR, Alelo, Pluxee, Ticket, Flash, Caju…) e o saldo de hoje. Depois lance as compras à mão ou tire foto do cupom fiscal: o app lê o valor e, quando o comprovante traz o saldo do cartão, corrige o saldo daqui.</p>
      <p>Tudo fica guardado só neste celular. Faça backup de vez em quando em Ajustes.</p>
      <div class="btnrow"><button class="btn primary" data-act="new-card">+ Adicionar primeiro cartão</button><button class="btn" data-act="import">Restaurar backup</button></div>
    </div>`;
  }
  const people = holders();
  if (S.person !== null && !people.includes(S.person)) S.person = null;
  const cards = visibleCards();
  const total = cards.reduce((s, c) => s + (c.balance || 0), 0);
  const ids = new Set(cards.map(c => c.id));
  const mk = monthKey(new Date());
  const spent = S.txs.filter(t => ids.has(t.cardId) && t.kind === "debit" && t.source !== "ajuste" && (t.date || "").startsWith(mk)).reduce((s, t) => s + t.amount, 0);
  const recent = S.txs.filter(t => ids.has(t.cardId)).sort(txSort).slice(0, 15);
  const sumOf = h => S.cards.filter(c => (c.holder || "") === h).reduce((s, c) => s + (c.balance || 0), 0);
  const peopleBar = people.length > 1 ? `
    <div class="people" role="group" aria-label="Filtrar por titular">
      <button class="person" data-act="person" data-all="1" aria-pressed="${S.person === null}"><span class="n">Todos</span><span class="v num">${brl(S.cards.reduce((s, c) => s + (c.balance || 0), 0))}</span></button>
      ${people.map(h => `<button class="person" data-act="person" data-p="${esc(h)}" aria-pressed="${S.person === h}"><span class="n">${esc(h || "Sem titular")}</span><span class="v num">${brl(sumOf(h))}</span></button>`).join("")}
    </div>` : "";
  // Lembrete de backup: sem backup, backup com mais de 30 dias ou 30 lançamentos novos desde o último
  const newSinceBackup = S.meta.lastBackup ? S.txs.filter(t => (t.createdAt || 0) > S.meta.lastBackup).length : S.txs.length;
  const backupOld = S.txs.length >= 10 && (!S.meta.lastBackup || Date.now() - S.meta.lastBackup > 30 * 86400000);
  const lembreteDrive = Drive.lembrete({ drive: S.meta.drive, agora: Date.now() });
  const driveWarn = lembreteDrive.tipo === "falhando"
    ? `<div class="notice info"><span>${lembreteDrive.texto} Os dados deste celular continuam aqui; veja a ligação com o Drive.</span><span class="actions"><button class="btn small primary" data-act="m-drive">Abrir Drive</button></span></div>` : "";
  const backupWarn = driveWarn || lembreteDrive.tipo === "nenhum" ? driveWarn : backupOld || (S.meta.lastBackup && newSinceBackup >= 30)
    ? `<div class="notice info"><span>${!S.meta.lastBackup ? "Você ainda não fez backup." : backupOld ? "Seu último backup tem mais de 30 dias." : `Há ${newSinceBackup} lançamentos novos desde o último backup.`} Se o celular for perdido ou formatado, os dados vão junto.</span><span class="actions"><button class="btn small primary" data-act="backup">Fazer backup</button></span></div>` : "";
  const credited = S.txs.filter(t => ids.has(t.cardId) && isBenefitCredit(t) && (t.date || "").startsWith(mk)).reduce((s, t) => s + t.amount, 0);
  return `
    <section class="hero">
      <span class="label">Saldo disponível${S.person !== null ? " · " + esc(S.person || "sem titular") : ""}</span>
      <span class="big num">${brl(total)}</span>
      <span class="sub num">${cards.length} ${cards.length === 1 ? "cartão" : "cartões"}${people.length > 1 && S.person === null ? ` de ${people.length} pessoas` : ""}</span>
      <div class="hero-stats">
        <div><span class="k">Gasto em ${MONTHS[new Date().getMonth()]}</span><span class="v num">${brl(spent)}</span></div>
        <div><span class="k">Créditos recebidos</span><span class="v num">${brl(credited)}</span></div>
      </div>
    </section>
    ${peopleBar}
    ${renderPrevistos(cards)}
    ${renderCreditNotices(pendingCredits(cards).filter(({ c }) => !previstosHoje(cards).some(p => p.cardId === c.id)))}
    ${renderUpdateNotice()}
    ${backupWarn}
    ${renderCardToolbar()}
    <div id="cardArea">${renderCardArea()}</div>
    <div class="section-head"><h2>Últimos lançamentos</h2><button class="btn small ghost" data-act="tab" data-tab="extrato">Ver extrato</button></div>
    <section class="panel">
      ${renderTxList(recent, true)}
    </section>`;
}

// ---------- avisos de crédito: um a um ou em lote ----------
function renderCreditNotices(list) {
  if (list.length <= 1) return renderNotices(list);
  const total = list.reduce((s, { c }) => s + expectedAmount(c), 0);
  return `
    <div class="notice">
      <span><b>${list.length} cartões</b> têm crédito previsto neste período (<span class="num">${brl(total)}</span> no total). Já caíram?</span>
      <span class="actions">
        <button class="btn small primary" data-act="credit-batch">Revisar e registrar</button>
        <button class="btn small ghost" data-act="credit-later">Depois</button>
      </span>
    </div>`;
}
export function creditBatchSheet() {
  const list = pendingCredits(visibleCards());
  if (!list.length) return;
  openSheet(`
    <h3>Registrar créditos</h3>
    <p class="hint">Desmarque os cartões cujo crédito ainda não caiu. Você pode ajustar o valor de cada um.</p>
    <div class="btnrow"><button class="btn small" type="button" id="cbAll">Marcar todos</button><button class="btn small" type="button" id="cbNone">Desmarcar todos</button></div>
    <form id="cbForm" class="sform">
      <div class="chklist">
        ${list.map(({ c, ci }) => `
          <label class="chkrow">
            <input type="checkbox" data-id="${c.id}" checked>
            <span class="rinfo"><span class="rname">${esc(c.name)}</span><span class="rsub">${esc(c.holder || "sem titular")} · ${ci.estimated ? `previsto ${shortDate(ci.next)}` : `${MONTHS[ci.period.start.getMonth()]}, dia ${esc(c.creditDay)}`}${amountModeOf(c) === "variable" ? " · valor varia" : ""}</span></span>
            <input class="num amt" inputmode="decimal" data-amt="${c.id}" value="${expectedAmount(c) > 0 ? fmtInput(expectedAmount(c)) : ""}" placeholder="valor" aria-label="Valor do crédito de ${esc(c.name)}">
          </label>`).join("")}
      </div>
      <div class="err" id="cbErr"></div>
      <div class="btnrow"><button class="btn primary" type="submit" id="cbGo">Registrar marcados</button><button class="btn" type="button" data-close>Cancelar</button></div>
    </form>`, sheet => {
    const boxes = [...sheet.querySelectorAll('input[type="checkbox"][data-id]')];
    const sync = () => { const n = boxes.filter(b => b.checked).length; $("cbGo").textContent = n ? `Registrar ${n} ${n === 1 ? "crédito" : "créditos"}` : "Nada marcado"; $("cbGo").disabled = !n; };
    boxes.forEach(b => b.addEventListener("change", sync));
    $("cbAll").addEventListener("click", () => { boxes.forEach(b => b.checked = true); sync(); });
    $("cbNone").addEventListener("click", () => { boxes.forEach(b => b.checked = false); sync(); });
    sync();
    $("cbForm").addEventListener("submit", async e => {
      e.preventDefault();
      const chosen = [];
      for (const b of boxes.filter(b => b.checked)) {
        const v = parseMoney(sheet.querySelector(`[data-amt="${b.dataset.id}"]`).value);
        if (!(v > 0)) { $("cbErr").textContent = "Há um valor de crédito inválido. Use o formato 800,00."; return; }
        chosen.push({ id: b.dataset.id, v });
      }
      $("cbGo").disabled = true;
      const ok = await run(async () => {
        for (const { id, v } of chosen) {
          const card = cardById(id); const ci = card && creditInfo(card);
          if (!ci) continue;
          await registerCredit(card, v, creditDateFor(card, ci));
        }
      }, `${chosen.length} ${chosen.length === 1 ? "crédito registrado" : "créditos registrados"}.`);
      if (ok) closeSheet(); else $("cbGo").disabled = false;
    });
  });
}
