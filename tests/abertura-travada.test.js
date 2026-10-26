// #32: o app nunca fica girando para sempre na abertura. Sem navegador: simula DOM, IndexedDB, caches e service worker.
// Todos os dados aqui são fictícios.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const raiz = path.join(__dirname, "..");
const ler = f => fs.readFileSync(path.join(raiz, f), "utf8");
const html = ler("index.html");
const inline = html.slice(html.indexOf("<script>\n// Segurança da abertura") + 9, html.indexOf("</script>", html.indexOf("// Segurança da abertura")));

// Banco falso com dados fictícios; qualquer escrita ou apagamento fica registrado em `chamadas`.
function bancoFalso(dados) {
  const chamadas = [];
  const store = nome => ({
    getAll: () => { const q = {}; setTimeout(() => { q.result = dados[nome]; q.onsuccess && q.onsuccess(); }); return q; },
    get: () => { const q = {}; setTimeout(() => { q.result = dados[nome]; q.onsuccess && q.onsuccess(); }); return q; },
  });
  const indexedDB = {
    open(n) {
      chamadas.push("open:" + n);
      const r = {};
      setTimeout(() => { r.result = { objectStoreNames: { contains: s => s in dados }, transaction: s => ({ objectStore: () => store(s) }), close() {} }; r.onsuccess && r.onsuccess(); });
      return r;
    },
    deleteDatabase() { chamadas.push("deleteDatabase"); throw new Error("não pode apagar"); },
  };
  return { indexedDB, chamadas };
}

