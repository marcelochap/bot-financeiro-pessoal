// Testes do parser da FATURA ABERTA do C6 (texto real do app web, colado no Telegram).
// Fatia 1: parser determinístico + checksum. Critérios: gstack/specs/fatura-aberta-projecao.md
// Rodar: node workflows/src/fatura-aberta.test.js
//
// A amostra real (PII) vive em "Dados CSV/" (gitignored) — mesmo padrão do
// parser-cartao.test.js. As fixtures sintéticas (sem PII) são inline.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseFaturaAberta,
  parseReais,
  parseSeedParcelas,
  normalizarChave,
  montarEstadoParcelas,
  indiceAtual,
  projetarComprometido,
  mesAnoParaVencimento,
  proximoVencimento,
  mesesEntreVencimentos,
  normalizarCiclo,
  montarProvisorios,
} = require("./fatura-aberta.js");

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

// ═══════════════ FATIA 2 — parcelas (seed/reseed + projeção) ═════════

// ─── Helpers de ciclo (vencimento dia 10) ────────────────────────────
teste("mesAnoParaVencimento: 'julho de 2026' → 10/07/2026", () => {
  assert.strictEqual(mesAnoParaVencimento("julho de 2026"), "10/07/2026");
  assert.strictEqual(mesAnoParaVencimento("março de 2027"), "10/03/2027");
  assert.strictEqual(mesAnoParaVencimento("lixo"), null);
});
teste("proximoVencimento: vira o ano em dezembro", () => {
  assert.strictEqual(proximoVencimento("10/07/2026"), "10/08/2026");
  assert.strictEqual(proximoVencimento("10/12/2026"), "10/01/2027");
});
teste("mesesEntreVencimentos", () => {
  assert.strictEqual(mesesEntreVencimentos("10/07/2026", "10/07/2026"), 0);
  assert.strictEqual(mesesEntreVencimentos("10/07/2026", "10/08/2026"), 1);
  assert.strictEqual(mesesEntreVencimentos("10/07/2026", "10/01/2027"), 6);
});

// ─── normalizarChave + parseSeedParcelas ─────────────────────────────
teste("normalizarChave: maiúsculas + colapsa espaços", () => {
  assert.strictEqual(normalizarChave("  GOL  Linhas "), "GOL LINHAS");
});
teste("parseSeedParcelas: 'estab | N/M' por linha", () => {
  const { entradas, avisos } = parseSeedParcelas("CLUBEW | 1/12\n\nGOL LINHAS | 2/3");
  assert.deepStrictEqual(entradas, [
    { chave: "CLUBEW", N: 1, M: 12 },
    { chave: "GOL LINHAS", N: 2, M: 3 },
  ]);
  assert.deepStrictEqual(avisos, []);
});
teste("parseSeedParcelas: linha malformada → aviso, não trava", () => {
  const { entradas, avisos } = parseSeedParcelas("CLUBEW | 1/12\nlixo sem barra\nX | 9/2");
  assert.strictEqual(entradas.length, 1); // só CLUBEW; X tem N>M
  assert.ok(avisos.length >= 2);
});

// ─── montarEstadoParcelas: casa seed↔lançamento por (chave, M) ────────
const real = parseFaturaAberta(AMOSTRA);
const parcelados = real.lancamentos.filter((l) => l.parcelas_total !== null);
const SEED = parseSeedParcelas("CLUBEW | 1/12\nGOL LINHAS | 2/3").entradas;
const estado = montarEstadoParcelas(SEED, parcelados, "10/07/2026");

teste("montarEstado: CLUBEW vira 1 linha com valor/M/N do seed", () => {
  const clubew = estado.rows.filter((r) => r.estabelecimento.includes("CLUBEW"));
  assert.strictEqual(clubew.length, 1);
  assert.strictEqual(clubew[0].valor, 123.54);
  assert.strictEqual(clubew[0].M, 12);
  assert.strictEqual(clubew[0].N_no_seed, 1);
  assert.strictEqual(clubew[0].ciclo_referencia, "10/07/2026");
});
teste("montarEstado: GOL (4 compras 3x mesmo dia) vira 4 linhas", () => {
  const gol = estado.rows.filter((r) => r.estabelecimento.includes("GOL"));
  assert.strictEqual(gol.length, 4);
  assert.deepStrictEqual(
    gol.map((r) => r.valor).sort((a, b) => a - b),
    [295.42, 295.42, 295.42, 515.42]
  );
});
teste("montarEstado: parcela sem seed → aviso (não projeta às cegas)", () => {
  // só CLUBEW+GOL foram semeados; LATAM/ARAJET/etc ficam sem seed
  assert.ok(estado.avisos.some((a) => /sem seed/i.test(a) && /ARAJET|LATAM/i.test(a)));
});

