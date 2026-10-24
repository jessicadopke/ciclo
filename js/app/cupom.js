// Leitura de cupom: câmera, galeria, fila, recorte.
import { $, brl, esc, fmtDay, toast } from "./util.js";
import { S, ui } from "./estado.js";
import { IDB } from "./armazenamento.js";
import { geminiOn } from "./gemini-ui.js";
import { openSheet } from "./folhas.js";
import { reviewForm } from "./conferencia.js";

// ---------- câmera ou galeria ----------
// "Ler cupom" abre a câmera traseira direto (capture="environment"); a galeria fica como opção secundária.
// Sem o Gemini, o leitor do celular já vai carregando enquanto a câmera ou a galeria estão abertas.
const warmReader = () => { if (!geminiOn() && window.ReceiptReader) ReceiptReader.warm(); };
export function openCamera(cardId) { S.scanCard = cardId || null; warmReader(); $("camIn").click(); }
export function openGallery(cardId) { S.scanCard = cardId || null; warmReader(); $("fileIn").click(); }

// ---------- cupom fiscal ----------
// Foto guardada: lado maior ≤ 1280 px, tons de cinza, JPEG leve (~60–150 KB), ainda legível para conferir o cupom.
// Para o Gemini: colorida, lado maior ≤ 2000 px (shrink(file, 2000, 0.85, false)).
export async function shrink(file, max = 1280, q = 0.6, gray = true) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
    const ctx = cv.getContext("2d");
    if (gray) ctx.filter = "grayscale(1) contrast(1.15)";
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    return (await new Promise(r => cv.toBlob(r, "image/jpeg", q))) || file;
  } catch (e) { return file; }
}