// Roda o script da abertura num ambiente falso. Os relógios ficam na mão do teste.
function abrir({ iniciou = false, idb, regs = [], cacheNomes = [] } = {}) {
  const els = {};
  const get = id => els[id] || (els[id] = { id, className: "", textContent: "", hidden: id === "abSocorro", disabled: false, h: {}, addEventListener(ev, fn) { this.h[ev] = fn; } });
  const eventos = {}, timers = [], apagadas = [], ls = [];
  const downloads = [];
  const ctx = {
    document: {
      getElementById: id => id === "abertura" ? (ctx.removida ? null : get(id)) : get(id),
      createElement: () => { const a = { click() { downloads.push(a); }, remove() {} }; return a; },
      body: { appendChild() {} },
    },
    location: { reload() { ctx.recarregou = true; } },
    navigator: { serviceWorker: { getRegistrations: async () => regs.map(n => ({ unregister: async () => { apagadas.push("sw:" + n); } })) } },
    caches: { keys: async () => cacheNomes, delete: async n => { apagadas.push("cache:" + n); return true; } },
    localStorage: { getItem() { ls.push("get"); return null; }, setItem() { ls.push("set"); }, removeItem() { ls.push("rm"); }, clear() { ls.push("clear"); } },
    indexedDB: idb && idb.indexedDB,
    Blob: class { constructor(p) { this.p = p; } },
    URL: { createObjectURL: b => b },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: () => {},
    JSON, String, Date, Promise,
    __cicloIniciou: iniciou || undefined,
    addEventListener: (ev, fn) => { eventos[ev] = fn; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(inline, ctx);
  return { ctx, get, eventos, timers, apagadas, ls, downloads };
}
const espera = () => new Promise(r => setTimeout(r, 20));

test("sem o app iniciar, em 10 s aparece a mensagem de arquivos com os botões", () => {
  const a = abrir();
  const t = a.timers.find(x => x.ms === 10000);
  assert.ok(t, "falta o prazo de 10 s");
  t.f();
  assert.equal(a.get("abSocorro").hidden, false);
  assert.match(a.get("abTexto").textContent, /não conseguiu carregar todos os arquivos/);
  assert.match(a.get("abTexto").textContent, /não foram apagados/);
  assert.equal(a.get("abertura").className, "falha");
});

test("com o código carregado mas sem dados em 10 s, a mensagem é a dos dados", () => {
  const a = abrir({ iniciou: true });
  a.timers.find(x => x.ms === 10000).f();
  assert.match(a.get("abTexto").textContent, /Não consegui abrir seus dados/);
  assert.equal(a.get("abSocorro").hidden, false);
});

test("erro de arquivo/módulo ou promessa rejeitada antes do app iniciar mostra a mensagem na hora", () => {
  for (const ev of ["error", "unhandledrejection"]) {
    const a = abrir();
    assert.equal(a.get("abSocorro").hidden, true);
    a.eventos[ev]({});
    assert.equal(a.get("abSocorro").hidden, false, ev);
  }
});

test("erro depois do app iniciar não troca a abertura (só o prazo de 10 s ou o catch do app)", () => {
  const a = abrir({ iniciou: true });
  a.eventos.error({});
  assert.equal(a.get("abSocorro").hidden, true);
});

test("o app expõe __cicloFalha para o catch da inicialização trocar a tela", () => {
  const a = abrir({ iniciou: true });
  a.ctx.__cicloFalha("dados");
  assert.equal(a.get("abSocorro").hidden, false);
  assert.match(ler("js/app.js"), /__cicloFalha/);
});

test("Tentar de novo só recarrega", () => {
  const a = abrir({ idb: bancoFalso({}) });
  a.get("abTentar").h.click();
  assert.equal(a.ctx.recarregou, true);
  assert.deepEqual(a.apagadas, []);
});

test("Atualizar os arquivos limpa só service worker e caches; IndexedDB e localStorage ficam intactos", async () => {
  const dados = { cards: [{ id: "c1", name: "Cartão de teste" }], txs: [{ id: "t1", amount: 12.5 }], meta: { vault: null } };
  const copia = JSON.stringify(dados);
  const idb = bancoFalso(dados);
  const a = abrir({ idb, regs: ["a"], cacheNomes: ["ciclo-1.12.0", "ciclo-1.14.0"] });
  a.get("abArquivos").h.click();
  await espera();
  assert.deepEqual(a.apagadas.sort(), ["cache:ciclo-1.12.0", "cache:ciclo-1.14.0", "sw:a"]);
  assert.equal(a.ctx.recarregou, true);
  assert.deepEqual(idb.chamadas, [], "não pode abrir nem apagar o banco");
  assert.deepEqual(a.ls, [], "não pode mexer em localStorage");
  assert.equal(JSON.stringify(dados), copia, "os dados de teste continuam iguais");
});

test("o código do botão de arquivos não tem nenhuma chamada que apague dados", () => {
  const i = inline.indexOf('el("abArquivos")'), j = inline.indexOf('el("abCopia")');
  const trecho = inline.slice(i, j);
  for (const proibido of ["indexedDB", "deleteDatabase", "localStorage", "IDB", ".clear(", "deleteObjectStore"]) assert.ok(!trecho.includes(proibido), proibido);
  assert.match(trecho, /unregister/);
  assert.match(trecho, /caches\.delete/);
});

test("Salvar uma cópia dos dados lê o banco e baixa um arquivo no formato do backup, sem escrever nada", async () => {
  const idb = bancoFalso({ cards: [{ id: "c1", name: "Cartão de teste" }], txs: [{ id: "t1", amount: 12.5 }], meta: { vault: { x: 1 }, drive: { secret: "nao-deve-sair" } } });
  const a = abrir({ idb });
  a.get("abCopia").h.click();
  await espera();
  assert.equal(a.downloads.length, 1);
  const json = JSON.parse(a.downloads[0].href.p[0]);
  assert.equal(json.app, "ciclo");
  assert.deepEqual(json.cards, [{ id: "c1", name: "Cartão de teste" }]);
  assert.equal(json.txs.length, 1);
  assert.deepEqual(json.meta, { vault: { x: 1 } });
  assert.ok(!JSON.stringify(json).includes("nao-deve-sair"));
  assert.deepEqual(idb.chamadas, ["open:ciclo"]);
});

test("se não der para ler os dados, a mensagem diz que eles continuam guardados", async () => {
  const a = abrir({ idb: { indexedDB: { open() { throw new Error("travado"); } } } });
  a.get("abCopia").h.click();
  await espera();
  assert.match(a.get("abTexto").textContent, /continuam guardados no celular/);
  assert.equal(a.downloads.length, 0);
});

// ---------- IDB com prazo ----------
const urlArm = pathToFileURL(path.join(raiz, "js", "app", "armazenamento.js")).href;

test("IDB.open rejeita dentro do prazo quando o Chrome nunca responde", async () => {
  const { IDB, PRAZO } = await import(urlArm);
  const antes = PRAZO.abrir; PRAZO.abrir = 30;
  globalThis.indexedDB = { open: () => ({}) };
  try {
    const t0 = Date.now();
    await assert.rejects(IDB.open(), /não respondeu a tempo/);
    assert.ok(Date.now() - t0 < 500);
  } finally { PRAZO.abrir = antes; delete globalThis.indexedDB; }
});

test("IDB.open rejeita na hora quando outra janela segura o banco (onblocked)", async () => {
  const { IDB } = await import(urlArm);
  globalThis.indexedDB = { open: () => { const r = {}; setTimeout(() => r.onblocked()); return r; } };
  try { await assert.rejects(IDB.open(), /bloqueado/); } finally { delete globalThis.indexedDB; }
});

test("abertura que termina depois do prazo fecha a conexão atrasada", async () => {
  const { IDB, PRAZO } = await import(urlArm);
  const antes = PRAZO.abrir; PRAZO.abrir = 10;
  let fechou = false, r;
  globalThis.indexedDB = { open: () => (r = {}) };
  try {
    await assert.rejects(IDB.open());
    r.result = { close() { fechou = true; } }; r.onsuccess();
    assert.equal(fechou, true);
  } finally { PRAZO.abrir = antes; delete globalThis.indexedDB; }
});

test("migrateOldDb não trava se indexedDB.databases() nunca responde", async () => {
  const { migrateOldDb, PRAZO } = await import(urlArm);
  const antes = PRAZO.abrir; PRAZO.abrir = 20;
  globalThis.indexedDB = { databases: () => new Promise(() => {}), open: () => ({}) };
  try { assert.equal(await migrateOldDb(), false); } finally { PRAZO.abrir = antes; delete globalThis.indexedDB; }
});

test("migrateOldDb rejeita (sem travar) se o banco antigo não responde", async () => {
  const { IDB, migrateOldDb, PRAZO } = await import(urlArm);
  const antes = PRAZO.abrir; PRAZO.abrir = 20;
  IDB.db = { transaction: () => { const tx = {}; setTimeout(() => tx.oncomplete()); return { objectStore: () => ({ getAll: () => ({ result: [] }), get: () => ({ result: undefined }) }), set oncomplete(f) { tx.oncomplete = f; } }; } };
  globalThis.indexedDB = { databases: async () => [{ name: "carteira-vales" }], open: () => ({}) };
  try { await assert.rejects(migrateOldDb(), /não respondeu a tempo/); } finally { PRAZO.abrir = antes; IDB.db = null; delete globalThis.indexedDB; }
});

// ---------- applyUpdate ----------
test("applyUpdate espera o service worker novo e só apaga caches antigas se a nova existe", async () => {
  require("./carregar.js"); // Issuers etc., como os <script> do index.html
  const { config, S } = await import(pathToFileURL(path.join(raiz, "js", "app", "estado.js")).href);
  const { applyUpdate } = await import(pathToFileURL(path.join(raiz, "js", "app", "atualizacao.js")).href);
  config.APP_VERSION = "1.14.0"; S.updateAvailable = "1.15.0";
  for (const [existentes, esperado] of [[["ciclo-1.14.0", "ciclo-1.15.0"], ["ciclo-1.14.0"]], [["ciclo-1.14.0"], []]]) {
    const ordem = [], apagadas = [];
    let ouvinte;
    const w = { state: "installing", addEventListener: (_, f) => { ouvinte = f; } };
    globalThis.window = globalThis;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true, serviceWorker: { getRegistration: async () => ({ installing: w, update: async () => { ordem.push("update"); } }) } } });
    globalThis.caches = { keys: async () => { ordem.push("keys"); return existentes; }, delete: async n => { apagadas.push(n); } };
    globalThis.location = { reload() { ordem.push("reload"); } };
    const el = { setAttribute() {}, remove() {} };
    globalThis.document = { getElementById: () => ({ replaceChildren() {} }), createElement: () => el };
    const p = applyUpdate();
    await espera();
    assert.ok(!ordem.includes("keys"), "não pode apagar antes do worker novo assumir");
    w.state = "activated"; ouvinte();
    await p;
    assert.deepEqual(apagadas, esperado);
    assert.deepEqual(ordem, ["update", "keys", "reload"]);
  }
  for (const k of ["window", "caches", "location", "document", "navigator"]) delete globalThis[k];
});

