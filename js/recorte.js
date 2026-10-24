// Recorte automático da foto do cupom: acha o papel, valida os 4 cantos e endireita.
// Só contas sobre vetores de cinza (Uint8Array, largura, altura): sem tela, para poder ser testado no Node.
(() => {
  "use strict";

  const AREA_MIN = 0.15;   // o papel precisa ocupar pelo menos 15% da foto
  const AREA_MAX = 0.97;   // acima disso não há fundo para separar do papel
  const PROP_MIN = 0.5, PROP_MAX = 12; // alto/largo plausível de um cupom
  const TETO_PIXELS = 3.5e6;

  const trava = (v, a, b) => Math.max(a, Math.min(b, v));

  // Limiar de Otsu sobre um histograma de 256 faixas (o mesmo cálculo que a leitura usa para binarizar).
  function otsu(hist, total) {
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  // Desfoque leve 3x3 (média), bordas repetidas.
  function suavizar(g, w, h) {
    const t = new Uint16Array(w * h), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      t[i] = g[i - (x > 0 ? 1 : 0)] + g[i] + g[i + (x < w - 1 ? 1 : 0)];
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      o[i] = ((t[i - (y > 0 ? w : 0)] + t[i] + t[i + (y < h - 1 ? w : 0)]) / 9) | 0;
    }
    return o;
  }

  // Dilata (erode = false) ou erode (erode = true) uma máscara 0/1 com janela de raio r. Fora da foto vale como dentro.
  function janela(src, w, h, r, erode) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    const pre = new Int32Array(Math.max(w, h) + 1);
    const dec = (c, n) => erode ? (c === n ? 1 : 0) : (c > 0 ? 1 : 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + src[y * w + x];
      for (let x = 0; x < w; x++) {
        const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
        tmp[y * w + x] = dec(pre[b + 1] - pre[a], b - a + 1);
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
        out[y * w + x] = dec(pre[b + 1] - pre[a], b - a + 1);
      }
    }
    return out;
  }

  // Maior região conectada (4 vizinhos) de uma máscara, por varredura com pilha (sem recursão).
  function maiorRegiao(bin, w, h) {
    const n = w * h, rot = new Int32Array(n), pilha = new Int32Array(n);
    let melhor = 0, melhorN = 0, id = 0;
    for (let s = 0; s < n; s++) {
      if (!bin[s] || rot[s]) continue;
      id++;
      let topo = 0, cont = 0;
      pilha[topo++] = s; rot[s] = id;
      while (topo) {
        const i = pilha[--topo]; cont++;
        const x = i % w;
        if (x > 0 && bin[i - 1] && !rot[i - 1]) { rot[i - 1] = id; pilha[topo++] = i - 1; }
        if (x < w - 1 && bin[i + 1] && !rot[i + 1]) { rot[i + 1] = id; pilha[topo++] = i + 1; }
        if (i >= w && bin[i - w] && !rot[i - w]) { rot[i - w] = id; pilha[topo++] = i - w; }
        if (i < n - w && bin[i + w] && !rot[i + w]) { rot[i + w] = id; pilha[topo++] = i + w; }
      }
      if (cont > melhorN) { melhorN = cont; melhor = id; }
    }
    return { rot, id: melhor, n: melhorN };
  }

  const area = p => {
    let s = 0;
    for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // Largura e altura médias do quadrilátero (topo-esq, topo-dir, base-dir, base-esq).
  function medidas(c) {
    return { larg: (dist(c[0], c[1]) + dist(c[3], c[2])) / 2, alt: (dist(c[0], c[3]) + dist(c[1], c[2])) / 2 };
  }

  // Confere 4 cantos (topo-esq, topo-dir, base-dir, base-esq): trava cada ponto dentro da foto e recusa
  // quadrilátero cruzado, não convexo ou pequeno demais. Devolve os cantos (travados) ou null.
  function validar(cantos, larg, alt) {
    if (!Array.isArray(cantos) || cantos.length !== 4) return null;
    const p = [];
    for (const q of cantos) {
      if (!q || !isFinite(q.x) || !isFinite(q.y)) return null;
      p.push({ x: trava(q.x, 0, larg - 1), y: trava(q.y, 0, alt - 1) });
    }
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1e-6) return null;
    }
    if (area(p) < AREA_MIN * larg * alt) return null;
    return p;
  }

  // Os cantos fogem da moldura da foto (mais de 3% do lado maior)? Se não, a foto já está enquadrada.
  function diferenteDaMoldura(cantos, larg, alt) {
    const f = [{ x: 0, y: 0 }, { x: larg - 1, y: 0 }, { x: larg - 1, y: alt - 1 }, { x: 0, y: alt - 1 }];
    const tol = 0.03 * Math.max(larg, alt);
    return cantos.some((c, i) => dist(c, f[i]) > tol);
  }

  // Acha o papel: limiar de Otsu, fecha buracos de texto, maior região clara e seus 4 cantos extremos.
  // Devolve 4 cantos {x, y} (topo-esq, topo-dir, base-dir, base-esq) ou null se não houver papel reconhecível.
  function acharCantos(cinza, larg, alt) {
    try {
      if (!cinza || larg < 8 || alt < 8 || cinza.length < larg * alt) return null;
      const g = suavizar(cinza, larg, alt), n = larg * alt;
      const hist = new Array(256).fill(0);
      for (let i = 0; i < n; i++) hist[g[i]]++;
      const thr = otsu(hist, n);
      let sc = 0, nc = 0, se = 0, ne = 0;
      for (let t = 0; t < 256; t++) { if (t > thr) { sc += t * hist[t]; nc += hist[t]; } else { se += t * hist[t]; ne += hist[t]; } }
      if (!nc || !ne || sc / nc - se / ne < 30) return null; // sem contraste entre papel e fundo
      let bin = new Uint8Array(n);
      for (let i = 0; i < n; i++) bin[i] = g[i] > thr ? 1 : 0;
      // texto e linhas escuras dentro do papel não podem partir a região: fecha buracos finos
      const r = Math.max(2, Math.round(Math.max(larg, alt) * 0.02));
      bin = janela(janela(bin, larg, alt, r, false), larg, alt, r, true);
      const reg = maiorRegiao(bin, larg, alt);
      if (!reg.id || reg.n < AREA_MIN * n || reg.n > AREA_MAX * n) return null;
      let a = [Infinity, null], b = [-Infinity, null], c = [Infinity, null], d = [-Infinity, null];
      for (let y = 0; y < alt; y++) for (let x = 0; x < larg; x++) {
        if (reg.rot[y * larg + x] !== reg.id) continue;
        const s = x + y, q = x - y;
        if (s < a[0]) a = [s, { x, y }];
        if (s > b[0]) b = [s, { x, y }];
        if (q < c[0]) c = [q, { x, y }];
        if (q > d[0]) d = [q, { x, y }];
      }
      // topo-esq (menor x+y), topo-dir (maior x−y), base-dir (maior x+y), base-esq (menor x−y)
      const cantos = validar([a[1], d[1], b[1], c[1]], larg, alt);
      if (!cantos) return null;
      if (reg.n < 0.75 * area(cantos)) return null; // região irregular, não é um papel
      const m = medidas(cantos), prop = m.alt / Math.max(1, m.larg);
      if (prop < PROP_MIN || prop > PROP_MAX) return null;
      return cantos;
    } catch (e) { return null; }
  }

  // Homografia que leva cada ponto de `de` (4 pontos) ao ponto correspondente de `para`.
  // Devolve 8 coeficientes [h0..h7] (h8 = 1) ou null se os pontos forem degenerados (3 em linha, repetidos).
  function homografia(de, para) {
    if (!de || !para || de.length !== 4 || para.length !== 4) return null;
    const M = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = de[i], u = para[i].x, v = para[i].y;
      M.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      M.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let col = 0; col < 8; col++) {
      let p = col;
      for (let r = col + 1; r < 8; r++) if (Math.abs(M[r][col]) > Math.abs(M[p][col])) p = r;
      if (!(Math.abs(M[p][col]) > 1e-7)) return null;
      [M[col], M[p]] = [M[p], M[col]];
      for (let r = 0; r < 8; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let k = col; k < 9; k++) M[r][k] -= f * M[col][k];
      }
    }
    const h = M.map((l, i) => l[8] / l[i]);
    return h.every(isFinite) ? h : null;
  }

  function mapear(h, x, y) {
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  }

  // Endireita o papel dos 4 cantos para um retângulo de largura `largSaida` (altura pela proporção do papel,
  // respeitando o teto de ~3,5 MP). Amostragem bilinear. Devolve {dados, larg, alt} ou null.
  function endireitar(cinza, larg, alt, cantos, largSaida) {
    try {
      const c = validar(cantos, larg, alt);
      if (!c) return null;
      const m = medidas(c);
      let W = Math.max(1, Math.round(largSaida || m.larg)), H = Math.max(1, Math.round(W * m.alt / Math.max(1, m.larg)));
      if (W * H > TETO_PIXELS) { const s = Math.sqrt(TETO_PIXELS / (W * H)); W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s)); }
      const h = homografia([{ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: H - 1 }, { x: 0, y: H - 1 }], c);
      if (!h) return null;
      const dados = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = mapear(h, x, y);
        const sx = trava(p.x, 0, larg - 1), sy = trava(p.y, 0, alt - 1);
        const x0 = sx | 0, y0 = sy | 0, x1 = Math.min(larg - 1, x0 + 1), y1 = Math.min(alt - 1, y0 + 1);
        const fx = sx - x0, fy = sy - y0;
        const top = cinza[y0 * larg + x0] * (1 - fx) + cinza[y0 * larg + x1] * fx;
        const bot = cinza[y1 * larg + x0] * (1 - fx) + cinza[y1 * larg + x1] * fx;
        dados[y * W + x] = (top * (1 - fy) + bot * fy + 0.5) | 0;
      }
      return { dados, larg: W, alt: H };
    } catch (e) { return null; }
  }

  // Preferência "Recortar automaticamente sem perguntar" (Ajustes). Desligada se nunca foi mexida.
  const autoLigado = meta => !!(meta && meta.recorteAuto);

  window.Recorte = { otsu, acharCantos, validar, homografia, mapear, endireitar, diferenteDaMoldura, medidas, autoLigado };
})();
