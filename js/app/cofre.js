// Cofre de senhas: tranca, destranca e telas do cofre.
import { $, esc, toast } from "./util.js";
import { cardById, S, sortedCards } from "./estado.js";
import { b64, deriveKey, hasCrypto, seal, unseal } from "./cripto.js";
import { Store } from "./armazenamento.js";
import { closeSheet, openSheet } from "./folhas.js";
import { render, run } from "./telas.js";

const LOCK_MS = 5 * 60 * 1000;

// ---------- cofre ----------
export function touchVault() {
  if (!S.key) return;
  clearTimeout(S.lockTimer);
  S.lockTimer = setTimeout(() => lockVault("O cofre foi trancado por inatividade."), LOCK_MS);
}
export function lockVault(msg) {
  if (!S.key) return;
  S.key = null; S.plain = {}; S.plainSig = {}; S.reveal.clear(); clearTimeout(S.lockTimer);
  if ($("scrim") && $("scrim").dataset.secret) closeSheet();
  render();
  if (msg) toast(msg);
}
export async function decryptCards() {
  if (!S.key) return;
  let changed = false;
  for (const c of S.cards) {
    const sig = c.secret ? c.secret.ct : "";
    if (S.plainSig[c.id] === sig) continue;
    S.plainSig[c.id] = sig; changed = true;
    if (!c.secret) { delete S.plain[c.id]; continue; }
    try { S.plain[c.id] = await unseal(S.key, c.secret); } catch (e) { S.plain[c.id] = { error: true }; }
  }
  if (changed) render();
}

// ---------- aba Cofre ----------
export function renderCofre() {
  let state;
  if (!hasCrypto) state = `<div class="notice">O cofre só funciona com o app instalado ou aberto pelo endereço https.</div>`;
  else if (!S.meta.vault) state = `
    <div class="hero-empty">
      <span class="label">Cofre de senhas</span>
      <h2>Guarde as senhas dos cartões com segurança</h2>
      <p>A senha de cada cartão e o login do app do emissor ficam criptografados neste celular com uma senha mestra que só você sabe.</p>
      <div class="btnrow"><button class="btn primary" data-act="vault">Criar cofre</button></div>
    </div>`;
  else state = `
    <section class="panel">
      <div class="panel-head"><h2>${S.key ? "Cofre aberto" : "Cofre trancado"}</h2>${S.key ? `<button class="btn small" data-act="lock">Trancar</button>` : `<button class="btn small primary" data-act="vault">Abrir cofre</button>`}</div>
      <p class="hint">${S.key ? "O cofre tranca sozinho depois de 5 minutos sem uso ou quando você sai do app." : "Abra com a senha mestra para ver ou editar as senhas dos cartões."}</p>
    </section>`;
  const rows = sortedCards().map(c => `<button data-act="edit-secrets" data-id="${c.id}"><span class="t">${esc(c.name)}${c.holder ? ` · ${esc(c.holder)}` : ""}</span><span class="s">${c.secret ? "Senhas guardadas" : "Nenhuma senha guardada"}</span></button>`).join("");
  return `
    <h1 class="page-title">Cofre</h1>
    ${state}
    ${hasCrypto && S.meta.vault && S.cards.length ? `<div class="section-head"><h2>Cartões</h2></div><div class="menu">${rows}</div>` : ""}`;
}

