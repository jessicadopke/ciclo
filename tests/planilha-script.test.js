// Contrato do Apps Script (apps-script/planilha.gs) com SpreadsheetApp, PropertiesService, LockService e ContentService falsos.
// Dados fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Sync } = require("./carregar.js");

const codigo = fs.readFileSync(path.join(__dirname, "..", "apps-script", "planilha.gs"), "utf8");

function ambiente(segredo = "SEGREDO-FICTICIO-1234", fonte = codigo) {
  const abas = new Map();
  const novaAba = nome => {
    const linhas = []; // linhas[0] = cabeçalho
    const aba = {
      nome, linhas, notas: [], congeladas: 0, formatos: [],
      getLastRow: () => linhas.length,
      setFrozenRows(n) { aba.congeladas = n; },
      getRange(a, b, c, d) {
        if (typeof a === "string") return { setNumberFormat: f => { aba.formatos.push([a, f]); } };
        return {
          getValues: () => Array.from({ length: c }, (_, i) => Array.from({ length: d }, (_, j) => (linhas[a - 1 + i] || [])[b - 1 + j] ?? "")),
          setValues: v => { v.forEach((linha, i) => { const L = linhas[a - 1 + i] = linhas[a - 1 + i] || []; linha.forEach((x, j) => { L[b - 1 + j] = x; }); }); },
          setNote: t => { aba.notas.push(t); },
        };
      },
    };
    abas.set(nome, aba);
    return aba;
  };
  const props = { SEGREDO: segredo };
  const trava = { presa: false, livre: true, solta: 0 };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => abas.get(n) || null, insertSheet: novaAba }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (!trava.livre) return false; trava.presa = true; return true; }, releaseLock: () => { trava.presa = false; trava.solta++; } }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx, { filename: "planilha.gs" });
  const chamar = (corpo, segredoEnviado = segredo) => {
    const bruto = typeof corpo === "string" ? corpo : JSON.stringify({ ...corpo, segredo: segredoEnviado });
    return JSON.parse(ctx.doPost({ postData: { contents: bruto } }).getContent());
  };
  return { chamar, abas, props, ctx, trava };
}

const card = (id, extra = {}) => ({ id, name: "Cartão " + id, holder: "Fulana", type: "va", issuer: "Outro", last4: "", balance: 0, saldoBase: 0, createdAt: 1, ...extra });
const tx = (id, extra = {}) => ({ id, cardId: "c1", kind: "debit", amount: 1000, desc: "Mercado Teste", cat: "Mercado", date: "2026-10-01", createdAt: 2, ...extra });
const env = (loja, r, por = "aparelho1") => ({ loja, id: r.id, mudou: r.updatedAt, por, apagado: !!r.apagado, dados: { ...r, updatedBy: por } });
const reg = (loja, base, mudou, extra = {}) => {
  const r = (loja === "cards" ? card : tx)(base, { updatedAt: mudou, ...extra });
  return env(loja, r);
};
const enviar = (a, registros) => a.chamar({ acao: "enviar", aparelho: "aparelho1", registros });

test("segredo errado, vazio ou script sem configurar(): erro \"segredo\" e nada é criado", () => {
  const a = ambiente();
  assert.deepEqual(a.chamar({ acao: "estado" }, "outro"), { ok: false, erro: "segredo" });
  assert.deepEqual(a.chamar({ acao: "enviar", aparelho: "x", registros: [] }, ""), { ok: false, erro: "segredo" });
  assert.equal(a.abas.size, 0);
  delete a.props.SEGREDO;
  assert.equal(a.chamar({ acao: "estado" }, "").erro, "segredo");
});

test("configurar() recusa o texto de exemplo e grava um código válido", () => {
  const { ctx, props } = ambiente();
  delete props.SEGREDO;
  assert.throws(() => ctx.configurar(), /Troque o texto/);
  const b = ambiente("x", codigo.replace("COLE-AQUI-O-CODIGO", "codigo-ficticio-de-teste-123"));
  delete b.props.SEGREDO;
  b.ctx.configurar();
  assert.equal(b.props.SEGREDO, "codigo-ficticio-de-teste-123");
});

