// Cartões: lista, detalhe, seletor, edição e ajuste de saldo.
import { $, brl, esc, fmtInput, fold, ICON, ISSUERS, issuerStyle, MANY, midnight, parseMoney, shortDate, todayISO, TYPES, uid } from "./util.js";
import { cardById, holders, S, sortedCards, txSort, visibleCards } from "./estado.js";
import { amountModeOf, creditInfo, creditWhen, dayModeOf, expectedAmount, perDayOf, periodAt, periodLabel, periodShift, periodStats } from "./periodos.js";
import { askPersist, IDB, Store } from "./armazenamento.js";
import { geminiOn } from "./gemini-ui.js";
import { closeSheet, openSheet } from "./folhas.js";
import { renderSecrets } from "./cofre.js";
import { shrink } from "./cupom.js";
import { pendingCredits, renderNotices } from "./inicio.js";
import { openCard, postTxs, renderGraficos, renderTxList, run } from "./telas.js";

export async function deleteCard(card) {
  for (const t of S.txs.filter(t => t.cardId === card.id)) {
    await Store.remove("txs", t.id);
    if (t.receiptId) await IDB.del("receipts", t.receiptId);
  }
  await Store.remove("cards", card.id);
}

// ---------- leitura de cartão por foto ----------
// Gemini (se ligado) e, se falhar, o leitor do celular. A imagem não é guardada em lugar nenhum.
async function readCardImage(file, onStatus) {
  let fallbackMsg = null;
  if (geminiOn()) {
    try {
      onStatus && onStatus("Lendo com o Gemini…");
      const img = await shrink(file, 2000, 0.85, false);
      return await GeminiReader.readCard(img, { key: S.meta.gemini.key, model: S.meta.gemini.model });
    } catch (e) {
      console.warn("gemini cartão", e);
      fallbackMsg = "Gemini: " + GeminiReader.explain(e) + " Lido no celular.";
    }
  }
  try {
    onStatus && onStatus("Lendo no celular…");
    const text = await ReceiptReader.readText(file);
    const r = ReceiptReader.parseCard(text);
    r.fallbackMsg = fallbackMsg;
    return r;
  } catch (e) { console.warn("cartão", e); return null; }
}

