// Fila offline da sincronização (js/app/sincronizacao.js) com IndexedDB e fetch falsos. Dados fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
require("./carregar.js");

const dir = path.join(__dirname, "..", "js", "app");
const imp = n => import(pathToFileURL(path.join(dir, n)).href);

function bancoFalso(IDB) {
  const lojas = { cards: new Map(), txs: new Map(), receipts: new Map(), meta: new Map() };
  IDB.all = async s => [...lojas[s].values()].map(v => JSON.parse(JSON.stringify(v)));
  IDB.get = async (s, k) => lojas[s].get(k);
  IDB.put = async (s, v, k) => { lojas[s].set(k === undefined ? v.id : k, JSON.parse(JSON.stringify(v))); };
  IDB.del = async (s, k) => { lojas[s].delete(k); };
  IDB.clear = async s => { lojas[s].clear(); };
  return lojas;
}
async function abrir({ ligado = true } = {}) {
  const [arm, est, sinc] = await Promise.all([imp("armazenamento.js"), imp("estado.js"), imp("sincronizacao.js")]);
  const lojas = bancoFalso(arm.IDB);
  est.S.meta = ligado ? { sync: { url: "https://exemplo.invalid/exec", secret: "CODIGO-FICTICIO-DE-TESTE", ligado: true, fila: [] } } : {};
  est.S.cards = []; est.S.txs = [];
  arm.Store.aoMudar = null;
  sinc.ATRASO.envio = 1e7; // os testes chamam enviarFila() à mão
  await arm.Store.carregar({ cards: [], txs: [] });
  sinc.iniciarSync();
  await sinc.enviarFila();
  return { ...arm, ...sinc, S: est.S, lojas };
}
const servidor = (resp = () => ({ ok: true })) => {
  const chamadas = [];
  globalThis.fetch = async (url, opts) => { const corpo = JSON.parse(opts.body); chamadas.push(corpo); return { json: async () => resp(corpo, chamadas.length) }; };
  return chamadas;
};
const novoCartao = id => ({ id, name: "Cartão " + id, holder: "Fulana", balance: 0, createdAt: 1 });
const novoGasto = (id, cardId = "c1") => ({ id, cardId, kind: "debit", amount: 1000, desc: "Mercado Teste", date: "2026-10-01", createdAt: 2 });

test("sincronização desligada: nada entra na fila e nada é enviado", async () => {
  const chamadas = servidor();
  const { Store, S, enviarFila } = await abrir({ ligado: false });
  await Store.put("cards", novoCartao("c1"));
  await Store.put("txs", novoGasto("t1"));
  assert.equal(S.meta.sync.fila, undefined);
  assert.deepEqual(await enviarFila(), { ok: false, erro: "Sincronização desligada." });
  assert.equal(chamadas.length, 0);
});

test("3 lançamentos offline: fila com 3; internet volta: um envio com os 3 e fila vazia", async () => {
  const chamadas = servidor();
  const { Store, S, enviarFila, filaDe } = await abrir();
  await Store.put("cards", novoCartao("c1"));
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  for (const id of ["t1", "t2", "t3"]) await Store.put("txs", novoGasto(id));
  assert.deepEqual(filaDe().sort(), ["cards:c1", "txs:t1", "txs:t2", "txs:t3"]);
  assert.deepEqual((await enviarFila()), { ok: false, erro: "Sem internet." });
  assert.equal(chamadas.length, 0);
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  const r = await enviarFila();
  assert.equal(r.ok, true);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].acao, "enviar");
  assert.equal(chamadas[0].segredo, "CODIGO-FICTICIO-DE-TESTE");
  assert.equal(chamadas[0].aparelho, S.meta.sync.aparelho);
  assert.deepEqual(chamadas[0].registros.map(x => x.id).sort(), ["c1", "t1", "t2", "t3"]);
  assert.deepEqual(filaDe(), []);
  assert.ok(S.meta.sync.ultimoEnvio > 0);
  delete globalThis.navigator;
});

test("nunca envia balance, receipts nem texto em claro das senhas", async () => {
  const chamadas = servidor();
  const { Store, enviarFila } = await abrir();
  await Store.put("cards", { ...novoCartao("c1"), balance: 123456, secret: { ct: "CIFRADO-FICTICIO", iv: "ab" } });
  await Store.put("txs", { ...novoGasto("t1"), receiptId: "r1" });
  await enviarFila();
  const texto = JSON.stringify(chamadas);
  assert.ok(!texto.includes("123456"));
  assert.ok(!texto.includes("balance"));
  assert.ok(!texto.includes("receipts"));
  assert.ok(texto.includes("CIFRADO-FICTICIO"));
});