test("o arquivo do repositório não traz segredo nem link reais, e só usa a planilha vinculada", () => {
  assert.ok(codigo.includes('SEGREDO_LOCAL = "COLE-AQUI-O-CODIGO"'));
  assert.ok(!/script\.google\.com\/macros\/s\//.test(codigo));
  assert.ok(!/openById|openByUrl|SpreadsheetApp\.create|DriveApp/.test(codigo));
  assert.ok(codigo.split("\n").slice(0, 25).join("\n").includes("Extensões > Apps Script"));
});

test("enviar cria as abas com cabeçalho e linhas novas; reenviar o mesmo não duplica", () => {
  const a = ambiente();
  const r1 = enviar(a, [reg("cards", "c1", 100), reg("txs", "t1", 110)]);
  assert.equal(r1.ok, true);
  assert.equal(r1.aceitos, 2);
  assert.equal(r1.ignorados, 0);
  assert.ok(r1.marca >= 2 && r1.hora > 0);
  assert.deepEqual([...a.abas.keys()].sort(), ["Cartões", "Lançamentos"]);
  const cartoes = a.abas.get("Cartões"), lanc = a.abas.get("Lançamentos");
  assert.equal(cartoes.linhas.length, 2);
  assert.equal(cartoes.linhas[0][0], "Nome");
  assert.equal(cartoes.congeladas, 1);
  assert.ok(/Só para consulta/.test(cartoes.notas[0]));
  assert.equal(cartoes.linhas[1][0], "Cartão c1");
  const r2 = enviar(a, [reg("cards", "c1", 100), reg("txs", "t1", 110)]);
  assert.equal(r2.aceitos, 0);
  assert.equal(r2.ignorados, 2);
  assert.equal(cartoes.linhas.length, 2);
  assert.equal(lanc.linhas.length, 2);
});

test("enviar atualiza a linha existente e o registro mais velho é ignorado", () => {
  const a = ambiente();
  enviar(a, [reg("cards", "c1", 100)]);
  const novo = enviar(a, [reg("cards", "c1", 200, { name: "Nome novo" })]);
  assert.equal(novo.aceitos, 1);
  const cartoes = a.abas.get("Cartões");
  assert.equal(cartoes.linhas.length, 2);
  assert.equal(cartoes.linhas[1][0], "Nome novo");
  const velho = enviar(a, [reg("cards", "c1", 150, { name: "Nome velho" })]);
  assert.equal(velho.aceitos, 0);
  assert.equal(velho.ignorados, 1);
  assert.equal(cartoes.linhas[1][0], "Nome novo");
});

test("o mesmo id duas vezes no lote: fica uma linha só, com a versão que vence", () => {
  const a = ambiente();
  const r = enviar(a, [reg("txs", "t1", 100, { desc: "A" }), reg("txs", "t1", 300, { desc: "C" }), reg("txs", "t1", 200, { desc: "B" })]);
  assert.equal(r.aceitos, 2);
  const lanc = a.abas.get("Lançamentos");
  assert.equal(lanc.linhas.length, 2);
  assert.equal(lanc.linhas[1][2], "C");
});

test("buscar desde=N devolve só o que chegou depois; desde=0 devolve tudo", () => {
  const a = ambiente();
  const r1 = enviar(a, [reg("cards", "c1", 100), reg("txs", "t1", 110)]);
  const r2 = enviar(a, [reg("txs", "t2", 120)]);
  const tudo = a.chamar({ acao: "buscar", desde: 0 });
  assert.equal(tudo.ok, true);
  assert.deepEqual(tudo.registros.map(r => r.id), ["c1", "t1", "t2"]);
  assert.equal(tudo.mais, false);
  assert.equal(tudo.marca, r2.marca);
  const resto = a.chamar({ acao: "buscar", desde: r1.marca });
  assert.deepEqual(resto.registros.map(r => r.id), ["t2"]);
  assert.deepEqual(resto.registros[0].dados.desc, "Mercado Teste");
  assert.equal(resto.registros[0].loja, "txs");
  assert.equal(resto.registros[0].mudou, 120);
  const nada = a.chamar({ acao: "buscar", desde: r2.marca });
  assert.deepEqual(nada.registros, []);
  assert.equal(nada.marca, r2.marca);
});

test("buscar pagina com limite e avisa que tem mais", () => {
  const a = ambiente();
  enviar(a, [reg("txs", "t1", 1), reg("txs", "t2", 2), reg("txs", "t3", 3)]);
  const p1 = a.chamar({ acao: "buscar", desde: 0, limite: 2 });
  assert.equal(p1.mais, true);
  assert.equal(p1.registros.length, 2);
  const p2 = a.chamar({ acao: "buscar", desde: p1.marca, limite: 2 });
  assert.equal(p2.mais, false);
  assert.deepEqual(p2.registros.map(r => r.id), ["t3"]);
});

test("apagado vira linha marcada e não some; só a marca mínima fica no JSON", () => {
  const a = ambiente();
  enviar(a, [reg("cards", "c1", 100), reg("txs", "t1", 110)]);
  const marca = Sync.marcaApagado({ id: "t1", updatedAt: 110 }, "aparelho1", 50);
  const r = enviar(a, [env("txs", marca)]);
  assert.equal(r.aceitos, 1);
  const lanc = a.abas.get("Lançamentos");
  assert.equal(lanc.linhas.length, 2);
  assert.equal(lanc.linhas[1][7], "sim");
  assert.equal(lanc.linhas[1][2], "");
  const b = a.chamar({ acao: "buscar", desde: 0 }).registros.find(x => x.id === "t1");
  assert.equal(b.apagado, true);
  assert.deepEqual(Object.keys(b.dados).sort(), ["apagado", "id", "updatedAt", "updatedBy"]);
  // edição mais velha que a marca não ressuscita
  assert.equal(enviar(a, [reg("txs", "t1", 111)]).ignorados, 1);
  assert.equal(lanc.linhas[1][7], "sim");
  const e = a.chamar({ acao: "estado" });
  assert.equal(e.lancamentos, 0);
  assert.equal(e.cartoes, 1);
});

test("estado conta só os não apagados e devolve marca e hora", () => {
  const a = ambiente();
  assert.deepEqual({ ...a.chamar({ acao: "estado" }), hora: 0 }, { ok: true, cartoes: 0, lancamentos: 0, marca: 0, hora: 0 });
  enviar(a, [reg("cards", "c1", 1), reg("cards", "c2", 2), reg("txs", "t1", 3)]);
  const e = a.chamar({ acao: "estado" });
  assert.equal(e.cartoes, 2);
  assert.equal(e.lancamentos, 1);
  assert.equal(e.marca, 3);
  assert.ok(e.hora > 0);
});

test("a coluna Saldo é saldoBase + lançamentos e o nome do cartão aparece no lançamento", () => {
  const a = ambiente();
  enviar(a, [reg("cards", "c1", 1, { saldoBase: 500 }), reg("txs", "t1", 2), reg("txs", "t2", 3, { kind: "credit", amount: 4000 }), reg("txs", "t3", 4, { cardId: "outro" })]);
  const cartoes = a.abas.get("Cartões"), lanc = a.abas.get("Lançamentos");
  assert.equal(cartoes.linhas[1][5], (500 - 1000 + 4000) / 100);
  assert.equal(lanc.linhas[1][1], "Cartão c1");
  assert.equal(lanc.linhas[3][1], "");
  // apagar um lançamento devolve o saldo
  enviar(a, [env("txs", Sync.marcaApagado({ id: "t1", updatedAt: 2 }, "aparelho1", 10))]);
  assert.equal(cartoes.linhas[1][5], (500 + 4000) / 100);
});

test("cofre: registro meta/vault vai para a aba Cofre", () => {
  const a = ambiente();
  const r = enviar(a, [{ loja: "meta", id: "vault", mudou: 5, por: "aparelho1", apagado: false, dados: { id: "vault", salt: "xx", check: "yy" } }]);
  assert.equal(r.aceitos, 1);
  assert.equal(a.abas.get("Cofre").linhas[1][2], "vault");
});

test("JSON inválido, ação desconhecida e registros malformados: erro \"formato\"", () => {
  const a = ambiente();
  assert.deepEqual(a.chamar("isto não é json"), { ok: false, erro: "formato" });
  assert.deepEqual(a.chamar("null"), { ok: false, erro: "formato" });
  assert.deepEqual(a.chamar({ acao: "apagar" }), { ok: false, erro: "formato" });
  assert.deepEqual(a.chamar({ acao: "enviar", aparelho: "x" }), { ok: false, erro: "formato" });
  assert.deepEqual(a.chamar({ acao: "enviar", registros: [] }), { ok: false, erro: "formato" });
  for (const ruim of [{ loja: "receipts", id: "a", mudou: 1, apagado: false, dados: { id: "a" } }, { loja: "txs", id: "a", mudou: "1", apagado: false, dados: { id: "a" } }, { loja: "txs", id: "a", mudou: 1, apagado: false, dados: { id: "b" } }, null]) {
    assert.deepEqual(enviar(a, [ruim]), { ok: false, erro: "formato" });
  }
  assert.equal(a.abas.size, 0);
});

test("lote grande demais: erro \"tamanho\" e nada é gravado", () => {
  const a = ambiente();
  const lote = Array.from({ length: 501 }, (_, i) => reg("txs", "t" + i, i + 1));
  assert.deepEqual(enviar(a, lote), { ok: false, erro: "tamanho" });
  assert.equal(a.abas.size, 0);
  assert.equal(enviar(a, lote.slice(0, 500)).aceitos, 500);
  const pesado = a.chamar({ acao: "enviar", aparelho: "x", registros: [], lixo: "a".repeat(5 * 1048576 + 1) });
  assert.deepEqual(pesado, { ok: false, erro: "tamanho" });
});

test("trava: ocupado quando outra chamada segura a trava; a trava é sempre solta", () => {
  const a = ambiente();
  a.trava.livre = false;
  assert.deepEqual(enviar(a, [reg("txs", "t1", 1)]), { ok: false, erro: "ocupado" });
  assert.equal(a.abas.size, 0);
  a.trava.livre = true;
  enviar(a, [reg("txs", "t1", 1)]);
  assert.equal(a.trava.presa, false);
  assert.ok(a.trava.solta >= 1);
});

test("falha da planilha vira erro \"inesperado\" e a trava é solta", () => {
  const a = ambiente();
  a.ctx.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error("falhou"); };
  assert.deepEqual(a.chamar({ acao: "estado" }), { ok: false, erro: "inesperado" });
  assert.equal(a.trava.presa, false);
});

test("a regra de quem vence é a mesma do app (Sync.vence), inclusive nos empates", () => {
  const a = ambiente();
  const casos = [];
  for (const mudou of [10, 20]) for (const por of ["aaa", "bbb"]) for (const nome of ["A", "B"]) casos.push({ mudou, por, nome });
  for (const x of casos) for (const y of casos) {
    const rx = { id: "k", name: x.nome, updatedAt: x.mudou, updatedBy: x.por }, ry = { id: "k", name: y.nome, updatedAt: y.mudou, updatedBy: y.por };
    const doApp = Sync.canonico(rx) === Sync.canonico(ry) ? false : Sync.vence(rx, ry) === rx;
    const doScript = a.ctx.vence_({ mudou: x.mudou, por: x.por, dados: rx }, { mudou: y.mudou, por: y.por, dados: ry });
    assert.equal(doScript, doApp, JSON.stringify([x, y]));
  }
});