// ---------- lista de cartões: busca, grupos por titular, cartões ou lista ----------
export const layoutNow = () => S.meta.layout || (S.cards.length > 6 ? "list" : "grid");
export function renderCardToolbar() {
  if (S.cards.length < 4) return "";
  const list = layoutNow() === "list";
  return `
    <div class="toolbar">
      <input id="cardSearch" class="search" type="search" placeholder="Buscar cartão, titular, emissor ou final" value="${esc(S.cardQuery)}" autocomplete="off" aria-label="Buscar cartão">
      <button class="btn small" data-act="layout">${list ? "Ver como cartões" : "Ver em lista"}</button>
    </div>`;
}
function matchesQuery(c, q) {
  if (!q) return true;
  const hay = fold([c.name, c.holder, c.issuer, c.last4, (TYPES[c.type] || TYPES.outro).label].join(" "));
  return fold(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
export function groupOpen(h) {
  if (h in S.groups) return S.groups[h];
  return S.cards.length <= MANY;
}
export function renderCardArea() {
  const q = S.cardQuery.trim();
  const cards = visibleCards().filter(c => matchesQuery(c, q));
  const list = layoutNow() === "list";
  const draw = cs => list
    ? `<div class="cardlist">${cs.map(renderRow).join("")}</div>`
    : `<section class="cards">${cs.map(c => renderTile(c, true)).join("")}</section>`;
  const addBtn = `<button class="btn" data-act="new-card">+ Adicionar cartão</button>`;
  if (!cards.length) return `<div class="empty">Nenhum cartão encontrado para “${esc(q)}”.</div><div class="btnrow">${addBtn}</div>`;
  const people = [...new Set(cards.map(c => c.holder || ""))];
  if (q || S.person !== null || people.length < 2) {
    return `${draw(cards)}<div class="btnrow">${addBtn}</div>`;
  }
  return people.map(h => {
    const cs = cards.filter(c => (c.holder || "") === h);
    const open = groupOpen(h);
    const sum = cs.reduce((s, c) => s + (c.balance || 0), 0);
    return `
      <section class="grp">
        <button class="grp-head" data-act="grp" data-h="${esc(h)}" aria-expanded="${open}">
          <span class="gname">${esc(h || "Sem titular")}</span>
          <span class="gmeta num">${cs.length} ${cs.length === 1 ? "cartão" : "cartões"} · ${brl(sum)}</span>
          <span class="chev" aria-hidden="true">${open ? "▴" : "▾"}</span>
        </button>
        ${open ? draw(cs) : ""}
      </section>`;
  }).join("") + `<div class="btnrow">${addBtn}</div>`;
}
function renderRow(c) {
  const st = issuerStyle(c);
  const ci = creditInfo(c);
  const pd = perDayOf(c, ci);
  const perDay = pd !== null ? `${brl(pd)}/dia útil` : ci && ci.overdue ? "aguardando crédito" : (TYPES[c.type] || TYPES.outro).label;
  return `
    <button class="cardrow" data-act="open-card" data-id="${c.id}">
      <span class="badge" style="background:${st.c}">${esc(st.s)}</span>
      <span class="rinfo"><span class="rname">${esc(c.name)}</span><span class="rsub num">${esc([c.holder, c.last4 ? "final " + c.last4 : ""].filter(Boolean).join(" · "))}${c.holder || c.last4 ? " · " : ""}${perDay}</span></span>
      <span class="rbal num">${brl(c.balance || 0)}</span>
    </button>`;
}

// ---------- seletor de cartão com busca ----------
export function pickLabel(c) {
  if (!c) return "Escolher cartão";
  const st = issuerStyle(c);
  return `<span class="badge sm" style="background:${st.c}">${esc(st.s)}</span><span class="rinfo"><span class="rname">${esc(c.name)}</span><span class="rsub num">${esc([c.holder, c.last4 ? "final " + c.last4 : ""].filter(Boolean).join(" · "))} · ${brl(c.balance || 0)}</span></span><span class="chev" aria-hidden="true">▾</span>`;
}
export function cardPickerHTML(id, selId) {
  return `
    <input type="hidden" id="${id}" value="${esc(selId || "")}">
    <div class="picker">
      <button type="button" class="pick-btn" id="${id}Btn" aria-expanded="false">${pickLabel(cardById(selId))}</button>
      <div class="pick-panel" id="${id}Panel" hidden>
        <input class="search" id="${id}Q" type="search" placeholder="Buscar por nome, titular, emissor ou final" autocomplete="off" aria-label="Buscar cartão">
        <div class="pick-list" id="${id}List" role="listbox"></div>
      </div>
    </div>`;
}
// suggestions: [{card, reasons}] mostrados no topo da lista
export function wirePicker(id, suggestions = []) {
  const hidden = $(id), btn = $(id + "Btn"), panel = $(id + "Panel"), q = $(id + "Q"), listEl = $(id + "List");
  const item = (c, why) => `<button type="button" class="pick-item ${c.id === hidden.value ? "sel" : ""}" data-pick="${c.id}" role="option" aria-selected="${c.id === hidden.value}">${pickLabel(c).replace(/<span class="chev".*$/, "")}${why ? `<span class="why">${esc(why)}</span>` : ""}</button>`;
  const draw = () => {
    const term = q.value.trim();
    const cs = sortedCards().filter(c => matchesQuery(c, term));
    const all = typeof suggestions === "function" ? suggestions() : suggestions;
    const sug = term ? [] : all.filter(s => s.reasons.length).slice(0, 3);
    listEl.innerHTML =
      (sug.length ? `<div class="label pick-sec">Sugeridos</div>${sug.map(s => item(s.card, s.reasons.join(" · "))).join("")}<div class="label pick-sec">Todos os cartões</div>` : "") +
      (cs.length ? cs.map(c => item(c)).join("") : `<div class="empty">Nenhum cartão encontrado.</div>`);
  };
  btn.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) { q.value = ""; draw(); q.focus(); }
  });
  q.addEventListener("input", draw);
  listEl.addEventListener("click", e => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    hidden.value = b.dataset.pick;
    btn.innerHTML = pickLabel(cardById(hidden.value));
    panel.hidden = true; btn.setAttribute("aria-expanded", "false");
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderTile(c, clickable) {
  const t = TYPES[c.type] || TYPES.outro;
  const ci = creditInfo(c);
  let meta = `<span>${dayModeOf(c) === "variable" ? "Registre um crédito para prever o próximo" : "Sem dia de crédito definido"}</span>`;
  if (ci) {
    const pd = perDayOf(c, ci);
    meta = `<span>${pd !== null ? `${brl(pd)}/dia útil` : "aguardando crédito"}</span><span>${creditWhen(ci)}</span>`;
  }
  const attrs = clickable ? `data-act="open-card" data-id="${c.id}"` : `tabindex="-1" aria-disabled="true"`;
  return `
    <button class="cardtile ${clickable ? "" : "static"}" style="--tc:${issuerStyle(c).c}" ${attrs}>
      <div class="row">
        <div><div class="issuer">${esc(c.issuer || "")}${c.last4 ? ` · final ${esc(c.last4)}` : ""}</div><div class="name">${esc(c.name)}</div>${c.holder ? `<div class="holder">${esc(c.holder)}</div>` : ""}</div>
        <span class="chip">${esc(t.label)}</span>
      </div>
      <div>
        <div class="bal num">${brl(c.balance || 0)}</div>
        <div class="meta num">${meta}</div>
      </div>
    </button>`;
}

export function renderCard(c) {
  const ci = creditInfo(c);
  const cur = periodAt(c, new Date());
  const p = periodShift(c, cur, S.periodOffset);
  const st = periodStats(c, p);
  const isCurrent = S.periodOffset === 0;
  const bal = c.balance || 0;
  let quick = "";
  if (isCurrent && ci) {
    const pd = perDayOf(c, ci);
    const elapsed = Math.round((midnight(new Date()) - p.start) / 86400000) + 1;
    const exp = expectedAmount(c);
    const pct = exp > 0 ? Math.max(0, Math.min(100, Math.round(bal / exp * 100))) : null;
    const amtLabel = amountModeOf(c) === "variable" ? (exp > 0 ? `valor varia · último ${brl(exp)}` : "valor varia") : (c.monthlyCredit ? brl(c.monthlyCredit) : "valor não informado");
    const estLabel = ci.estimated ? (ci.est.samples ? `previsão pela média de ${ci.est.avg} dias entre créditos` : "previsão: 30 dias após o último crédito") : "";
    quick = `
      <div class="stats">
        <div class="stat"><span class="h">Pode gastar por dia útil</span><span class="v num">${pd !== null ? brl(pd) : "—"}</span><span class="h">${pd !== null ? `${ci.workdays} dias úteis até o crédito${ci.estimated ? " (previsto)" : ""}` : "o crédito previsto ainda não foi registrado"}</span></div>
        <div class="stat"><span class="h">Próximo crédito${ci.estimated ? " (previsão)" : ""}</span><span class="v num">${ci.estimated ? "~" : ""}${shortDate(ci.next)}</span><span class="h num">${amtLabel}</span></div>
        <div class="stat"><span class="h">Gasto médio por dia</span><span class="v num">${brl(Math.round(st.debits / Math.max(1, elapsed)))}</span><span class="h">neste período</span></div>
      </div>
      ${estLabel ? `<p class="hint">${esc(estLabel)}. A previsão melhora a cada crédito registrado.</p>` : ""}
      ${pct !== null ? `<div class="pace"><div class="cap"><span>Saldo restante em relação ao ${amountModeOf(c) === "variable" ? "último crédito" : "crédito mensal"}</span><span class="num">${pct}%</span></div><div class="bar"><span style="width:${pct}%"></span></div></div>` : ""}`;
  } else if (isCurrent) {
    quick = dayModeOf(c) === "variable"
      ? `<p class="hint">Este cartão recebe o crédito em dias variados. Registre o próximo crédito em “Adicionar crédito” para o app separar os períodos e prever os seguintes.</p>`
      : `<p class="hint">Informe o dia do crédito em “Editar” (fixo ou variável) para o app calcular quanto dá para gastar por dia útil e separar os períodos pelo ciclo do benefício.</p>`;
  }
  const hasEarlier = S.txs.some(t => t.cardId === c.id && t.date < p.startISO);
  return `
    <div class="btnrow" style="justify-content:space-between">
      <button class="back" data-act="home">← Cartões</button>
      <button class="btn small" data-act="edit-card" data-id="${c.id}">Editar cartão</button>
    </div>
    <section class="cards" style="grid-template-columns:1fr">${renderTile(c, false)}</section>
    ${renderNotices(pendingCredits([c]))}
    <div class="actions-grid">
      <button class="qa primary" data-act="new-tx" data-id="${c.id}" data-kind="debit">${ICON.gasto}Gasto</button>
      <button class="qa" data-act="scan" data-id="${c.id}">${ICON.cupom}Ler cupom</button>
      <button class="qa" data-act="new-tx" data-id="${c.id}" data-kind="credit">${ICON.credito}Crédito</button>
      <button class="qa" data-act="adjust" data-id="${c.id}">${ICON.corrigir}Corrigir</button>
    </div>
    <button class="linkbtn" data-act="scan-gallery" data-id="${c.id}">Ler cupom de uma foto da galeria</button>
    <section class="panel">
      <div class="panel-head">
        <h2>${isCurrent ? "Período atual" : "Período"}</h2>
        <div class="pernav">
          <button class="iconbtn" data-act="per" data-d="-1" aria-label="Período anterior" ${hasEarlier ? "" : "disabled"}>‹</button>
          <span class="p num">${esc(periodLabel(c, p))}</span>
          <button class="iconbtn" data-act="per" data-d="1" aria-label="Próximo período" ${isCurrent ? "disabled" : ""}>›</button>
        </div>
      </div>
      <div class="stats four">
        <div class="stat"><span class="h">Saldo no início</span><span class="v num">${brl(st.opening)}</span></div>
        <div class="stat"><span class="h">Créditos</span><span class="v num in">+${brl(st.credits)}</span></div>
        <div class="stat"><span class="h">Gastos</span><span class="v num">−${brl(st.debits)}</span></div>
        <div class="stat"><span class="h">${isCurrent ? "Saldo agora" : "Saldo no fim"}</span><span class="v num">${brl(isCurrent ? bal : st.closing)}</span>${st.adjust ? `<span class="h num">ajustes ${st.adjust > 0 ? "+" : ""}${brl(st.adjust)}</span>` : ""}</div>
      </div>
      ${quick}
    </section>
    ${renderGraficos([c], S.periodOffset, false)}
    <section class="panel">
      <div class="panel-head"><h2>Extrato do período</h2><span class="label num">${st.txs.length} lançamentos</span></div>
      ${renderTxList(st.txs.sort(txSort), false)}
    </section>
    ${renderSecrets(c)}
    <div class="btnrow"><button class="btn danger small" data-act="del-card" data-id="${c.id}">Excluir cartão</button></div>`;
}

export function cardSheet(card) {
  const isNew = !card;
  const c = card || { name: "", holder: S.person || "", type: "refeicao", issuer: "VR", last4: "", monthlyCredit: 0, creditDay: "" };
  openSheet(`
    <h3>${isNew ? "Novo cartão" : "Editar cartão"}</h3>
    <div class="photofill">
      <span class="hint">Preencher por foto:</span>
      <div class="btnrow">
        <button class="btn small" type="button" id="cpCamBtn">${ICON.cupom}Foto do cartão</button>
        <button class="btn small" type="button" id="cpGalBtn">${ICON.cartao}Print do app do emissor</button>
      </div>
      <input type="file" id="cpCam" accept="image/*" capture="environment" hidden>
      <input type="file" id="cpGal" accept="image/*" hidden>
      <div id="cpStatus" class="hint" role="status"></div>
    </div>
    <form id="cardForm" class="sform">
      <div class="grid2">
        <label class="field"><span>Nome do cartão</span><input id="cName" maxlength="40" value="${esc(c.name)}" placeholder="Ex.: VR Refeição" autofocus></label>
        <label class="field"><span>Titular</span><input id="cHolder" maxlength="40" list="holderList" value="${esc(c.holder || "")}" placeholder="Ex.: Ana"><datalist id="holderList">${holders().filter(Boolean).map(h => `<option value="${esc(h)}">`).join("")}</datalist></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Tipo</span><select id="cType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === c.type ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
        <label class="field"><span>Emissor</span><select id="cIssuer">${ISSUERS.map(i => `<option ${i === c.issuer ? "selected" : ""}>${esc(i)}</option>`).join("")}</select></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Final do cartão</span><input id="cLast4" inputmode="numeric" maxlength="4" value="${esc(c.last4 || "")}" placeholder="4 últimos dígitos"></label>
        ${isNew ? `<label class="field"><span>Saldo de hoje</span><input id="cBalance" class="num" inputmode="decimal" placeholder="0,00"></label>` : "<span></span>"}
      </div>
      <span class="hint">O final do cartão ajuda a reconhecer de quem é cada cupom fiscal.</span>
      <div class="grid2">
        <label class="field"><span>Valor do crédito</span><select id="cAmtMode"><option value="fixed" ${amountModeOf(c) === "fixed" ? "selected" : ""}>Fixo todo mês</option><option value="variable" ${amountModeOf(c) === "variable" ? "selected" : ""}>Varia</option></select></label>
        <label class="field" id="cCreditWrap"><span>Valor mensal</span><input id="cCredit" class="num" inputmode="decimal" placeholder="0,00" value="${c.monthlyCredit ? fmtInput(c.monthlyCredit) : ""}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Dia do crédito</span><select id="cDayMode"><option value="fixed" ${dayModeOf(c) === "fixed" ? "selected" : ""}>Dia fixo</option><option value="variable" ${dayModeOf(c) === "variable" ? "selected" : ""}>Varia</option><option value="none" ${dayModeOf(c) === "none" ? "selected" : ""}>Não controlar</option></select></label>
        <label class="field" id="cDayWrap"><span>Dia do mês</span><input id="cDay" type="number" min="1" max="31" inputmode="numeric" placeholder="ex.: 5" value="${esc(c.creditDay || "")}"></label>
        <label class="field" id="cLastWrap"><span>Último crédito caiu em</span><input id="cLast" type="date" value="${esc(c.lastCreditDate || "")}"></label>
      </div>
      <span class="hint" id="cHint"></span>
      <div class="err" id="cErr"></div>
      <div class="btnrow"><button class="btn primary" type="submit">${isNew ? "Adicionar cartão" : "Salvar alterações"}</button><button class="btn" type="button" data-close>Cancelar</button></div>
    </form>`, () => {
    // ---- preencher por foto (cartão ou print do app) ----
    const onPhoto = async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      const st = $("cpStatus");
      st.innerHTML = `<span class="loading"><span class="spin"></span>Lendo a imagem…</span>`;
      const r = await readCardImage(f, msg => { if ($("cpStatus")) $("cpStatus").textContent = msg; });
      if (!$("cardForm")) return;
      if (!r) { st.textContent = "Não consegui ler a imagem. Preencha os campos à mão."; return; }
      const filled = [];
      const setV = (id, v, label) => { if (v && $(id)) { $(id).value = v; filled.push(label); } };
      if (r.issuer && ISSUERS.includes(r.issuer)) setV("cIssuer", r.issuer, "emissor");
      if (r.type && TYPES[r.type]) setV("cType", r.type, "tipo");
      setV("cLast4", r.last4, "final");
      setV("cHolder", r.holder, "titular");
      if (r.balance !== null && r.balance !== undefined && $("cBalance")) setV("cBalance", fmtInput(r.balance), "saldo");
      if (!$("cName").value.trim() && (r.issuer || r.type)) {
        $("cName").value = [r.issuer && r.issuer !== "Outro" ? r.issuer.replace(" (Sodexo)", "") : "", r.type ? TYPES[r.type].label : ""].filter(Boolean).join(" ");
        filled.push("nome");
      }
      st.textContent = filled.length
        ? `${r.source === "gemini" ? "Lido pelo Gemini" : "Lido no celular"}: ${filled.join(", ")}. Confira antes de salvar.${r.fallbackMsg ? " (" + r.fallbackMsg + ")" : ""}`
        : "Não encontrei os dados do cartão nessa imagem. Tente uma foto mais nítida da frente do cartão ou preencha à mão.";
    };
    $("cpCam").addEventListener("change", onPhoto);
    $("cpGal").addEventListener("change", onPhoto);
    $("cpCamBtn").addEventListener("click", () => $("cpCam").click());
    $("cpGalBtn").addEventListener("click", () => $("cpGal").click());

    const syncModes = () => {
      const am = $("cAmtMode").value, dm = $("cDayMode").value;
      $("cCreditWrap").querySelector("span").textContent = am === "fixed" ? "Valor mensal" : "Valor aproximado (opcional)";
      $("cDayWrap").hidden = dm !== "fixed";
      $("cLastWrap").hidden = dm !== "variable";
      $("cHint").textContent = dm === "fixed"
        ? "Cada período vai do dia do crédito até a véspera do próximo."
        : dm === "variable"
          ? "Os períodos vão de um crédito registrado até o seguinte, e o app prevê o próximo pela média entre os créditos. Informe quando caiu o último para começar."
          : "Sem controle de crédito: os períodos são os meses do calendário e não há aviso de crédito.";
      if (am === "variable") $("cHint").textContent += " Como o valor varia, o app pergunta o valor a cada crédito.";
    };
    $("cAmtMode").addEventListener("change", syncModes);
    $("cDayMode").addEventListener("change", syncModes);
    syncModes();
    $("cardForm").addEventListener("submit", async e => {
      e.preventDefault();
      const name = $("cName").value.trim();
      const amountMode = $("cAmtMode").value, dayMode = $("cDayMode").value;
      const credit = $("cCredit").value.trim() ? parseMoney($("cCredit").value) : 0;
      const dayRaw = $("cDay").value.trim();
      const day = dayMode === "fixed" && dayRaw ? Math.round(Number(dayRaw)) : "";
      const lastCreditDate = dayMode === "variable" ? $("cLast").value : "";
      const last4 = $("cLast4").value.trim();
      if (!name) { $("cErr").textContent = "Dê um nome ao cartão."; return; }
      if (last4 && !/^\d{4}$/.test(last4)) { $("cErr").textContent = "O final do cartão deve ter 4 números."; return; }
      if (isNaN(credit) || credit < 0) { $("cErr").textContent = "Valor do crédito inválido. Use o formato 800,00."; return; }
      if (dayMode === "fixed" && !(day >= 1 && day <= 31)) { $("cErr").textContent = "Informe o dia do crédito, entre 1 e 31."; return; }
      if (lastCreditDate && lastCreditDate > todayISO()) { $("cErr").textContent = "A data do último crédito não pode ser no futuro."; return; }
      const fields = { name, holder: $("cHolder").value.trim(), type: $("cType").value, issuer: $("cIssuer").value, last4, monthlyCredit: credit, creditDay: day, dayMode, amountMode, lastCreditDate };
      if (isNew) {
        const bal = $("cBalance").value.trim() ? parseMoney($("cBalance").value) : 0;
        if (isNaN(bal) || bal < 0) { $("cErr").textContent = "Saldo inválido. Use o formato 450,75."; return; }
        const newCard = { id: uid(), ...fields, balance: 0, createdAt: Date.now(), secret: null };
        // O saldo informado já inclui o crédito do período atual.
        if (day) newCard.lastCreditMonth = periodAt(newCard, new Date()).key;
        const ok = await run(async () => {
          await Store.put("cards", newCard);
          if (bal > 0) await postTxs(newCard, [{ kind: "credit", amount: bal, desc: "Saldo inicial", source: "ajuste", date: todayISO() }]);
        }, "Cartão adicionado.");
        if (ok) { askPersist(); closeSheet(); openCard(newCard.id); }
      } else {
        const ok = await run(() => Store.patch("cards", card.id, fields), "Cartão atualizado.");
        if (ok) closeSheet();
      }
    });
  });
}

