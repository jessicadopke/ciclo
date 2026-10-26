// Guarda o app no celular para abrir sem internet.
// Ao publicar uma versão nova, mude VERSION para o celular baixar os arquivos atualizados.
const VERSION = "ciclo-1.14.1";
importScripts("js/credito.js");

const FILES = [
  "./",
  "index.html",
  "styles.css",
  "fonts/outfit-latin.woff2",
  "manifest.webmanifest",
  "js/app.js",
  "js/app/util.js",
  "js/app/estado.js",
  "js/app/cripto.js",
  "js/app/periodos.js",
  "js/app/armazenamento.js",
  "js/app/gemini-ui.js",
  "js/app/atualizacao.js",
  "js/app/pagamento.js",
  "js/app/folhas.js",
  "js/app/cofre.js",
  "js/app/cartoes.js",
  "js/app/cupom.js",
  "js/app/conferencia.js",
  "js/app/backup.js",
  "js/app/inicio.js",
  "js/app/telas.js",
  "js/issuers.js",
  "js/match.js",
  "js/recorte.js",
  "js/receipt.js",
  "js/gemini.js",
  "js/drive.js",
  "js/sync.js",
  "js/csv.js",
  "js/graficos.js",
  "js/credito.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "vendor/tesseract/tesseract.min.js",
  "vendor/tesseract/worker.min.js",
  "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/lang/por.traineddata.gz",
];

self.addEventListener("install", e => {
  // cache: "reload" ignora a cópia do navegador, para o conjunto novo vir inteiro e da mesma versão.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Tudo do app vem da cópia da VERSION atual, pré-carregada inteira no install: página, estilos e código nunca se misturam
// entre versões. A versão nova chega com o sw.js novo e vale na abertura seguinte. O que não está na lista (ex.: version.json) vem da internet.
// Se não estiver na cópia nem na internet, a resposta é erro explícito (e não "nada").
self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(
    caches.open(VERSION)
      .then(c => c.match(key, { ignoreSearch: true }))
      .then(r => r || fetch(req).catch(() => Response.error()))
      .catch(() => fetch(req).catch(() => Response.error()))
  );
});

// Aviso do dia do crédito (experimento): o Chrome decide quando roda, sem garantia.
// O app grava em meta.avisoCredito só datas e contagem; aqui só se lê, sem calcular nada nem mudar o banco.
function lerAgenda() {
  return new Promise((ok, falha) => {
    const abrir = indexedDB.open("ciclo");
    // banco ainda não existe: não cria nada, só desiste
    abrir.onupgradeneeded = () => { abrir.transaction.abort(); };
    abrir.onerror = () => falha(abrir.error);
    abrir.onsuccess = () => {
      const db = abrir.result;
      try {
        if (!db.objectStoreNames.contains("meta")) { db.close(); return ok(null); }
        const q = db.transaction("meta", "readonly").objectStore("meta").get("main");
        q.onsuccess = () => { db.close(); ok(q.result && q.result.avisoCredito || null); };
        q.onerror = () => { db.close(); falha(q.error); };
      } catch (e) { db.close(); falha(e); }
    };
  });
}
async function avisarCredito() {
  const a = await lerAgenda();
  if (!a || !a.ligado) return;
  const hoje = new Date();
  const texto = Credito.avisoDeHoje(a.datas, hoje);
  if (!texto) return;
  const tag = "ciclo-credito-" + hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0") + "-" + String(hoje.getDate()).padStart(2, "0");
  // a tag evita repetir: se já avisou hoje, não avisa de novo
  const jaAvisou = await self.registration.getNotifications({ tag });
  if (jaAvisou.length) return;
  await self.registration.showNotification("Ciclo", { body: texto, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
}
self.addEventListener("periodicsync", e => {
  if (e.tag !== "ciclo-credito") return;
  e.waitUntil(avisarCredito().catch(err => console.warn("aviso de crédito", err)));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(lista => {
    const aberta = lista.find(c => "focus" in c);
    return aberta ? aberta.focus() : self.clients.openWindow("./");
  }));
});
