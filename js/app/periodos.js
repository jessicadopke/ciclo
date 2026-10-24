// Períodos de crédito, estimativas e cálculos por dia útil.
import { delta, isoDay, midnight, mkDate, monthKey, MONTHS, shortDate } from "./util.js";
import { S } from "./estado.js";

// ---------- crédito do benefício: fixo ou variável ----------
// dayMode: "fixed" (todo dia X), "variable" (cai em dias diferentes) ou "none" (não controlar).
// amountMode: "fixed" (mesmo valor todo mês) ou "variable" (valor muda).
export const dayModeOf = c => c.dayMode || (c.creditDay ? "fixed" : "none");
export const amountModeOf = c => c.amountMode || "fixed";
export const fromISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const isBenefitCredit = t => t.kind === "credit" && (t.benefit || /^Crédito de /.test(t.desc || ""));
export const benefitCredits = card => S.txs.filter(t => t.cardId === card.id && isBenefitCredit(t)).sort((a, b) => a.date.localeCompare(b.date));
// Datas em que o crédito caiu (inclui a data do último crédito informada no cadastro).
function creditDates(card) {
  const ds = new Set(benefitCredits(card).map(t => t.date));
  if (card.lastCreditDate) ds.add(card.lastCreditDate);
  return [...ds].sort();
}
// Valor esperado do próximo crédito: o fixo, ou o último recebido.
export function expectedAmount(card) {
  if (amountModeOf(card) === "fixed") return card.monthlyCredit || 0;
  const cs = benefitCredits(card);
  return cs.length ? cs[cs.length - 1].amount : (card.monthlyCredit || 0);
}
// Previsão do próximo crédito pelo intervalo médio entre os últimos créditos (sem histórico: 30 dias).
function estimateNext(card) {
  const ds = creditDates(card);
  if (!ds.length) return null;
  const recent = ds.slice(-6).map(fromISO);
  const gaps = recent.slice(1).map((d, i) => Math.round((d - recent[i]) / 86400000)).filter(g => g >= 5);
  const avg = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : 30;
  const last = recent[recent.length - 1];
  return { date: addDays(last, Math.min(45, Math.max(7, avg))), last, avg, samples: gaps.length };
}

// ---------- períodos ----------
// Dia fixo: um período vai do dia do crédito até a véspera do crédito seguinte.
// Dia variável: um período vai de um crédito real até o próximo crédito registrado.
// Sem dia de crédito, o período é o mês do calendário.
export function periodAt(card, date) {
  const d = midnight(date);
  if (dayModeOf(card) === "variable") {
    const ds = creditDates(card), iso = isoDay(d);
    let i = -1;
    ds.forEach((x, k) => { if (x <= iso) i = k; });
    if (i >= 0) {
      const start = fromISO(ds[i]);
      let end, open = false;
      if (ds[i + 1]) end = fromISO(ds[i + 1]);
      else { open = true; const est = estimateNext(card); end = est && est.date > d ? est.date : addDays(d, 1); }
      return { start, end, startISO: isoDay(start), endISO: open ? "9999-12-31" : isoDay(end), key: ds[i], open };
    }
    // antes do primeiro crédito conhecido: mês do calendário, até o primeiro crédito
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    let end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    if (ds[0] && fromISO(ds[0]) < end) end = fromISO(ds[0]);
    return { start, end, startISO: isoDay(start), endISO: isoDay(end), key: "cal:" + monthKey(start), calendar: true };
  }
  const day = Number(card.creditDay) || 1;
  let start = mkDate(d.getFullYear(), d.getMonth(), day);
  if (d < start) start = mkDate(d.getFullYear(), d.getMonth() - 1, day);
  const end = mkDate(start.getFullYear(), start.getMonth() + 1, day);
  return { start, end, startISO: isoDay(start), endISO: isoDay(end), key: monthKey(start), calendar: dayModeOf(card) === "none" };
}
export function periodShift(card, p, n) {
  if (dayModeOf(card) !== "variable") {
    const day = Number(card.creditDay) || 1;
    return periodAt(card, mkDate(p.start.getFullYear(), p.start.getMonth() + n, day));
  }
  let q = p;
  for (let k = 0; k < Math.abs(n); k++) q = n < 0 ? periodAt(card, addDays(q.start, -1)) : periodAt(card, q.end);
  return q;
}
export function periodLabel(card, p) {
  if (p.calendar && dayModeOf(card) !== "variable") return `${MONTHS[p.start.getMonth()]} ${p.start.getFullYear()}`;
  if (p.open) return `${shortDate(p.start)} – hoje`;
  const last = addDays(p.end, -1);
  return `${shortDate(p.start)} – ${shortDate(last)} ${last.getFullYear()}`;
}
function workdaysBetween(a, b) {
  let n = 0;
  for (let d = new Date(a); d < b; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
export function periodStats(card, p) {
  const txs = S.txs.filter(t => t.cardId === card.id);
  const bal = card.balance || 0;
  const after = iso => txs.filter(t => (t.date || "") >= iso).reduce((s, t) => s + delta(t), 0);
  const inP = txs.filter(t => t.date >= p.startISO && t.date < p.endISO);
  const isAdj = t => t.source === "ajuste";
  return {
    txs: inP,
    opening: bal - after(p.startISO),
    closing: bal - after(p.endISO),
    credits: inP.filter(t => t.kind === "credit" && !isAdj(t)).reduce((s, t) => s + t.amount, 0),
    debits: inP.filter(t => t.kind === "debit" && !isAdj(t)).reduce((s, t) => s + t.amount, 0),
    adjust: inP.filter(isAdj).reduce((s, t) => s + delta(t), 0),
  };
}
export function creditInfo(card) {
  const mode = dayModeOf(card);
  const today = midnight(new Date());
  if (mode === "fixed") {
    const p = periodAt(card, today);
    return { period: p, next: p.end, workdays: workdaysBetween(today, p.end), calDays: Math.round((p.end - today) / 86400000), estimated: false, overdue: false };
  }
  if (mode === "variable") {
    const est = estimateNext(card);
    if (!est) return null;
    const overdue = est.date <= today;
    return { period: periodAt(card, today), next: est.date, workdays: overdue ? 0 : workdaysBetween(today, est.date), calDays: Math.round((est.date - today) / 86400000), estimated: true, overdue, est };
  }
  return null;
}
// Quanto dá para gastar por dia útil até o próximo crédito (null quando o crédito está atrasado ou não há previsão).
export function perDayOf(card, ci) {
  if (!ci || ci.overdue) return null;
  return Math.max(0, ci.workdays > 0 ? Math.floor((card.balance || 0) / ci.workdays) : card.balance || 0);
}
export function creditWhen(ci) {
  if (!ci) return "";
  if (ci.overdue) return "crédito previsto: já deveria ter caído";
  return `crédito em ${ci.estimated ? "~" : ""}${ci.calDays} ${ci.calDays === 1 ? "dia" : "dias"}`;
}