// ─── indiceAtual: derivado do calendário (R1 — não conta colagens) ───
teste("normalizarCiclo: serial do Sheets e strings → DD/MM/YYYY", () => {
  assert.strictEqual(normalizarCiclo(46213), "10/07/2026"); // serial gravado pelo append
  assert.strictEqual(normalizarCiclo("46213"), "10/07/2026");
  assert.strictEqual(normalizarCiclo("10/07/2026"), "10/07/2026");
  assert.strictEqual(normalizarCiclo("2026-07-10"), "10/07/2026");
  assert.strictEqual(normalizarCiclo(""), "");
});
teste("indiceAtual: robusto a ciclo_referencia como serial (Sheets)", () => {
  const row = { N_no_seed: 1, M: 12, ciclo_referencia: 46213 }; // serial = 10/07/2026
  assert.strictEqual(indiceAtual(row, "10/07/2026"), 1);
  assert.strictEqual(indiceAtual(row, "10/08/2026"), 2);
});
teste("indiceAtual: deriva N do nº de ciclos desde o seed", () => {
  const clubew = estado.rows.find((r) => r.estabelecimento.includes("CLUBEW"));
  assert.strictEqual(indiceAtual(clubew, "10/07/2026"), 1); // mesmo ciclo
  assert.strictEqual(indiceAtual(clubew, "10/08/2026"), 2); // 1 virada
  assert.strictEqual(indiceAtual(clubew, "10/12/2026"), 6); // 5 viradas
});
teste("indiceAtual: recolar o MESMO ciclo não incrementa", () => {
  const clubew = estado.rows.find((r) => r.estabelecimento.includes("CLUBEW"));
  // duas leituras do mesmo vencimento → mesmo N (derivado, não contador)
  assert.strictEqual(indiceAtual(clubew, "10/07/2026"), indiceAtual(clubew, "10/07/2026"));
});

// ─── projetarComprometido: M − N cobranças futuras, por ciclo ─────────
teste("projeção CLUBEW (1/12): 6 meses à frente, R$ 123,54 cada", () => {
  const clubew = estado.rows.filter((r) => r.estabelecimento.includes("CLUBEW"));
  const proj = projetarComprometido(clubew, "10/07/2026", 6);
  assert.strictEqual(proj.length, 6);
  assert.strictEqual(proj[0].vencimento, "10/08/2026");
  assert.ok(proj.every((m) => m.total === 123.54));
});
teste("projeção GOL (2/3): só o próximo ciclo cobra (4×), depois zera", () => {
  const gol = estado.rows.filter((r) => r.estabelecimento.includes("GOL"));
  const proj = projetarComprometido(gol, "10/07/2026", 6);
  assert.strictEqual(proj[0].total, 1401.68); // 515.42 + 295.42*3
  assert.strictEqual(proj[1].total, 0); // N=4 > M=3
});
teste("R2: parcela terminando (seed 3/3) não tem projeção futura", () => {
  const golFim = montarEstadoParcelas(
    parseSeedParcelas("GOL LINHAS | 3/3").entradas,
    parcelados,
    "10/07/2026"
  ).rows;
  const proj = projetarComprometido(golFim, "10/07/2026", 6);
  assert.ok(proj.every((m) => m.total === 0)); // já é a última; gasto fica só no lançamento
});

// ═══════════════ FATIA 3 — linhas da aba FaturaAberta ════════════════
const VENC = mesAnoParaVencimento(real.competencia_label); // "10/07/2026"

teste("Fatia 3: montarProvisorios — linhas da aba FaturaAberta", () => {
  const rows = montarProvisorios(real, VENC);
  assert.strictEqual(rows.length, 34);
  assert.ok(rows.every((r) => r.ciclo === "10/07/2026"));
  assert.ok(rows.every((r) => r.status === "fechado")); // checksum bate
  const clubew = rows.find((r) => r.estabelecimento.includes("CLUBEW"));
  assert.strictEqual(clubew.parcelas_total, 12);
  assert.strictEqual(clubew.categoria_c6, "Supermercados / Mercearia / Padarias / Lojas de Conveniência");
  // à vista → parcelas_total vazio (não null, para o Sheets)
  assert.strictEqual(rows.find((r) => r.estabelecimento.includes("MERCADOLIVRE")).parcelas_total, "");
});
teste("Fatia 3: checksum não bate → status rascunho (não-fechado, R3)", () => {
  const parcial = parseFaturaAberta(
    fatura("R$ 200,00", ["Segunda-feira, 01/06/26", "Cat", "LOJA A", "R$ 80,00", "R$ 80,00"].join("\n"))
  );
  const rows = montarProvisorios(parcial, VENC);
  assert.ok(rows.every((r) => r.status === "rascunho"));
});

console.log(`\n${passou} testes passaram.`);