test("falha no envio mantém a fila intacta, sem erro para a tela; enviar de novo não duplica", async () => {
  let falhar = true;
  const chamadas = servidor(() => falhar ? { ok: false, erro: "ocupado" } : { ok: true });
  const { Store, S, enviarFila, filaDe } = await abrir();
  await Store.put("cards", novoCartao("c1"));
  await Store.put("txs", novoGasto("t1"));
  const r = await enviarFila();
  assert.equal(r.ok, false);
  assert.deepEqual(filaDe().sort(), ["cards:c1", "txs:t1"]);
  assert.ok(S.meta.sync.ultimoErro > 0);
  falhar = false;
  assert.equal((await enviarFila()).ok, true);
  assert.deepEqual(filaDe(), []);
  const n = chamadas.length;
  await enviarFila();
  assert.equal(chamadas.length, n); // fila vazia: nada a enviar
  // rede que cai no meio
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await Store.put("txs", novoGasto("t2"));
  assert.equal((await enviarFila()).ok, false);
  assert.deepEqual(filaDe(), ["txs:t2"]);
});

test("mudou durante o envio: o item continua na fila e vai de novo", async () => {
  let primeira = true;
  const ref = {};
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    const corpo = JSON.parse(opts.body); chamadas.push(corpo);
    if (primeira) { primeira = false; await ref.Store.patch("txs", "t1", { desc: "Editado durante o envio" }); }
    return { json: async () => ({ ok: true }) };
  };
  const m = await abrir();
  ref.Store = m.Store;
  await m.Store.put("cards", novoCartao("c1"));
  await m.Store.put("txs", novoGasto("t1"));
  const r = await m.enviarFila();
  assert.equal(r.ok, true);
  const ultimo = chamadas[chamadas.length - 1];
  assert.equal(chamadas.length, 2);
  assert.equal(ultimo.registros.find(x => x.id === "t1").dados.desc, "Editado durante o envio");
  assert.deepEqual(m.filaDe(), []);
});

test("apagar entra na fila como marca; a fila é gravada no banco do aparelho", async () => {
  const chamadas = servidor();
  const { Store, S, lojas, enviarFila } = await abrir();
  await Store.put("cards", novoCartao("c1"));
  await Store.put("txs", novoGasto("t1"));
  await enviarFila();
  await Store.remove("txs", "t1");
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(lojas.meta.get("main").sync.fila, ["txs:t1"]);
  await enviarFila();
  const marca = chamadas[chamadas.length - 1].registros[0];
  assert.equal(marca.apagado, true);
  assert.deepEqual(Object.keys(marca.dados).sort(), ["apagado", "id", "updatedAt", "updatedBy"]);
  assert.deepEqual(S.meta.sync.fila, []);
});

test("Enviar tudo: enfileirarTudo põe cartões, lançamentos e marcas na fila", async () => {
  servidor();
  const m = await abrir();
  await m.Store.put("cards", novoCartao("c1"));
  await m.Store.put("txs", novoGasto("t1"));
  await m.Store.remove("txs", "t1");
  await m.enviarFila();
  assert.deepEqual(m.filaDe(), []);
  m.enfileirarTudo();
  assert.deepEqual(m.filaDe().sort(), ["cards:c1", "txs:t1"]);
});

test("resumoSync: desligado, nunca enviou e com itens a enviar", async () => {
  const { resumoSync } = await imp("sincronizacao.js");
  assert.equal(resumoSync({}), "Desligado.");
  assert.equal(resumoSync({ ligado: true, fila: [] }), "Ainda não sincronizou.");
  assert.match(resumoSync({ ligado: true, fila: ["a", "b"], ultimoEnvio: Date.UTC(2026, 9, 29, 15, 0) }), /^Última sincronização: .* · 2 a enviar\.$/);
});

test("meta.sync não entra no backup do arquivo nem do Drive", () => {
  const { Drive } = require("./carregar.js");
  const b = Drive.montarBackup({ cards: [], txs: [], meta: { vault: { salt: "x" }, sync: { url: "https://exemplo.invalid", secret: "S" }, drive: { secret: "D" } } }, false);
  assert.deepEqual(Object.keys(b.meta), ["vault"]);
});
