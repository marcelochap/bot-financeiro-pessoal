// Testes do parser da FATURA ABERTA do C6 (texto real do app web, colado no Telegram).
// Fatia 1: parser determinístico + checksum. Critérios: gstack/specs/fatura-aberta-projecao.md
// Rodar: node workflows/src/fatura-aberta.test.js
//
// A amostra real (PII) vive em "Dados CSV/" (gitignored) — mesmo padrão do
// parser-cartao.test.js. As fixtures sintéticas (sem PII) são inline.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseFaturaAberta, parseReais } = require("./fatura-aberta.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const AMOSTRA = fs.readFileSync(
  path.join(RAIZ, "Dados CSV", "fatura-aberta-exemplo.txt"),
  "utf-8"
);

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

const acha = (r, estab) => r.lancamentos.find((l) => l.estabelecimento.includes(estab));

// ─── parseReais: "R$ 1.234,56" / "-R$ 9.363,91" ──────────────────────
teste("parseReais: positivo, milhar e decimal", () => {
  assert.strictEqual(parseReais("R$ 21,35"), 21.35);
  assert.strictEqual(parseReais("R$ 1.000,00"), 1000);
  assert.strictEqual(parseReais("R$ 7.873,89"), 7873.89);
  assert.strictEqual(parseReais("R$ 0,00"), 0);
});
teste("parseReais: negativo (pagamento)", () => {
  assert.strictEqual(parseReais("-R$ 9.363,91"), -9363.91);
});
teste("parseReais: inválido → null (não trava)", () => {
  assert.strictEqual(parseReais("R$ abc"), null);
  assert.strictEqual(parseReais("R$ "), null);
});

// ─── Amostra REAL: o checksum tem que fechar exatamente ──────────────
teste("amostra real: Total dessa fatura = 7873.89", () => {
  const r = parseFaturaAberta(AMOSTRA);
  assert.strictEqual(r.total, 7873.89);
});
teste("amostra real: 34 lançamentos de gasto + 1 pagamento excluído", () => {
  const r = parseFaturaAberta(AMOSTRA);
  assert.strictEqual(r.lancamentos.length, 34);
  assert.strictEqual(r.pagamentos.length, 1);
  assert.strictEqual(r.pagamentos[0].descricao, "Inclusao de Pagamento");
  assert.strictEqual(r.pagamentos[0].valor, 9363.91); // valor absoluto
});
teste("amostra real: checksum bate (soma == total, sem pagamento)", () => {
  const r = parseFaturaAberta(AMOSTRA);
  assert.strictEqual(r.checksum.somado, 7873.89);
  assert.strictEqual(r.checksum.total, 7873.89);
  assert.strictEqual(r.checksum.diferenca, 0);
  assert.strictEqual(r.checksum.bate, true);
  assert.deepStrictEqual(r.avisos, []);
});
teste("amostra real: competência capturada do topo", () => {
  const r = parseFaturaAberta(AMOSTRA);
  assert.strictEqual(r.competencia_label, "julho de 2026");
});

// ─── Datas: DD/MM/AA → DD/MM/YYYY na fronteira (R7) ──────────────────
teste("amostra real: ano de 2 dígitos vira 4 (14/06/26 → 14/06/2026)", () => {
  const r = parseFaturaAberta(AMOSTRA);
  const ml = acha(r, "MERCADOLIVRE");
  assert.strictEqual(ml.data, "14/06/2026");
  // item parcelado com data de compra antiga (ARAJET 30/03/26)
  const arajet = acha(r, "ARAJET");
  assert.strictEqual(arajet.data, "30/03/2026");
});

