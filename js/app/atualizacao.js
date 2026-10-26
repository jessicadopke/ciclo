// Aviso e instalação de versão nova do app.
import { $, esc, toast } from "./util.js";
import { config, S } from "./estado.js";
import { render } from "./telas.js";

// ---------- atualização do app ----------
// version.json (na raiz do site) traz a versão publicada. Compara com APP_VERSION;
// se for maior, oferece atualizar: limpa a cópia offline do app (não os dados) e recarrega.
const newerThan = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};
export async function checkUpdate(manual) {
  if (!navigator.onLine) { if (manual) toast("Sem internet. Conecte-se para buscar atualização."); return null; }
  try {
    const res = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const v = String((await res.json()).version || "");
    const before = S.updateAvailable;
    S.lastUpdateCheck = Date.now();
    S.updateAvailable = newerThan(v, config.APP_VERSION) ? v : null;
    if (manual && !S.updateAvailable) toast(`Você já está na versão mais recente (${config.APP_VERSION}).`);
    if (S.loaded && !$("scrim") && before !== S.updateAvailable) render();
    return S.updateAvailable;
  } catch (e) {
    console.warn("atualização", e);
    if (manual) toast("Não foi possível verificar agora. Tente de novo em instantes.");
    return null;
  }
}
// Espera o service worker novo (se houver) terminar de instalar e assumir; desiste em 15 s.
function esperarNovo(reg) {
  const w = reg.installing || reg.waiting;
  if (!w || w.state === "activated") return Promise.resolve();
  return new Promise(res => {
    const t = setTimeout(res, 15000);
    w.addEventListener("statechange", () => { if (w.state === "activated" || w.state === "redundant") { clearTimeout(t); res(); } });
  });
}
export async function applyUpdate() {
  if (!navigator.onLine) { toast("Sem internet. Conecte-se para atualizar."); return; }
  toast("Atualizando…");
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.update().catch(() => {}); await esperarNovo(reg); }
    // Só a cópia offline do programa; cartões, extratos e senhas ficam no IndexedDB e não são tocados.
    // Só apaga as cópias antigas se a da versão nova já existe (o nome é "ciclo-" + versão, como em sw.js).
    if (window.caches) {
      const manter = "ciclo-" + (S.updateAvailable || config.APP_VERSION);
      const nomes = await caches.keys();
      if (nomes.includes(manter)) for (const k of nomes) if (k !== manter) await caches.delete(k);
    }
  } catch (e) { console.warn("atualização", e); }
  location.reload();
}
export function renderUpdateNotice() {
  if (!S.updateAvailable) return "";
  return `<div class="notice info"><span>A versão <b class="num">${esc(S.updateAvailable)}</b> do Ciclo está disponível (você está na ${config.APP_VERSION}).</span><span class="actions"><button class="btn small primary" data-act="update-now">Atualizar</button></span></div>`;
}
