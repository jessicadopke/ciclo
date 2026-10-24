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
export async function applyUpdate() {
  if (!navigator.onLine) { toast("Sem internet. Conecte-se para atualizar."); return; }
  toast("Atualizando…");
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update().catch(() => {});
    // Só a cópia offline do programa; cartões, extratos e senhas ficam no IndexedDB e não são tocados.
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  } catch (e) { console.warn("atualização", e); }
  location.reload();
}
export function renderUpdateNotice() {
  if (!S.updateAvailable) return "";
  return `<div class="notice info"><span>A versão <b class="num">${esc(S.updateAvailable)}</b> do Ciclo está disponível (você está na ${config.APP_VERSION}).</span><span class="actions"><button class="btn small primary" data-act="update-now">Atualizar</button></span></div>`;
}
