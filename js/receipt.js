// Leitura de cupom fiscal no próprio aparelho: OCR (Tesseract) + interpretação do texto.
(() => {
  "use strict";

  // ---------- OCR ----------
  const abs = p => new URL(p, location.href).href;
  let workerPromise = null;
  let progressCb = null;

  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("por", 1, {
        workerPath: abs("vendor/tesseract/worker.min.js"),
        corePath: abs("vendor/tesseract/"),
        langPath: abs("vendor/tesseract/lang"),
        gzip: true,
        logger: m => { if (progressCb && typeof m.progress === "number") progressCb(m.status, m.progress); },
      }).then(async w => {
        await w.setParameters({ tessedit_pageseg_mode: "4", preserve_interword_spaces: "1" });
        return w;
      }).catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  const agora = () => (window.performance || Date).now();
  const seg = ms => (ms / 1000).toFixed(1).replace(".", ",") + " s";
  const abrirFoto = blob => createImageBitmap(blob, { imageOrientation: "from-image" });

  // Desenha a foto em w×h e devolve só os tons de cinza.
  function cinzaDe(bmp, w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    return g;
  }

  // Procura o papel na foto (reduzida a ~320 px). Devolve { cantos, larg, alt, ms } com os cantos em pixels
  // da foto original (topo-esq, topo-dir, base-dir, base-esq) ou cantos = null. Nunca lança erro.
  async function detectarBmp(bmp) {
    const ms = { reduzir: 0, achar: 0, endireitar: 0 };
    let cantos = null;
    try {
      let t = agora();
      const s = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
      const w = Math.max(8, Math.round(bmp.width * s)), h = Math.max(8, Math.round(bmp.height * s));
      const g = cinzaDe(bmp, w, h);
      ms.reduzir = agora() - t; t = agora();
      const c = Recorte.acharCantos(g, w, h);
      ms.achar = agora() - t;
      if (c) cantos = c.map(p => ({ x: p.x * bmp.width / w, y: p.y * bmp.height / h }));
    } catch (e) { console.warn("recorte", e); }
    return { cantos, larg: bmp.width, alt: bmp.height, ms };
  }
  async function detectar(blob) {
    const bmp = await abrirFoto(blob);
    try { return await detectarBmp(bmp); } finally { bmp.close && bmp.close(); }
  }

  // Tons de cinza -> contraste esticado -> binarização (Otsu) -> canvas, que é o que o Tesseract lê.
  function binarizar(gray, w, h) {
    const hist = new Array(256).fill(0), total = gray.length;
    for (let j = 0; j < total; j++) hist[gray[j]]++;
    // contraste: corta 1% de cada ponta
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--;
    const range = Math.max(1, hi - lo);
    const h2 = new Array(256).fill(0);
    for (let j = 0; j < total; j++) {
      const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255 / range) | 0));
      gray[j] = v; h2[v]++;
    }
    const thr = Recorte.otsu(h2, total);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const img = ctx.createImageData(w, h), px = img.data;
    for (let i = 0, j = 0; j < total; i += 4, j++) {
      const v = gray[j] > thr ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // Miniatura (data URL) do recorte, para mostrar depois da leitura.
  function miniatura(gray, w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) { img.data[i] = img.data[i + 1] = img.data[i + 2] = gray[j]; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const mw = Math.min(160, w), mh = Math.max(1, Math.round(h * mw / w));
    const mini = document.createElement("canvas");
    mini.width = mw; mini.height = mh;
    mini.getContext("2d").drawImage(cv, 0, 0, mw, mh);
    return mini.toDataURL("image/jpeg", 0.6);
  }

  // Recorta e endireita o papel em tons de cinza. Devolve { dados, larg, alt } ou null.
  async function recortar(bmp, opts, info) {
    let cantos = opts.cantos ? Recorte.validar(opts.cantos, bmp.width, bmp.height) : null;
    if (!cantos) {
      const det = await detectarBmp(bmp);
      info.ms.reduzir += det.ms.reduzir; info.ms.achar += det.ms.achar;
      cantos = det.cantos && Recorte.validar(det.cantos, bmp.width, bmp.height);
      if (!cantos) { info.motivo = "não achei o papel"; return null; }
    }
    const t = agora();
    // foto de trabalho: até ~6 MP, para o recorte ainda ter detalhe de sobra
    const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height), Math.sqrt(6e6 / (bmp.width * bmp.height)));
    const w = Math.max(8, Math.round(bmp.width * s)), h = Math.max(8, Math.round(bmp.height * s));
    const g = cinzaDe(bmp, w, h);
    const c = cantos.map(p => ({ x: p.x * w / bmp.width, y: p.y * h / bmp.height }));
    const m = Recorte.medidas(c);
    const out = Recorte.endireitar(g, w, h, c, Math.max(1100, Math.min(1600, m.larg)));
    info.ms.endireitar = agora() - t;
    if (!out) { info.motivo = "não consegui endireitar"; return null; }
    info.cantos = cantos;
    info.miniatura = miniatura(out.dados, out.larg, out.alt);
    return out;
  }

  // Foto -> canvas pronto para o OCR. Com opts.cantos (ou opts.recortar) lê só o papel; se o recorte falhar,
  // lê a foto inteira. `info` recebe o que aconteceu (tempos, motivo, miniatura) para "Como foi lido".
  async function prepare(blob, opts, info) {
    opts = opts || {}; info = info || {};
    info.ms = info.ms || { reduzir: 0, achar: 0, endireitar: 0 };
    const bmp = await abrirFoto(blob);
    let rec = null;
    if (opts.cantos || opts.recortar) {
      try { rec = await recortar(bmp, opts, info); }
      catch (e) { console.warn("recorte", e); info.motivo = "deu erro no recorte"; }
    } else info.motivo = info.motivo || "desligado";
    if (rec) {
      const cv = binarizar(rec.dados, rec.larg, rec.alt);
      bmp.close && bmp.close();
      return cv;
    }
    // Resolução bastante para o texto do cupom, sem pesar: uma foto de celular (12 MP ou mais) vira no
    // máximo ~3,5 MP. Acima disso o OCR fica bem mais lento sem ler melhor.
    let scale = 1;
    if (bmp.width < 1100) scale = 1100 / bmp.width;
    scale = Math.min(scale, 2400 / Math.max(bmp.width, bmp.height), Math.sqrt(3.5e6 / (bmp.width * bmp.height)));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const cv = binarizar(cinzaDe(bmp, w, h), w, h);
    bmp.close && bmp.close();
    return cv;
  }

  // Carrega o leitor antes de a foto chegar (por exemplo, enquanto a câmera está aberta).
  const warm = () => { getWorker().catch(() => {}); };

  // opts.cantos: 4 cantos já ajustados, em pixels da foto original · opts.recortar: detecta sozinho ·
  // opts.info: objeto que recebe { ms, motivo, cantos, miniatura, texto } (texto = linha de "Como foi lido").
  async function readText(blob, onProgress, opts) {
    opts = opts || {};
    const info = opts.info || {};
    info.ms = Object.assign({ reduzir: 0, achar: 0, endireitar: 0 }, info.ms);
    progressCb = onProgress || null;
    try {
      onProgress && onProgress("preparando a foto", 0);
      const canvas = await prepare(blob, opts, info);
      const soma = info.ms.reduzir + info.ms.achar + info.ms.endireitar;
      info.texto = info.cantos
        ? `Recorte: ${seg(soma)} (reduzir ${seg(info.ms.reduzir)}, achar ${seg(info.ms.achar)}, endireitar ${seg(info.ms.endireitar)}).`
        : `Sem recorte (${info.motivo || "foto inteira"}).`;
      const worker = await getWorker();
      const { data } = await worker.recognize(canvas);
      return data.text || "";
    } finally { progressCb = null; }
  }

  // ---------- interpretação ----------
  const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  // Valor em reais: 1.234,56 · 45,90 · 45.90 · R$ 45, 90 (espaço por erro de OCR)
  const MONEY = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)\s?[,.]\s?(\d{2})(?!\d)/g;
  function amounts(line) {
    // OCR costuma trocar 0 por O dentro de números
    const fixed = line.replace(/(\d)[Oo](?=\d|\b)/g, (_, d) => d + "0").replace(/[Oo](?=\d)/g, "0");
    const out = [];
    for (const m of fixed.matchAll(MONEY)) {
      // ignora datas (12.10.2026) e horas
      const after = fixed.slice(m.index + m[0].length, m.index + m[0].length + 1);
      if (/[.\/:]/.test(after) && /\d/.test(fixed[m.index + m[0].length + 1] || "")) continue;
      out.push(Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]));
    }
    return out;
  }

  // Linhas que falam de cartão de benefício (os emissores vêm de issuers.js)
  const BENEFIT_WORDS = new RegExp(String.raw`VALE ?ALIMENT|VALE ?REFEI|VOUCHER|\bALIMENTACAO\b|\bREFEICAO\b|\bBENEFICIO|\bVA\b|\bVOUCH|` + Issuers.ANY_PRINT.source);
  // Final do cartão: 4 dígitos depois da máscara (************4321, **** **** **** 4321, XXXX4321).
  // O OCR costuma ler o * como x, + ou #.
  const MASK_L4 = String.raw`(?<![A-Z0-9])(?:[*X+#•]{2,}[\s.-]*)+(\d{4})\b`;
  const FINAL_L4 = String.raw`\bFINAL\s*:?\s*(\d{4})\b`;
  const CAT_RULES = [
    [/SUPERMERC|MERCADO|ATACAD|ASSAI|CARREFOUR|HIPER|MERCEARIA|HORTIFRUTI|EMPORIO/, "Mercado"],
    [/PADARIA|PANIFIC|CONFEITAR/, "Padaria"],
    [/IFOOD\.COM|RAPPI|DELIVERY|ENTREGA/, "Delivery"],
    [/FEIRA|SACOLAO|VERDURAO/, "Feira"],
    [/LANCHONETE|LANCHES|PASTELARIA|SORVET|CAFETERIA|\bCAFE\b|BURGER|ACAI/, "Lanche"],
    [/RESTAURANTE|CHURRASC|PIZZ|GRILL|BISTRO|COZINHA|SELF ?SERVICE|BUFFET|REFEICOES/, "Restaurante"],
  ];
  const HEADER_SKIP = /CNPJ|CPF|INSCR|\bIE\b|\bI\.E\b|DOCUMENTO|DANFE|NFC|NOTA FISCAL|CUPOM|EXTRATO|CONSUMIDOR|ENDERECO|\bRUA\b|\bAV\b|AVENIDA|FONE|TEL\b|CEP|ESTABELEC|VIA ?(?:CLIENTE|ESTAB)|COMPROVANTE|^\W*$/;

  function parse(text) {
    const raw = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lines = raw.map(norm);
    const res = { store: null, cnpj: null, date: null, total: null, paid: null, balance: null, balanceMoment: "desconhecido", issuer: null, last4: null, category: null, found: [] };

    // Data (primeira data válida que não está no futuro)
    const today = new Date();
    for (const l of lines) {
      const m = l.match(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{4}|\d{2})\b/);
      if (!m) continue;
      let [, d, mo, y] = m; if (y.length === 2) y = "20" + y;
      const dt = new Date(+y, +mo - 1, +d);
      if (dt.getMonth() !== +mo - 1 || dt > new Date(today.getTime() + 86400000) || +y < 2015) continue;
      res.date = `${y}-${mo}-${d}`; break;
    }

    // Saldo do cartão de benefício
    const balCands = [];
    lines.forEach((l, i) => {
      if (!/SALDO/.test(l) || /TROCO/.test(l)) return;
      let vals = amounts(l);
      if (!vals.length && lines[i + 1] && !/SALDO/.test(lines[i + 1])) vals = amounts(lines[i + 1]);
      if (!vals.length) return;
      const before = /ANTERIOR|ANTES/.test(l);
      const strong = /DISPON|ATUAL|APOS|RESTANTE|FINAL|DISP\b|SALDO\s*[:R$\d]/.test(l);
      balCands.push({ v: vals[vals.length - 1], before, score: (before ? 1 : strong ? 3 : 2) });
    });
    if (balCands.length) {
      balCands.sort((a, b) => b.score - a.score);
      res.balance = balCands[0].v;
      res.balanceMoment = balCands[0].before ? "antes_compra" : "apos_compra";
    }

    // Total da nota
    for (const re of [/VALOR\s*A\s*PAGAR/, /VALOR\s*TOTAL/, /^TOTAL\b|\bTOTAL\s*R?\$|\bTOTAL\s*:/]) {
      const i = lines.findIndex(l => re.test(l) && !/SALDO|TROCO|DESCONTO|ITENS|QTD|TRIBUT|IMPOSTO/.test(l));
      if (i >= 0) {
        let v = amounts(lines[i]);
        if (!v.length && lines[i + 1]) v = amounts(lines[i + 1]);
        if (v.length) { res.total = v[v.length - 1]; break; }
      }
    }

    // Valor pago com o cartão de benefício: linha da forma de pagamento ou "VALOR" do comprovante TEF
    let paid = null;
    lines.forEach((l, i) => {
      if (paid !== null || /SALDO|TROCO/.test(l)) return;
      if (BENEFIT_WORDS.test(l)) {
        const v = amounts(l);
        if (v.length) paid = v[v.length - 1];
        else if (lines[i + 1] && !/SALDO/.test(lines[i + 1]) && /^\W*(?:R\$)?\s*\d/.test(lines[i + 1])) { const n = amounts(lines[i + 1]); if (n.length) paid = n[0]; }
      }
    });
    if (paid === null) {
      const i = lines.findIndex(l => /\bVALOR\b(?!\s*TOTAL)(?!\s*A\s*PAGAR)|VALOR APROVADO|VENDA\b/.test(l) && !/SALDO|TROCO|TRIBUT|IMPOSTO|DESCONTO/.test(l));
      if (i >= 0) { const v = amounts(lines[i]); if (v.length) paid = v[v.length - 1]; }
    }
    res.paid = paid !== null ? paid : res.total;

    // Todas as formas de pagamento da NFC-e (pode haver vários vales, cartão, Pix e dinheiro na mesma compra).
    // Com o cabeçalho "FORMA DE PAGAMENTO", lê só as linhas logo abaixo dele; sem ele, procura no cupom todo.
    const PAY_RULES = [
      [BENEFIT_WORDS, "vale"],
      [/\bPIX\b/, "pix"],
      [/DINHEIRO|ESPECIE/, "dinheiro"],
      [/CREDITO/, "credito"],
      [/DEBITO/, "debito"],
    ];
    const head = lines.findIndex(l => /FORMAS? (DE )?PAGAMENTO|FORMA PAGTO|MEIO DE PAGAMENTO/.test(l));
    const scope = head >= 0 ? lines.slice(head + 1, head + 10) : lines;
    const payments = [];
    for (const l of scope) {
      if (head >= 0 && /TROCO|CONSULTE|CHAVE|PROTOCOLO|TRIBUT/.test(l)) break;
      if (/SALDO|TROCO|TOTAL|DESCONTO|APROVAD|VIA |SUBTOTAL/.test(l)) continue;
      const v = amounts(l);
      if (!v.length) continue;
      const rule = PAY_RULES.find(([re]) => re.test(l));
      if (!rule) { if (head >= 0 && /[A-Z]{3}/.test(l)) payments.push({ kind: "outro", amount: v[v.length - 1], label: raw[lines.indexOf(l)] }); continue; }
      payments.push({ kind: rule[1], amount: v[v.length - 1], label: raw[lines.indexOf(l)] });
    }
    // "CARTAO TEF" / "OUTROS" na NFC-e é o vale quando o cupom traz o comprovante de um cartão de benefício
    // e nenhuma outra linha de pagamento já é de vale.
    if (!payments.some(p => p.kind === "vale") && lines.some(l => BENEFIT_WORDS.test(l)))
      for (const p of payments) if (p.kind === "outro" && /CART|TEF|OUTROS/.test(norm(p.label || ""))) p.kind = "vale";
    // Sem a seção da NFC-e, mantém só um pagamento por tipo para não contar duas vezes o mesmo valor do comprovante.
    res.payments = head >= 0 ? payments : payments.filter((p, i) => payments.findIndex(q => q.kind === p.kind && q.amount === p.amount) === i);
    const vales = res.payments.filter(p => p.kind === "vale");
    if (vales.length > 1) res.paid = vales.reduce((s, p) => s + p.amount, 0);
    // Todos os saldos impressos (um por comprovante de vale) e todos os finais de cartão
    res.balances = balCands.map(b => b.before && res.paid ? null : b.v).filter(v => v !== null);

    // Emissor e final do cartão
    const all = lines.join("\n");
    // CNPJ da loja (o primeiro do cupom é o do emitente): serve para lembrar qual cartão é usado em cada loja
    const cn = all.match(/CNPJ[^\d\n]{0,8}(\d{2}\.?\d{3}\.?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2})/);
    if (cn) { const digits = cn[1].replace(/\D/g, ""); if (digits.length === 14) res.cnpj = digits; }
    res.issuer = Issuers.fromPrint(all);
    // Tipo do cartão, quando o comprovante diz (ex.: "ALELO REFEICAO", "VR ALIMENTACAO"),
    // só nas linhas do cartão, para não pegar o nome da loja
    const cardLines = lines.filter(l => BENEFIT_WORDS.test(l)).join("\n");
    // Com cartões de tipos diferentes no mesmo cupom, o tipo fica em aberto.
    const types = [/MULTI ?BENEF|\bFLEX\b/.test(cardLines) && "flex", /REFEI/.test(cardLines) && "refeicao", /ALIMENTA/.test(cardLines) && "alimentacao"].filter(Boolean);
    res.type = types.length === 1 ? types[0] : null;
    // Titular, quando o comprovante imprime (PORTADOR / TITULAR / NOME DO PORTADOR)
    const hm = all.match(/\b(?:NOME DO PORTADOR|PORTADOR|TITULAR)\s*:?\s*([A-Z][A-Z .']{2,40})$/m);
    if (hm && !/CONSUMIDOR|OPERADOR|CAIXA/.test(hm[1])) res.holder = hm[1].trim().toLowerCase().replace(/(^|\s)\p{L}/gu, m => m.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, m => m.toLowerCase());
    const l4 = all.match(new RegExp(`${MASK_L4}|${FINAL_L4}|CARTAO\\s*:?\\s*[*X+#•\\d\\s]{6,}?(\\d{4})\\b`));
    if (l4) res.last4 = l4[1] || l4[2] || l4[3];
    res.last4s = [...all.matchAll(new RegExp(`${MASK_L4}|${FINAL_L4}`, "g"))].map(m => m[1] || m[2]);

    // Estabelecimento: primeira linha de cabeçalho com nome
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const l = lines[i];
      if (HEADER_SKIP.test(l) || !/[A-Z]{3}/.test(l) || l.replace(/[^A-Z]/g, "").length < 4) continue;
      res.store = raw[i].replace(/\s{2,}/g, " ").replace(/[^\p{L}\p{N}&.,' -]/gu, "").trim().slice(0, 60);
      if (res.store === res.store.toUpperCase()) res.store = res.store.toLowerCase().replace(/(^|\s)\p{L}/gu, s => s.toUpperCase()).replace(/\b(Ltda|Me|Epp|Eireli|S\.?a)\b\.?/gi, m => m.toUpperCase());
      break;
    }

    for (const [re, cat] of CAT_RULES) if (re.test(all)) { res.category = cat; break; }

    if (res.date) res.found.push("data");
    if (res.paid !== null) res.found.push("valor");
    if (res.balance !== null) res.found.push("saldo");
    if (res.issuer) res.found.push("emissor");
    if (res.last4) res.found.push("final do cartão");
    if (res.holder) res.found.push("titular");
    return res;
  }

  // ---------- cadastro de cartão por foto (leitor do celular) ----------
  // Foto do cartão ou print do app do emissor. Guarda só os 4 últimos dígitos do número.
  const CARD_WORDS = new RegExp(Issuers.ANY_PRINT.source + "|IFOOD|BENEF|VALE|REFEI|ALIMENT|VOUCHER|CARTAO|VALIDADE|VALID|THRU|SALDO|MASTERCARD|VISA|ELO|DEBITO|CREDITO|DISPON|EXTRATO|APP");
  function parseCard(text) {
    const raw = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lines = raw.map(norm);
    const all = lines.join("\n");
    const res = { source: "celular", kind: /SALDO|DISPON|EXTRATO/.test(all) ? "app" : "cartao", issuer: null, type: null, holder: null, last4: null, balance: null };
    res.issuer = Issuers.fromPrint(all);
    if (/MULTI|FLEX|BENEFICIO/.test(all)) res.type = "flex";
    else if (/REFEI|RESTAURANTE/.test(all)) res.type = "refeicao";
    else if (/ALIMENT|MERCADO/.test(all)) res.type = "alimentacao";
    // número do cartão: 13 a 19 dígitos (com espaços) ou mascarado (**** 1234) → só o final
    const digits = all.replace(/[ .-](?=\d)/g, "");
    const full = digits.match(/\d{13,19}/);
    const masked = all.match(new RegExp(`${MASK_L4}|${FINAL_L4}`));
    if (masked) res.last4 = masked[1] || masked[2];
    else if (full) res.last4 = full[0].slice(-4);
    // saldo (print do app)
    lines.forEach((l, i) => {
      if (res.balance !== null || !/SALDO|DISPON/.test(l)) return;
      let v = amounts(l);
      if (!v.length && lines[i + 1]) v = amounts(lines[i + 1]);
      if (v.length) res.balance = v[0];
    });
    // titular: linha só com letras, 2 a 5 palavras, que não seja marca/rótulo
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (CARD_WORDS.test(l) || /\d/.test(l)) continue;
      const words = l.split(/\s+/).filter(w => /^[A-Z]{2,}$/.test(w));
      if (words.length >= 2 && words.length <= 5 && words.join(" ").length >= 6) {
        res.holder = words.map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ").replace(/\b(De|Da|Do|Dos|Das|E)\b/g, m => m.toLowerCase());
        break;
      }
    }
    return res;
  }

  window.ReceiptReader = { warm, readText, detectar, parse, parseCard, prepare };
})();
