// Planilha do Ciclo no Google Planilhas (Google Apps Script).
//
// COMO LIGAR (uma vez só, no computador):
//  1. No Ciclo, abra Ajustes > Sincronizar com a Planilha e toque em "Copiar código".
//  2. Em https://sheets.google.com crie uma planilha nova (pode chamar de "Ciclo").
//  3. Na planilha, abra Extensões > Apps Script. Apague o que estiver no editor e cole este arquivo inteiro.
//  4. Na linha "const SEGREDO_LOCAL" logo abaixo, troque o texto pelo código copiado.
//     Essa troca fica só no seu editor: NÃO coloque o código real neste arquivo do repositório.
//  5. No topo, escolha a função "configurar" e toque em "Executar". Autorize quando o Google pedir.
//     (Depois disso pode apagar o código da linha do passo 4: ele já ficou guardado no script.)
//  6. Toque em "Implantar" > "Nova implantação" > tipo "App da Web".
//     Executar como: "Eu". Quem pode acessar: "Qualquer pessoa". Toque em "Implantar" e copie o link.
//  7. Cole o link no Ciclo, em Ajustes > Sincronizar com a Planilha, e toque em "Testar conexão".
//  Quando este arquivo mudar numa versão nova do Ciclo: cole de novo e use
//  "Implantar" > "Gerenciar implantações" > lápis > "Nova versão" > "Implantar". Sem isso o app fala com a versão velha.
//
// A planilha é só para CONSULTA. Editar linhas à mão não é suportado e o app pode sobrescrever.
// O script nunca apaga linhas: o que você apaga no Ciclo fica marcado como "sim" na coluna Apagado.
// Do cofre só chegam textos cifrados; a senha mestra nunca sai do celular.
//
// SEGURANÇA: quem tiver o link E o código consegue ler e gravar nesta planilha. Não compartilhe os dois.
// O script só mexe nesta planilha (a que está vinculada a ele).

const SEGREDO_LOCAL = "COLE-AQUI-O-CODIGO";
const MAX_LOTE = 500;
const MAX_BYTES = 5 * 1024 * 1024;
const ESPERA_TRAVA_MS = 20000;
const AVISO_ABA = "Só para consulta: o Ciclo escreve aqui sozinho. Editar à mão não é suportado e pode ser sobrescrito. Linhas nunca são apagadas; o que foi apagado no app aparece como \"sim\" em Apagado.";

// Cada aba: cabeçalho, onde ficam as colunas técnicas (0 = primeira coluna) e como montar a linha de um registro.
// As colunas técnicas (id, mudou, por, marca, dados...) são usadas pelo app para sincronizar: não mexa nelas.
const ABAS = {
  cards: {
    nome: "Cartões",
    cab: ["Nome", "Titular", "Emissor", "Tipo", "Final", "Saldo (R$)", "Última mudança", "Apagado", "id", "mudou", "por", "marca", "saldoBase", "dados"],
    i: { apagado: 7, id: 8, mudou: 9, por: 10, marca: 11, dados: 13 },
    linha(e, d) {
      const v = !e.apagado;
      return [v ? d.name || "" : "", v ? d.holder || "" : "", v ? d.issuer || "" : "", v ? d.type || "" : "", v ? d.last4 || "" : "", "",
        new Date(e.mudou), e.apagado ? "sim" : "", e.id, e.mudou, e.por || "", 0, v ? d.saldoBase || 0 : 0, JSON.stringify(d)];
    },
  },
  txs: {
    nome: "Lançamentos",
    cab: ["Data", "Cartão", "Descrição", "Tipo", "Valor (R$)", "Categoria", "Última mudança", "Apagado", "id", "mudou", "por", "marca", "cardId", "centavos", "dados"],
    i: { apagado: 7, id: 8, mudou: 9, por: 10, marca: 11, dados: 14 },
    linha(e, d) {
      const v = !e.apagado;
      const delta = v ? (d.kind === "debit" ? -d.amount : d.amount) || 0 : 0;
      return [v ? d.date || "" : "", "", v ? d.desc || "" : "", v ? (d.kind === "debit" ? "Gasto" : "Crédito") : "", v ? (d.amount || 0) / 100 : "", v ? d.cat || "" : "",
        new Date(e.mudou), e.apagado ? "sim" : "", e.id, e.mudou, e.por || "", 0, v ? d.cardId || "" : "", delta, JSON.stringify(d)];
    },
  },
  meta: {
    nome: "Cofre",
    cab: ["Última mudança", "Apagado", "id", "mudou", "por", "marca", "dados"],
    i: { apagado: 1, id: 2, mudou: 3, por: 4, marca: 5, dados: 6 },
    linha(e, d) { return [new Date(e.mudou), e.apagado ? "sim" : "", e.id, e.mudou, e.por || "", 0, JSON.stringify(d)]; },
  },
};

