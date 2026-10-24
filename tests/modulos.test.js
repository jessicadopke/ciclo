// Confere a organização de js/app/*.js: quem pode importar quem, lista offline do sw.js e carregamento sem navegador.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const raiz = path.join(__dirname, "..");
const pasta = path.join(raiz, "js", "app");
const arquivos = fs.readdirSync(pasta).filter(f => f.endsWith(".js")).sort();
const nomes = arquivos.map(f => f.replace(/\.js$/, ""));

// Módulos de base: só podem importar outros módulos de base (lista branca).
// util, estado e cripto não importam nada.
const BASE = { util: [], estado: [], cripto: [], periodos: ["util", "estado"], armazenamento: ["estado"] };

const lerImports = arq => {
  const texto = fs.readFileSync(path.join(pasta, arq), "utf8");
  return [...texto.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map(m => m[1] || m[2]);
};

test("módulos de base só importam módulos de base permitidos", () => {
  for (const arq of arquivos) {
    const nome = arq.replace(/\.js$/, "");
    if (!(nome in BASE)) continue;
    const alvos = lerImports(arq).map(i => {
      assert.ok(/^\.\/[\w-]+\.js$/.test(i), `${arq}: import fora do padrão "./nome.js": ${i}`);
      return i.slice(2, -3);
    });
    for (const alvo of alvos) assert.ok(BASE[nome].includes(alvo), `${arq} não pode importar ${alvo}.js (permitidos: ${BASE[nome].join(", ") || "nenhum"})`);
  }
});

test("nenhum módulo importa a entrada (js/app.js)", () => {
  for (const arq of arquivos) {
    for (const i of lerImports(arq)) assert.ok(!/(^|\/)app\.js$/.test(i), `${arq} importa a entrada: ${i}`);
  }
});

test("todo arquivo de js/app/ e o js/app.js estão na lista offline (FILES do sw.js)", () => {
  const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8");
  const files = sw.slice(sw.indexOf("const FILES"), sw.indexOf("];", sw.indexOf("const FILES")));
  assert.ok(files.includes('"js/app.js"'), "js/app.js fora de FILES");
  for (const arq of arquivos) assert.ok(files.includes(`"js/app/${arq}"`), `js/app/${arq} fora de FILES no sw.js`);
});

test("cada módulo carrega no Node sem navegador e sem executar nada com efeito", async () => {
  require("./carregar.js"); // põe Issuers, Match etc. em globalThis, como os <script> do index.html
  assert.equal(typeof document, "undefined");
  assert.equal(typeof indexedDB, "undefined");
  for (const arq of arquivos) {
    const mod = await import(pathToFileURL(path.join(pasta, arq)).href);
    assert.ok(Object.keys(mod).length > 0, `${arq} não exporta nada`);
  }
});

test("exporta só nomes (sem export default)", async () => {
  for (const arq of arquivos) {
    const mod = await import(pathToFileURL(path.join(pasta, arq)).href);
    assert.ok(!("default" in mod), `${arq} tem export default`);
  }
});
