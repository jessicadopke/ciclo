// O estado do app (S) é um objeto único, com o mesmo formato de sempre.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const url = pathToFileURL(path.join(__dirname, "..", "js", "app", "estado.js")).href;

test("S tem os campos e os valores iniciais de sempre", async () => {
  const { S } = await import(url);
  assert.deepEqual(Object.keys(S).sort(), [
    "busy", "cardQuery", "cards", "gfOffset", "gfView", "groups", "installEvt", "key", "loaded", "lockTimer", "meta",
    "periodOffset", "plain", "plainSig", "person", "reveal", "skipped", "tab", "txLimit", "txQuery", "txs", "view",
  ].sort());
  assert.deepEqual(S.cards, []);
  assert.deepEqual(S.txs, []);
  assert.deepEqual(S.meta, {});
  assert.equal(S.loaded, false);
  assert.deepEqual(S.view, { name: "home" });
  assert.equal(S.tab, "home");
  assert.equal(S.person, null);
  assert.equal(S.periodOffset, 0);
  assert.equal(S.gfOffset, 0);
  assert.equal(S.gfView, "categorias");
  assert.equal(S.busy, false);
  assert.ok(S.skipped instanceof Set && S.skipped.size === 0);
  assert.equal(S.cardQuery, "");
  assert.deepEqual(S.groups, {});
  assert.equal(S.txQuery, "");
  assert.equal(S.txLimit, 100);
  assert.equal(S.key, null);
  assert.deepEqual(S.plain, {});
  assert.deepEqual(S.plainSig, {});
  assert.ok(S.reveal instanceof Set && S.reveal.size === 0);
  assert.equal(S.lockTimer, null);
  assert.equal(S.installEvt, null);
});

test("existe uma única instância de S, compartilhada por todos os importadores", async () => {
  const a = await import(url);
  const b = await import(url + "");
  assert.equal(a.S, b.S);
  a.S.cards.push({ id: "x" });
  assert.equal(b.S.cards.length, 1);
  a.S.cards.length = 0;
});

test("ui e config começam vazios e a leitura de cartões usa o mesmo S", async () => {
  const { S, ui, config, cardById, sortedCards, holders } = await import(url);
  assert.equal(ui.sheetCleanup, null);
  assert.equal(config.APP_VERSION, "");
  S.cards.push({ id: "b", name: "B", holder: "Zeca", createdAt: 2 }, { id: "a", name: "A", holder: "Ana", createdAt: 1 });
  assert.equal(cardById("a").name, "A");
  assert.deepEqual(sortedCards().map(c => c.id), ["a", "b"]);
  assert.deepEqual(holders(), ["Ana", "Zeca"]);
  S.cards.length = 0;
});
