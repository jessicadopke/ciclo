// Carrega os scripts do app no Node, como o navegador faz (cada um se pendura em `window`).
// Só os que não dependem da tela: emissores, leitor do celular, Gemini e escolha do cartão.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

globalThis.window = globalThis;
const raiz = path.join(__dirname, "..");
for (const f of ["js/issuers.js", "js/recorte.js", "js/receipt.js", "js/gemini.js", "js/drive.js", "js/sync.js", "js/csv.js", "js/match.js", "js/graficos.js", "js/credito.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(raiz, f), "utf8"), { filename: f });
}

const cupom = nome => fs.readFileSync(path.join(__dirname, "cupons", nome), "utf8");
const respostaGemini = nome => JSON.parse(fs.readFileSync(path.join(__dirname, "gemini", nome), "utf8"));

module.exports = { Issuers: window.Issuers, Recorte: window.Recorte, ReceiptReader: window.ReceiptReader, GeminiReader: window.GeminiReader, Drive: window.Drive, Sync: window.Sync, Csv: window.Csv, Match: window.Match, Graficos: window.Graficos, Credito: window.Credito, cupom, respostaGemini };
