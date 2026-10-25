// Qual cartão pagou o cupom: pontuação de cada cartão e detecção de cartão que não está na carteira.
// Funções puras (recebem os cartões e lançamentos, não mexem na tela), para poder testar com `node --test`.
(() => {
  "use strict";

  const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // Chave da loja: CNPJ do cupom ou, sem ele, o nome normalizado.
  const storeKeyOf = d => d && d.cnpj ? "cnpj:" + d.cnpj : d && d.store ? "loja:" + fold(d.store).replace(/[^a-z0-9]/g, "").slice(0, 24) : null;
  const descKey = s => "loja:" + fold(s).replace(/[^a-z0-9]/g, "").slice(0, 24);

  // Pontua cada cartão como provável pagador do cupom. Sinais, do mais forte ao mais fraco:
  // final do cartão, saldo impresso que fecha com o saldo daqui, loja onde o cartão já foi usado, titular, emissor, tipo.
  function rankCards(cards, txs, d, amount, saldos, presetCardId) {
    const saldoList = (Array.isArray(saldos) ? saldos : [saldos]).filter(s => s !== null && s >= 0);
    const finals = new Set([...(d && d.last4s) || [], ...(d && d.last4 ? [d.last4] : [])]);
    const key = storeKeyOf(d);
    const nameKey = d && d.store ? descKey(d.store) : null;
    const used = {};
    if (key || nameKey) for (const t of txs) {
      if (t.kind !== "debit") continue;
      if ((key && t.storeKey === key) || (nameKey && descKey(t.desc || "") === nameKey)) used[t.cardId] = (used[t.cardId] || 0) + 1;
    }
    return cards.map(c => {
      let score = 0; const reasons = [];
      if (c.last4 && finals.has(c.last4)) { score += 100; reasons.push("final " + c.last4); }
      const bal = c.balance || 0;
      if (amount > 0 && saldoList.some(s => Math.abs(bal - amount - s) <= 1)) { score += 90; reasons.push("o saldo do cupom fecha com este cartão"); }
      else if (saldoList.some(s => Math.abs(bal - s) <= 1)) { score += 50; reasons.push("saldo igual ao do cupom"); }
      if (used[c.id]) { score += Math.min(45, 15 * used[c.id]); reasons.push(used[c.id] === 1 ? "já usado nesta loja" : `usado ${used[c.id]} vezes nesta loja`); }
      if (d && d.issuer && c.issuer === d.issuer) { score += 20; reasons.push(d.issuer); }
      // titular do cupom: basta o primeiro nome bater ("Ana" no app, "ANA PAULA SILVA" no cupom)
      if (d && d.holder && c.holder && fold(c.holder).split(/\s+/)[0] === fold(d.holder).split(/\s+/)[0]) { score += 25; reasons.push("titular " + c.holder); }
      if (d && d.category) {
        if (d.category === "Mercado" && c.type === "alimentacao") score += 5;
        if (["Restaurante", "Lanche", "Padaria", "Delivery"].includes(d.category) && c.type === "refeicao") score += 5;
      }
      if (c.id === presetCardId) score += 30;
      return { card: c, score, reasons };
    }).sort((a, b) => b.score - a.score || (a.card.createdAt || 0) - (b.card.createdAt || 0));
  }

  // A maquininha imprime "COMPRA CREDITO" ou "DEBITO" mesmo para cartão de benefício (Volus, por exemplo).
  // Se o final do cartão pago como crédito/débito é de um vale cadastrado, a parte conta como vale.
  function promoverVales(d, cards) {
    d = d || {};
    const pays = d.payments || [];
    const ehVale = p => (p.kind === "credito" || p.kind === "debito") && p.last4 && cards.some(c => c.last4 === p.last4);
    if (!pays.some(ehVale)) return d;
    const payments = pays.map(p => ehVale(p) ? { ...p, kind: "vale" } : p);
    const novos = payments.filter((p, i) => p.kind === "vale" && pays[i].kind !== "vale");
    // pistas por vale, na ordem dos pagamentos
    let k = 0;
    const antigos = Array.isArray(d.vales) ? d.vales : [];
    const vales = payments.filter(p => p.kind === "vale").map(p => pays.includes(p) ? antigos[k++] || { amount: p.amount, issuer: null, holder: null, type: null, last4: null, saldo: null } : { amount: p.amount, issuer: p.issuer || null, issuerRaw: null, holder: p.holder || null, type: p.type || null, last4: p.last4, saldo: p.saldo === undefined ? null : p.saldo });
    const paid = payments.filter(p => p.kind === "vale").reduce((s, p) => s + p.amount, 0);
    const balances = vales.filter(v => v.saldo !== null && v.saldo !== undefined).map(v => v.saldo);
    return { ...d, payments, vales, paid, balances: balances.length ? balances : d.balances || [], balance: d.balance === undefined || d.balance === null ? (balances.length === 1 ? balances[0] : null) : d.balance, last4s: vales.map(v => v.last4).filter(Boolean), last4: vales.length === 1 ? vales[0].last4 : d.last4, found: (d.found || []).filter(f => f !== "outras formas de pagamento" || payments.some(p => p.kind !== "vale")), promovido: novos.length };
  }

  // Leitura do cupom (d, de receipt.js ou gemini.js) → um cartão sugerido para cada parte paga com vale,
  // e os avisos de cartão que pode não estar na carteira.
  // fallbackCardId: cartão para a 1ª parte quando nada aponta para nenhum (o da tela aberta, por exemplo).
  function matchReceipt(d, cards, txs, presetCardId, fallbackCardId) {
    d = promoverVales(d, cards);
    // Saldos impressos (um por comprovante de vale), já como "saldo depois da compra"
    let saldos = d.balances && d.balances.length ? d.balances.slice() : typeof d.balance === "number" ? [d.balance] : [];
    if (saldos.length === 1 && d.balanceMoment === "antes_compra" && d.paid > 0) saldos = [saldos[0] - d.paid];
    // Partes pagas com vale e com outras formas, lidas da NFC-e
    const pays = d.payments || [];
    let valeAmts = pays.filter(p => p.kind === "vale").map(p => p.amount);
    if (!valeAmts.length && d.paid > 0) valeAmts = [d.paid];
    const others = pays.filter(p => p.kind !== "vale").map(p => ({ kind: p.kind, amount: p.amount }));
    // Escolhe um cartão para cada parte, sem repetir, do mais provável para o menos provável
    const taken = new Set();
    // Quando a leitura separa as pistas de cada vale (emissor, final, saldo), cada linha usa só as suas.
    const perVale = Array.isArray(d.vales) && d.vales.length === valeAmts.length ? d.vales : null;
    const parts = (valeAmts.length ? valeAmts : [0]).map((a, i) => {
      const v = perVale && perVale[i];
      const dRow = v ? { ...d, issuer: v.issuer || null, holder: v.holder || null, last4: v.last4 || null, last4s: v.last4 ? [v.last4] : [] } : d;
      const sRow = v && v.saldo !== null ? [v.saldo] : v ? [] : saldos;
      const r = rankCards(cards, txs, dRow, a, sRow, presetCardId).filter(x => !taken.has(x.card.id));
      const pick = r[0] && r[0].score > 0 ? r[0] : null;
      if (pick) taken.add(pick.card.id);
      const confident = pick && pick.score >= 50 && (!r[1] || pick.score - r[1].score >= 20);
      return { amount: a, pick, confident, cardId: pick ? pick.card.id : i === 0 ? (presetCardId || fallbackCardId || "") : "" };
    });
    // Cartões do cupom que podem não estar na carteira. Sem um sinal forte (final ou saldo que fecha)
    // apontando para um cartão cadastrado:
    // - "novo": o cupom mostra um final ou emissor que nenhum cartão cadastrado tem;
    // - "saldo": o saldo impresso não fecha com nenhum cartão cadastrado;
    // nesses dois casos o app não chuta um cartão: você escolhe ou cadastra.
    // - "fraco": o cartão sugerido veio só de pistas fracas (emissor, loja); fica sugerido, com a opção de cadastrar outro.
    const unknown = parts.map((pt, i) => {
      const v = perVale ? perVale[i] : i === 0 ? { issuer: d.issuer || null, issuerRaw: d.issuerRaw || null, holder: d.holder || null, type: d.type || null, last4: d.last4 || null, saldo: saldos.length === 1 ? saldos[0] : null } : null;
      if (!v || (!v.issuer && !v.issuerRaw && !v.last4 && (v.saldo === null || v.saldo === undefined))) return null;
      if (pt.pick && pt.pick.reasons.some(r => /^final |saldo/.test(r))) return null;
      const saldo = v.saldo === undefined ? null : v.saldo;
      const lastUnknown = !!v.last4 && !cards.some(c => c.last4 === v.last4);
      const issuerUnknown = !!v.issuer && !cards.some(c => c.issuer === v.issuer);
      const saldoOff = saldo !== null && saldo >= 0 && !cards.some(c => Math.abs((c.balance || 0) - pt.amount - saldo) <= 1 || Math.abs((c.balance || 0) - saldo) <= 1);
      const base = { i, issuer: v.issuer, issuerRaw: v.issuerRaw || null, holder: v.holder || null, type: v.type || null, last4: v.last4, saldo, amount: pt.amount };
      if (lastUnknown || issuerUnknown || saldoOff) {
        const weak = pt.pick && pt.pick.card;
        // "É o X?" só quando o cupom não contradiz esse cartão (outro final ou outro emissor)
        const alt = weak && !(lastUnknown && weak.last4) && !(issuerUnknown) ? weak : null;
        pt.cardId = ""; // não chuta um cartão errado: escolha ou cadastre
        pt.pick = null;
        return { ...base, kind: lastUnknown || issuerUnknown ? "novo" : "saldo", alt };
      }
      if (pt.pick && !pt.confident) return { ...base, kind: "fraco" };
      return null;
    }).filter(Boolean);
    return { saldos, others, parts, unknown };
  }

  window.Match = { promoverVales, rankCards, matchReceipt, storeKeyOf, descKey };
})();