// ---------- service worker ----------
function carregarSw(copia, rede) {
  const handlers = {};
  const ctx = {
    self: { addEventListener: (ev, fn) => { handlers[ev] = fn; }, location: { origin: "https://x.test" } },
    location: { origin: "https://x.test" },
    importScripts() {}, URL, Response, Request,
    caches: { open: async () => ({ match: async req => { const k = typeof req === "string" ? req : req.url; return copia[k.replace("https://x.test/", "")]; } }) },
    fetch: async req => { if (!rede) throw new Error("sem rede"); return rede(req); },
  };
  vm.createContext(ctx);
  vm.runInContext(ler("sw.js"), ctx);
  return handlers;
}
const pedir = async (h, url, mode = "no-cors") => {
  let resp; h.fetch({ request: { method: "GET", url: "https://x.test/" + url, mode }, respondWith: p => { resp = p; } });
  return resp;
};

test("cache misto 1.12.0 / 1.14.0: o sw serve tudo da cópia da versão atual, sem ir à internet", async () => {
  // Reprodução: antes, com rede ruim, index.html/js novos vinham da internet e algum módulo caía na cópia velha.
  // Agora a internet nem é consultada para arquivos da lista.
  const copia = { "index.html": new Response("pagina 1.14.0"), "js/app.js": new Response("app 1.14.0"), "js/app/telas.js": new Response("telas 1.14.0") };
  let idas = 0;
  const h = carregarSw(copia, () => { idas++; return new Response("da internet"); });
  assert.equal(await (await pedir(h, "js/app.js")).text(), "app 1.14.0");
  assert.equal(await (await pedir(h, "", "navigate")).text(), "pagina 1.14.0");
  assert.equal(idas, 0);
});

test("arquivo que não está na cópia nem na internet vira erro explícito, não 'nada'", async () => {
  const h = carregarSw({}, null);
  const r = await pedir(h, "js/app/telas.js");
  assert.ok(r, "respondWith recebeu algo");
  assert.equal((await r).type, "error");
});

test("sw.js: nada de caches.match solto e a cópia do install ignora o cache do navegador", () => {
  const sw = ler("sw.js");
  assert.ok(!/caches\.match\(/.test(sw), "usa só caches.open(VERSION).match");
  assert.match(sw, /Response\.error\(\)/);
  assert.match(sw, /cache: "reload"/);
});
