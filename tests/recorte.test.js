// Geometria do recorte do cupom, com imagens montadas aqui mesmo (nenhuma foto real).
const test = require("node:test");
const assert = require("node:assert/strict");
const { Recorte } = require("./carregar");

const W = 320, H = 430;
const imagem = (larg, alt, v) => ({ larg, alt, d: new Uint8Array(larg * alt).fill(v) });
// Preenche um quadrilátero convexo (cantos em sentido horário) com o valor v.
function poligono(img, c, v) {
  for (let y = 0; y < img.alt; y++) for (let x = 0; x < img.larg; x++) {
    let dentro = true;
    for (let i = 0; i < 4 && dentro; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) dentro = false;
    }
    if (dentro) img.d[y * img.larg + x] = v;
  }
}
const ret = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
function girar(c, graus, cx, cy) {
  const t = graus * Math.PI / 180, co = Math.cos(t), si = Math.sin(t);
  return c.map(p => ({ x: cx + (p.x - cx) * co - (p.y - cy) * si, y: cy + (p.x - cx) * si + (p.y - cy) * co }));
}
// Linhas finas de "texto" escuro dentro do papel.
function texto(img, y0, y1, x0, x1, v = 30) {
  for (let y = y0; y < y1; y += 8) for (let k = 0; k < 3; k++) for (let x = x0; x < x1; x++) img.d[(y + k) * img.larg + x] = v;
}
const perto = (a, b, tol) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
const erroMax = (achados, esperados) => Math.max(...esperados.map((e, i) => Math.hypot(achados[i].x - e.x, achados[i].y - e.y)));

test("retângulo reto acha os 4 cantos (±2 px)", () => {
  const img = imagem(W, H, 40), r = ret(60, 50, 260, 380);
  poligono(img, r, 230); texto(img, 70, 360, 80, 240);
  const c = Recorte.acharCantos(img.d, W, H);
  assert.ok(c);
  r.forEach((e, i) => assert.ok(perto(c[i], e, 2), `canto ${i}: ${JSON.stringify(c[i])}`));
});

test("papel girado 10° e 25°", () => {
  for (const graus of [10, 25]) {
    const img = imagem(W, H, 40), r = girar(ret(90, 60, 230, 370), graus, 160, 215);
    poligono(img, r, 230); texto(img, 100, 330, 120, 200);
    const c = Recorte.acharCantos(img.d, W, H);
    assert.ok(c, `${graus}°`);
    assert.ok(erroMax(c, r) <= 0.03 * H, `${graus}°: erro ${erroMax(c, r)}`);
  }
});

test("papel em trapézio", () => {
  const img = imagem(W, H, 40), r = [{ x: 90, y: 50 }, { x: 240, y: 60 }, { x: 280, y: 390 }, { x: 50, y: 380 }];
  poligono(img, r, 230); texto(img, 90, 350, 100, 220);
  const c = Recorte.acharCantos(img.d, W, H);
  assert.ok(c);
  assert.ok(erroMax(c, r) <= 0.03 * H, `erro ${erroMax(c, r)}`);
});

test("foto lisa", () => {
  assert.equal(Recorte.acharCantos(imagem(W, H, 200).d, W, H), null);
  assert.equal(Recorte.acharCantos(imagem(W, H, 0).d, W, H), null);
});

test("ruído", () => {
  const img = imagem(W, H, 0);
  let s = 12345; // gerador simples e repetível
  for (let i = 0; i < img.d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; img.d[i] = (s >> 8) & 255; }
  assert.equal(Recorte.acharCantos(img.d, W, H), null);
});

test("papel pequeno demais", () => {
  const img = imagem(W, H, 40);
  poligono(img, ret(100, 100, 160, 200), 230); // ~4% da foto
  assert.equal(Recorte.acharCantos(img.d, W, H), null);
});

test("formato absurdo", () => {
  const img = imagem(W, H, 40);
  poligono(img, ret(10, 200, 310, 215), 230); // faixa fina e larga, e também alta e fina
  assert.equal(Recorte.acharCantos(img.d, W, H), null);
  const img2 = imagem(W, H, 40);
  poligono(img2, ret(0, 0, 310, 40), 230);
  assert.equal(Recorte.acharCantos(img2.d, W, H), null);
});

test("fundo claro: acha ou devolve null, nunca um recorte pequeno dentro do papel", () => {
  const r = ret(60, 50, 260, 380);
  for (const fundo of [200, 225, 245]) {
    const img = imagem(W, H, fundo);
    poligono(img, r, 250); texto(img, 70, 360, 80, 240); texto(img, 200, 220, 70, 250, 20);
    const c = Recorte.acharCantos(img.d, W, H);
    if (c) {
      assert.ok(Recorte.medidas(c).larg * Recorte.medidas(c).alt >= 0.85 * 200 * 330, `fundo ${fundo}: recorte pequeno`);
    }
  }
  // fundo escuro com faixa grossa de texto escuro cortando o papel: ainda é o papel inteiro
  const img = imagem(W, H, 40);
  poligono(img, r, 230); texto(img, 70, 360, 80, 240);
  for (let y = 200; y < 210; y++) for (let x = 60; x <= 260; x++) img.d[y * W + x] = 25;
  const c = Recorte.acharCantos(img.d, W, H);
  assert.ok(c);
  assert.ok(erroMax(c, r) <= 0.03 * H);
});