export function renderSecrets(c) {
  let body;
  if (!hasCrypto) body = `<p class="hint">O cofre precisa que o app seja aberto pelo endereço seguro (https) ou instalado. Neste modo ele fica desativado.</p>`;
  else if (!c.secret) body = `<p class="hint">Nenhuma senha guardada para este cartão.</p><div class="btnrow"><button class="btn small" data-act="edit-secrets" data-id="${c.id}">Guardar senhas</button></div>`;
  else if (!S.key) body = `<p class="hint">Senhas guardadas com criptografia. Abra o cofre com a senha mestra para ver.</p><div class="btnrow"><button class="btn small primary" data-act="vault">Abrir cofre</button></div>`;
  else {
    const p = S.plain[c.id];
    if (!p) body = `<div class="loading"><span class="spin"></span>Abrindo…</div>`;
    else if (p.error) body = `<p class="err">Não foi possível abrir as senhas deste cartão com a senha mestra atual.</p>`;
    else {
      const rows = [["pin", "Senha do cartão"], ["login", "Login do app do emissor"], ["appPass", "Senha do app"], ["notes", "Observações"]]
        .filter(([k]) => p[k]).map(([k, label]) => {
          const secret = k === "pin" || k === "appPass";
          const shown = !secret || S.reveal.has(c.id + k);
          return `<div class="srow"><div><div class="k">${label}</div><div class="val ${shown ? "" : "mask"}">${shown ? esc(p[k]) : "••••••"}</div></div>
            <div class="btnrow">${secret ? `<button class="btn small" data-act="reveal" data-id="${c.id}" data-k="${k}">${shown ? "Ocultar" : "Mostrar"}</button>` : ""}<button class="btn small" data-act="copy" data-id="${c.id}" data-k="${k}">Copiar</button></div></div>`;
        }).join("");
      body = `<div class="secrets">${rows || `<p class="hint">Nenhum campo preenchido.</p>`}</div><div class="btnrow"><button class="btn small" data-act="edit-secrets" data-id="${c.id}">Editar senhas</button></div>`;
    }
  }
  return `<section class="panel"><div class="panel-head"><h2>Senhas</h2><span class="label">criptografadas</span></div>${body}</section>`;
}

// ---------- cofre: criar, abrir, editar ----------
export function vaultSheet(then) {
  if (!hasCrypto) { toast("O cofre só funciona com o app instalado ou aberto pelo endereço https."); return; }
  if (!S.meta.vault) {
    openSheet(`
      <h3>Criar cofre de senhas</h3>
      <p class="hint">As senhas dos cartões são criptografadas neste celular com a sua senha mestra. Ninguém consegue ler sem ela, nem você: se esquecer a senha mestra, as senhas guardadas não podem ser recuperadas.</p>
      <form id="vForm" class="sform">
        <label class="field"><span>Senha mestra</span><input id="v1" type="password" autocomplete="new-password" autofocus></label>
        <label class="field"><span>Repita a senha mestra</span><input id="v2" type="password" autocomplete="new-password"></label>
        <div class="err" id="vErr"></div>
        <div class="btnrow"><button class="btn primary" type="submit" id="vBtn">Criar cofre</button><button class="btn" type="button" data-close>Cancelar</button></div>
      </form>`, () => {
      $("vForm").addEventListener("submit", async e => {
        e.preventDefault();
        const a = $("v1").value, b = $("v2").value;
        if (a.length < 8) { $("vErr").textContent = "Use pelo menos 8 caracteres."; return; }
        if (a !== b) { $("vErr").textContent = "As duas senhas não são iguais."; return; }
        $("vBtn").disabled = true;
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const key = await deriveKey(a, salt);
        const check = await seal(key, { ok: "ciclo" });
        const ok = await run(() => Store.setMeta({ ...S.meta, vault: { salt, ...check } }), "Cofre criado e aberto.");
        if (ok) { S.key = key; touchVault(); closeSheet(); render(); then && then(); }
        else $("vBtn").disabled = false;
      });
    }, { secret: true });
    return;
  }
  openSheet(`
    <h3>Abrir cofre</h3>
    <form id="uForm" class="sform">
      <label class="field"><span>Senha mestra</span><input id="u1" type="password" autocomplete="current-password" autofocus></label>
      <div class="err" id="uErr"></div>
      <div class="btnrow"><button class="btn primary" type="submit" id="uBtn">Abrir</button><button class="btn" type="button" data-close>Cancelar</button></div>
      <span class="hint">O cofre tranca sozinho depois de 5 minutos sem uso ou quando você sai do app.</span>
    </form>`, () => {
    $("uForm").addEventListener("submit", async e => {
      e.preventDefault();
      $("uBtn").disabled = true; $("uErr").textContent = "";
      try {
        const key = await deriveKey($("u1").value, S.meta.vault.salt);
        await unseal(key, S.meta.vault);
        S.key = key; touchVault(); closeSheet(); render(); then && then();
      } catch (err) {
        $("uErr").textContent = "Senha mestra incorreta.";
        $("uBtn").disabled = false; $("u1").select();
      }
    });
  }, { secret: true });
}