// ─── Parcelas: "Em Mx" capturado; à vista = null (Fatia 2 usa o M) ───
teste("amostra real: Em Mx capturado como total de parcelas", () => {
  const r = parseFaturaAberta(AMOSTRA);
  assert.strictEqual(acha(r, "CLUBEW").parcelas_total, 12);
  assert.strictEqual(acha(r, "GOL LINHAS A*SNURWI").parcelas_total, 3);
  assert.strictEqual(acha(r, "ARAJET").parcelas_total, 6);
  // à vista → null
  assert.strictEqual(acha(r, "MERCADOLIVRE").parcelas_total, null);
  assert.strictEqual(acha(r, "DIVINO FOGAO").parcelas_total, null);
});
teste("amostra real: categoria do C6 preservada no lançamento", () => {
  const r = parseFaturaAberta(AMOSTRA);
  assert.strictEqual(acha(r, "MERCADOLIVRE").categoria_c6, "Elétrico");
  assert.strictEqual(
    acha(r, "GOL LINHAS A*SNURWI").categoria_c6,
    "T&E Companhia aérea"
  );
});

// ─── Fixtures SINTÉTICAS (sem PII) ───────────────────────────────────
const fatura = (totalLabel, corpo) =>
  [
    "julho de 2026",
    "Lançamentos nacionais",
    totalLabel,
    totalLabel,
    "Total dessa fatura",
    totalLabel,
    totalLabel,
    corpo,
  ].join("\n");

teste("checksum NÃO bate: captura incompleta (soma < total)", () => {
  const txt = fatura("R$ 200,00", [
    "Segunda-feira, 01/06/26",
    "Cat",
    "LOJA A",
    "R$ 80,00",
    "R$ 80,00",
  ].join("\n"));
  const r = parseFaturaAberta(txt);
  assert.strictEqual(r.checksum.bate, false);
  assert.strictEqual(r.checksum.somado, 80);
  assert.strictEqual(r.checksum.total, 200);
  assert.strictEqual(r.checksum.diferenca, 120); // faltam R$ 120 (positivo = falta)
});
teste("checksum NÃO bate: sobra (soma > total)", () => {
  const txt = fatura("R$ 50,00", [
    "Segunda-feira, 01/06/26",
    "Cat",
    "LOJA A",
    "R$ 80,00",
    "R$ 80,00",
  ].join("\n"));
  const r = parseFaturaAberta(txt);
  assert.strictEqual(r.checksum.bate, false);
  assert.strictEqual(r.checksum.diferenca, -30); // negativo = sobra
});
teste("pagamento negativo é excluído do checksum", () => {
  const txt = fatura("R$ 100,00", [
    "Segunda-feira, 01/06/26",
    "Cat",
    "LOJA A",
    "R$ 100,00",
    "R$ 100,00",
    "Inclusao de Pagamento",
    "-R$ 500,00",
    "-R$ 500,00",
  ].join("\n"));
  const r = parseFaturaAberta(txt);
  assert.strictEqual(r.checksum.bate, true);
  assert.strictEqual(r.lancamentos.length, 1);
  assert.strictEqual(r.pagamentos.length, 1);
  assert.strictEqual(r.pagamentos[0].valor, 500);
});
teste("parser não trava em valor malformado: pula + avisa", () => {
  const txt = fatura("R$ 100,00", [
    "Segunda-feira, 01/06/26",
    "Cat",
    "LOJA A",
    "R$ 100,00",
    "R$ 100,00",
    "Cat",
    "LOJA B",
    "R$ xx,yy",
    "R$ xx,yy",
  ].join("\n"));
  const r = parseFaturaAberta(txt);
  assert.strictEqual(r.lancamentos.length, 1); // LOJA B pulada
  assert.ok(r.avisos.length >= 1);
  assert.ok(r.avisos.some((a) => /malformado|inválid/i.test(a)));
});
teste("texto sem assinatura 'Total dessa fatura' → aviso, não grava", () => {
  const txt = [
    "Segunda-feira, 01/06/26",
    "Cat",
    "LOJA A",
    "R$ 100,00",
    "R$ 100,00",
  ].join("\n");
  const r = parseFaturaAberta(txt);
  assert.strictEqual(r.total, null);
  assert.strictEqual(r.checksum.bate, false);
  assert.ok(r.avisos.some((a) => /assinatura|Total dessa fatura/i.test(a)));
});

console.log(`\n${passou} testes passaram.`);
