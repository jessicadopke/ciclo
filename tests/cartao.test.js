// Qual cartão pagou (match.js): escolha do cartão e aviso de cartão que não está na carteira.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Match } = require("./carregar");

const cartao = (id, extra) => ({ id, name: id, issuer: "VR", type: "alimentacao", last4: "", balance: 0, createdAt: 1, ...extra });
const cupom = extra => ({ paid: 5000, payments: [{ kind: "vale", amount: 5000 }], balances: [], ...extra });

test("final do cartão identifica o cartão com confiança", () => {
  const cards = [cartao("a", { last4: "1111", balance: 50000 }), cartao("b", { last4: "2222", balance: 50000 })];
  const m = Match.matchReceipt(cupom({ last4: "2222" }), cards, [], null, "a");
  assert.equal(m.parts[0].cardId, "b");
  assert.ok(m.parts[0].confident);
  assert.deepEqual(m.unknown, []);
});

test("saldo do cupom que fecha com o saldo daqui identifica o cartão", () => {
  const cards = [cartao("a", { balance: 20000 }), cartao("b", { balance: 30000 })];
  const m = Match.matchReceipt(cupom({ balances: [25000] }), cards, [], null, "a");
  assert.equal(m.parts[0].cardId, "b", "300,00 − 50,00 = 250,00");
  assert.ok(m.parts[0].pick.reasons.includes("o saldo do cupom fecha com este cartão"));
});

test("final que nenhum cartão tem: aviso de cartão novo e nenhum cartão escolhido", () => {
  const cards = [cartao("a", { last4: "1111", balance: 50000 })];
  const m = Match.matchReceipt(cupom({ last4: "9999", issuer: "VR" }), cards, [], null, "a");
  assert.equal(m.unknown.length, 1);
  assert.equal(m.unknown[0].kind, "novo");
  assert.equal(m.parts[0].cardId, "");
});

test("saldo que não fecha com nenhum cartão: aviso pelo saldo, sem ajustar o cartão errado (defeito da 1.8.1)", () => {
  const cards = [cartao("a", { balance: 50000 })];
  const m = Match.matchReceipt(cupom({ balances: [99999], issuer: "VR" }), cards, [], null, "a");
  assert.equal(m.unknown[0].kind, "saldo");
  assert.equal(m.unknown[0].alt.id, "a", "oferece 'É o a', porque o cupom não contradiz o cartão");
  assert.equal(m.parts[0].cardId, "");
});

test("emissor que não está na carteira conta como cartão novo", () => {
  const cards = [cartao("a", { balance: 50000 })];
  const m = Match.matchReceipt(cupom({ issuer: "Volus", balances: [] }), cards, [], null, "a");
  assert.equal(m.unknown[0].kind, "novo");
  assert.equal(m.unknown[0].alt, null);
});

test("dois vales: cada parte com o seu cartão, sem repetir", () => {
  const cards = [cartao("a", { last4: "1111" }), cartao("b", { last4: "2222", issuer: "Alelo" })];
  const d = {
    paid: 13000,
    payments: [{ kind: "vale", amount: 8000 }, { kind: "vale", amount: 5000 }, { kind: "pix", amount: 2000 }],
    vales: [{ amount: 8000, issuer: "Alelo", last4: "2222", saldo: null }, { amount: 5000, issuer: "VR", last4: "1111", saldo: null }],
  };
  const m = Match.matchReceipt(d, cards, [], null, "a");
  assert.deepEqual(m.parts.map(p => p.cardId), ["b", "a"]);
  assert.deepEqual(m.others, [{ kind: "pix", amount: 2000 }]);
});

test("saldo impresso antes da compra é convertido para depois da compra", () => {
  const m = Match.matchReceipt(cupom({ balance: 20000, balanceMoment: "antes_compra" }), [], [], null, "");
  assert.deepEqual(m.saldos, [15000]);
});

test("titular do cupom ajuda a escolher entre cartões do mesmo emissor", () => {
  const cards = [cartao("ana", { holder: "Ana" }), cartao("bia", { holder: "Beatriz Lima" })];
  const r = Match.rankCards(cards, [], { issuer: "VR", holder: "Beatriz Souza Lima" }, 5000, [], null);
  assert.equal(r[0].card.id, "bia");
});

test("loja onde o cartão já foi usado pesa na escolha", () => {
  const cards = [cartao("a"), cartao("b")];
  const txs = [{ kind: "debit", cardId: "b", storeKey: "cnpj:11222333000181" }, { kind: "debit", cardId: "b", storeKey: "cnpj:11222333000181" }];
  const r = Match.rankCards(cards, txs, { cnpj: "11222333000181" }, 5000, [], null);
  assert.equal(r[0].card.id, "b");
  assert.equal(r[0].reasons[0], "usado 2 vezes nesta loja");
});

// ---- crédito/débito impresso para cartão de vale (final cadastrado) ----
const soma = m => m.parts.reduce((s, p) => s + p.amount, 0) + m.others.reduce((s, p) => s + p.amount, 0);
const cartA = () => cartao("a", { name: "Cartão A", last4: "0000", balance: 50000 });
const cartB = () => cartao("b", { name: "Cartão B", last4: "1111", balance: 50000 });
const cred = (amount, last4, kind = "credito") => ({ kind, amount, last4 });
const cupomCred = (payments, extra) => ({ paid: null, payments, balances: [], ...extra });

