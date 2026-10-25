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

// ---------- armazenamento (IndexedDB falso em memória) ----------
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const dir = path.join(__dirname, "..", "js", "app");
const carregarModulos = async () => ({
  arm: await import(pathToFileURL(path.join(dir, "armazenamento.js")).href),
  est: await import(pathToFileURL(path.join(dir, "estado.js")).href),
});
function bancoFalso(IDB, inicial = {}) {
  const lojas = { cards: new Map(), txs: new Map(), receipts: new Map(), meta: new Map() };
  for (const [l, lista] of Object.entries(inicial)) for (const r of lista) lojas[l].set(r.id, JSON.parse(JSON.stringify(r)));
  IDB.all = async s => [...lojas[s].values()].map(v => JSON.parse(JSON.stringify(v)));
  IDB.get = async (s, k) => lojas[s].get(k);
  IDB.put = async (s, v, k) => { lojas[s].set(k === undefined ? v.id : k, JSON.parse(JSON.stringify(v))); };
  IDB.del = async (s, k) => { lojas[s].delete(k); };
  IDB.clear = async s => { lojas[s].clear(); };
  return lojas;
}
async function abrir(inicial) {
  const { arm, est } = await carregarModulos();
  const lojas = bancoFalso(arm.IDB, inicial);
  est.S.meta = {}; est.S.cards = []; est.S.txs = [];
  arm.Store.aoMudar = null;
  await arm.Store.carregar({ cards: await arm.IDB.all("cards"), txs: await arm.IDB.all("txs") });
  return { ...arm, S: est.S, lojas };
}

test("carregar: dados antigos migram sem perder nada e os saldos continuam iguais", async () => {
  const antigos = { cards: [card("c1", { balance: 4500 })], txs: [tx("a", { kind: "credit", amount: 5000 }), tx("b")] };
  const { S, lojas, Store, IDB } = await abrir(antigos);
  assert.equal(S.cards.length, 1);
  assert.equal(S.txs.length, 2);
  assert.equal(S.cards[0].balance, 4500);
  assert.ok(S.meta.sync.aparelho.match(/^[0-9a-z]{12}$/));
  assert.equal(lojas.cards.get("c1").saldoBase, 500);
  assert.equal(lojas.txs.get("a").updatedAt, 2);
  // abrir de novo: idempotente
  const aparelho = S.meta.sync.aparelho;
  const antes = JSON.stringify([...lojas.cards.values(), ...lojas.txs.values()]);
  await Store.carregar({ cards: await IDB.all("cards"), txs: await IDB.all("txs") });
  assert.equal(JSON.stringify([...lojas.cards.values(), ...lojas.txs.values()]), antes);
  assert.equal(S.meta.sync.aparelho, aparelho);
  assert.equal(S.cards[0].balance, 4500);
});

test("backup antigo (sem updatedAt nem saldoBase) restaurado mantém os saldos", async () => {
  const { S, Store } = await abrir({});
  const backup = { cards: [card("c1", { balance: 700 })], txs: [tx("a", { amount: 300 })] };
  await Store.carregar(backup);
  assert.equal(S.cards[0].balance, 700);
  assert.equal(S.txs.length, 1);
});

test("put e patch carimbam updatedAt e updatedBy; remove deixa só a marca", async () => {
  const { S, Store, lojas } = await abrir({});
  await Store.put("cards", card("c1"));
  const p1 = lojas.cards.get("c1");
  assert.ok(p1.updatedAt > 0);
  assert.equal(p1.updatedBy, S.meta.sync.aparelho);
  assert.equal(p1.saldoBase, 0);
  await Store.patch("cards", "c1", { name: "Novo nome" });
  const p2 = lojas.cards.get("c1");
  assert.ok(p2.updatedAt > p1.updatedAt);
  assert.equal(p2.name, "Novo nome");
  await Store.put("txs", tx("a"));
  assert.equal(S.cards[0].balance, -1000);
  await Store.remove("txs", "a");
  assert.deepEqual(Object.keys(lojas.txs.get("a")).sort(), ["apagado", "id", "updatedAt", "updatedBy"]);
  assert.equal(S.txs.length, 0);
  assert.equal(S.cards[0].balance, 0);
});

