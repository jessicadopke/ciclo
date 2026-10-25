// Ids novos não repetem entre aparelhos; ids antigos continuam achados.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
require("./carregar.js");
const dir = path.join(__dirname, "..", "js", "app");

test("uid: 10 000 ids sem repetir, no formato novo", async () => {
  const { uid } = await import(pathToFileURL(path.join(dir, "util.js")).href);
  const vistos = new Set();
  for (let i = 0; i < 10000; i++) {
    const id = uid();
    assert.match(id, /^[0-9a-z]{20,}$/);
    vistos.add(id);
  }
  assert.equal(vistos.size, 10000);
});

test("ids antigos de 14 caracteres continuam achados por cardById", async () => {
  const { S, cardById } = await import(pathToFileURL(path.join(dir, "estado.js")).href);
  S.cards.push({ id: "mh3k2x9ab1c4d2", name: "Antigo" });
  assert.equal(cardById("mh3k2x9ab1c4d2").name, "Antigo");
  S.cards.length = 0;
});
