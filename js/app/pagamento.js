// Pagamento dividido entre vales e outras formas.
import { $, brl, fmtDay, fmtInput, parseMoney, uid } from "./util.js";
import { cardById, S } from "./estado.js";
import { cardPickerHTML, wirePicker } from "./cartoes.js";
import { postTxs } from "./telas.js";

// ---------- divisão do pagamento: vários vales + crédito, débito, Pix, dinheiro ----------
export const OTHER_KINDS = { credito: "Cartão de crédito", debito: "Cartão de débito", pix: "Pix", dinheiro: "Dinheiro", outro: "Outra forma" };
let splitSeq = 0;
export function splitHTML(p) {
  return `
    <div class="split" id="${p}Split">
      <div class="split-rows" id="${p}Rows"></div>
      <div class="btnrow"><button type="button" class="btn small" id="${p}AddVale">+ Outro vale</button><button type="button" class="btn small" id="${p}AddOther">+ Crédito, débito, Pix ou dinheiro</button></div>
      <label class="field" id="${p}TotalWrap"><span>Total da compra</span><input id="${p}Total" class="num" inputmode="decimal" placeholder="soma das formas de pagamento"></label>
      <div class="split-status num" id="${p}Status" role="status"></div>
    </div>`;
}
// init: { vale: [{cardId, amount}], other: [{kind, amount}], total, suggest(amount) => ranking }
export function wireSplit(p, init) {
  const rowsEl = $(p + "Rows"), totalEl = $(p + "Total");
  const listeners = [];
  if (init.total > 0) totalEl.value = fmtInput(init.total);
  const valeRows = () => [...rowsEl.querySelectorAll('.split-row[data-kind="vale"]')];
  const otherRows = () => [...rowsEl.querySelectorAll('.split-row[data-kind="other"]')];
  function addVale(cardId, amount, focus) {
    const id = p + "C" + (++splitSeq);
    const row = document.createElement("div");
    row.className = "split-row"; row.dataset.kind = "vale"; row.dataset.pid = id;
    row.innerHTML = `
      <div class="split-main">${cardPickerHTML(id, cardId || "")}</div>
      <div class="split-side"><input class="num amt money" inputmode="decimal" placeholder="0,00" value="${amount > 0 ? fmtInput(amount) : ""}" aria-label="Valor pago com este vale"><button type="button" class="mini x" data-rm aria-label="Remover esta forma de pagamento">×</button></div>
      <div class="split-after hint num"></div>`;
    rowsEl.appendChild(row);
    wirePicker(id, () => init.suggest ? init.suggest(parseMoney(row.querySelector(".amt").value) || 0) : []);
    if (focus) row.querySelector(".amt").focus();
    update();
  }
  function addOther(kind, amount, focus) {
    const row = document.createElement("div");
    row.className = "split-row"; row.dataset.kind = "other";
    row.innerHTML = `
      <div class="split-main"><select class="okind" aria-label="Forma de pagamento">${Object.entries(OTHER_KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="split-side"><input class="num amt" inputmode="decimal" placeholder="0,00" value="${amount > 0 ? fmtInput(amount) : ""}" aria-label="Valor pago desta forma"><button type="button" class="mini x" data-rm aria-label="Remover esta forma de pagamento">×</button></div>
      <div class="split-after hint">Não mexe no saldo de nenhum vale.</div>`;
    rowsEl.appendChild(row);
    if (focus) row.querySelector(".amt").focus();
    update();
  }
  const amt = row => { const v = row.querySelector(".amt").value.trim(); return v ? parseMoney(v) : 0; };
  function get() {
    const t = totalEl.value.trim();
    return {
      vale: valeRows().map(r => ({ cardId: $(r.dataset.pid).value, amount: amt(r) })),
      other: otherRows().map(r => ({ kind: r.querySelector(".okind").value, amount: amt(r) })),
      total: t ? parseMoney(t) : null,
    };
  }
  function update() {
    const vr = valeRows();
    vr.forEach(r => {
      r.querySelector("[data-rm]").hidden = vr.length === 1;
      const c = cardById($(r.dataset.pid).value), a = amt(r), out = r.querySelector(".split-after");
      if (!c) { out.textContent = "Escolha o cartão que pagou esta parte."; return; }
      if (!(a > 0)) { out.textContent = `Saldo atual: ${brl(c.balance || 0)}`; return; }
      const after = (c.balance || 0) - a;
      out.textContent = `Saldo do ${c.name} depois desta compra: ${brl(after)}${after < 0 ? " (ficaria negativo, confira)" : ""}`;
    });
    const sp = get();
    const vs = sp.vale.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
    const os = sp.other.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
    const st = $(p + "Status");
    const multi = vr.length > 1 || otherRows().length > 0;
    $(p + "TotalWrap").hidden = !multi && !(sp.total > 0);
    if (!multi) { st.textContent = ""; return; }
    let txt = `Vales: ${brl(vs)}${os ? ` · outras formas: ${brl(os)}` : ""}`;
    if (sp.total > 0) {
      const diff = sp.total - vs - os;
      txt += diff === 0 ? " · confere com o total" : diff > 0 ? ` · faltam ${brl(diff)} para o total` : ` · ${brl(-diff)} a mais que o total`;
      st.classList.toggle("bad", diff !== 0);
    } else st.classList.remove("bad");
    st.textContent = txt;
  }
  rowsEl.addEventListener("input", () => { update(); listeners.forEach(f => f()); });
  rowsEl.addEventListener("change", () => { update(); listeners.forEach(f => f()); });
  rowsEl.addEventListener("click", e => {
    const rm = e.target.closest("[data-rm]"); if (!rm) return;
    rm.closest(".split-row").remove(); update(); listeners.forEach(f => f());
  });
  totalEl.addEventListener("input", () => { update(); listeners.forEach(f => f()); });
  $(p + "AddVale").addEventListener("click", () => addVale("", 0, true));
  $(p + "AddOther").addEventListener("click", () => addOther("pix", 0, true));
  (init.vale.length ? init.vale : [{ cardId: "", amount: 0 }]).forEach(v => addVale(v.cardId, v.amount));
  (init.other || []).forEach(o => addOther(o.kind, o.amount));
  return { get, onChange: f => listeners.push(f), firstAmountInput: () => valeRows()[0].querySelector(".amt") };
}
// Confere a divisão e devolve as partes pagas com vale, ou uma mensagem de erro.
export function checkSplit(sp, allowEmpty) {
  if (sp.vale.some(r => isNaN(r.amount) || r.amount < 0) || sp.other.some(r => isNaN(r.amount) || r.amount < 0)) return { err: "Há um valor inválido. Use o formato 32,90." };
  if (sp.total !== null && (isNaN(sp.total) || sp.total < 0)) return { err: "Total da compra inválido. Use o formato 120,50." };
  const parts = sp.vale.filter(r => r.amount > 0);
  if (parts.some(r => !cardById(r.cardId))) return { err: "Escolha o cartão de cada vale usado." };
  const ids = parts.map(r => r.cardId);
  if (new Set(ids).size !== ids.length) return { err: "O mesmo cartão aparece duas vezes. Some os valores numa linha só." };
  if (!parts.length && !allowEmpty) return { err: "Informe quanto foi pago com vale, por exemplo 32,90." };
  const others = sp.other.filter(r => r.amount > 0);
  const sum = parts.reduce((s, r) => s + r.amount, 0) + others.reduce((s, r) => s + r.amount, 0);
  if (sp.total > 0 && sp.total !== sum) return { err: `As formas de pagamento somam ${brl(sum)}, mas o total é ${brl(sp.total)}. Ajuste os valores ou o total.` };
  return { parts, others, total: sp.total > 0 ? sp.total : sum };
}
// Grava uma compra (dividida ou não): um gasto por vale, todos ligados pela mesma compra.
export async function savePurchase(parts, others, total, base, extraFor) {
  const split = parts.length > 1 || others.length > 0;
  const purchase = split ? { groupId: uid(), purchaseTotal: total, otherPay: others.map(o => ({ kind: o.kind, amount: o.amount })) } : {};
  const results = [];
  for (const r of parts) {
    const card = cardById(r.cardId);
    const list = [{ kind: "debit", amount: r.amount, ...base, ...purchase }, ...(extraFor ? extraFor(card, r) : [])];
    results.push({ card, bal: await postTxs(card, list) });
  }
  return results;
}
export function dupWarning(parts, date) {
  for (const r of parts) {
    const dup = S.txs.find(t => t.cardId === r.cardId && t.kind === "debit" && t.amount === r.amount && t.date === date);
    if (dup) return `Já existe um gasto de ${brl(r.amount)} no ${cardById(r.cardId).name} em ${fmtDay(date).toLowerCase()} (“${dup.desc}”). Toque em Salvar de novo se for outra compra.`;
  }
  return null;
}
