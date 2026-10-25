// Leitor do celular (receipt.js): texto de cupons reais, anonimizados, e o que deve sair de cada um.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ReceiptReader, cupom } = require("./carregar");

const kinds = r => r.payments.map(p => `${p.kind}:${p.amount}`);

test("Super Big: VR, final depois da máscara, saldo após a compra e 'CARTAO TEF' como vale", () => {
  const r = ReceiptReader.parse(cupom("super-big-vr.txt"));
  assert.equal(r.cnpj, "16593945000102");
  assert.equal(r.date, "2026-10-20");
  assert.equal(r.paid, 1599);
  assert.equal(r.balance, 41230);
  assert.equal(r.balanceMoment, "apos_compra");
  assert.equal(r.issuer, "VR");
  assert.equal(r.last4, "7310");
  assert.deepEqual(kinds(r), ["vale:1599"]);
});

test("Assaí: Volus, tipo alimentação, titular, final e saldo", () => {
  const r = ReceiptReader.parse(cupom("assai-volus.txt"));
  assert.equal(r.issuer, "Volus");
  assert.equal(r.type, "alimentacao");
  assert.equal(r.holder, "Fulana de Tal");
  assert.equal(r.last4, "4821");
  assert.equal(r.balance, 120840);
  assert.equal(r.category, "Mercado");
  assert.deepEqual(kinds(r), ["vale:31707"]);
});

test("dois vales e Pix: três pagamentos, dois saldos, dois finais e tipo em aberto", () => {
  const r = ReceiptReader.parse(cupom("dois-vales-e-pix.txt"));
  assert.deepEqual(kinds(r), ["vale:8000", "vale:5000", "pix:2000"]);
  assert.equal(r.paid, 13000);
  assert.deepEqual(r.balances, [12000, 30000]);
  assert.deepEqual(r.last4s, ["1111", "2222"]);
  assert.equal(r.type, null);
});

test("saldo anterior à compra e máscara lida como '+'", () => {
  const r = ReceiptReader.parse(cupom("saldo-anterior.txt"));
  assert.equal(r.balance, 20000);
  assert.equal(r.balanceMoment, "antes_compra");
  assert.equal(r.last4, "7777");
  assert.equal(r.issuer, "Ticket");
});

test("formatos do final do cartão, inclusive com erros do OCR", () => {
  const final = linha => ReceiptReader.parse(`VR BENEFICIOS VOUCHER\nVALOR 10,00\n${linha}`).last4;
  for (const linha of ["CARTAO ************4321", "**** **** **** 4321", "XXXX4321", "FINAL 4321", "CARTAO xxxxxxxxxxxx4321", "CARTAO ++++++++++++4321", "############4321"]) {
    assert.equal(final(linha), "4321", linha);
  }
  assert.equal(final("CARTAO: 608812******4821"), "4821");
  assert.equal(final("CARTAO: 608715    97"), null, "sem os 4 dígitos do final");
  assert.equal(final("TAXX 2026"), null, "palavra com XX não é máscara");
});

test("cartão por foto: emissor, tipo, titular e só o final do número", () => {
  const c = ReceiptReader.parseCard("VOLUS\nALIMENTACAO\n6088 0712 3456 4821\nMARIA SOUZA");
  assert.equal(c.issuer, "Volus");
  assert.equal(c.type, "alimentacao");
  assert.equal(c.holder, "Maria Souza");
  assert.equal(c.last4, "4821");
});

test("Tesseract: crédito com final único recebe o final", () => {
  const r = ReceiptReader.parse(cupom("credito-final-de-vale.txt"));
  assert.deepEqual(kinds(r), ["credito:5000"]);
  assert.equal(r.payments[0].last4, "0000");
});

test("Tesseract: dois cartões sem ligação clara não atribui final", () => {
  const dois = cupom("credito-final-de-vale.txt").replace("CARTAO DE CREDITO 50,00", "CARTAO DE CREDITO 30,00\nCARTAO DE DEBITO 20,00")
    + "CARTAO: 123456******1111\n";
  const r = ReceiptReader.parse(dois);
  assert.deepEqual(r.payments.map(p => p.kind), ["credito", "debito"]);
  assert.ok(r.payments.every(p => !p.last4));
  const doisFinais = cupom("credito-final-de-vale.txt") + "CARTAO: 123456******1111\n";
  assert.equal(ReceiptReader.parse(doisFinais).payments[0].last4, undefined);
});
