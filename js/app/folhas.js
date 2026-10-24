// Folhas (janelas de baixo para cima), histórico do botão voltar e formulário de lançamento.
import { $, brl, CATS, esc, parseMoney, toast, todayISO } from "./util.js";
import { cardById, S, sortedCards, ui, visibleCards } from "./estado.js";
import { checkSplit, dupWarning, savePurchase, splitHTML, wireSplit } from "./pagamento.js";
import { cardPickerHTML, wirePicker } from "./cartoes.js";
import { registerCredit } from "./inicio.js";
import { postTxs, reduceMotion, run } from "./telas.js";

// ---------- folhas (formulários) ----------
// Histórico: cada folha aberta e cada cartão aberto ganham uma entrada, para o "voltar" do Android funcionar.
// Quando o próprio app chama history.back(), o popstate seguinte é só a confirmação disso.
export const hist = { pending: false, after: [] };
export function whenHistoryIdle(fn) { if (hist.pending) hist.after.push(fn); else fn(); }
function goBack() { hist.pending = true; history.back(); }

export function openSheet(html, onMount, opts = {}) {
  closeSheet(true, true);
  const root = $("sheetRoot");
  root.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  if (opts.secret) $("scrim").dataset.secret = "1";
  const sheet = root.querySelector(".sheet");
  // Toque fora fecha só janelas sem formulário, para não perder o que foi digitado.
  $("scrim").addEventListener("click", e => { if (e.target.id === "scrim" && !sheet.querySelector("form, #scanBody")) closeSheet(); });
  sheet.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeSheet()));
  onMount && onMount(sheet);
  const first = root.querySelector("[autofocus]");
  first && first.focus({ preventScroll: true });
  whenHistoryIdle(() => { if ($("scrim") && !(history.state && history.state.sheet)) history.pushState({ sheet: true }, ""); });
  return sheet;
}
// keepHistory: não mexe no histórico (o "voltar" já foi usado). instant: troca de folha, sem animação de saída.
export function closeSheet(keepHistory, instant) {
  if (ui.sheetCleanup) { const f = ui.sheetCleanup; ui.sheetCleanup = null; f(); }
  const scrim = $("scrim");
  if (scrim) {
    if (instant || reduceMotion()) scrim.remove();
    else {
      // tira os ids antes da animação, para a próxima folha não confundir os campos
      scrim.removeAttribute("id");
      scrim.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
      scrim.classList.add("closing");
      setTimeout(() => scrim.remove(), 240);
    }
  }
  if (scrim && keepHistory !== true && !hist.pending && history.state && history.state.sheet) goBack();
}
// Botão "voltar" do Android fecha a folha aberta ou volta para a lista de cartões.