export const scanQueue = [];
export function startScan(files, cardId) {
  const list = [...files].filter(f => /^image\//.test(f.type) || !f.type);
  if (!list.length) { toast("Escolha uma foto do cupom."); return; }
  list.forEach(f => scanQueue.push({ file: f, cardId }));
  if (!$("scrim")) nextScan();
}
export function nextScan() { const job = scanQueue.shift(); if (job) scanOne(job.file, job.cardId); }

async function scanOne(file, presetCardId, extra = {}) {
  const url = URL.createObjectURL(file);
  let alive = true;
  const loaderHTML = `
      <div class="loading"><span class="spin"></span><span id="scanStatus">Preparando…</span></div>
      <div class="progress" style="margin-top:10px"><span id="scanBar"></span></div>
      <div class="btnrow" style="margin-top:12px"><button class="btn" id="scanStop">Preencher à mão</button></div>`;
  const remaining = scanQueue.length;
  const sheet = openSheet(`
    <h3>Ler cupom${remaining ? ` <span class="hint num">(mais ${remaining} na fila)</span>` : ""}</h3>
    <img class="receipt-img" src="${url}" alt="Foto do cupom">
    <div id="scanBody">${loaderHTML}</div>`);
  const ctl = window.AbortController ? new AbortController() : null;
  ui.sheetCleanup = () => { alive = false; ctl && ctl.abort(); URL.revokeObjectURL(url); scanQueue.length = 0; };
  const stored = shrink(file);
  const bindStop = () => $("scanStop").addEventListener("click", async () => { alive = false; ctl && ctl.abort(); reviewForm(sheet, await stored, presetCardId, null, "Preencha os dados do cupom.", ""); });
  bindStop();

  // 1º: Gemini, se estiver ligado, com chave e com internet. Se falhar, segue para o leitor do celular.
  // "Como foi lido" (modelos tentados, erros e tempos) aparece na conferência, para entender demora ou falha.
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1).replace(".", ",") + " s";
  let geminiFail = null, geminiLog = "";
  if (!geminiOn()) geminiLog = !(S.meta.gemini && S.meta.gemini.key) ? "Gemini: sem chave salva." : !(S.meta.gemini && S.meta.gemini.enabled) ? "Gemini: desligado em Ajustes." : !navigator.onLine ? "Gemini: sem internet." : "";
  if (geminiOn()) {
    // Andamento: modelo da tentativa atual, troca de modelo e tempo decorrido
    let gNow = "Lendo com o Gemini…";
    const showNow = () => { if (alive && $("scanStatus")) $("scanStatus").textContent = `${gNow} ${Math.round((Date.now() - t0) / 1000)} s`; };
    const onProgress = ({ model, prev }) => {
      gNow = !prev ? `Lendo com o Gemini (${model})…`
        : prev.running ? `${prev.model} está demorando; tentando também ${model}…`
        : `${prev.model}: ${GeminiReader.shortStatus(prev.status)}. Tentando ${model}…`;
      showNow();
    };
    showNow();
    const tick = setInterval(showNow, 1000);
    $("scanBar").parentElement.hidden = true;
    try {
      // 1600 px bastam para o Gemini ler o cupom; foto menor sobe e é processada mais rápido
      const img = await shrink(file, 1600, 0.8, false);
      const g = await GeminiReader.read(img, { key: S.meta.gemini.key, model: S.meta.gemini.model }, ctl && ctl.signal, onProgress);
      clearInterval(tick);
      if (!alive || !$("scanBody")) return;
      const p = g.parsed;
      p.how = `Gemini: ${GeminiReader.describe(g.attempts)}. Total: ${secs()}.`;
      const msg = !p.legible ? "O Gemini achou que a foto não é um comprovante ou está ilegível. Confira os dados." : !p.found.length ? "O Gemini não encontrou valores nesta foto. Confira ou preencha à mão." : null;
      reviewForm(sheet, await stored, presetCardId, p, msg, g.raw);
      return;
    } catch (e) {
      clearInterval(tick);
      if (!alive || !$("scanBody")) return;
      console.warn("gemini", e);
      geminiFail = GeminiReader.explain(e);
      geminiLog = `Gemini: ${GeminiReader.describe(e.attempts) || e.message}.`;
      $("scanBar").parentElement.hidden = false;
    }
  }

  const labels = { "preparando a foto": "Preparando a foto…", "loading tesseract core": "Carregando o leitor…", "initializing tesseract": "Carregando o leitor…", "loading language traineddata": "Carregando o português…", "initializing api": "Carregando o leitor…", "recognizing text": "Lendo o texto do cupom…" };
  if (geminiFail) $("scanStatus").textContent = `${geminiFail} Usando o leitor do celular…`;
  try {
    // Recorte (só no leitor do celular): acha o papel e deixa conferir os cantos antes de ler.
    const info = { ms: {} };
    const opts = { info };
    if (extra.semRecorte) info.motivo = "pedido: ler sem recorte";
    else {
      if ($("scanStatus")) $("scanStatus").textContent = "Procurando o cupom na foto…";
      const det = await ReceiptReader.detectar(file).catch(() => null);
      if (!alive || !$("scanBody")) return;
      if (det) info.ms = { ...det.ms };
      if (!det || !det.cantos) { info.motivo = "não achei o papel"; }
      else if (!Recorte.diferenteDaMoldura(det.cantos, det.larg, det.alt)) { info.motivo = "a foto já está enquadrada"; }
      else if (Recorte.autoLigado(S.meta)) opts.cantos = det.cantos;
      else {
        const r = await confirmarRecorte(sheet, url, det);
        if (!alive || !$("scanBody")) return;
        $("scanBody").innerHTML = loaderHTML; bindStop();
        if (r.cantos) opts.cantos = r.cantos; else info.motivo = "você escolheu ler a foto inteira";
      }
    }
    const text = await ReceiptReader.readText(file, (status, p) => {
      if (!alive || !$("scanStatus")) return;
      $("scanStatus").textContent = labels[status] || "Lendo…";
      $("scanBar").style.width = Math.round((status === "recognizing text" ? 0.3 + p * 0.7 : p * 0.3) * 100) + "%";
    }, opts);
    if (!alive || !$("scanBody")) return;
    const parsed = ReceiptReader.parse(text);
    parsed.how = `${geminiLog ? geminiLog + " " : ""}Leitor do celular. ${info.texto || ""} Total: ${secs()}.`;
    // recorte usado automaticamente: mostra a miniatura e deixa ler de novo sem ele
    if (info.cantos && Recorte.autoLigado(S.meta)) parsed.recorteMini = info.miniatura;
    const empty = !parsed.found.length;
    const prefix = geminiFail ? `Gemini: ${geminiFail} A foto foi lida pelo leitor do celular. ` : "";
    reviewForm(sheet, await stored, presetCardId, parsed, empty ? prefix + "Não encontrei valores nesta foto. Confira se o cupom está inteiro, reto e bem iluminado, ou preencha à mão." : (prefix ? prefix + "Confira os valores com atenção." : null), text);
    const again = sheet.querySelector("#rNoCrop");
    if (again) again.addEventListener("click", () => { ui.sheetCleanup = null; scanOne(file, presetCardId, { semRecorte: true }); });
  } catch (e) {
    console.error(e);
    if (!alive || !$("scanBody")) return;
    reviewForm(sheet, await stored, presetCardId, null, "Não foi possível ler a foto. Preencha os dados do cupom.", "");
  }
}