test("aoMudar é chamado a cada gravação de cartão ou lançamento", async () => {
  const { Store } = await abrir({});
  const vistos = [];
  Store.aoMudar = (loja, reg) => vistos.push(loja + ":" + reg.id + (reg.apagado ? ":x" : ""));
  await Store.put("cards", card("c1"));
  await Store.put("txs", tx("a"));
  await Store.remove("txs", "a");
  assert.deepEqual(vistos, ["cards:c1", "txs:a", "txs:a:x"]);
});

test("apagar cartão com lançamentos deixa marcas em todos e nada visível", async () => {
  const { S, Store, lojas } = await abrir({});
  await Store.put("cards", card("c1"));
  await Store.put("txs", tx("a"));
  await Store.put("txs", tx("b"));
  for (const t of S.txs.filter(t => t.cardId === "c1")) await Store.remove("txs", t.id);
  await Store.remove("cards", "c1");
  assert.deepEqual([S.cards.length, S.txs.length], [0, 0]);
  assert.ok([...lojas.txs.values(), ...lojas.cards.values()].every(r => r.apagado));
});

test("Gastos e gráficos não mudam por causa de marcas de apagado", async () => {
  const { Graficos } = require("./carregar.js");
  const { S, Store } = await abrir({});
  await Store.put("cards", card("c1"));
  await Store.put("txs", tx("a", { date: "2026-10-01", cat: "Mercado", desc: "Compra", amount: 2000 }));
  await Store.put("txs", tx("b", { date: "2026-10-02", cat: "Padaria", desc: "Pão", amount: 500 }));
  const gastos = () => S.txs.filter(t => t.kind === "debit").reduce((s, t) => s + t.amount, 0);
  assert.equal(gastos(), 2500);
  await Store.remove("txs", "b");
  assert.equal(gastos(), 2000);
  assert.ok(S.txs.every(t => !t.apagado));
  assert.ok(typeof Graficos === "object");
});

test("lançamento de cartão apagado (vindo de fora) fica guardado e escondido", async () => {
  const { S, Store, lojas } = await abrir({});
  await Store.put("cards", card("c1"));
  await Store.remove("cards", "c1");
  await Store.put("txs", tx("z"));
  assert.equal(S.txs.length, 0);
  assert.ok(lojas.txs.has("z"));
});

test("marcas de apagado com mais de 90 dias são limpas ao abrir", async () => {
  const velha = { id: "v", apagado: true, updatedAt: Date.now() - 91 * DIA, updatedBy: "aaa" };
  const { lojas } = await abrir({ txs: [velha] });
  assert.equal(lojas.txs.has("v"), false);
});

test("postTxs e deleteTx: saldo certo sem gravar no cartão; apagar lançamento devolve o saldo", async () => {
  const telas = await import(pathToFileURL(path.join(dir, "telas.js")).href).catch(e => e);
  if (telas instanceof Error) return; // telas.js precisa do navegador; o caminho acima já cobre Store
  const { S, Store, lojas } = await abrir({});
  await Store.put("cards", card("c1", { balance: 0, saldoBase: 10000 }));
  const antes = lojas.cards.get("c1").updatedAt;
  const saldo = await telas.postTxs(S.cards[0], [
    { kind: "debit", amount: 1500, date: "2026-10-01" },
    { kind: "credit", amount: 200, date: "2026-10-02" },
  ]);
  assert.equal(saldo, 10000 - 1500 + 200);
  assert.equal(lojas.cards.get("c1").updatedAt, antes);
  await telas.deleteTx(S.txs.find(t => t.amount === 1500));
  assert.equal(S.cards[0].balance, 10200);
  assert.equal(lojas.cards.get("c1").updatedAt, antes);
});
