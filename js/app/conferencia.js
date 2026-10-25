// Conferência do cupom lido (formulário de revisão).
import { $, brl, esc, fmtInput, ISSUERS, parseMoney, toast, todayISO, TYPES, uid } from "./util.js";
import { cardById, holders, lastTxDate, S, ui } from "./estado.js";
import { askPersist, IDB, Store } from "./armazenamento.js";
import { checkSplit, dupWarning, OTHER_KINDS, savePurchase, splitHTML, wireSplit } from "./pagamento.js";
import { catButtons, closeSheet, defaultCardId, wireCats } from "./folhas.js";
import { pickLabel } from "./cartoes.js";
import { nextScan, rankCards, scanQueue, storeKeyOf } from "./cupom.js";
import { postTxs, run } from "./telas.js";

export function reviewForm(sheet, blob, presetCardId, d, msg, rawText) {
  if (!sheet.querySelector("#scanBody")) return;
  d = Match.promoverVales(d || {}, S.cards);
  // Um cartão sugerido para cada parte paga com vale, e avisos de cartão que pode não estar na carteira
  const { saldos, others, parts, unknown } = Match.matchReceipt(d, S.cards, S.txs, presetCardId, defaultCardId());
  const pays = d.payments || [];
  const unkLabel = u => esc([u.issuer || u.issuerRaw, u.last4 ? "final " + u.last4 : ""].filter(Boolean).join(" ") || "deste cupom");
  const unknownHTML = unknown.map(u => {
    const amt = u.amount ? ` (<span class="num">${brl(u.amount)}</span>)` : "";
    const text = u.kind === "novo"
      ? `O cartão <b>${unkLabel(u)}</b>${amt} não está cadastrado na sua carteira.`
      : u.kind === "saldo"
        ? `O saldo impresso no cupom (<b class="num">${brl(u.saldo)}</b>)${u.issuer ? ` do ${esc(u.issuer)}` : ""} não fecha com nenhum cartão cadastrado. Pode ser um cartão que ainda não está na carteira.`
        : `Se esta compra${amt} foi paga com um cartão que não está na carteira, cadastre na hora.`;
    const btns = `<button type="button" class="btn small${u.kind === "fraco" ? "" : " primary"}" data-newcard="${u.i}">${u.kind === "fraco" ? "Cadastrar outro cartão" : "Cadastrar agora"}</button>`
      + (u.alt ? `<button type="button" class="btn small" data-isit="${u.i}">É o ${esc(u.alt.name)}</button>` : "");
    return `
    <div class="notice${u.kind === "fraco" ? " info" : ""}" id="unk${u.i}">
      <span>${text}</span>
      <span class="actions">${btns}</span>
    </div>
    <div id="ncBox${u.i}"></div>`;
  }).join("");
  const hardUnknown = i => unknown.some(u => u.i === i && u.kind !== "fraco");
  const suggestLine = parts.map((pt, i) => hardUnknown(i) ? "" : pt.pick && pt.pick.reasons.length
    ? `<span>${parts.length > 1 ? `Vale ${i + 1} (${brl(pt.amount)}): ` : "Cartão "}${pt.confident ? "identificado" : "provável"}: <b>${esc(pt.pick.card.name)}</b>${pt.pick.card.holder ? ` (${esc(pt.pick.card.holder)})` : ""} · ${esc(pt.pick.reasons.join(", "))}${pt.confident ? "" : " (confira o cartão)"}</span>`
    : S.cards.length > 1 ? `<span>${parts.length > 1 ? `Vale ${i + 1}: n` : "N"}ão consegui identificar o cartão pelo cupom. Escolha abaixo.</span>` : "").join("");
  const date = d.date || todayISO();
  const state = { cat: d.category || "", dupOk: false };
  const payLine = pays.length > 1 ? `<span>Pagamento: ${esc(pays.map(p => `${p.kind === "vale" ? "vale" : OTHER_KINDS[p.kind] || p.kind} ${brl(p.amount)}`).join(" + "))}</span>` : "";
  const summary = d.found && d.found.length ? `
    <div class="found">
      <span><b>${d.source === "gemini" ? "Lido pelo Gemini" : "Lido no celular"}:</b> ${esc(d.found.join(", "))}${d.issuer ? ` · ${esc(d.issuer)}` : ""}${d.last4 ? ` final ${esc(d.last4)}` : ""}</span>
      ${payLine}
      <span>${saldos.length ? `Saldo${saldos.length > 1 ? "s" : ""} do vale impresso${saldos.length > 1 ? "s" : ""}: <b class="num">${saldos.map(brl).join(" · ")}</b>${d.balanceMoment === "antes_compra" ? " (já descontada esta compra)" : ""}` : "O cupom não mostra o saldo do cartão: o saldo daqui será descontado pelo valor pago."}</span>
      ${suggestLine}
      <span class="hint">Confira os valores com o papel antes de salvar.</span>
    </div>` : (suggestLine ? `<div class="found">${suggestLine}</div>` : "");
  sheet.querySelector("#scanBody").outerHTML = `
    ${msg ? `<div class="notice">${esc(msg)}</div>` : ""}
    ${d.recorteMini ? `<div class="found recorte-usado"><img src="${d.recorteMini}" alt="Recorte usado na leitura"><span>O app recortou a foto antes de ler.<br><button type="button" class="btn small" id="rNoCrop">Ler de novo sem recorte</button></span></div>` : ""}
    ${summary}
    ${unknownHTML}
    <form id="rForm" class="sform">
      <div class="field"><span>Pago com vale</span>${splitHTML("rs")}</div>
      <div class="grid2">
        <label class="field"><span>Estabelecimento</span><input id="rDesc" maxlength="60" value="${esc(d.store || "")}"></label>
        <label class="field"><span>Data</span><input id="rDate" type="date" value="${date}"></label>
      </div>
      <div class="field"><span>Categoria</span><div class="cats">${catButtons(state.cat)}</div></div>
      <div id="rSaldoBox">
        <label class="field"><span>Saldo do vale impresso no cupom (se houver)</span><input id="rSaldo" class="num" inputmode="decimal" placeholder="não informado" value="${saldos.length === 1 && saldos[0] >= 0 ? fmtInput(saldos[0]) : ""}"></label>
        <label class="check" id="rUseWrap"><input type="checkbox" id="rUse"> <span id="rUseTxt"></span></label>
      </div>
      ${d.how ? `<details class="raw"><summary>Como foi lido</summary><p class="hint num" style="margin-top:8px">${esc(d.how)}</p></details>` : ""}
      ${rawText ? `<details class="raw"><summary>${d.source === "gemini" ? "Ver resposta do Gemini" : "Ver texto lido da foto"}</summary><pre></pre></details>` : ""}
      <div class="err" id="rErr"></div>
      <div class="btnrow">
        <button class="btn primary" type="submit" id="rSave">Salvar</button>
        <button class="btn" type="button" id="rSkip">${scanQueue.length ? "Pular este cupom" : "Cancelar"}</button>
      </div>
    </form>`;
  const pre = sheet.querySelector("details.raw pre");
  if (pre) pre.textContent = rawText;
  wireCats(sheet, state);
  const split = wireSplit("rs", {
    vale: parts.map(pt => ({ cardId: pt.cardId, amount: pt.amount })),
    other: others,
    total: pays.length > 1 && d.total > 0 ? d.total : null,
    suggest: a => rankCards(d, a, saldos, presetCardId),
  });

  // ---- cadastrar na hora o cartão que não está na carteira ----
  const typeFromCat = { Mercado: "alimentacao", Feira: "alimentacao", Restaurante: "refeicao", Lanche: "refeicao", Padaria: "refeicao", Delivery: "refeicao" };
  // escolhe um cartão para o vale da linha k, como se fosse pelo seletor
  const selectRow = (k, cardId) => {
    const row = [...sheet.querySelectorAll('#rsRows .split-row[data-kind="vale"]')][k];
    if (!row) return;
    const hidden = $(row.dataset.pid);
    hidden.value = cardId;
    $(row.dataset.pid + "Btn").innerHTML = pickLabel(cardById(cardId));
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
  };
  sheet.addEventListener("click", async e => {
    const isit = e.target.closest("[data-isit]");
    if (isit) {
      const u = unknown.find(x => x.i === +isit.dataset.isit);
      selectRow(u.i, u.alt.id);
      $("ncBox" + u.i).innerHTML = "";
      $("unk" + u.i).className = "notice info";
      $("unk" + u.i).innerHTML = `<span><b>${esc(u.alt.name)}</b> escolhido para este vale.${u.kind === "saldo" ? " Como o saldo daqui não batia com o do cupom, confira abaixo a opção de usar o saldo do cupom." : ""}</span>`;
      return;
    }
    const open = e.target.closest("[data-newcard]");
    const save = e.target.closest("[data-ncsave]");
    const cancel = e.target.closest("[data-nccancel]");
    if (open) {
      const u = unknown.find(x => x.i === +open.dataset.newcard);
      const type = u.type && TYPES[u.type] ? u.type : typeFromCat[state.cat] || "alimentacao";
      const issuer = u.issuer && ISSUERS.includes(u.issuer) ? u.issuer : "Outro";
      const k = u.i;
      $("ncBox" + k).innerHTML = `
        <div class="newcard">
          <h4>Novo cartão</h4>
          <div class="grid2">
            <label class="field"><span>Nome do cartão</span><input id="ncName${k}" maxlength="40" value="${esc([issuer !== "Outro" ? issuer.replace(" (Sodexo)", "") : u.issuerRaw || "", TYPES[type].label].filter(Boolean).join(" ").slice(0, 40))}"></label>
            <label class="field"><span>Titular</span><input id="ncHolder${k}" maxlength="40" list="ncHolders${k}" value="${esc(u.holder || S.person || "")}" placeholder="Ex.: Ana"><datalist id="ncHolders${k}">${holders().filter(Boolean).map(h => `<option value="${esc(h)}">`).join("")}</datalist></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Tipo</span><select id="ncType${k}">${Object.entries(TYPES).map(([t, v]) => `<option value="${t}" ${t === type ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
            <label class="field"><span>Emissor</span><select id="ncIssuer${k}">${ISSUERS.map(x => `<option ${x === issuer ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Final do cartão</span><input id="ncLast${k}" inputmode="numeric" maxlength="4" value="${esc(u.last4 || "")}" placeholder="4 últimos dígitos"></label>
            <label class="field"><span>${u.saldo !== null ? "Saldo após a compra" : "Saldo antes da compra"}</span><input id="ncBal${k}" class="num" inputmode="decimal" placeholder="0,00" value="${u.saldo !== null && u.saldo >= 0 ? fmtInput(u.saldo) : ""}"></label>
          </div>
          <span class="hint">${u.saldo !== null ? "Veio do saldo impresso no cupom. " : ""}O dia e o valor do crédito você completa depois, em Editar cartão.</span>
          <div class="err" id="ncErr${k}"></div>
          <div class="btnrow"><button type="button" class="btn primary" data-ncsave="${k}">Adicionar cartão</button><button type="button" class="btn" data-nccancel="${k}">Cancelar</button></div>
        </div>`;
      open.hidden = true;
      $("ncName" + k).focus();
    } else if (cancel) {
      const k = +cancel.dataset.nccancel;
      $("ncBox" + k).innerHTML = "";
      const b = sheet.querySelector(`[data-newcard="${k}"]`); if (b) b.hidden = false;
    } else if (save) {
      const k = +save.dataset.ncsave;
      const u = unknown.find(x => x.i === k);
      const name = $("ncName" + k).value.trim(), last4 = $("ncLast" + k).value.trim();
      const balRaw = $("ncBal" + k).value.trim(), bal = balRaw ? parseMoney(balRaw) : 0;
      if (!name) { $("ncErr" + k).textContent = "Dê um nome ao cartão."; return; }
      if (last4 && !/^\d{4}$/.test(last4)) { $("ncErr" + k).textContent = "O final do cartão deve ter 4 números."; return; }
      if (isNaN(bal) || bal < 0) { $("ncErr" + k).textContent = "Saldo inválido. Use o formato 450,75."; return; }
      // valor que este vale pagou (pode ter sido corrigido na tela)
      const valeRows = [...sheet.querySelectorAll('#rsRows .split-row[data-kind="vale"]')];
      const row = valeRows[k];
      const rowAmt = row ? (parseMoney(row.querySelector(".amt").value) || 0) : u.amount || 0;
      // o saldo inicial fica de modo que, depois desta compra, o saldo seja o informado
      const initial = u.saldo !== null ? bal + rowAmt : bal;
      const newCard = { id: uid(), name, holder: $("ncHolder" + k).value.trim(), type: $("ncType" + k).value, issuer: $("ncIssuer" + k).value, last4, monthlyCredit: 0, creditDay: "", dayMode: "none", amountMode: "fixed", balance: 0, createdAt: Date.now(), secret: null };
      save.disabled = true;
      const ok = await run(async () => {
        await Store.put("cards", newCard);
        if (initial > 0) await postTxs(newCard, [{ kind: "credit", amount: initial, desc: "Saldo inicial", source: "ajuste", date: $("rDate").value || todayISO() }]);
      });
      if (!ok) { save.disabled = false; return; }
      askPersist();
      // escolhe o cartão novo para este vale
      selectRow(k, newCard.id);
      $("ncBox" + k).innerHTML = "";
      $("unk" + k).className = "notice info";
      $("unk" + k).innerHTML = `<span>Cartão <b>${esc(name)}</b> cadastrado e escolhido para este vale. Agora é só salvar o cupom.</span>`;
    }
  });

  // Conciliação pelo saldo impresso: só quando a compra usou um único vale.
  const single = () => { const sp = split.get(); return sp.vale.length === 1 ? sp.vale[0] : null; };
  const syncUse = () => {
    const one = single();
    $("rSaldoBox").hidden = !one;
    const card = one && cardById(one.cardId);
    const s = parseMoney($("rSaldo").value);
    const a = one ? one.amount : 0;
    const wrap = $("rUseWrap");
    wrap.hidden = !(s >= 0) || !card;
    if (wrap.hidden) return;
    const newer = $("rDate").value >= lastTxDate(card.id);
    const expected = (card.balance || 0) - (a > 0 ? a : 0);
    const diff = s - expected;
    $("rUseTxt").innerHTML = diff === 0
      ? `O saldo do cupom confere com o saldo daqui depois desta compra (<span class="num">${brl(s)}</span>).`
      : `Usar o saldo do cupom como saldo atual do ${esc(card.name)}: passa a <b class="num">${brl(s)}</b> (diferença de <span class="num">${diff > 0 ? "+" : ""}${brl(diff)}</span> entra como ajuste).${newer ? "" : " Atenção: há lançamentos mais recentes que este cupom."}`;
    if (!$("rUse").dataset.touched) $("rUse").checked = newer && diff !== 0;
    $("rUse").disabled = diff === 0;
  };
  $("rUse").addEventListener("change", () => { $("rUse").dataset.touched = "1"; });
  ["rSaldo", "rDate"].forEach(id => $(id).addEventListener("input", () => { state.dupOk = false; syncUse(); }));
  split.onChange(() => { state.dupOk = false; syncUse(); });
  syncUse();
  const finish = () => { const q = scanQueue.splice(0); ui.sheetCleanup = null; closeSheet(); if (q.length) { scanQueue.push(...q); setTimeout(nextScan, 50); } };
  $("rSkip").addEventListener("click", finish);
  $("rForm").addEventListener("submit", async e => {
    e.preventDefault();
    const sp = split.get();
    const one = sp.vale.length === 1 ? sp.vale[0] : null;
    const s = $("rSaldo").value.trim() ? parseMoney($("rSaldo").value) : NaN;
    const dt = $("rDate").value || todayISO();
    const useBal = !!one && !$("rSaldoBox").hidden && !$("rUseWrap").hidden && $("rUse").checked && !$("rUse").disabled;
    const chk = checkSplit(sp, useBal);
    if (chk.err) { $("rErr").textContent = chk.err; return; }
    if (useBal && !cardById(one.cardId)) { $("rErr").textContent = "Escolha o cartão que pagou."; return; }
    const warn = dupWarning(chk.parts, dt);
    if (warn && !state.dupOk) { state.dupOk = true; $("rErr").textContent = warn; return; }
    $("rSave").disabled = true;
    let results = [];
    const ok = await run(async () => {
      const receiptId = uid();
      await IDB.put("receipts", { id: receiptId, blob, createdAt: Date.now() });
      const desc = $("rDesc").value.trim() || state.cat || "Compra";
      const storeKey = storeKeyOf({ cnpj: d.cnpj, store: $("rDesc").value.trim() || d.store });
      const base = { desc, cat: state.cat, date: dt, source: "cupom", receiptId, ...(storeKey ? { storeKey } : {}), ...(one && s >= 0 ? { reportedBalance: s } : {}) };
      const adjust = (card, r) => {
        if (!useBal) return [];
        const diff = s - ((card.balance || 0) - r.amount);
        return diff ? [{ kind: diff > 0 ? "credit" : "debit", amount: Math.abs(diff), desc: "Ajuste pelo saldo do cupom", source: "ajuste", date: dt }] : [];
      };
      if (chk.parts.length) results = await savePurchase(chk.parts, chk.others, chk.total, base, adjust);
      else {
        // Só o saldo, sem valor: o cupom é um extrato de saldo
        const card = cardById(one.cardId);
        const diff = s - (card.balance || 0);
        results = [{ card, bal: diff ? await postTxs(card, [{ kind: diff > 0 ? "credit" : "debit", amount: Math.abs(diff), desc: "Ajuste pelo saldo do cupom", source: "ajuste", date: dt, receiptId }]) : card.balance }];
      }
    });
    if (!ok) { $("rSave").disabled = false; return; }
    toast(results.length === 1 ? `Cupom salvo. Saldo do ${results[0].card.name}: ${brl(results[0].bal)}` : `Compra salva em ${results.length} vales.`);
    finish();
  });
}
