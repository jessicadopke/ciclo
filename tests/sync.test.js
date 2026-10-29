// Sincronização, etapa 2: chamada ao script, envelope, lotes e saída da fila. fetch falso; dados fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Sync } = require("./carregar.js");

const card = (id, extra = {}) => ({ id, name: "Cartão " + id, holder: "Fulana", balance: 777, saldoBase: 0, secret: { ct: "TEXTO-CIFRADO", iv: "x" }, updatedAt: 10, updatedBy: "aaa", ...extra });
const tx = (id, extra = {}) => ({ id, cardId: "c1", kind: "debit", amount: 1000, updatedAt: 20, updatedBy: "aaa", ...extra });
const cfg = { url: "https://exemplo.invalid/exec", secret: "CODIGO-FICTICIO-DE-TESTE" };

function fetchFalso(resposta) {
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url, opts, corpo: JSON.parse(opts.body) });
    if (resposta instanceof Error) throw resposta;
    return { json: async () => { if (resposta === "html") throw new SyntaxError("x"); return typeof resposta === "function" ? resposta(chamadas.length) : resposta; } };
  };
  return chamadas;
}

test("chamar: monta o corpo com o segredo, sem Content-Type, e devolve o JSON", async () => {
  const chamadas = fetchFalso({ ok: true, cartoes: 1, lancamentos: 2 });
  const r = await Sync.chamar(cfg, { acao: "estado" });
  assert.equal(r.cartoes, 1);
  assert.equal(chamadas[0].url, cfg.url);
  assert.equal(chamadas[0].opts.method, "POST");
  assert.equal(chamadas[0].opts.headers, undefined);
  assert.deepEqual(chamadas[0].corpo, { acao: "estado", segredo: cfg.secret });
});

test("chamar: rede fora, resposta que não é JSON e config vazia viram erro em português", async () => {
  fetchFalso(new TypeError("Failed to fetch"));
  await assert.rejects(Sync.chamar(cfg, { acao: "estado" }), /Sem conexão com a Planilha/);
  fetchFalso("html");
  await assert.rejects(Sync.chamar(cfg, { acao: "estado" }), /não respondeu como o script/);
  await assert.rejects(Sync.chamar({ url: "", secret: "" }, {}), /Falta o link/);
});

test("chamar: erros do script ganham texto e código", async () => {
  for (const [erro, texto] of [["segredo", /código secreto não confere/], ["formato", /não entendeu/], ["tamanho", /grande demais/], ["ocupado", /ocupada/], ["inesperado", /deu erro/], [undefined, /recusou/]]) {
    fetchFalso({ ok: false, erro });
    await assert.rejects(Sync.chamar(cfg, { acao: "estado" }), e => { assert.match(e.message, texto); assert.equal(e.codigo, erro || "inesperado"); return true; });
  }
});

test("gerarSegredo: código longo e diferente a cada vez", () => {
  const a = Sync.gerarSegredo(), b = Sync.gerarSegredo();
  assert.equal(a.length, 40);
  assert.notEqual(a, b);
});

test("envelope: sem balance, secret só cifrado e marca de apagado mínima", () => {
  const e = Sync.envelope("cards", card("c1"));
  assert.deepEqual({ ...e, dados: undefined }, { loja: "cards", id: "c1", mudou: 10, por: "aaa", apagado: false, dados: undefined });
  assert.equal("balance" in e.dados, false);
  assert.deepEqual(e.dados.secret, { ct: "TEXTO-CIFRADO", iv: "x" });
  const m = Sync.envelope("txs", Sync.marcaApagado({ id: "t1", updatedAt: 5 }, "bbb", 100));
  assert.equal(m.apagado, true);
  assert.equal(m.mudou, 100);
  assert.deepEqual(Object.keys(m.dados).sort(), ["apagado", "id", "updatedAt", "updatedBy"]);
});

test("montarLotes: usa a versão atual, pula ids que sumiram, não repete e respeita o máximo", () => {
  const base = { cards: [card("c1")], txs: Array.from({ length: 5 }, (_, i) => tx("t" + i)) };
  const fila = ["cards:c1", "txs:t0", "txs:t1", "txs:t1", "txs:fantasma", "receipts:r1", "txs:t2", "txs:t3", "txs:t4"];
  const lotes = Sync.montarLotes(fila, base, 3);
  assert.deepEqual(lotes.map(l => l.map(e => e.id)), [["c1", "t0", "t1"], ["t2", "t3", "t4"]]);
  assert.deepEqual(Sync.montarLotes([], base), []);
  const grande = { cards: [], txs: [tx("g1", { desc: "a".repeat(3 * 1024 * 1024) }), tx("g2", { desc: "b".repeat(3 * 1024 * 1024) })] };
  assert.equal(Sync.montarLotes(["txs:g1", "txs:g2"], grande).length, 2);
});

test("tirarDaFila: só sai o que continua na versão enviada; o que mudou no meio fica", () => {
  const base = { cards: [card("c1")], txs: [tx("t1"), tx("t2", { updatedAt: 99 })] };
  const enviados = [Sync.envelope("cards", card("c1")), Sync.envelope("txs", tx("t1")), Sync.envelope("txs", tx("t2", { updatedAt: 50 }))];
  const fila = ["cards:c1", "txs:t1", "txs:t2", "txs:t3", "txs:t1"];
  // t2 mudou depois do envio (99 > 50) e fica; t3 não existe mais e sai; repetidos saem
  assert.deepEqual(Sync.tirarDaFila(fila, enviados, base), ["txs:t2"]);
  assert.deepEqual(Sync.tirarDaFila(["txs:t1"], [], base), ["txs:t1"]);
});
