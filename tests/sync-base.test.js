// Sincronização, etapa 1: carimbo, marcas de apagado, migração e saldo derivado. Dados fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Sync } = require("./carregar.js");

const DIA = 86400000;
const card = (id, extra = {}) => ({ id, name: "Cartão " + id, holder: "Fulana", balance: 0, createdAt: 1, ...extra });
const tx = (id, extra = {}) => ({ id, cardId: "c1", kind: "debit", amount: 1000, createdAt: 2, ...extra });

test("carimbar: updatedAt nunca anda para trás, mesmo com relógio atrasado", () => {
  const a = Sync.carimbar({ id: "x" }, null, "aaa", 1000);
  assert.deepEqual(a, { id: "x", updatedAt: 1000, updatedBy: "aaa" });
  const b = Sync.carimbar(a, a, "aaa", 500);
  assert.equal(b.updatedAt, 1001);
  const c = Sync.carimbar(a, { updatedAt: 5000 }, "aaa", 1000);
  assert.equal(c.updatedAt, 5001);
});

test("marcaApagado: só o mínimo, sem dados do registro", () => {
  const m = Sync.marcaApagado({ id: "x", name: "Segredo", secret: "abc", updatedAt: 50 }, "aaa", 10);
  assert.deepEqual(m, { id: "x", apagado: true, updatedAt: 51, updatedBy: "aaa" });
});

test("saldo: saldoBase + lançamentos, ignorando apagados e de outros cartões", () => {
  const c = card("c1", { saldoBase: 300 });
  const txs = [tx("a", { kind: "credit", amount: 5000 }), tx("b"), tx("c", { amount: 99999, apagado: true }), tx("d", { cardId: "c2" })];
  assert.equal(Sync.saldo(c, txs), 300 + 5000 - 1000);
});

test("migrar: carimba updatedAt e calcula saldoBase; segunda vez não muda nada", () => {
  const base = { cards: [card("c1", { balance: 4500 })], txs: [tx("a", { kind: "credit", amount: 5000 }), tx("b")] };
  const m = Sync.migrar(base);
  assert.equal(m.mudados.length, 3);
  assert.equal(m.cards[0].updatedAt, 1);
  assert.equal(m.cards[0].saldoBase, 500);
  assert.equal(m.txs[0].updatedAt, 2);
  assert.equal(Sync.saldo(m.cards[0], m.txs), 4500);
  const m2 = Sync.migrar(m);
  assert.deepEqual(m2.mudados, []);
  assert.deepEqual(m2.cards, m.cards);
  assert.equal(base.cards[0].updatedAt, undefined);
});

test("migrar: createdAt ausente vira 0 e marcas de apagado ficam como estão", () => {
  const marca = { id: "z", apagado: true, updatedAt: 9, updatedBy: "aaa" };
  const m = Sync.migrar({ cards: [{ id: "c1", balance: 0 }, marca], txs: [] });
  assert.equal(m.cards[0].updatedAt, 0);
  assert.deepEqual(m.cards[1], marca);
  assert.equal(m.mudados.length, 1);
});

test("visiveis: esconde marcas e lançamentos de cartão apagado", () => {
  const v = Sync.visiveis({
    cards: [card("c1"), { id: "c2", apagado: true, updatedAt: 3 }],
    txs: [tx("a"), tx("b", { apagado: true }), tx("c", { cardId: "c2" })],
  });
  assert.deepEqual(v.cards.map(c => c.id), ["c1"]);
  assert.deepEqual(v.txs.map(t => t.id), ["a"]);
});

test("limparMarcas: tira só as marcas com mais de 90 dias", () => {
  const agora = 200 * DIA;
  const lista = [
    { id: "velha", apagado: true, updatedAt: agora - 91 * DIA },
    { id: "nova", apagado: true, updatedAt: agora - 89 * DIA },
    { id: "viva", updatedAt: 1 },
  ];
  const r = Sync.limparMarcas(lista, agora);
  assert.deepEqual(r.removidos, ["velha"]);
  assert.deepEqual(r.lista.map(x => x.id), ["nova", "viva"]);
});

test("saldo igual ao de um aparelho que tivesse todos os lançamentos", () => {
  const c = card("c1", { saldoBase: 1000, updatedAt: 5, updatedBy: "aaa" });
  const um = { cards: [c], txs: [tx("A", { amount: 300, updatedAt: 6, updatedBy: "aaa" })] };
  const dois = { cards: [{ ...c, name: "Renomeado", updatedAt: 9, updatedBy: "bbb" }], txs: [tx("B", { kind: "credit", amount: 700, updatedAt: 7, updatedBy: "bbb" })] };
  const m = Sync.mesclar(um, dois);
  const unico = { cards: [c], txs: [...um.txs, ...dois.txs] };
  assert.equal(Sync.saldo(m.cards[0], m.txs), Sync.saldo(unico.cards[0], unico.txs));
  assert.equal(Sync.saldo(m.cards[0], m.txs), 1000 - 300 + 700);
  assert.equal(m.cards[0].name, "Renomeado");
});
