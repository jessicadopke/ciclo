// Constantes e utilidades (sem dependências).

// ---------- constantes e utilidades ----------
export const TYPES = {
  alimentacao: { label: "Alimentação", color: "var(--t-alim)" },
  refeicao: { label: "Refeição", color: "var(--t-ref)" },
  flex: { label: "Multibenefício", color: "var(--t-flex)" },
  outro: { label: "Outro voucher", color: "var(--t-outro)" },
};
// Emissores (nome, cor e sigla) vêm de issuers.js
export const ISSUERS = Issuers.NAMES;
const ISSUER_STYLE = Issuers.STYLE;
export const issuerStyle = c => ISSUER_STYLE[c.issuer] || ISSUER_STYLE.Outro;
export const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const MANY = 12; // a partir daqui os grupos por titular começam fechados
export const CATS = ["Mercado", "Restaurante", "Padaria", "Delivery", "Lanche", "Feira", "Outros"];
export const MONTHS = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

export const brl = c => (c < 0 ? "−" : "") + "R$ " + (Math.abs(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, "0");
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const todayISO = () => isoDay(new Date());
export const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const mkDate = (y, m, d) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()));
export const shortDate = d => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
export function parseMoney(str) {
  let s = String(str ?? "").replace(/[R$\s]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) : NaN;
}
export const fmtInput = c => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function fmtDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const diff = Math.round((midnight(new Date()) - dt) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return dt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", year: dt.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}
export const delta = t => t.kind === "debit" ? -t.amount : t.amount;

export const $ = id => document.getElementById(id);

export function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  $("toastRoot").replaceChildren(el);
  setTimeout(() => el.remove(), 2800);
}
export function explain(err) {
  if (err && err.name === "QuotaExceededError") return "O celular está sem espaço para o app. Apague fotos de cupons antigos ou libere espaço.";
  return "Não foi possível salvar. Tente de novo.";
}

// ---------- ícones ----------
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  gasto: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
  credito: svg('<path d="M17 7 7 17M15 17H7V9"/>'),
  cupom: svg('<path d="M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.5"/>'),
  corrigir: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  cartao: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>'),
};