test("endireitar: faixas giradas voltam a ficar horizontais", () => {
  // papel 200x300 girado 15°, com faixas horizontais (claro/escuro a cada 20 linhas) no próprio papel
  const t = 15 * Math.PI / 180, cx = 160, cy = 215, pw = 200, ph = 300;
  const img = imagem(W, H, 40);
  const quad = girar(ret(cx - pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2), 15, cx, cy);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x - cx) * Math.cos(t) + (y - cy) * Math.sin(t) + pw / 2;   // coordenadas no papel
    const v = -(x - cx) * Math.sin(t) + (y - cy) * Math.cos(t) + ph / 2;
    if (u >= 0 && u < pw && v >= 0 && v < ph) img.d[y * W + x] = Math.floor(v / 20) % 2 ? 90 : 220;
  }
  const o = Recorte.endireitar(img.d, W, H, quad, 200);
  assert.ok(o);
  assert.ok(Math.abs(o.larg - 200) <= 2 && Math.abs(o.alt - 300) <= 3, `${o.larg}x${o.alt}`);
  // no meio do papel, cada linha deve ser quase uniforme (faixa horizontal) e as faixas alternam
  const linha = y => { const a = []; for (let x = 30; x < o.larg - 30; x++) a.push(o.dados[y * o.larg + x]); return a; };
  for (const y of [50, 70, 130, 150, 210, 250]) {
    const l = linha(y), mn = Math.min(...l), mx = Math.max(...l);
    assert.ok(mx - mn <= 12, `linha ${y} não é uniforme (${mn}..${mx})`);
  }
  assert.ok(linha(50)[0] > 180 && linha(70)[0] < 130, "faixas não alternam como esperado");
});

test("endireitar: cantos = imagem inteira devolve praticamente a mesma imagem", () => {
  const img = imagem(W, H, 40);
  poligono(img, ret(60, 50, 260, 380), 230); texto(img, 70, 360, 80, 240);
  const o = Recorte.endireitar(img.d, W, H, ret(0, 0, W - 1, H - 1), W);
  assert.ok(o);
  assert.ok(Math.abs(o.larg - W) <= 1 && Math.abs(o.alt - H) <= 1);
  let dif = 0; const n = Math.min(o.alt, H) * W;
  for (let i = 0; i < n; i++) dif += Math.abs(o.dados[i] - img.d[i]);
  assert.ok(dif / n < 3, `diferença média ${dif / n}`);
});

test("homografia: cantos e caso degenerado", () => {
  const de = [{ x: 90, y: 50 }, { x: 240, y: 60 }, { x: 280, y: 390 }, { x: 50, y: 380 }];
  const para = ret(0, 0, 1099, 1500);
  const h = Recorte.homografia(de, para);
  assert.ok(h);
  de.forEach((p, i) => assert.ok(perto(Recorte.mapear(h, p.x, p.y), para[i], 0.5)));
  const colinear = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 5, y: 40 }];
  assert.equal(Recorte.homografia(colinear, para), null);
});

test("ajuste manual: cantos cruzados são recusados e pontos são limitados à foto", () => {
  const bom = ret(60, 50, 260, 380);
  assert.ok(Recorte.validar(bom, W, H));
  const cruzado = [bom[1], bom[0], bom[2], bom[3]];
  assert.equal(Recorte.validar(cruzado, W, H), null);
  const naoConvexo = [{ x: 60, y: 50 }, { x: 260, y: 50 }, { x: 150, y: 150 }, { x: 60, y: 380 }];
  assert.equal(Recorte.validar(naoConvexo, W, H), null);
  assert.equal(Recorte.validar(ret(100, 100, 150, 150), W, H), null, "área < 15%");
  const fora = Recorte.validar(ret(-40, -10, 400, 500), W, H);
  assert.ok(fora);
  assert.ok(fora.every(p => p.x >= 0 && p.x <= W - 1 && p.y >= 0 && p.y <= H - 1));
  assert.equal(Recorte.validar([{ x: NaN, y: 0 }, ...bom.slice(1)], W, H), null);
});

test("diferenteDaMoldura: foto já enquadrada pula o passo de ajuste", () => {
  assert.equal(Recorte.diferenteDaMoldura(ret(0, 0, W - 1, H - 1), W, H), false);
  assert.equal(Recorte.diferenteDaMoldura(ret(3, 2, W - 4, H - 3), W, H), false);
  assert.equal(Recorte.diferenteDaMoldura(ret(60, 50, 260, 380), W, H), true);
});

test("recorte automático em Ajustes: desligado por padrão", () => {
  assert.equal(Recorte.autoLigado(undefined), false);
  assert.equal(Recorte.autoLigado({}), false);
  assert.equal(Recorte.autoLigado({ recorteAuto: true }), true);
});

test("tempo: acharCantos em 320×430 fica abaixo de 50 ms", () => {
  const img = imagem(W, H, 40);
  poligono(img, girar(ret(90, 60, 230, 370), 12, 160, 215), 230);
  Recorte.acharCantos(img.d, W, H); // aquece
  const t0 = process.hrtime.bigint();
  Recorte.acharCantos(img.d, W, H);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 50, `${ms.toFixed(1)} ms`);
});