// Roda uma vez, à mão, para guardar o código nas Propriedades do script.
function configurar() {
  if (!SEGREDO_LOCAL || SEGREDO_LOCAL === "COLE-AQUI-O-CODIGO" || SEGREDO_LOCAL.length < 16) {
    throw new Error("Troque o texto de SEGREDO_LOCAL pelo código copiado do Ciclo.");
  }
  PropertiesService.getScriptProperties().setProperty("SEGREDO", SEGREDO_LOCAL);
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// JSON com as chaves em ordem (igual ao Sync.canonico do app), para desempatar igual nos dois lados.
function canonico_(v) {
  if (Array.isArray(v)) return "[" + v.map(canonico_).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + canonico_(v[k]); }).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Mesma regra do Sync.vence do app: maior "mudou"; empate, maior "por"; empate, maior JSON. Verdadeiro se `novo` deve substituir `atual`.
// (idênticos não substituem: não há o que gravar.)
function vence_(novo, atual) {
  if (novo.mudou !== atual.mudou) return novo.mudou > atual.mudou;
  const pn = novo.por || "", pa = atual.por || "";
  if (pn !== pa) return pn > pa;
  return canonico_(novo.dados) > canonico_(atual.dados);
}

function letra_(n) { return String.fromCharCode(65 + n); }

function aba_(loja) {
  const def = ABAS[loja];
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName(def.nome);
  if (!aba) {
    aba = planilha.insertSheet(def.nome);
    aba.getRange(1, 1, 1, def.cab.length).setValues([def.cab]);
    aba.getRange(1, 1, 1, 1).setNote(AVISO_ABA);
    aba.setFrozenRows(1);
    // O id vai como texto, para a planilha não "adivinhar" número ou data.
    const l = letra_(def.i.id);
    aba.getRange(l + ":" + l).setNumberFormat("@");
  }
  return aba;
}

// Lê a aba inteira (sem o cabeçalho). Cada item: linha (1 = cabeçalho), valores.
function ler_(loja) {
  const def = ABAS[loja], aba = aba_(loja);
  const ultima = aba.getLastRow();
  if (ultima < 2) return { aba: aba, linhas: [] };
  const valores = aba.getRange(2, 1, ultima - 1, def.cab.length).getValues();
  return { aba: aba, linhas: valores };
}

function proximaMarca_(props) {
  const n = (Number(props.getProperty("MARCA")) || 0) + 1;
  props.setProperty("MARCA", String(n));
  return n;
}

function marcaAtual_() { return Number(PropertiesService.getScriptProperties().getProperty("MARCA")) || 0; }

function valido_(r) {
  return r && typeof r === "object" && ABAS[r.loja] && typeof r.id === "string" && r.id && typeof r.mudou === "number" && isFinite(r.mudou)
    && (r.por === undefined || typeof r.por === "string") && typeof r.apagado === "boolean"
    && r.dados && typeof r.dados === "object" && !Array.isArray(r.dados) && r.dados.id === r.id;
}

// Recalcula o que a planilha mostra e que depende de outras linhas: saldo de cada cartão e nome do cartão em cada lançamento.
function refazerDerivados_() {
  const cards = ler_("cards"), txs = ler_("txs");
  const ic = ABAS.cards.i, it = ABAS.txs.i;
  const soma = {}, nomes = {};
  for (const r of txs.linhas) if (r[it.apagado] !== "sim") soma[r[12]] = (soma[r[12]] || 0) + (Number(r[13]) || 0);
  for (const r of cards.linhas) nomes[String(r[ic.id])] = r[0];
  if (cards.linhas.length) {
    const col = cards.linhas.map(function (r) { return [r[ic.apagado] === "sim" ? "" : ((Number(r[12]) || 0) + (soma[String(r[ic.id])] || 0)) / 100]; });
    cards.aba.getRange(2, 6, col.length, 1).setValues(col);
  }
  if (txs.linhas.length) {
    const col = txs.linhas.map(function (r) { return [r[it.apagado] === "sim" ? "" : (nomes[String(r[12])] || "")]; });
    txs.aba.getRange(2, 2, col.length, 1).setValues(col);
  }
}

