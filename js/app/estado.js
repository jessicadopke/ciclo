// Estado do app: um único objeto S, lido e escrito por todos os módulos.

// ---------- estado ----------
export const S = {
  cards: [], txs: [], meta: {}, loaded: false,
  view: { name: "home" }, tab: "home", person: null, periodOffset: 0, gfOffset: 0, gfView: "categorias", busy: false, skipped: new Set(), cardQuery: "", groups: {}, txQuery: "", txLimit: 100,
  key: null, plain: {}, plainSig: {}, reveal: new Set(), lockTimer: null, installEvt: null,
};

export const cardById = id => S.cards.find(c => c.id === id);
export const sortedCards = () => [...S.cards].sort((a, b) => (a.holder || "").localeCompare(b.holder || "", "pt-BR") || (a.createdAt || 0) - (b.createdAt || 0));
export const visibleCards = () => sortedCards().filter(c => S.person === null || (c.holder || "") === S.person);
export const holders = () => [...new Set(S.cards.map(c => c.holder || ""))].sort((a, b) => a.localeCompare(b, "pt-BR"));
export const txSort = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0);
export const lastTxDate = cardId => S.txs.filter(t => t.cardId === cardId).reduce((m, t) => (t.date > m ? t.date : m), "");

// Dois objetos pequenos que antes eram variáveis soltas dentro do app.js. Mesmo estado, só que importável.
// ui.sheetCleanup: função que fecha o que a folha aberta deixou pendente (câmera, foto, etc.).
export const ui = { sheetCleanup: null };
// config.APP_VERSION: preenchido pela entrada (js/app.js), que guarda a versão do app.
export const config = { APP_VERSION: "" };