// Passo de conferência do recorte: contorno sobre a foto e 4 pontos para arrastar com o dedo.
// Resolve com { cantos } (em pixels da foto) ou { inteira: true }.
function confirmarRecorte(sheet, url, det) {
  return new Promise(resolve => {
    const body = sheet.querySelector("#scanBody"), foto = sheet.querySelector(".receipt-img");
    if (foto) foto.hidden = true;
    body.innerHTML = `
      <p class="hint">Achei o cupom na foto. Se o contorno não estiver certo, arraste os pontos com o dedo.</p>
      <div class="crop" id="crop" style="max-width:${Math.round(360 * det.larg / det.alt)}px">
        <img src="${url}" alt="Foto do cupom com o contorno do recorte" draggable="false">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon id="cropPoly"></polygon></svg>
        ${[0, 1, 2, 3].map(i => `<button type="button" class="crop-h" data-i="${i}" aria-label="Ponto ${i + 1} de 4 do recorte"></button>`).join("")}
      </div>
      <div class="btnrow">
        <button class="btn primary" type="button" id="cropOk">Usar recorte</button>
        <button class="btn" type="button" id="cropFull">Ler a foto inteira</button>
        <button class="btn" type="button" id="cropRedo">Refazer sozinho</button>
      </div>`;
    const box = $("crop"), hs = [...box.querySelectorAll(".crop-h")];
    let cur = det.cantos.map(p => ({ ...p }));
    const pct = (v, n) => (v / Math.max(1, n - 1) * 100);
    const draw = () => {
      $("cropPoly").setAttribute("points", cur.map(p => `${pct(p.x, det.larg)},${pct(p.y, det.alt)}`).join(" "));
      hs.forEach((h, i) => { h.style.left = pct(cur[i].x, det.larg) + "%"; h.style.top = pct(cur[i].y, det.alt) + "%"; });
    };
    draw();
    hs.forEach(h => {
      const i = +h.dataset.i;
      h.addEventListener("pointerdown", e => { e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add("on"); });
      h.addEventListener("pointermove", e => {
        if (!h.classList.contains("on")) return;
        const r = box.getBoundingClientRect();
        const novo = cur.map(p => ({ ...p }));
        novo[i] = { x: (e.clientX - r.left) / r.width * (det.larg - 1), y: (e.clientY - r.top) / r.height * (det.alt - 1) };
        const ok = Recorte.validar(novo, det.larg, det.alt); // trava dentro da foto; cruzado não passa
        if (ok) { cur = ok; draw(); }
      });
      const solta = () => h.classList.remove("on");
      h.addEventListener("pointerup", solta); h.addEventListener("pointercancel", solta);
    });
    $("cropOk").addEventListener("click", () => { if (foto) foto.hidden = false; resolve({ cantos: cur }); });
    $("cropFull").addEventListener("click", () => { if (foto) foto.hidden = false; resolve({ inteira: true }); });
    $("cropRedo").addEventListener("click", () => { cur = det.cantos.map(p => ({ ...p })); draw(); });
  });
}

// Escolha do cartão pelo cupom: js/match.js (funções puras, com testes)
export const storeKeyOf = Match.storeKeyOf;
export const rankCards = (d, amount, saldos, presetCardId) => Match.rankCards(S.cards, S.txs, d, amount, saldos, presetCardId);

export async function receiptSheet(tx) {
  const rec = await IDB.get("receipts", tx.receiptId).catch(() => null);
  const url = rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
  openSheet(`
    <h3>${esc(tx.desc || "Cupom")}</h3>
    <p class="hint num">${esc(fmtDay(tx.date))} · ${brl(tx.amount)}${typeof tx.reportedBalance === "number" ? ` · saldo no cupom ${brl(tx.reportedBalance)}` : ""}</p>
    ${url ? `<img class="receipt-full" src="${url}" alt="Foto do cupom">` : `<p class="hint">A foto deste cupom não está mais no aparelho.</p>`}
    <div class="btnrow"><button class="btn" data-close>Fechar</button></div>`);
  if (url) ui.sheetCleanup = () => URL.revokeObjectURL(url);
}