function enviar_(corpo) {
  const props = PropertiesService.getScriptProperties();
  if (typeof corpo.aparelho !== "string" || !Array.isArray(corpo.registros)) return { ok: false, erro: "formato" };
  if (corpo.registros.length > MAX_LOTE) return { ok: false, erro: "tamanho" };
  for (const r of corpo.registros) if (!valido_(r)) return { ok: false, erro: "formato" };

  const lidas = {}, achados = {}, novas = {}, mudadas = {};
  for (const loja of Object.keys(ABAS)) {
    if (!corpo.registros.some(function (r) { return r.loja === loja; })) continue;
    const def = ABAS[loja], dado = ler_(loja);
    lidas[loja] = dado; achados[loja] = {}; novas[loja] = []; mudadas[loja] = {};
    dado.linhas.forEach(function (v, k) {
      achados[loja][String(v[def.i.id])] = { mudou: Number(v[def.i.mudou]), por: v[def.i.por] || "", linha: v, onde: "velho", pos: k };
    });
  }
  let aceitos = 0, ignorados = 0, derivados = false;
  for (const r of corpo.registros) {
    const def = ABAS[r.loja], mapa = achados[r.loja];
    const atual = mapa[r.id];
    if (atual) {
      // Só olha o JSON guardado quando "mudou" e "por" empatam.
      let dadosAtuais = null;
      if (atual.mudou === r.mudou && atual.por === (r.por || "")) { try { dadosAtuais = JSON.parse(atual.linha[def.i.dados]); } catch (e) { dadosAtuais = {}; } }
      if (!vence_(r, { mudou: atual.mudou, por: atual.por, dados: dadosAtuais })) { ignorados++; continue; }
    }
    const linha = def.linha(r, r.dados);
    linha[def.i.marca] = proximaMarca_(props);
    aceitos++;
    if (r.loja !== "meta") derivados = true;
    if (atual) {
      atual.mudou = r.mudou; atual.por = r.por || ""; atual.linha = linha;
      if (atual.onde === "velho") mudadas[r.loja][atual.pos] = linha; else novas[r.loja][atual.pos] = linha;
    } else {
      mapa[r.id] = { mudou: r.mudou, por: r.por || "", linha: linha, onde: "novo", pos: novas[r.loja].length };
      novas[r.loja].push(linha);
    }
  }
  for (const loja of Object.keys(lidas)) {
    const def = ABAS[loja], aba = lidas[loja].aba, existentes = lidas[loja].linhas.length;
    for (const k of Object.keys(mudadas[loja])) aba.getRange(2 + Number(k), 1, 1, def.cab.length).setValues([mudadas[loja][k]]);
    if (novas[loja].length) aba.getRange(2 + existentes, 1, novas[loja].length, def.cab.length).setValues(novas[loja]);
  }
  if (derivados) refazerDerivados_();
  return { ok: true, aceitos: aceitos, ignorados: ignorados, marca: marcaAtual_(), hora: Date.now() };
}

function buscar_(corpo) {
  const desde = Number(corpo.desde) || 0;
  const limite = Math.max(1, Math.min(MAX_LOTE, Number(corpo.limite) || MAX_LOTE));
  const achados = [];
  for (const loja of Object.keys(ABAS)) {
    const i = ABAS[loja].i;
    for (const v of ler_(loja).linhas) {
      const marca = Number(v[i.marca]);
      if (marca > desde) {
        let dados;
        try { dados = JSON.parse(v[i.dados]); } catch (e) { continue; }
        achados.push({ loja: loja, id: String(v[i.id]), mudou: Number(v[i.mudou]), por: v[i.por] || "", apagado: v[i.apagado] === "sim", dados: dados, marca: marca });
      }
    }
  }
  achados.sort(function (a, b) { return a.marca - b.marca; });
  const mais = achados.length > limite;
  const registros = achados.slice(0, limite);
  const marca = mais ? registros[registros.length - 1].marca : Math.max(desde, marcaAtual_());
  return { ok: true, registros: registros, marca: marca, mais: mais, hora: Date.now() };
}

function estado_() {
  const conta = function (loja) {
    const i = ABAS[loja].i;
    return ler_(loja).linhas.filter(function (v) { return v[i.apagado] !== "sim"; }).length;
  };
  return { ok: true, cartoes: conta("cards"), lancamentos: conta("txs"), marca: marcaAtual_(), hora: Date.now() };
}

function doPost(e) {
  let trava = null;
  try {
    const bruto = e && e.postData && e.postData.contents;
    let corpo;
    try { corpo = JSON.parse(bruto); } catch (err) { return responder_({ ok: false, erro: "formato" }); }
    if (!corpo || typeof corpo !== "object") return responder_({ ok: false, erro: "formato" });
    const segredo = PropertiesService.getScriptProperties().getProperty("SEGREDO");
    if (!segredo || corpo.segredo !== segredo) return responder_({ ok: false, erro: "segredo" });
    if (corpo.acao !== "enviar" && corpo.acao !== "buscar" && corpo.acao !== "estado") return responder_({ ok: false, erro: "formato" });
    if (String(bruto).length > MAX_BYTES) return responder_({ ok: false, erro: "tamanho" });

    // Uma chamada por vez, para dois celulares não se atropelarem.
    trava = LockService.getScriptLock();
    if (!trava.tryLock(ESPERA_TRAVA_MS)) { trava = null; return responder_({ ok: false, erro: "ocupado" }); }
    if (corpo.acao === "enviar") return responder_(enviar_(corpo));
    if (corpo.acao === "buscar") return responder_(buscar_(corpo));
    return responder_(estado_());
  } catch (err) {
    return responder_({ ok: false, erro: "inesperado" });
  } finally {
    if (trava) { try { trava.releaseLock(); } catch (err2) {} }
  }
}
