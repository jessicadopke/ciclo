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

test("maquininha imprime CREDITO mas o final é de um vale cadastrado: conta como vale", () => {
  const cards = [{ id: "v", name: "Volus", last4: "5257", balance: 47632, issuer: null }, { id: "o", name: "Outro", last4: "1111", balance: 1000 }];
  const d = { total: 4683, paid: null, payments: [{ kind: "credito", amount: 4683, last4: "5257" }], vales: [], balances: [], last4s: [], found: ["outras formas de pagamento"] };
  const m = Match.matchReceipt(d, cards, [], null, "o");
  assert.equal(m.others.length, 0);
  assert.equal(m.parts.length, 1);
  assert.equal(m.parts[0].amount, 4683);
  assert.equal(m.parts[0].cardId, "v");
});

test("crédito com final que não é de nenhum vale continua sendo crédito", () => {
  const cards = [{ id: "v", name: "Volus", last4: "5257", balance: 47632 }];
  const d = { total: 4683, payments: [{ kind: "credito", amount: 4683, last4: "9999" }], vales: [], balances: [] };
  const m = Match.matchReceipt(d, cards, [], null, "v");
  assert.equal(m.others.length, 1);
});