test("crédito com final de vale cadastrado conta como vale", () => {
  const m = Match.matchReceipt(cupomCred([cred(5000, "0000")]), [cartA(), cartB()], [], null, "b");
  assert.equal(m.parts.length, 1);
  assert.equal(m.parts[0].amount, 5000);
  assert.equal(m.parts[0].cardId, "a");
  assert.ok(m.parts[0].pick.reasons.includes("final 0000"));
  assert.deepEqual(m.others, []);
  assert.equal(m.convertidos.length, 1);
  assert.deepEqual([m.convertidos[0].amount, m.convertidos[0].last4, m.convertidos[0].kind, m.convertidos[0].cardName, m.convertidos[0].incerto], [5000, "0000", "credito", "Cartão A", false]);
  assert.equal(m.payments[0].kind, "vale");
  assert.equal(soma(m), 5000);
});

test("crédito com final desconhecido continua crédito (e débito também)", () => {
  for (const kind of ["credito", "debito"]) {
    const m = Match.matchReceipt(cupomCred([cred(5000, "9999", kind)]), [cartA()], [], null, "a");
    assert.deepEqual(m.others, [{ kind, amount: 5000 }]);
    assert.deepEqual(m.convertidos, []);
    assert.equal(m.parts[0].amount, 0);
  }
});

test("débito com final de vale cadastrado também converte", () => {
  const m = Match.matchReceipt(cupomCred([cred(2000, "1111", "debito")]), [cartA(), cartB()], [], null, "a");
  assert.equal(m.parts[0].cardId, "b");
  assert.equal(m.convertidos[0].kind, "debito");
});

test("crédito sem final continua crédito", () => {
  const m = Match.matchReceipt(cupomCred([{ kind: "credito", amount: 5000, issuer: "VR" }]), [cartA()], [], null, "a");
  assert.deepEqual(m.others, [{ kind: "credito", amount: 5000 }]);
  assert.deepEqual(m.convertidos, []);
});

test("misto: vale e crédito comum", () => {
  const d = cupomCred([{ kind: "vale", amount: 3000, last4: "0000" }, cred(2000, "9999")], { paid: 3000, last4: "0000", last4s: ["0000"] });
  const m = Match.matchReceipt(d, [cartA(), cartB()], [], null, "a");
  assert.deepEqual(m.parts.map(p => [p.amount, p.cardId]), [[3000, "a"]]);
  assert.deepEqual(m.others, [{ kind: "credito", amount: 2000 }]);
  assert.deepEqual(m.convertidos, []);
  assert.equal(soma(m), 5000);
});

test("misto: vale e crédito de outro vale", () => {
  const d = cupomCred([{ kind: "vale", amount: 3000, last4: "0000" }, cred(2000, "1111")], {
    paid: 3000, last4: "0000", last4s: ["0000"], vales: [{ amount: 3000, issuer: null, holder: null, last4: "0000", saldo: null }],
  });
  const m = Match.matchReceipt(d, [cartA(), cartB()], [], null, "a");
  assert.deepEqual(m.parts.map(p => [p.amount, p.cardId]), [[3000, "a"], [2000, "b"]]);
  assert.deepEqual(m.others, []);
  assert.equal(m.convertidos.length, 1);
  assert.equal(m.convertidos[0].cardName, "Cartão B");
  assert.equal(soma(m), 5000);
});

test("vale e pix não muda", () => {
  const d = cupomCred([{ kind: "vale", amount: 3000 }, { kind: "pix", amount: 2000 }], { paid: 3000, last4: "0000" });
  const m = Match.matchReceipt(d, [cartA()], [], null, "a");
  assert.deepEqual(m.parts.map(p => [p.amount, p.cardId]), [[3000, "a"]]);
  assert.deepEqual(m.others, [{ kind: "pix", amount: 2000 }]);
  assert.deepEqual(m.convertidos, []);
  assert.equal(soma(m), 5000);
});

test("final igual em dois cartões: converte e pede confirmação", () => {
  const cards = [cartao("a", { name: "Cartão A", last4: "0000", balance: 50000 }), cartao("b", { name: "Cartão B", last4: "0000", balance: 50000 })];
  const m = Match.matchReceipt(cupomCred([cred(5000, "0000")]), cards, [], null, "a");
  assert.equal(m.parts[0].amount, 5000);
  assert.equal(m.parts[0].confident, false);
  assert.equal(m.convertidos[0].incerto, true);
  assert.deepEqual(m.others, []);
});

test("dois pagamentos com o mesmo final em dois cartões iguais pegam um cartão cada", () => {
  const cards = [cartao("a", { name: "Cartão A", last4: "0000" }), cartao("b", { name: "Cartão B", last4: "0000" })];
  const m = Match.matchReceipt(cupomCred([cred(3000, "0000"), cred(2000, "0000")]), cards, [], null, "a");
  assert.equal(m.parts.length, 2);
  assert.notEqual(m.parts[0].cardId, m.parts[1].cardId);
  assert.ok(m.parts.every(p => p.cardId));
  assert.equal(soma(m), 5000);
});
