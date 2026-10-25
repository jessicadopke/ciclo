// Base da sincronização com a Planilha (etapa 1: só funções puras, sem rede e sem banco).
// Mesmo estilo do drive.js: script clássico que se pendura em `window.Sync`.
// Registros de `cards` e `txs` carregam `updatedAt` (última mudança), `updatedBy` (aparelho) e, quando apagados,
// `apagado: true` (marca mínima). Veja specs/9-sincronizar-planilha.md, seção "Desenho".
(() => {
  "use strict";

  const DIA = 86400000;
  const LOJAS = ["cards", "txs"];

  const delta = t => t.kind === "debit" ? -t.amount : t.amount;

  // JSON com as chaves em ordem, para desempatar igual nos dois aparelhos.
  function canonico(v) {
    if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  // Cópia com a "última mudança" carimbada. Uma mudança sempre vence a versão anterior, mesmo com relógio atrasado.
  function carimbar(novo, anterior, aparelho, agora) {
    const antes = (anterior && anterior.updatedAt) || 0;
    return { ...novo, updatedAt: Math.max(agora, antes + 1), updatedBy: aparelho || "" };
  }

  // Marca de apagado: só o essencial, sem nome, valor, loja nem senhas.
  function marcaApagado(anterior, aparelho, agora) {
    const antes = (anterior && anterior.updatedAt) || 0;
    return { id: anterior.id, apagado: true, updatedAt: Math.max(agora, antes + 1), updatedBy: aparelho || "" };
  }

  // Ordem total: maior updatedAt; empate, maior updatedBy; empate, maior JSON canônico.
  function vence(a, b) {
    const ua = a.updatedAt || 0, ub = b.updatedAt || 0;
    if (ua !== ub) return ua > ub ? a : b;
    const pa = a.updatedBy || "", pb = b.updatedBy || "";
    if (pa !== pb) return pa > pb ? a : b;
    return canonico(a) >= canonico(b) ? a : b;
  }

  function mesclarLista(a, b) {
    const mapa = new Map();
    for (const r of [...(a || []), ...(b || [])]) {
      const atual = mapa.get(r.id);
      mapa.set(r.id, atual ? vence(atual, r) : r);
    }
    return [...mapa.values()].sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  }

  // Une duas bases completas (com marcas). Lançamentos com ids diferentes ficam sempre os dois.
  function mesclar(local, remoto) {
    const out = {};
    for (const l of LOJAS) out[l] = mesclarLista(local && local[l], remoto && remoto[l]);
    return out;
  }

  // Só o que a tela deve ver: sem marcas, e sem lançamentos de cartão apagado.
  function visiveis(base) {
    const cards = (base.cards || []).filter(c => !c.apagado);
    const ids = new Set(cards.map(c => c.id));
    const txs = (base.txs || []).filter(t => !t.apagado && ids.has(t.cardId));
    return { cards, txs };
  }

  // Saldo derivado: saldoBase + lançamentos não apagados do cartão.
  function saldo(card, txs) {
    let s = card.saldoBase || 0;
    for (const t of txs) if (t.cardId === card.id && !t.apagado) s += delta(t);
    return s;
  }

  // Dados antigos ganham updatedAt (= createdAt) e, nos cartões, saldoBase. Idempotente.
  function migrar(base) {
    const mudados = [];
    const txs = (base.txs || []).map(t => {
      if (t.updatedAt !== undefined) return t;
      const n = { ...t, updatedAt: t.createdAt || 0 };
      mudados.push({ loja: "txs", registro: n });
      return n;
    });
    const cards = (base.cards || []).map(c => {
      if (c.apagado) return c;
      let n = c;
      if (n.updatedAt === undefined) n = { ...n, updatedAt: n.createdAt || 0 };
      if (n.saldoBase === undefined) n = { ...n, saldoBase: (c.balance || 0) - saldo({ id: c.id }, txs) };
      if (n !== c) mudados.push({ loja: "cards", registro: n });
      return n;
    });
    return { cards, txs, mudados };
  }

  // Tira as marcas de apagado mais velhas que `dias`.
  function limparMarcas(lista, agora, dias = 90) {
    const corte = agora - dias * DIA;
    const removidos = [];
    const sobra = lista.filter(r => {
      if (r.apagado && (r.updatedAt || 0) < corte) { removidos.push(r.id); return false; }
      return true;
    });
    return { lista: sobra, removidos };
  }

  window.Sync = { carimbar, marcaApagado, vence, mesclar, visiveis, saldo, migrar, limparMarcas, canonico };
})();