export function catButtons(cur) { return CATS.map(c => `<button type="button" data-cat="${c}" aria-pressed="${c === cur}">${c}</button>`).join(""); }
export function wireCats(sheet, state) {
  sheet.querySelectorAll(".cats button").forEach(b => b.addEventListener("click", () => {
    state.cat = state.cat === b.dataset.cat ? "" : b.dataset.cat;
    sheet.querySelectorAll(".cats button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.cat === state.cat)));
  }));
}
export const defaultCardId = () => S.view.name === "card" ? S.view.id : ((visibleCards()[0] || sortedCards()[0]) || {}).id || "";

export function txSheet(cardId, kind = "debit") {
  const sel = cardId || defaultCardId();
  const state = { kind, cat: "" };
  openSheet(`
    <h3 id="txTitle"></h3>
    <div class="seg" role="group" aria-label="Tipo de lançamento">
      <button type="button" data-k="debit">Gasto</button><button type="button" data-k="credit">Crédito</button>
    </div>
    <form id="txForm" class="sform">
      <div id="debitFields" class="field"><span>Pago com vale</span>${splitHTML("ts")}</div>
      <div id="creditFields" class="sform">
        <label class="field"><span>Valor</span><input id="txAmount" class="money num" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>
        <div class="field"><span>Cartão</span>${cardPickerHTML("txCard", sel)}</div>
      </div>
      <div class="field" id="catField"><span>Categoria</span><div class="cats">${catButtons("")}</div></div>
      <label class="check" id="benefitWrap"><input type="checkbox" id="txBenefit" checked> <span>É o crédito do benefício (começa um novo período). Desmarque para estorno ou devolução.</span></label>
      <label class="field"><span>Descrição (opcional)</span><input id="txDesc" maxlength="60" placeholder="Ex.: almoço no restaurante da esquina"></label>
      <label class="field"><span>Data</span><input id="txDate" type="date" value="${todayISO()}"></label>
      <div class="err" id="txErr"></div>
      <div class="btnrow"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-close>Cancelar</button></div>
    </form>`, sheet => {
    const sync = () => {
      sheet.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === state.kind)));
      $("txTitle").textContent = state.kind === "debit" ? "Lançar gasto" : "Adicionar crédito";
      $("catField").hidden = state.kind !== "debit";
      $("benefitWrap").hidden = state.kind !== "credit";
      $("debitFields").hidden = state.kind !== "debit";
      $("creditFields").hidden = state.kind !== "credit";
    };
    sheet.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
      state.kind = b.dataset.k; sync();
      (state.kind === "debit" ? split.firstAmountInput() : $("txAmount")).focus();
    }));
    wireCats(sheet, state);
    wirePicker("txCard");
    const split = wireSplit("ts", { vale: [{ cardId: sel, amount: 0 }], other: [] });
    sync();
    (state.kind === "debit" ? split.firstAmountInput() : $("txAmount")).focus();
    $("txForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (state.kind === "debit") {
        const chk = checkSplit(split.get());
        if (chk.err) { $("txErr").textContent = chk.err; return; }
        const date = $("txDate").value || todayISO();
        const warn = dupWarning(chk.parts, date);
        if (warn && !state.dupOk) { state.dupOk = true; $("txErr").textContent = warn; return; }
        let results = [];
        const desc = $("txDesc").value.trim() || state.cat || "Compra";
        const ok = await run(async () => { results = await savePurchase(chk.parts, chk.others, chk.total, { desc, cat: state.cat, date }); });
        if (ok) { toast(results.length === 1 ? `Gasto salvo. Saldo do ${results[0].card.name}: ${brl(results[0].bal)}` : `Gasto salvo em ${results.length} vales.`); closeSheet(); }
        return;
      }
      const amount = parseMoney($("txAmount").value);
      const card = cardById($("txCard").value);
      if (!(amount > 0)) { $("txErr").textContent = "Informe um valor maior que zero, por exemplo 32,90."; return; }
      if (!card) { $("txErr").textContent = "Escolha um cartão."; return; }
      const date = $("txDate").value || todayISO();
      const benefit = state.kind === "credit" && $("txBenefit").checked;
      let bal;
      const ok = await run(async () => {
        if (benefit) { await registerCredit(card, amount, date); bal = cardById(card.id).balance; return; }
        const desc = $("txDesc").value.trim() || (state.kind === "debit" ? (state.cat || "Compra") : "Crédito avulso");
        bal = await postTxs(card, [{ kind: state.kind, amount, desc, cat: state.kind === "debit" ? state.cat : "", date }]);
      });
      if (ok) { toast(state.kind === "debit" ? `Gasto salvo. Saldo do ${card.name}: ${brl(bal)}` : "Crédito salvo."); closeSheet(); }
    });
  });
}

export function confirmSheet(title, html, label, action) {
  openSheet(`
    <h3>${esc(title)}</h3>
    <p>${html}</p>
    <div class="btnrow"><button class="btn dangerfill" id="cfOk">${esc(label)}</button><button class="btn" data-close>Cancelar</button></div>`, () => {
    $("cfOk").addEventListener("click", async () => { const ok = await action(); if (ok) closeSheet(); });
  });
}
