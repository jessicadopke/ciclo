// Sincronização, etapa 1: mesclar duas bases (cartões e lançamentos). Dados fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Sync } = require("./carregar.js");

const card = (id, extra = {}) => ({ id, name: "Cartão " + id, holder: "Fulana", balance: 0, saldoBase: 0, createdAt: 1, updatedAt: 10, updatedBy: "aaa", ...extra });
const tx = (id, extra = {}) => ({ id, cardId: "c1", kind: "debit", amount: 1000, date: "2026-10-01", createdAt: 1, updatedAt: 10, updatedBy: "aaa", ...extra });
const ids = l => l.map(x => x.id);

test("lançamento só de um lado fica, nos dois sentidos", () => {
  const um = { cards: [card("c1")], txs: [tx("A")] };
  const dois = { cards: [card("c1")], txs: [tx("B", { updatedBy: "bbb" })] };
  assert.deepEqual(ids(Sync.mesclar(um, dois).txs), ["A", "B"]);
  assert.deepEqual(ids(Sync.mesclar(dois, um).txs), ["A", "B"]);
});

test("mesmo cartão editado nos dois: vale o mais recente", () => {
  const a = { cards: [card("c1", { name: "Velho", updatedAt: 20 })], txs: [] };
  const b = { cards: [card("c1", { name: "Novo", updatedAt: 30, updatedBy: "bbb" })], txs: [] };
  assert.equal(Sync.mesclar(a, b).cards[0].name, "Novo");
  assert.equal(Sync.mesclar(b, a).cards[0].name, "Novo");
});

test("empate de updatedAt é decidido pelo aparelho, igual nos dois lados", () => {
  const a = { cards: [card("c1", { name: "DeA", updatedAt: 20, updatedBy: "aaa" })], txs: [] };
  const b = { cards: [card("c1", { name: "DeB", updatedAt: 20, updatedBy: "bbb" })], txs: [] };
  assert.equal(Sync.mesclar(a, b).cards[0].name, "DeB");
  assert.equal(Sync.mesclar(b, a).cards[0].name, "DeB");
});

test("empate total é decidido pelo conteúdo, sem depender da ordem", () => {
  const a = { cards: [card("c1", { name: "X", updatedAt: 20 })], txs: [] };
  const b = { cards: [card("c1", { name: "Y", updatedAt: 20 })], txs: [] };
  assert.deepEqual(Sync.mesclar(a, b), Sync.mesclar(b, a));
});

test("apagado mais novo vence edição mais velha, e edição mais nova vence apagado velho", () => {
  const marca = (t, quando) => Sync.marcaApagado(t, "bbb", quando);
  const t0 = tx("A", { updatedAt: 100 });
  const apagadoDepois = { cards: [], txs: [marca(t0, 200)] };
  const editadoAntes = { cards: [], txs: [t0] };
  assert.equal(Sync.mesclar(editadoAntes, apagadoDepois).txs[0].apagado, true);
  assert.equal(Sync.mesclar(apagadoDepois, editadoAntes).txs[0].apagado, true);
  const editadoDepois = { cards: [], txs: [{ ...t0, amount: 5, updatedAt: 300 }] };
  assert.equal(Sync.mesclar(apagadoDepois, editadoDepois).txs[0].amount, 5);
  assert.equal(Sync.mesclar(editadoDepois, apagadoDepois).txs[0].apagado, undefined);
});

test("mesclar duas vezes dá o mesmo resultado; ordem dos argumentos não muda nada", () => {
  const a = { cards: [card("c1"), card("c2", { updatedAt: 50 })], txs: [tx("A"), tx("C", { updatedAt: 40 })] };
  const b = { cards: [card("c1", { name: "Outro", updatedAt: 11, updatedBy: "bbb" })], txs: [tx("B"), tx("C", { updatedAt: 41, amount: 7 })] };
  const ab = Sync.mesclar(a, b);
  assert.deepEqual(ab, Sync.mesclar(b, a));
  assert.deepEqual(Sync.mesclar(ab, b), ab);
  assert.deepEqual(Sync.mesclar(ab, a), ab);
  assert.deepEqual(Sync.mesclar(a, a), Sync.mesclar(a, { cards: [], txs: [] }));
  assert.deepEqual(Sync.mesclar(ab, ab), ab);
});

test("lançamento de cartão apagado fica guardado, mas escondido", () => {
  const c = card("c1");
  const apagado = Sync.marcaApagado(c, "bbb", 500);
  const m = Sync.mesclar({ cards: [apagado], txs: [] }, { cards: [c], txs: [tx("A")] });
  assert.equal(m.txs.length, 1);
  const v = Sync.visiveis(m);
  assert.deepEqual(v, { cards: [], txs: [] });
});