export function secretsSheet(card) {
  if (!S.key) { vaultSheet(() => secretsSheet(cardById(card.id))); return; }
  const p = S.plain[card.id] && !S.plain[card.id].error ? S.plain[card.id] : {};
  openSheet(`
    <h3>Senhas · ${esc(card.name)}</h3>
    <form id="sForm" class="sform" autocomplete="off">
      <label class="field"><span>Senha do cartão</span><input id="sPin" type="password" inputmode="numeric" autocomplete="new-password" value="${esc(p.pin || "")}" autofocus></label>
      <div class="grid2">
        <label class="field"><span>Login do app do emissor</span><input id="sLogin" autocomplete="off" value="${esc(p.login || "")}" placeholder="CPF ou e-mail"></label>
        <label class="field"><span>Senha do app</span><input id="sApp" type="password" autocomplete="new-password" value="${esc(p.appPass || "")}"></label>
      </div>
      <label class="field"><span>Observações</span><input id="sNotes" maxlength="120" autocomplete="off" value="${esc(p.notes || "")}"></label>
      <label class="check"><input type="checkbox" id="sShow"> Mostrar o que estou digitando</label>
      <div class="err" id="sErr"></div>
      <div class="btnrow">
        <button class="btn primary" type="submit">Salvar senhas</button>
        <button class="btn" type="button" data-close>Cancelar</button>
        ${card.secret ? `<button class="btn danger" type="button" id="sDel">Apagar senhas</button>` : ""}
      </div>
    </form>`, () => {
    $("sShow").addEventListener("change", e => { ["sPin", "sApp"].forEach(id => $(id).type = e.target.checked ? "text" : "password"); });
    $("sDel") && $("sDel").addEventListener("click", async () => {
      const ok = await run(() => Store.patch("cards", card.id, { secret: null }), "Senhas apagadas.");
      if (ok) closeSheet();
    });
    $("sForm").addEventListener("submit", async e => {
      e.preventDefault();
      if (!S.key) { $("sErr").textContent = "O cofre trancou. Abra de novo para salvar."; return; }
      const data = { pin: $("sPin").value, login: $("sLogin").value.trim(), appPass: $("sApp").value, notes: $("sNotes").value.trim() };
      const empty = !data.pin && !data.login && !data.appPass && !data.notes;
      const box = empty ? null : await seal(S.key, data);
      const ok = await run(() => Store.patch("cards", card.id, { secret: box }), "Senhas salvas no cofre.");
      if (ok) closeSheet();
    });
  }, { secret: true });
}

export function changeMasterSheet() {
  if (!S.meta.vault) { vaultSheet(); return; }
  openSheet(`
    <h3>Trocar senha mestra</h3>
    <form id="mForm" class="sform">
      <label class="field"><span>Senha mestra atual</span><input id="m0" type="password" autocomplete="current-password" autofocus></label>
      <label class="field"><span>Nova senha mestra</span><input id="m1" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Repita a nova senha</span><input id="m2" type="password" autocomplete="new-password"></label>
      <div class="err" id="mErr"></div>
      <div class="btnrow"><button class="btn primary" type="submit" id="mBtn">Trocar</button><button class="btn" type="button" data-close>Cancelar</button></div>
    </form>`, () => {
    $("mForm").addEventListener("submit", async e => {
      e.preventDefault();
      const a = $("m1").value;
      if (a.length < 8) { $("mErr").textContent = "Use pelo menos 8 caracteres."; return; }
      if (a !== $("m2").value) { $("mErr").textContent = "As duas senhas novas não são iguais."; return; }
      $("mBtn").disabled = true;
      let oldKey;
      try { oldKey = await deriveKey($("m0").value, S.meta.vault.salt); await unseal(oldKey, S.meta.vault); }
      catch (err) { $("mErr").textContent = "Senha mestra atual incorreta."; $("mBtn").disabled = false; return; }
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const newKey = await deriveKey(a, salt);
      const ok = await run(async () => {
        for (const c of S.cards.filter(c => c.secret)) {
          const plain = await unseal(oldKey, c.secret);
          await Store.patch("cards", c.id, { secret: await seal(newKey, plain) });
        }
        await Store.setMeta({ ...S.meta, vault: { salt, ...(await seal(newKey, { ok: "ciclo" })) } });
      }, "Senha mestra trocada.");
      if (ok) { S.key = newKey; S.plainSig = {}; touchVault(); closeSheet(); render(); }
      else $("mBtn").disabled = false;
    });
  }, { secret: true });
}
