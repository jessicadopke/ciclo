// IndexedDB e gravação de dados.
import { S } from "./estado.js";

// ---------- armazenamento no aparelho (IndexedDB) ----------
const DB_NAME = "ciclo";
const OLD_DB_NAME = "carteira-vales"; // nome usado até a 1.4.0
// Prazo (ms) para o Chrome abrir um banco. Se estourar, a abertura mostra o aviso em vez de ficar girando. Os testes encurtam.
export const PRAZO = { abrir: 8000 };
// Abre um banco com prazo e aviso de "bloqueado" (outra janela segurando). Nunca apaga nem muda versão.
// Se a abertura terminar depois do prazo, a conexão é fechada para não ficar pendurada.
function abrirBanco(nome, versao, aoAtualizar) {
  return new Promise((res, rej) => {
    let fim = false;
    const acaba = (f, v) => { if (fim) return; fim = true; clearTimeout(t); f(v); };
    const t = setTimeout(() => acaba(rej, new Error("O banco " + nome + " não respondeu a tempo.")), PRAZO.abrir);
    let r;
    try { r = versao ? indexedDB.open(nome, versao) : indexedDB.open(nome); } catch (e) { return acaba(rej, e); }
    if (aoAtualizar) r.onupgradeneeded = () => aoAtualizar(r.result);
    r.onblocked = () => acaba(rej, new Error("O banco " + nome + " está bloqueado por outra janela."));
    r.onsuccess = () => { if (fim) { try { r.result.close(); } catch (e) {} return; } acaba(res, r.result); };
    r.onerror = () => acaba(rej, r.error || new Error("Erro ao abrir o banco " + nome + "."));
  });
}
export const IDB = {
  db: null,
  async open() {
    const db = await abrirBanco(DB_NAME, 1, db => {
      for (const s of ["cards", "txs", "receipts"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    });
    IDB.db = db;
    // Outra aba ou atualização precisa do banco: solta a conexão e recarrega, em vez de travar as duas.
    db.onversionchange = () => { db.close(); location.reload(); };
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = IDB.db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => res(r && r.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  all: s => IDB.req(s, "readonly", st => st.getAll()),
  get: (s, k) => IDB.req(s, "readonly", st => st.get(k)),
  put: (s, v, k) => IDB.req(s, "readwrite", st => k === undefined ? st.put(v) : st.put(v, k)),
  del: (s, k) => IDB.req(s, "readwrite", st => st.delete(k)),
  clear: s => IDB.req(s, "readwrite", st => st.clear()),
};
// Até a 1.4.0 o banco se chamava "carteira-vales". Se ele existir e o novo estiver vazio, copia tudo e apaga o antigo.
export async function migrateOldDb() {
  if (!indexedDB.databases) return false;
  const list = await Promise.race([indexedDB.databases().catch(() => []), new Promise(res => setTimeout(() => res([]), PRAZO.abrir))]);
  if (!list.some(d => d.name === OLD_DB_NAME)) return false;
  const [cards, meta] = await Promise.all([IDB.all("cards"), IDB.get("meta", "main")]);
  if (cards.length || meta) return false;
  const old = await abrirBanco(OLD_DB_NAME, 0, null);
  const read = (s, k) => new Promise(res => {
    if (!old.objectStoreNames.contains(s)) return res(k ? undefined : []);
    const q = k ? old.transaction(s).objectStore(s).get(k) : old.transaction(s).objectStore(s).getAll();
    q.onsuccess = () => res(q.result); q.onerror = () => res(k ? undefined : []);
  });
  const data = { cards: await read("cards"), txs: await read("txs"), receipts: await read("receipts"), meta: await read("meta", "main") };
  old.close();
  for (const s of ["cards", "txs", "receipts"]) for (const v of data[s]) await IDB.put(s, v);
  if (data.meta) await IDB.put("meta", data.meta, "main");
  await new Promise(res => { const d = indexedDB.deleteDatabase(OLD_DB_NAME); d.onsuccess = d.onerror = d.onblocked = res; });
  return data.cards.length > 0;
}
// Base completa (cartões e lançamentos, inclusive marcas de apagado). Fora de `S`: a tela só vê os visíveis.
export const Base = { cards: [], txs: [] };
const aparelho = () => (S.meta && S.meta.sync && S.meta.sync.aparelho) || "";
// Refaz o que a tela vê a partir da base. O saldo é derivado (saldoBase + lançamentos) e vai no próprio objeto do cartão.
function refazer() {
  const v = Sync.visiveis(Base);
  for (const c of v.cards) c.balance = Sync.saldo(c, v.txs);
  S.cards = v.cards; S.txs = v.txs;
}
function guardar(k, obj) {
  const i = Base[k].findIndex(x => x.id === obj.id);
  if (i >= 0) Base[k][i] = obj; else Base[k].push(obj);
}
function idAleatorio() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, x => "0123456789abcdefghijklmnopqrstuvwxyz"[x % 36]).slice(0, 12).join("");
}
export const Store = {
  // Ao abrir (e ao restaurar backup): migra dados antigos, limpa marcas velhas e monta o que a tela vê.
  async carregar({ cards, txs }) {
    if (!(S.meta && S.meta.sync && S.meta.sync.aparelho)) await Store.setMeta({ ...S.meta, sync: { ...(S.meta && S.meta.sync), aparelho: idAleatorio() } });
    const m = Sync.migrar({ cards, txs });
    for (const { loja, registro } of m.mudados) await IDB.put(loja, registro);
    const agora = Date.now();
    const lc = Sync.limparMarcas(m.cards, agora), lt = Sync.limparMarcas(m.txs, agora);
    for (const id of lc.removidos) await IDB.del("cards", id);
    for (const id of lt.removidos) await IDB.del("txs", id);
    Base.cards = lc.lista; Base.txs = lt.lista;
    refazer();
  },
  aoMudar: null, // etapa 2: chamada com (loja, registro) depois de cada gravação em cards/txs
  async put(k, obj) {
    let novo = obj;
    if (k === "cards" || k === "txs") {
      const antes = Base[k].find(x => x.id === obj.id);
      novo = Sync.carimbar(obj, antes, aparelho(), Date.now());
      if (k === "cards" && novo.saldoBase === undefined) novo.saldoBase = 0;
    }
    await IDB.put(k, novo);
    if (k === "cards" || k === "txs") { guardar(k, novo); refazer(); if (Store.aoMudar) Store.aoMudar(k, novo); }
    else upsert(k, novo);
  },
  async patch(k, id, part) {
    const cur = Base[k].find(x => x.id === id && !x.apagado);
    if (!cur) throw new Error("registro não encontrado");
    await Store.put(k, { ...cur, ...part });
  },
  async remove(k, id) {
    const antes = Base[k].find(x => x.id === id);
    const marca = Sync.marcaApagado(antes || { id }, aparelho(), Date.now());
    await IDB.put(k, marca);
    guardar(k, marca); refazer();
    if (Store.aoMudar) Store.aoMudar(k, marca);
  },
  async setMeta(m) { await IDB.put("meta", m, "main"); S.meta = m; },
};
function upsert(k, obj) {
  const i = S[k].findIndex(x => x.id === obj.id);
  if (i >= 0) S[k][i] = obj; else S[k].push(obj);
}

export async function askPersist() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
}