export function adjustSheet(card) {
  openSheet(`
    <h3>Corrigir saldo</h3>
    <p class="hint">Use quando o saldo do app do ${esc(card.issuer || "emissor")} for diferente do daqui. A diferença entra no extrato como “Ajuste de saldo”.</p>
    <form id="adjForm" class="sform">
      <label class="field"><span>Saldo real hoje</span><input id="adjVal" class="money num" inputmode="decimal" value="${fmtInput(card.balance || 0)}" autofocus></label>
      <div class="err" id="adjErr"></div>
      <div class="btnrow"><button class="btn primary" type="submit">Salvar saldo</button><button class="btn" type="button" data-close>Cancelar</button></div>
    </form>`, () => {
    $("adjVal").select();
    $("adjForm").addEventListener("submit", async e => {
      e.preventDefault();
      const v = parseMoney($("adjVal").value);
      if (isNaN(v) || v < 0) { $("adjErr").textContent = "Digite o saldo no formato 123,45."; return; }
      const diff = v - (card.balance || 0);
      if (diff === 0) { closeSheet(); return; }
      const ok = await run(() => postTxs(card, [{ kind: diff > 0 ? "credit" : "debit", amount: Math.abs(diff), desc: "Ajuste de saldo", source: "ajuste", date: todayISO() }]), "Saldo corrigido.");
      if (ok) closeSheet();
    });
  });
}
