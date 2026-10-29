// Sincronização com a Planilha. Etapa 1: funções puras (sem rede e sem banco). Etapa 2: envelope, lotes, fila e chamada ao script.
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

  // ---------- etapa 2: enviar para a Planilha (contrato em specs/9-sincronizar-planilha.md) ----------
  const MAX_LOTE = 500;
  const MAX_BYTES_LOTE = 4 * 1024 * 1024;
  const ERROS = {
    segredo: "O código secreto não confere com o do script. Copie o código do app e rode “configurar” de novo no script.",
    tamanho: "O envio ficou grande demais para a Planilha. Tente de novo.",
    formato: "O script não entendeu o pedido. Confira se colou a versão mais nova do script e se reimplantou.",
    ocupado: "A Planilha está ocupada. Tente de novo em instantes.",
    inesperado: "O script da Planilha deu erro. Tente de novo em instantes.",
  };

  // Registro como viaja na rede. Sem `balance` (é derivado). `secret` já é texto cifrado; fotos (`receipts`) nunca entram.
  function envelope(loja, registro) {
    const dados = { ...registro };
    delete dados.balance;
    return { loja, id: registro.id, mudou: registro.updatedAt || 0, por: registro.updatedBy || "", apagado: !!registro.apagado, dados };
  }

  const achar = (base, loja, id) => ((base && base[loja]) || []).find(r => r.id === id);
  const partir = item => { const i = item.indexOf(":"); return [item.slice(0, i), item.slice(i + 1)]; };

  // Fila de "loja:id" -> lotes de envelopes (até `max` registros e ~4 MB), com a versão atual de cada id na base.
  // Ids que não existem mais na base são pulados.
  function montarLotes(fila, base, max = MAX_LOTE) {
    const lotes = [];
    let atual = [], bytes = 0;
    for (const item of new Set(fila || [])) {
      const [loja, id] = partir(item);
      if (!LOJAS.includes(loja)) continue;
      const r = achar(base, loja, id);
      if (!r) continue;
      const e = envelope(loja, r);
      const tam = JSON.stringify(e).length;
      if (atual.length && (atual.length >= max || bytes + tam > MAX_BYTES_LOTE)) { lotes.push(atual); atual = []; bytes = 0; }
      atual.push(e); bytes += tam;
    }
    if (atual.length) lotes.push(atual);
    return lotes;
  }

  // Depois de um envio ok: tira da fila o que foi enviado, mas só se o registro ainda está na versão enviada
  // (se mudou durante o envio, fica para o próximo). Itens cujo registro não existe mais também saem.
  function tirarDaFila(fila, enviados, base) {
    const mandado = new Map((enviados || []).map(e => [e.loja + ":" + e.id, e.mudou]));
    const vistos = new Set();
    return (fila || []).filter(item => {
      if (vistos.has(item)) return false;
      vistos.add(item);
      const [loja, id] = partir(item);
      const r = LOJAS.includes(loja) ? achar(base, loja, id) : null;
      if (!r) return false;
      return !(mandado.has(item) && mandado.get(item) === (r.updatedAt || 0));
    });
  }

  // Chama o script da Planilha. Devolve o JSON de sucesso; em qualquer falha lança Error com texto em português.
  async function chamar(config, corpo) {
    if (!config || !config.url || !config.secret) throw new Error("Falta o link da Planilha ou o código secreto.");
    let resp, json;
    try {
      // Sem cabeçalho Content-Type: vira text/plain e o navegador não faz a pré-verificação (CORS).
      resp = await fetch(config.url, { method: "POST", body: JSON.stringify({ ...corpo, segredo: config.secret }), redirect: "follow" });
    } catch (e) {
      throw new Error("Sem conexão com a Planilha. Confira a internet e o link do script.");
    }
    try { json = await resp.json(); }
    catch (e) { throw new Error("O link não respondeu como o script do Ciclo. Confira o link e se o acesso é “Qualquer pessoa”."); }
    if (!json || json.ok !== true) {
      const cod = json && json.erro;
      const err = new Error(ERROS[cod] || "A Planilha recusou o pedido.");
      err.codigo = cod || "inesperado";
      throw err;
    }
    return json;
  }

  const gerarSegredo = () => window.Drive.gerarSegredo();

  window.Sync = { carimbar, marcaApagado, vence, mesclar, visiveis, saldo, migrar, limparMarcas, canonico, envelope, montarLotes, tirarDaFila, chamar, gerarSegredo, MAX_LOTE };
})();
