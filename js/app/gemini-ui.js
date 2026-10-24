// Ajustes do Gemini (leitura opcional de cupom).
import { $, esc } from "./util.js";
import { S } from "./estado.js";
import { Store } from "./armazenamento.js";
import { closeSheet, openSheet } from "./folhas.js";
import { run } from "./telas.js";

// ---------- leitura de fotos (cupons e cartões) com o Gemini (opcional) ----------
// A chave fica só neste celular (S.meta.gemini) e não vai para o backup.
// Limpa o que costuma vir junto ao copiar: espaços, quebras de linha, aspas, caracteres invisíveis,
// e um "NOME_DA_VARIAVEL=" na frente (ex.: GEMINI_API_KEY=...).
const cleanKey = raw => {
  let k = String(raw || "").replace(/[\s ​-‍⁠﻿"'`´“”‘’]/g, "");
  if (/^[A-Z_]+=/.test(k)) k = k.slice(k.indexOf("=") + 1);
  return k;
};
export const geminiOn = () => !!(S.meta.gemini && S.meta.gemini.enabled && S.meta.gemini.key && navigator.onLine && window.GeminiReader);
// Opções da lista de modelos: o padrão e o atual sempre aparecem, mesmo fora da lista do Google
function modelOptions(list, current) {
  const ids = [...new Set([GeminiReader.DEFAULT_MODEL, current, ...list].filter(Boolean))];
  return ids.map(id => `<option value="${esc(id)}" ${id === current ? "selected" : ""}>${esc(id)}${id === GeminiReader.DEFAULT_MODEL ? " (padrão)" : ""}</option>`).join("");
}
function geminiUsageText() {
  const u = GeminiReader.usage();
  if (!u.last) return "Este celular ainda não leu nenhuma foto com o Gemini.";
  const when = new Date(u.last.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `Última leitura: ${u.last.m}, em ${when}. Nos últimos 30 dias: ${u.reads30} ${u.reads30 === 1 ? "leitura" : "leituras"} e ${u.quota30} ${u.quota30 === 1 ? "erro" : "erros"} de cota (429).`;
}
export function geminiSheet() {
  const g = S.meta.gemini || {};
  openSheet(`
    <h3>Leitura de fotos com o Gemini</h3>
    <p class="hint">Com o Gemini ligado, as fotos de cupons e de cartões (frente do cartão ou print do app do emissor) são enviadas para o Google, que devolve os dados lidos. A leitura costuma acertar mais, principalmente em cupom térmico apagado. Sem internet, ou se o Gemini falhar, o app usa o leitor do próprio celular.</p>
    <form id="gForm" class="sform" autocomplete="off">
      <label class="check"><input type="checkbox" id="gOn" ${g.enabled ? "checked" : ""}> <span>Usar o Gemini para ler cupons e cartões</span></label>
      <label class="field"><span>Chave de API do Google AI Studio</span><input id="gKey" type="password" autocomplete="off" spellcheck="false" placeholder="Cole aqui a chave (começa com AIza…)" value="${esc(g.key || "")}"></label>
      <label class="check"><input type="checkbox" id="gShow"> <span>Mostrar a chave</span></label>
      <details class="raw"><summary>Avançado</summary>
        <label class="field" style="margin-top:10px"><span>Modelo</span><select id="gModel">${modelOptions([], g.model || GeminiReader.DEFAULT_MODEL)}</select></label>
        <span class="hint" id="gModelHint">O padrão (${GeminiReader.DEFAULT_MODEL}) sempre aponta para o Gemini Flash mais recente.${g.key ? " Buscando os modelos que a sua chave pode usar…" : " Com a chave salva, a lista mostra os modelos que ela pode usar."}</span>
        <p class="hint" id="gUse">${esc(geminiUsageText())}</p>
      </details>
      <div class="notice info"><span><b>Privacidade:</b> no plano gratuito do Gemini, o Google pode usar as fotos enviadas para melhorar os produtos dele. Uma NFC-e pode trazer CPF e o final do cartão. Ativar o faturamento no Google AI Studio impede esse uso.</span></div>
      <p class="hint">A chave fica guardada só neste celular e não entra no backup. Para protegê-la, restrinja a chave ao site <b>jessicadopke.github.io</b> no Google Cloud Console.</p>
      <div class="err" id="gErr"></div>
      <div class="btnrow">
        <button class="btn primary" type="submit" id="gSave">Testar e salvar</button>
        <button class="btn" type="button" data-close>Cancelar</button>
        ${g.key ? `<button class="btn danger" type="button" id="gDel">Remover chave</button>` : ""}
      </div>
    </form>`, () => {
    $("gShow").addEventListener("change", e => { $("gKey").type = e.target.checked ? "text" : "password"; });
    const fillModels = list => { const cur = $("gModel").value; $("gModel").innerHTML = modelOptions(list, cur); };
    if (g.key) GeminiReader.listModels(g.key).then(list => {
      if (!$("gModel")) return;
      fillModels(list);
      $("gModelHint").textContent = `O padrão (${GeminiReader.DEFAULT_MODEL}) sempre aponta para o Gemini Flash mais recente. ${list.length} modelos disponíveis para a sua chave.`;
    }, () => { if ($("gModelHint")) $("gModelHint").textContent = `O padrão (${GeminiReader.DEFAULT_MODEL}) sempre aponta para o Gemini Flash mais recente. Não foi possível buscar a lista agora.`; });
    $("gDel") && $("gDel").addEventListener("click", async () => {
      const ok = await run(() => Store.setMeta({ ...S.meta, gemini: { enabled: false, key: "", model: g.model || "" } }), "Chave do Gemini removida.");
      if (ok) closeSheet();
    });
    $("gForm").addEventListener("submit", async e => {
      e.preventDefault();
      const key = cleanKey($("gKey").value), enabled = $("gOn").checked, model = $("gModel").value.trim() || GeminiReader.DEFAULT_MODEL;
      $("gKey").value = key;
      $("gErr").textContent = "";
      if (enabled && !key) { $("gErr").textContent = "Cole a chave de API para ligar o Gemini."; return; }
      // Quem decide se a chave vale é o Google (no teste abaixo); aqui só barra o que claramente está incompleto.
      if (key && key.length < 20) { $("gErr").textContent = `A chave colada parece incompleta (${key.length} caracteres). Copie de novo no Google AI Studio.`; return; }
      if (key) {
        $("gSave").disabled = true; $("gSave").textContent = "Testando…";
        try { fillModels(await GeminiReader.test(key)); }
        catch (err) {
          $("gErr").textContent = GeminiReader.explain(err);
          $("gSave").disabled = false; $("gSave").textContent = "Testar e salvar";
          return;
        }
      }
      const ok = await run(() => Store.setMeta({ ...S.meta, gemini: { enabled, key, model } }), enabled ? "Gemini ligado. Os próximos cupons e cartões serão lidos por ele." : "Configuração salva.");
      if (ok) closeSheet(); else { $("gSave").disabled = false; $("gSave").textContent = "Testar e salvar"; }
    });
  }, { secret: true });
}
