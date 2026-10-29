// Sincronização com a Planilha Google (opcional): fila offline, envio e a tela de Ajustes.
// As regras puras ficam em js/sync.js; o script que a usuária cola na Planilha é apps-script/planilha.gs.
import { $, esc, toast } from "./util.js";
import { S } from "./estado.js";
import { Base, IDB, Store } from "./armazenamento.js";
import { closeSheet, openSheet } from "./folhas.js";
import { render, run } from "./telas.js";

// Espera (ms) depois de uma gravação antes de enviar, para juntar várias gravações num envio só. Os testes mudam.
export const ATRASO = { envio: 1500 };

export const syncOn = () => !!(S.meta.sync && S.meta.sync.ligado && S.meta.sync.url && S.meta.sync.secret);
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
const quando = ms => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// meta.sync muda na memória na hora e é gravada em seguida, uma gravação por vez (a última vale), para duas mudanças
// seguidas não se atropelarem.
let cadeia = Promise.resolve();
function guardarMeta(sync) {
  S.meta = { ...S.meta, sync };
  cadeia = cadeia.then(() => IDB.put("meta", S.meta, "main")).catch(e => console.warn("meta.sync", e));
  return cadeia;
}
export const filaDe = () => (S.meta.sync && S.meta.sync.fila) || [];

// Põe "loja:id" na fila, sem repetir.
export function enfileirar(itens) {
  const y = S.meta.sync || {};
  const fila = new Set(y.fila || []);
  const antes = fila.size;
  for (const i of itens) fila.add(i);
  if (fila.size !== antes) guardarMeta({ ...y, fila: [...fila] });
}
export function enfileirarTudo() {
  enfileirar([...Base.cards.map(c => "cards:" + c.id), ...Base.txs.map(t => "txs:" + t.id)]);
}

// Texto curto do estado, para a tela de Ajustes.
export function resumoSync(y) {
  if (!y || !y.ligado) return "Desligado.";
  const n = (y.fila || []).length;
  const partes = [y.ultimoEnvio ? "Última sincronização: " + quando(y.ultimoEnvio) : "Ainda não sincronizou"];
  if (n) partes.push(n + " a enviar");
  return partes.join(" · ") + ".";
}

function atualizarTela() {
  if (typeof document === "undefined") return;
  const st = $("yStatus");
  if (st) st.textContent = resumoSync(S.meta.sync);
  if (S.tab === "ajustes" && !$("scrim") && !S.busy) render();
}

let emCurso = null, pendente = false;
// Manda a fila à Planilha, lote a lote. Só sai da fila o que a Planilha confirmou. Nunca lança erro:
// devolve { ok, erro } e, se falhar, deixa a fila como estava (sem aviso na tela).
export function enviarFila() {
  if (emCurso) { pendente = true; return emCurso; }
  emCurso = (async () => {
    if (!syncOn()) return { ok: false, erro: "Sincronização desligada." };
    if (!online()) return { ok: false, erro: "Sem internet." };
    try {
      do {
        pendente = false;
        for (let volta = 0; volta < 1000 && filaDe().length; volta++) {
          const y = S.meta.sync;
          const lote = Sync.montarLotes(y.fila, Base, Sync.MAX_LOTE)[0];
          if (!lote) { guardarMeta({ ...y, fila: Sync.tirarDaFila(y.fila, [], Base) }); break; }
          await Sync.chamar(y, { acao: "enviar", aparelho: y.aparelho, registros: lote });
          const atual = S.meta.sync;
          guardarMeta({ ...atual, fila: Sync.tirarDaFila(atual.fila, lote, Base), ultimoEnvio: Date.now(), ultimoErro: null, ultimoErroTexto: null });
        }
      } while (pendente);
      return { ok: true };
    } catch (e) {
      console.warn("sincronizar", e);
      guardarMeta({ ...S.meta.sync, ultimoErro: Date.now(), ultimoErroTexto: e.message });
      return { ok: false, erro: e.message };
    }
  })().finally(() => { emCurso = null; atualizarTela(); });
  return emCurso;
}

let timer = null;
function agendarEnvio() {
  clearTimeout(timer);
  timer = setTimeout(enviarFila, ATRASO.envio);
  if (timer && timer.unref) timer.unref();
}

// Liga o gancho do armazenamento: toda gravação em cards/txs entra na fila (só com a sincronização ligada).
export function iniciarSync() {
  Store.aoMudar = (loja, registro) => {
    if (!syncOn()) return;
    enfileirar([loja + ":" + registro.id]);
    agendarEnvio();
  };
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("online", () => { enviarFila(); });
  enviarFila(); // ao abrir
}

