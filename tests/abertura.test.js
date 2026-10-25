// Abertura do app (#29): ícones sem borda, tela de carregamento inline e sua saída. Só lê cores e pixels.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const raiz = path.join(__dirname, "..");
const ler = f => fs.readFileSync(path.join(raiz, f), "utf8");
const html = ler("index.html");
const app = ler("js/app.js");
const manifest = JSON.parse(ler("manifest.webmanifest"));

// Decodificação mínima de PNG RGBA 8 bits (sem dependência).
function png(f) {
  const b = fs.readFileSync(path.resolve(raiz, f));
  let p = 8, w, h; const idat = [];
  while (p < b.length) {
    const l = b.readUInt32BE(p), t = b.toString("latin1", p + 4, p + 8);
    if (t === "IHDR") { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); assert.equal(b[p + 16], 8); assert.equal(b[p + 17], 6); }
    if (t === "IDAT") idat.push(b.subarray(p + 8, p + 8 + l));
    p += 12 + l;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), st = w * 4, px = Buffer.alloc(h * st);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (st + 1)];
    for (let x = 0; x < st; x++) {
      const v = raw[y * (st + 1) + 1 + x];
      const a = x >= 4 ? px[y * st + x - 4] : 0, u = y ? px[(y - 1) * st + x] : 0, c = x >= 4 && y ? px[(y - 1) * st + x - 4] : 0;
      let r;
      if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + u; else if (ft === 3) r = v + ((a + u) >> 1);
      else { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? u : c); }
      px[y * st + x] = r & 255;
    }
  }
  return { w, h, at: (x, y) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)] };
}

test("ícones any são petróleo opaco de ponta a ponta", () => {
  for (const [f, n] of [["icons/icon-192.png", 192], ["icons/icon-512.png", 512]]) {
    const im = png(f);
    assert.equal(im.w, n); assert.equal(im.h, n);
    const m = n >> 1, e = n - 1;
    for (const [x, y] of [[0, 0], [e, 0], [0, e], [e, e], [m, 0], [m, e], [0, m], [e, m]]) {
      assert.deepEqual(im.at(x, y), [14, 79, 92, 255], `${f} em ${x},${y}`);
    }
  }
});

test("manifest mantém ícones e cor de abertura", () => {
  assert.equal(manifest.background_color, "#0e4f5c");
  assert.equal(manifest.theme_color, "#0e4f5c");
  assert.deepEqual(manifest.icons.map(i => [i.src, i.sizes, i.purpose]), [
    ["icons/icon-192.png", "192x192", "any"],
    ["icons/icon-512.png", "512x512", "any"],
    ["icons/maskable-512.png", "512x512", "maskable"],
  ]);
});

test("símbolo do maskable dentro da zona segura", () => {
  const im = png("icons/maskable-512.png"), raio = im.w * 0.4, c = im.w / 2;
  let simbolo = 0;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const [r, g, b] = im.at(x, y);
    if (r > 0x60 || g > 0x90) { // menta ou âmbar (o petróleo tem g <= 0x4f)
      simbolo++;
      assert.ok(Math.hypot(x - c, y - c) <= raio, `pixel fora da zona segura em ${x},${y}`);
    }
  }
  assert.ok(simbolo > 1000);
});

test("index.html tem #abertura inline antes de styles.css", () => {
  const css = html.indexOf('<link rel="stylesheet" href="styles.css">');
  const estilo = html.indexOf("#abertura {");
  assert.ok(estilo > 0 && estilo < css);
  assert.match(html, /<body>\s*<div id="abertura" role="status">/);
  assert.match(html, /Abrindo o Ciclo/);
  assert.match(html, /position: fixed; inset: 0/);
  assert.match(html, /100dvh/);
  assert.match(html, /stroke="#7fe0d0"/);
  assert.match(html, /fill="#ffb547"/);
  assert.match(html, /<div id="view"><\/div>/);
  assert.doesNotMatch(html, /Carregando…/);
});

test("cor de #abertura é igual a background_color do manifest", () => {
  const regra = html.match(/#abertura \{[^}]*\}/)[0];
  assert.ok(regra.includes(`background: ${manifest.background_color}`));
});

test("js/app.js fecha a abertura depois do render() e no catch, sem tempo mínimo", () => {
  const ini = app.indexOf("(async () => {\n  try {\n    applyTheme");
  const bloco = app.slice(ini, app.indexOf("\n})();", ini));
  const ok = bloco.slice(0, bloco.indexOf("} catch (e)"));
  const catchBloco = bloco.slice(bloco.indexOf("} catch (e)"));
  assert.match(ok, /\n    render\(\);\n    fecharAbertura\(\);/);
  assert.match(catchBloco, /fecharAbertura\(\)/);
  assert.doesNotMatch(bloco, /setTimeout\([^\n]*fecharAbertura/);
  const f = app.match(/function fecharAbertura\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(f, /\.remove\(\)/);
  assert.match(f, /classList\.add\("saindo"\)/);
  assert.match(f, /setTimeout\(\(\) => el\.remove\(\), 170\)/); // só a saída de 150 ms
  assert.match(html, /#abertura\.saindo \{ opacity: 0; pointer-events: none; \}/);
  assert.match(html, /transition: opacity \.15s/);
});

test("script inline de segurança existe", () => {
  assert.match(html, /Está demorando mais que o normal\. Feche e abra o app de novo\./);
  assert.match(html, /10000\)/);
});

test("abertura tem regra de reduced-motion", () => {
  const m = html.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)[0];
  assert.match(m, /animation: none/);
  assert.match(m, /transition: none/);
  assert.match(app, /prefers-reduced-motion: reduce[\s\S]{0,40}el\.remove\(\)/);
});

test("metas theme-color voltam aos valores originais", () => {
  assert.match(html, /id="tcClaro" content="#f3f7f7"/);
  assert.match(html, /id="tcEscuro" content="#081417"/);
  assert.match(html, /tcClaro"\)\.content = "#0e4f5c"/);
  const f = app.match(/function fecharAbertura\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(f, /claro\.content = "#f3f7f7"/);
  assert.match(f, /escuro\.content = "#081417"/);
});

test("gerador regenera os ícones any com tamanho certo e cantos petróleo", () => {
  const pasta = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ciclo-icones-"));
  try {
    require("node:child_process").execFileSync(process.execPath, [path.join(raiz, "scripts/gerar-icones.mjs"), pasta], { stdio: "pipe" });
    for (const n of [192, 512]) {
      const im = png(path.join(pasta, `icon-${n}.png`));
      assert.equal(im.w, n); assert.equal(im.h, n);
      for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) assert.deepEqual(im.at(x, y), [14, 79, 92, 255]);
    }
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
