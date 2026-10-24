// IndexedDB e gravação de dados.
import { S } from "./estado.js";

// ---------- armazenamento no aparelho (IndexedDB) ----------
const DB_NAME = "ciclo";
const OLD_DB_NAME = "carteira-vales"; // nome usado até a 1.4.0
export const IDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of ["cards", "txs", "receipts"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      r.onsuccess = () => {
        IDB.db = r.result;
        // Outra aba ou atualização precisa do banco: solta a conexão e recarrega, em vez de travar as duas.
        IDB.db.onversionchange = () => { IDB.db.close(); location.reload(); };
        res();
      };
      r.onerror = () => rej(r.error);
    });
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
  const list = await indexedDB.databases().catch(() => []);
  if (!list.some(d => d.name === OLD_DB_NAME)) return false;
  const [cards, meta] = await Promise.all([IDB.all("cards"), IDB.get("meta", "main")]);
  if (cards.length || meta) return false;
  const old = await new Promise((res, rej) => { const r = indexedDB.open(OLD_DB_NAME); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
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
export const Store = {
  async put(k, obj) { await IDB.put(k, obj); upsert(k, obj); },
  async patch(k, id, part) {
    const cur = S[k].find(x => x.id === id);
    if (!cur) throw new Error("registro não encontrado");
    const obj = { ...cur, ...part };
    await IDB.put(k, obj); upsert(k, obj);
  },
  async remove(k, id) { await IDB.del(k, id); S[k] = S[k].filter(x => x.id !== id); },
  async setMeta(m) { await IDB.put("meta", m, "main"); S.meta = m; },
};
function upsert(k, obj) {
  const i = S[k].findIndex(x => x.id === obj.id);
  if (i >= 0) S[k][i] = obj; else S[k].push(obj);
}

export async function askPersist() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
}