export function syncSheet() {
  const y = S.meta.sync || {};
  let secret = y.secret || Sync.gerarSegredo();
  openSheet(`
    <h3>Sincronizar com a Planilha</h3>
    <p class="hint">O Ciclo guarda uma cópia dos seus cartões e lançamentos numa Planilha Google sua. O celular continua sendo a cópia principal; a Planilha é só para consultar, e editar nela não muda o app. Se o celular estiver sem internet, o app guarda o que falta e envia quando voltar. É preciso fazer uma vez a configuração abaixo, no computador.</p>
    <form id="yForm" class="sform" autocomplete="off">
      <label class="field"><span>Código secreto (copie e use no passo 3)</span>
        <input id="ySec" type="text" readonly value="${esc(secret)}"></label>
      <div class="btnrow"><button class="btn small" type="button" id="yCopy">Copiar código</button><button class="btn small" type="button" id="yNew">Gerar outro</button></div>
      <ol class="hint">
        <li>No computador, crie uma Planilha Google nova e abra <b>Extensões → Apps Script</b>.</li>
        <li>Cole o arquivo <b>apps-script/planilha.gs</b> do Ciclo (o passo a passo também está no começo dele).</li>
        <li>Troque o texto da linha SEGREDO_LOCAL pelo código acima e rode a função <b>configurar</b>.</li>
        <li>Implante como <b>App da Web</b> (executar como você; acesso: qualquer pessoa) e copie o link.</li>
        <li>Cole o link aqui e toque em <b>Testar conexão</b>.</li>
      </ol>
      <label class="field"><span>Link do script</span><input id="yUrl" type="url" inputmode="url" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(y.url || "")}"></label>
      <label class="check"><input type="checkbox" id="yOn" ${y.ligado ? "checked" : ""}> <span>Enviar para a Planilha automaticamente</span></label>
      <p class="hint">Vão para a Planilha os cartões (sem o número completo), os lançamentos e as senhas do cofre só em texto cifrado. Fotos de cupons e a senha mestra ficam só no celular. Quem tiver o link e o código consegue ler e gravar na Planilha. Não compartilhe os dois. O link e o código ficam só neste celular e não entram no backup. Desligar não apaga nada, nem aqui nem na Planilha.</p>
      <div class="err" id="yErr"></div>
      <p class="hint" id="yOk"></p>
      <p class="hint" id="yStatus">${esc(resumoSync(y))}</p>
      <div class="btnrow">
        <button class="btn primary" type="submit" id="ySave">Salvar</button>
        <button class="btn" type="button" id="yTest">Testar conexão</button>
        <button class="btn" type="button" id="yAll">Enviar tudo agora</button>
        <button class="btn" type="button" data-close>Fechar</button>
      </div>
    </form>`, () => {
    const cfg = () => ({ url: $("yUrl").value.trim(), secret });
    const urlOk = u => /^https:\/\//i.test(u);
    $("yCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(secret); toast("Código copiado."); } catch (e) { $("ySec").select(); toast("Selecione e copie o código."); }
    });
    $("yNew").addEventListener("click", () => { secret = Sync.gerarSegredo(); $("ySec").value = secret; $("yOk").textContent = "Código novo. Troque também no script e rode “configurar” de novo."; });
    $("yTest").addEventListener("click", async () => {
      $("yErr").textContent = ""; $("yOk").textContent = "";
      if (!urlOk(cfg().url)) { $("yErr").textContent = "Cole o link do App da Web (começa com https://)."; return; }
      $("yTest").disabled = true; $("yTest").textContent = "Testando…";
      try {
        const r = await Sync.chamar(cfg(), { acao: "estado" });
        $("yOk").textContent = `Conectado: ${r.cartoes} ${r.cartoes === 1 ? "cartão" : "cartões"}, ${r.lancamentos} ${r.lancamentos === 1 ? "lançamento" : "lançamentos"}.`;
      } catch (e) { $("yErr").textContent = e.message; }
      $("yTest").disabled = false; $("yTest").textContent = "Testar conexão";
    });
    $("yAll").addEventListener("click", async () => {
      $("yErr").textContent = ""; $("yOk").textContent = "";
      if (!syncOn()) { $("yErr").textContent = "Marque “Enviar para a Planilha automaticamente” e toque em Salvar primeiro."; return; }
      $("yAll").disabled = true; $("yAll").textContent = "Enviando…";
      enfileirarTudo();
      const r = await enviarFila();
      if ($("yAll")) {
        if (r.ok) $("yOk").textContent = "Tudo enviado para a Planilha.";
        else $("yErr").textContent = r.erro + " O que falta fica guardado e o app tenta de novo.";
        $("yAll").disabled = false; $("yAll").textContent = "Enviar tudo agora";
        $("yStatus").textContent = resumoSync(S.meta.sync);
      }
    });
    $("yForm").addEventListener("submit", async e => {
      e.preventDefault();
      const { url } = cfg(), ligado = $("yOn").checked;
      $("yErr").textContent = "";
      if (ligado && !urlOk(url)) { $("yErr").textContent = "Cole o link do App da Web (começa com https://) para ligar."; return; }
      const novo = { ...(S.meta.sync || {}), url, secret, ligado };
      const ligando = ligado && !(S.meta.sync && S.meta.sync.ligado);
      if (ligando) { novo.ligadoEm = Date.now(); novo.ultimoErro = null; }
      const ok = await run(() => Store.setMeta({ ...S.meta, sync: novo }), ligado ? "Sincronização ligada." : "Configuração salva.");
      if (ok) {
        // Ao ligar, tudo que já existe entra na fila (o que a Planilha já tem igual ou mais novo é ignorado por ela).
        if (ligando) enfileirarTudo();
        closeSheet();
        if (ligado) enviarFila();
      }
    });
  }, { secret: true });
}
