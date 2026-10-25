// Leitura de cupom com o Gemini (opcional). A foto vai para a API do Google; a resposta vem num formato fixo (JSON)
// e é convertida para o mesmo formato do leitor no celular (receipt.js), usado pela tela de conferência.
(() => {
  "use strict";

  const API = "https://generativelanguage.googleapis.com/v1beta";
  const DEFAULT_MODEL = "gemini-flash-latest";
  // Quando o modelo escolhido está sobrecarregado, sem cota ou não existe, tenta estes, nesta ordem.
  // Cada modelo tem a sua própria cota e capacidade no Google.
  // O gemini-2.5-flash saiu da lista em 22/10/2026: a API passou a responder 404 para ele.
  const FALLBACK_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
  // Modelos que responderam 404 (não existem mais) nesta sessão: não são tentados de novo.
  const gone = new Set();
  // Tempo máximo de espera pelo Gemini, somando todas as tentativas. Depois disso o app usa o leitor do celular.
  const BUDGET_MS = 30000;
  const CATS = ["Mercado", "Restaurante", "Padaria", "Delivery", "Lanche", "Feira", "Outros"];

  // Formato da resposta pedido ao Gemini (subconjunto do OpenAPI aceito pela API)
  const SCHEMA = {
    type: "OBJECT",
    properties: {
      legivel: { type: "BOOLEAN", description: "false se a foto não for um comprovante de compra ou estiver ilegível" },
      estabelecimento: { type: "STRING", nullable: true },
      cnpj: { type: "STRING", nullable: true, description: "CNPJ do emitente, só dígitos" },
      data: { type: "STRING", nullable: true, description: "data da compra no formato AAAA-MM-DD" },
      valor_total: { type: "NUMBER", nullable: true, description: "valor total a pagar da nota, em reais" },
      pagamentos: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            forma: { type: "STRING", enum: ["vale", "credito", "debito", "pix", "dinheiro", "outro"] },
            valor: { type: "NUMBER", description: "valor pago desta forma, em reais" },
            emissor: { type: "STRING", nullable: true, description: "VR, Alelo, Pluxee, Sodexo, Ticket, Flash, Caju, iFood, Swile, Ben, Volus, Valecard, Up Brasil, Verocard, Greencard, Nutricash, GoodCard ou outro" },
            titular: { type: "STRING", nullable: true, description: "nome do titular do cartão de benefício impresso no comprovante, se houver" },
            texto_cartao: { type: "STRING", nullable: true, description: "linha do comprovante que identifica o cartão ou a rede, copiada como está (ex.: VR BENEFICIOS VOUCHER A VISTA, ALELO REFEICAO)" },
            tipo_cartao: { type: "STRING", enum: ["alimentacao", "refeicao", "flex", "desconhecido"] },
            cartao_impresso: { type: "STRING", nullable: true, description: "número do cartão exatamente como impresso no comprovante, com a máscara (ex.: 608812******4821)" },
            final_cartao: { type: "STRING", nullable: true, description: "4 ÚLTIMOS dígitos do cartão (os que vêm depois da máscara), se impressos" },
            saldo: { type: "NUMBER", nullable: true, description: "saldo do cartão de benefício impresso no comprovante, em reais" },
            saldo_momento: { type: "STRING", enum: ["apos_compra", "antes_compra", "desconhecido"] },
          },
          required: ["forma", "valor"],
        },
      },
      categoria: { type: "STRING", enum: CATS },
      observacoes: { type: "STRING", nullable: true },
    },
    required: ["legivel", "pagamentos"],
  };

  const PROMPT = `Você está lendo a foto de um comprovante de compra brasileiro: NFC-e, cupom fiscal, comprovante da maquininha (TEF) e/ou relatório de saldo do cartão impresso junto. A foto pode ter mais de um papel.
Extraia os dados no formato pedido. Regras:
- Valores em reais como número decimal (ex.: 87.43). Use null quando a informação não aparecer. Não invente.
- "pagamentos": uma linha para cada forma de pagamento usada na compra (seção "FORMA DE PAGAMENTO" da NFC-e e/ou comprovantes da maquininha). Não repita a mesma parte só porque aparece na NFC-e e no comprovante.
- forma "vale" para cartões de benefício: vale-alimentação, vale-refeição, voucher, multibenefício (VR, Alelo, Pluxee/Sodexo, Ticket, Flash, Caju, iFood Benefícios, Swile, Ben etc.). "credito"/"debito" só para cartões bancários comuns. A maquininha às vezes imprime "COMPRA CREDITO" ou "DEBITO" mesmo para cartão de benefício: preencha sempre "cartao_impresso"/"final_cartao" de cada pagamento, para o app conferir o cartão.
- "saldo": saldo disponível do cartão de benefício impresso no comprovante daquele pagamento (SALDO, SALDO DISPONIVEL, SALDO ATUAL). Nunca confunda com troco, total, desconto ou valor pago. "saldo_momento": "apos_compra" se o saldo já desconta esta compra (o normal), "antes_compra" se o comprovante diz que é o saldo anterior.
- "emissor": a rede ou administradora do cartão de benefício, que costuma aparecer no comprovante da maquininha (ex.: "VR BENEFICIOS" → VR, "PLUXEE" → Pluxee, "ALELO REFEICAO" → Alelo). Não confunda com a adquirente da maquininha (Cielo, Rede, Stone, GetNet, PagSeguro, SiTef) nem com a bandeira de crédito. "texto_cartao": copie a linha onde o emissor aparece.
- "tipo_cartao": alimentacao, refeicao ou flex (multibenefício) só se o comprovante disser; senão "desconhecido".
- "titular": nome da pessoa dona do cartão, se o comprovante imprimir (PORTADOR, TITULAR, NOME). Nunca use o nome do operador de caixa, da loja ou do "CONSUMIDOR".
- "cartao_impresso": copie o número do cartão como está no comprovante, com os asteriscos ou X da máscara.
- "final_cartao": só os 4 ÚLTIMOS dígitos, os que aparecem DEPOIS da máscara (em 608812******4821, o final é 4821). Os primeiros dígitos identificam a rede do cartão e nunca são o final. Se o final não estiver impresso, use null.
- "categoria": a que melhor descreve a loja.`;

  async function call(key, model, body, signal, ms) {
    // Prazo da tentativa, sem perder o "cancelar" de quem chamou.
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
    const stop = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", stop, { once: true }); }
    try {
      const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.json()).error.message || ""; } catch (e) {}
        const err = new Error(msg || "HTTP " + res.status);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      if (timedOut) { const err = new Error("tempo esgotado"); err.name = "TimeoutError"; err.status = 0; throw err; }
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", stop);
    }
  }

  // Ler um cupom não precisa de "raciocínio": quanto menos o modelo pensa, mais rápido responde.
  // O Gemini 2.5 usa thinkingBudget (0 desliga). Os modelos mais novos usam thinkingLevel: os Flash aceitam
  // "minimal"; os Pro, no mínimo "low". Se o modelo recusar um nível, o app tenta o próximo da lista.
  const LEVELS = ["minimal", "low", null];
  const levelOf = {}; // modelo → índice em LEVELS que ele aceitou (ou o próximo a tentar)
  function thinkingFor(model) {
    if (/gemini-2\.5-flash/.test(model)) return levelOf[model] ? null : { thinkingBudget: 0 };
    if (/gemini-[12]\./.test(model)) return null;
    const i = levelOf[model] ?? (/pro/.test(model) ? 1 : 0);
    return LEVELS[i] ? { thinkingLevel: LEVELS[i] } : null;
  }
  const nextThinking = model => { levelOf[model] = /gemini-2\.5-flash/.test(model) ? LEVELS.length - 1 : (levelOf[model] ?? (/pro/.test(model) ? 1 : 0)) + 1; };

  // Se o modelo escolhido não responder em HEDGE_MS, o próximo da reserva começa em paralelo e vale a primeira
  // resposta que chegar. Erro de sobrecarga, cota ou modelo inexistente passa logo para o próximo.
  const HEDGE_MS = 12000;

  // Uma tentativa num modelo, repetindo com menos exigência de raciocínio se ele recusar a configuração.
  async function attempt(key, model, parts, schema, signal, deadline) {
    for (;;) {
      const generationConfig = { temperature: 0, responseMimeType: "application/json", responseSchema: schema };
      const th = thinkingFor(model);
      if (th) generationConfig.thinkingConfig = th;
      const body = { contents: [{ role: "user", parts }], generationConfig };
      let out;
      try { out = await call(key, model, body, signal, Math.max(1000, deadline - Date.now())); }
      catch (e) {
        if (e.status === 400 && th && /think/i.test(e.message)) { nextThinking(model); continue; }
        throw e;
      }
      const text = (((out.candidates || [])[0] || {}).content || {}).parts?.map(p => p.thought ? "" : p.text || "").join("") || "";
      try { return JSON.parse(text); } catch (e) { const err = new Error("resposta fora do formato"); err.status = 0; err.raw = text; throw err; }
    }
  }

  // Tenta o modelo escolhido e os de reserva (ver HEDGE_MS), sem passar de BUDGET_MS no total.
  // Cada tentativa fica registrada (modelo, resultado, tempo) para a tela de conferência.
  function generate(cfg, parts, schema, signal, onProgress) {
    const first = cfg.model || DEFAULT_MODEL;
    let models = [first, ...FALLBACK_MODELS.filter(m => m !== first)].filter(m => !gone.has(m));
    if (!models.length) models = [first];
    const t0 = Date.now(), deadline = t0 + BUDGET_MS;
    const attempts = [];
    const ctl = new AbortController(); // cancela as tentativas que ficaram para trás
    const stopAll = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", stopAll, { once: true }); }

    return new Promise((resolve, reject) => {
      let next = 0, running = 0, done = false, lastErr = null, hedge = null;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(hedge);
        ctl.abort();
        if (signal) signal.removeEventListener("abort", stopAll);
        // tentativas ainda em andamento entram no registro como canceladas
        attempts.forEach(a => { if (a.ok === undefined) Object.assign(a, { ok: false, status: "cancelado", ms: Date.now() - a.t }); delete a.t; });
        logUse(attempts);
        fn(v);
      };
      const giveUp = e => { e.attempts = attempts; finish(reject, e); };
      const launch = () => {
        if (done) return;
        clearTimeout(hedge);
        if (next >= models.length || deadline - Date.now() < 3000) {
          if (!running) giveUp(lastErr || Object.assign(new Error("tempo esgotado"), { name: "TimeoutError", status: 0 }));
          return;
        }
        const model = models[next++];
        const prev = attempts[attempts.length - 1] || null;
        const rec = { model, t: Date.now() };
        attempts.push(rec);
        // avisa a tela: modelo da tentativa e, se houver, o que aconteceu com a anterior
        if (onProgress) try { onProgress({ model, prev: prev && { model: prev.model, running: prev.ok === undefined, status: prev.status } }); } catch (e) {}
        running++;
        if (next < models.length) hedge = setTimeout(launch, HEDGE_MS);
        attempt(cfg.key, model, parts, schema, ctl.signal, deadline).then(json => {
          running--;
          Object.assign(rec, { ok: true, ms: Date.now() - rec.t });
          finish(resolve, { json, model, attempts });
        }, e => {
          running--;
          if (done) return;
          lastErr = e;
          Object.assign(rec, { ok: false, status: e.name === "TimeoutError" ? "tempo esgotado" : e.status || e.name || "erro", msg: String(e.message || "").slice(0, 160), ms: Date.now() - rec.t });
          console.warn("gemini", model, e.status, e.message);
          if (e.name === "AbortError") return giveUp(e);
          const st = e.status;
          // Outro modelo ajuda quando o problema é deste: inexistente, sem cota, sobrecarregado ou resposta estranha.
          // Chave recusada ou foto recusada: não adianta insistir.
          if (st === 404) gone.add(model);
          if (st === 404 || st === 429 || st >= 500 || st === 0) launch();
          else giveUp(e);
        });
      };
      launch();
    });
  }

  // Resultado de uma tentativa em poucas palavras, para a tela de leitura
  const shortStatus = st => st === 429 ? "sem cota agora" : st === 404 ? "não encontrado" : st === 503 ? "sobrecarregado" : st >= 500 ? `erro ${st} no Google` : st === "tempo esgotado" ? "não respondeu a tempo" : st === "cancelado" ? "cancelado" : `erro ${st}`;

  // "gemini-flash-latest: 503 (2,1 s) · gemini-2.5-flash: ok (6,4 s)"
  const describe = attempts => (attempts || []).map(a => `${a.model}: ${a.ok ? "ok" : a.status} (${(a.ms / 1000).toFixed(1).replace(".", ",")} s)`).join(" · ");

  // Explica o erro em português, para a tela de conferência e para o teste da chave.
  function explain(e) {
    if (e && e.name === "TimeoutError") return "O Gemini demorou demais para responder.";
    if (e && e.name === "AbortError") return "A leitura foi interrompida.";
    if (!navigator.onLine) return "Sem internet.";
    const s = e && e.status;
    if (s === 400 && /API key|api_key|key not valid/i.test(e.message)) return "A chave de API não é válida.";
    if (s === 400) return "O Gemini não aceitou a foto.";
    if (s === 401 || s === 403) return "A chave de API foi recusada (confira a chave e as restrições dela no Google).";
    if (s === 404) return "O modelo do Gemini não foi encontrado.";
    if (s === 429) return "Limite de uso do Gemini atingido por agora. Tente mais tarde.";
    if (s === 503) return "O Gemini está sobrecarregado agora (erro 503 do Google). Costuma passar em alguns minutos.";
    if (s >= 500) return `O Gemini teve um erro no Google (${s}).`;
    return "Não foi possível falar com o Gemini.";
  }

  const toB64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const cents = v => typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  // "CARLA DE SOUZA" → "Carla de Souza"
  const nameCase = s => s.toLowerCase().replace(/(^|\s)\p{L}/gu, m => m.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, m => m.toLowerCase());
  // Emissores vêm de issuers.js: primeiro pelo nome escrito, depois como texto impresso ("VOLUS ALIMENTACAO")
  const issuerOf = s => s ? Issuers.fromName(s) || Issuers.fromPrint(String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()) : null;
  // Emissor fora da lista do app: guarda o nome lido, para usar no nome do cartão novo
  const rawIssuer = s => { const t = String(s || "").trim(); return t && !/^(outro|null|desconhecido)$/i.test(t) && !issuerOf(t) ? t.slice(0, 24) : null; };
  // Nome do titular: só letras, de 2 a 40 caracteres
  const holderOf = s => { const t = String(s || "").replace(/\s+/g, " ").trim(); return /^[\p{L} .'-]{2,40}$/u.test(t) && !/consumidor|operador|caixa/i.test(t) ? nameCase(t) : null; };
  // Final do cartão: os 4 dígitos depois da máscara do número impresso ("608812******4821" → 4821).
  // O "final" informado pelo Gemini só vale se não for o começo do número (os dígitos da rede do cartão).
  function last4Of(printed, final) {
    const p = String(printed || "").replace(/\s/g, "");
    const masked = /[*Xx•]/.test(p) ? p.match(/[*Xx•](\d{4})$/) : null;
    if (masked) return masked[1];
    const f = String(final || "").replace(/\D/g, "");
    if (!/^\d{4}$/.test(f)) return null;
    const lead = p.match(/^\d{4,}/);
    if (lead && lead[0].startsWith(f) && !p.endsWith(f)) return null;
    return f;
  }

  // Converte a resposta do Gemini para o formato de ReceiptReader.parse()
  function toParsed(j) {
    const pays = (Array.isArray(j.pagamentos) ? j.pagamentos : [])
      .map(p => ({ kind: ["vale", "credito", "debito", "pix", "dinheiro", "outro"].includes(p.forma) ? p.forma : "outro", amount: cents(p.valor), issuer: issuerOf(p.emissor) || issuerOf(p.texto_cartao), issuerRaw: rawIssuer(p.emissor), holder: holderOf(p.titular), type: ["alimentacao", "refeicao", "flex"].includes(p.tipo_cartao) ? p.tipo_cartao : null, last4: last4Of(p.cartao_impresso, p.final_cartao), saldo: cents(p.saldo), moment: p.saldo_momento }))
      .filter(p => p.amount > 0);
    const vales = pays.filter(p => p.kind === "vale");
    // saldos impressos sempre como "depois da compra"
    const balances = vales.filter(p => p.saldo !== null).map(p => p.moment === "antes_compra" ? p.saldo - p.amount : p.saldo);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(j.data || "") ? j.data : null;
    const cnpj = String(j.cnpj || "").replace(/\D/g, "");
    const res = {
      source: "gemini",
      store: j.estabelecimento ? String(j.estabelecimento).slice(0, 60) : null,
      cnpj: cnpj.length === 14 ? cnpj : null,
      date,
      total: cents(j.valor_total),
      paid: vales.length ? vales.reduce((s, p) => s + p.amount, 0) : null,
      payments: pays.map(p => ({ kind: p.kind, amount: p.amount, last4: p.last4 || null, issuer: p.issuer, holder: p.holder, type: p.type, saldo: p.saldo })),
      // pistas de cada vale, na mesma ordem dos pagamentos "vale"
      vales: vales.map(p => ({ amount: p.amount, issuer: p.issuer, issuerRaw: p.issuer ? null : p.issuerRaw, holder: p.holder, type: p.type, last4: p.last4, saldo: p.saldo === null ? null : p.moment === "antes_compra" ? p.saldo - p.amount : p.saldo })),
      balances,
      balance: balances.length === 1 ? balances[0] : null,
      balanceMoment: "apos_compra",
      issuer: vales.length === 1 ? vales[0].issuer : null,
      type: vales.length === 1 ? vales[0].type : null,
      issuerRaw: vales.length === 1 && !vales[0].issuer ? vales[0].issuerRaw : null,
      holder: vales.length === 1 ? vales[0].holder : null,
      last4: vales.length === 1 ? vales[0].last4 : null,
      last4s: vales.map(p => p.last4).filter(Boolean),
      category: CATS.includes(j.categoria) ? j.categoria : null,
      legible: j.legivel !== false,
      notes: j.observacoes || null,
      found: [],
    };
    if (res.date) res.found.push("data");
    if (res.paid !== null || res.total !== null) res.found.push("valor");
    if (balances.length) res.found.push("saldo");
    if (vales.some(p => p.issuer)) res.found.push("emissor");
    if (res.last4s.length) res.found.push("final do cartão");
    if (vales.some(p => p.holder)) res.found.push("titular");
    if (pays.some(p => p.kind !== "vale")) res.found.push("outras formas de pagamento");
    return res;
  }

  // Lê o cupom. cfg = { key, model }. Devolve { parsed, raw, model }.
  async function read(blob, cfg, signal, onProgress) {
    const data = await toB64(blob);
    const { json, model, attempts } = await generate(cfg, [{ text: PROMPT }, { inline_data: { mime_type: blob.type || "image/jpeg", data } }], SCHEMA, signal, onProgress);
    return { parsed: toParsed(json), raw: JSON.stringify(json, null, 2), model, attempts };
  }

  // ---------- cadastro de cartão por foto ----------
  // Foto do cartão (frente) ou print do app do emissor. Nunca pede o número completo: só os 4 últimos dígitos.
  const CARD_SCHEMA = {
    type: "OBJECT",
    properties: {
      tipo_imagem: { type: "STRING", enum: ["cartao", "app", "outro"], description: "cartao = foto do cartão físico; app = print/foto da tela do app do emissor" },
      emissor: { type: "STRING", nullable: true, description: "VR, Alelo, Pluxee, Sodexo, Ticket, Flash, Caju, iFood, Swile, Ben, Volus, Valecard, Up Brasil, Verocard, Greencard, Nutricash, GoodCard ou outro" },
      tipo: { type: "STRING", enum: ["alimentacao", "refeicao", "flex", "outro"] },
      titular: { type: "STRING", nullable: true, description: "nome da pessoa impresso no cartão ou mostrado no app" },
      final_cartao: { type: "STRING", nullable: true, description: "SOMENTE os 4 últimos dígitos do número do cartão" },
      saldo: { type: "NUMBER", nullable: true, description: "saldo disponível mostrado (geralmente só em print do app), em reais" },
    },
    required: ["tipo_imagem", "tipo"],
  };
  const CARD_PROMPT = `A imagem é a foto de um cartão de benefício brasileiro (vale-alimentação, vale-refeição, multibenefício: VR, Alelo, Pluxee/Sodexo, Ticket, Flash, Caju, iFood Benefícios, Swile, Ben, Volus, Valecard, Up Brasil etc.) ou um print da tela do app do emissor.
Extraia os dados no formato pedido. Regras:
- NUNCA devolva o número completo do cartão nem o código de segurança. Em "final_cartao", só os 4 últimos dígitos.
- "tipo": alimentacao (vale-alimentação, mercado), refeicao (vale-refeição, restaurante), flex (multibenefício com carteiras) ou outro.
- "saldo": só se a imagem mostrar o saldo disponível. Valores em reais como número decimal. Use null quando não aparecer. Não invente.`;

  async function readCard(blob, cfg, signal, onProgress) {
    const data = await toB64(blob);
    const { json: j } = await generate(cfg, [{ text: CARD_PROMPT }, { inline_data: { mime_type: blob.type || "image/jpeg", data } }], CARD_SCHEMA, signal, onProgress);
    const last4 = String(j.final_cartao || "").replace(/\D/g, "").slice(-4);
    return {
      source: "gemini",
      kind: j.tipo_imagem || "outro",
      issuer: issuerOf(j.emissor),
      type: ["alimentacao", "refeicao", "flex", "outro"].includes(j.tipo) ? j.tipo : null,
      holder: j.titular ? nameCase(String(j.titular).trim().slice(0, 40)) : null,
      last4: last4.length === 4 ? last4 : null,
      balance: cents(j.saldo),
    };
  }

  // Modelos que a chave pode usar para ler fotos. Também confere se a chave funciona (não gasta cota de geração).
  // Fora da lista: modelos de voz, imagem, embeddings e experimentais de outros usos.
  async function listModels(key, signal) {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, signal });
    if (!res.ok) {
      let msg = ""; try { msg = (await res.json()).error.message || ""; } catch (e) {}
      const err = new Error(msg || "HTTP " + res.status); err.status = res.status; throw err;
    }
    const data = await res.json();
    const ids = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => String(m.name || "").replace(/^models\//, ""))
      .filter(id => /^gemini-/.test(id) && !/tts|image|embedding|live|audio|native|robotics|computer-use/.test(id));
    // os apelidos "latest" primeiro, depois os demais em ordem alfabética
    return [...new Set(ids)].sort((a, b) => (/latest$/.test(b) - /latest$/.test(a)) || a.localeCompare(b));
  }
  const test = listModels;

  // Uso do Gemini neste celular (fica só aqui, fora do backup): as últimas 100 tentativas
  const USE_KEY = "ciclo-gemini-uso";
  function logUse(attempts) {
    try {
      const log = JSON.parse(localStorage.getItem(USE_KEY) || "[]");
      for (const a of attempts) log.push({ t: Date.now(), m: a.model, ok: !!a.ok, st: a.ok ? null : a.status });
      localStorage.setItem(USE_KEY, JSON.stringify(log.slice(-100)));
    } catch (e) {}
  }
  // { last: { m, t } (último modelo que leu), reads30, quota30 } nos últimos 30 dias
  function usage() {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(USE_KEY) || "[]"); } catch (e) {}
    const since = Date.now() - 30 * 86400000;
    const recent = log.filter(x => x.t >= since);
    const oks = log.filter(x => x.ok);
    return { last: oks.length ? oks[oks.length - 1] : null, reads30: recent.filter(x => x.ok).length, quota30: recent.filter(x => x.st === 429).length };
  }

  window.GeminiReader = { read, readCard, test, listModels, usage, toParsed, explain, describe, shortStatus, DEFAULT_MODEL };
})();
