// Testes do rateio proporcional ao salário (dashboard da reunião familiar).
// Critérios: gstack/specs/dashboard-reuniao-familiar.md
// Rodar: node workflows/src/rateio.test.js
const assert = require("node:assert");
const { proporcoes, rateioMes, rateioAcumulado, mesDe, mesParaNum,
  categoriaExclusivaDe, ehMovimentacaoPessoal, ehMeta, ehAbatimentoCdb, valorNum } = require("./rateio.js");

let passou = 0;
function teste(nome, fn) { fn(); passou++; console.log(`PASSOU: ${nome}`); }

const arred = (n) => Math.round(n * 100) / 100;

// ─── proporcoes ─────────────────────────────────────────────────────
teste("proporcoes: 20000/4000 → 0.8333/0.1667, soma 1", () => {
  const p = proporcoes({ Marcelo: 20000, Harumi: 4000 });
  assert.strictEqual(arred(p.Marcelo), 0.83);
  assert.ok(Math.abs(p.Marcelo + p.Harumi - 1) < 1e-9);
  assert.ok(p.Marcelo > p.Harumi);
});

teste("proporcoes: aceita array [{pessoa,salario}]", () => {
  const p = proporcoes([{ pessoa: "A", salario: 1 }, { pessoa: "B", salario: 1 }]);
  assert.strictEqual(p.A, 0.5);
  assert.strictEqual(p.B, 0.5);
});

teste("proporcoes: soma 0 → erro", () => {
  assert.throws(() => proporcoes({ A: 0, B: 0 }));
});

// ─── rateioMes ──────────────────────────────────────────────────────
const SAL = { Marcelo: 20000, Harumi: 4000 };
// despesas confirmadas de 05/2026 somando 12.000; depósitos M 8.000 / H 1.000
const LANC = [
  { data_competencia: "03/05/2026", valor: 7000, tipo: "saída", status: "confirmado", categoria: "Condominio" },
  { data_competencia: "10/05/2026", valor: 5000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  { data_competencia: "10/05/2026", valor: 999, tipo: "saída", status: "previsto", categoria: "Casamento" }, // previsto: ignorado
  { data_competencia: "10/04/2026", valor: 888, tipo: "saída", status: "confirmado", categoria: "Outros" },   // outro mês: ignorado
  { data_competencia: "05/05/2026", valor: 8000, tipo: "entrada", status: "confirmado", categoria: "Deposito Marcelo" },
  { data_competencia: "07/05/2026", valor: 1000, tipo: "entrada", status: "confirmado", categoria: "Depósito Harumi" }, // com acento
  { data_competencia: "05/05/2026", valor: 3000, tipo: "entrada", status: "confirmado", categoria: "Outros" }, // não é depósito de pessoa
];

teste("rateioMes: cota = despesas × proporção (só saídas confirmadas do mês)", () => {
  const r = rateioMes(LANC, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 12000);
  assert.strictEqual(r.cota.Marcelo, 10000);
  assert.strictEqual(r.cota.Harumi, 2000);
});

teste("rateioMes: pago = depósitos do mês (accent-insensitive 'Deposito'/'Depósito')", () => {
  const r = rateioMes(LANC, SAL, "05/2026");
  assert.strictEqual(r.pago.Marcelo, 8000);
  assert.strictEqual(r.pago.Harumi, 1000); // casou 'Depósito Harumi' com acento
});

teste("rateioMes: saldo = pago − cota; acerto = cota − pago (positivo = deve)", () => {
  const r = rateioMes(LANC, SAL, "05/2026");
  assert.strictEqual(r.saldo.Marcelo, -2000);
  assert.strictEqual(r.saldo.Harumi, -1000);
  assert.strictEqual(r.acerto.Marcelo, 2000);
  assert.strictEqual(r.acerto.Harumi, 1000);
});

teste("rateioMes: pessoa sem depósito no mês → pago 0, deve a cota inteira", () => {
  const r = rateioMes(LANC, SAL, "04/2026"); // só a saída 888 de abril
  assert.strictEqual(r.totalDespesas, 888);
  assert.strictEqual(r.pago.Marcelo, 0);
  assert.strictEqual(r.acerto.Marcelo, r.cota.Marcelo);
});

// ─── mesDe: tolerante aos 3 formatos que o Sheets devolve ───────────
// O dashboard/relatório leem com valueRenderOption=UNFORMATTED_VALUE; datas
// reais (célula formatada como Data) voltam como SERIAL, não como string.
teste("mesDe: 'DD/MM/YYYY' → 'MM/YYYY'", () => {
  assert.strictEqual(mesDe("03/05/2026"), "05/2026");
});

teste("mesDe: serial do Sheets (número) → 'MM/YYYY'", () => {
  // Âncoras verificadas na planilha real (FORMATTED_VALUE pt_BR):
  // 45936 → 06/10/2025 ; 45964 → 03/11/2025
  assert.strictEqual(mesDe(45936), "10/2025");
  assert.strictEqual(mesDe(45964), "11/2025");
});

teste("mesDe: serial como string só-dígitos → 'MM/YYYY'", () => {
  assert.strictEqual(mesDe("45936"), "10/2025");
});

teste("mesDe: ISO 'YYYY-MM-DD' → 'MM/YYYY'", () => {
  assert.strictEqual(mesDe("2026-05-03"), "05/2026");
});

teste("mesDe: vazio/nulo/lixo → null", () => {
  assert.strictEqual(mesDe(""), null);
  assert.strictEqual(mesDe(null), null);
  assert.strictEqual(mesDe("xx"), null);
});

// Regressão de ponta a ponta: rateioMes deve dar o MESMO resultado com as
// datas em serial (como o Sheets entrega hoje) e em string.
teste("rateioMes: datas em serial produzem o mesmo rateio que em string", () => {
  const serialDe = (ddmmyyyy) => {
    const [d, m, a] = ddmmyyyy.split("/").map(Number);
    return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  };
  const lancSerial = LANC.map((l) => ({ ...l, data_competencia: serialDe(l.data_competencia) }));
  const r = rateioMes(lancSerial, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 12000);
  assert.strictEqual(r.cota.Marcelo, 10000);
  assert.strictEqual(r.pago.Marcelo, 8000);
});

// Regressão: pagamento da fatura (saída "Retirada") é transferência interna —
// o gasto real já está nas compras da fatura, então NÃO entra em totalDespesas.
teste("rateioMes: saída 'Retirada' (pagto fatura) não infla totalDespesas", () => {
  const comPagtoFatura = LANC.concat([
    { data_competencia: "15/05/2026", valor: 4321, tipo: "saída", status: "confirmado", categoria: "Retirada" },
  ]);
  const r = rateioMes(comPagtoFatura, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 12000); // inalterado: a Retirada foi excluída
  assert.strictEqual(r.cota.Marcelo, 10000);
});

// ─── valorNum: robustez a valor em texto BR ─────────────────────────
teste("valorNum: número passa direto; texto ponto-decimal e BR viram número", () => {
  assert.strictEqual(valorNum(1011.87), 1011.87);
  assert.strictEqual(valorNum("1011.87"), 1011.87);     // USER_ENTERED coagido a texto
  assert.strictEqual(valorNum("1.011,56"), 1011.56);    // BR milhar + decimal
  assert.strictEqual(valorNum("1011,56"), 1011.56);     // só decimal vírgula
  assert.strictEqual(valorNum("1.011.000"), 1011000);   // milhar sem decimal
  assert.strictEqual(valorNum("R$ 1.234,56"), 1234.56); // com prefixo
});
teste("valorNum: vazio/inválido → 0 (não NaN, não envenena soma)", () => {
  assert.strictEqual(valorNum(""), 0);
  assert.strictEqual(valorNum(null), 0);
  assert.strictEqual(valorNum("abc"), 0);
});
teste("rateioMes: soma valores em texto BR sem virar NaN", () => {
  const lanc = [
    { data_competencia: "10/05/2026", valor: "1.000,00", tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 1000);
});

// ─── mesParaNum (rev #7) ────────────────────────────────────────────
teste("mesParaNum: 'MM/YYYY' → YYYYMM comparável; ordena 12/2025 < 01/2026", () => {
  assert.strictEqual(mesParaNum("05/2026"), 202605);
  assert.ok(mesParaNum("12/2025") < mesParaNum("01/2026"));
});
teste("mesParaNum: inválido → null", () => {
  assert.strictEqual(mesParaNum(""), null);
  assert.strictEqual(mesParaNum(null), null);
  assert.strictEqual(mesParaNum("2026"), null);
});

// ─── categoriaExclusivaDe ───────────────────────────────────────────
teste("categoriaExclusivaDe: 'Gastos Marcelo' → Marcelo (accent/case-insensitive)", () => {
  const pessoas = ["Marcelo", "Harumi"];
  assert.strictEqual(categoriaExclusivaDe("Gastos Marcelo", pessoas), "Marcelo");
  assert.strictEqual(categoriaExclusivaDe("gastos harumi", pessoas), "Harumi");
  assert.strictEqual(categoriaExclusivaDe("Supermercado", pessoas), null);
  assert.strictEqual(categoriaExclusivaDe("", pessoas), null);
});

// ─── movimentação pessoal (Pix de/para a própria conta) é NEUTRA ao rateio ──
teste("ehMovimentacaoPessoal reconhece 'Depósito/Saída para o/a ...' e ignora o resto", () => {
  assert.ok(ehMovimentacaoPessoal("Depósito para o Marcelo"));
  assert.ok(ehMovimentacaoPessoal("Saída para o Marcelo"));
  assert.ok(ehMovimentacaoPessoal("Depósito para a Harumi"));
  assert.ok(!ehMovimentacaoPessoal("Depósito Marcelo")); // contribuição da casa — NÃO é pessoal
  assert.ok(!ehMovimentacaoPessoal("Retirada"));
  assert.ok(!ehMovimentacaoPessoal("Supermercado"));
});

teste("rateioMes: movimentação pessoal é neutra — não afeta cota, pago nem totalDespesas", () => {
  const lanc = [
    { data_competencia: "10/05/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
    { data_competencia: "05/05/2026", valor: 8000, tipo: "entrada", status: "confirmado", categoria: "Depósito Marcelo" },
    // pass-through pessoal: NÃO deve mexer em nada do rateio
    { data_competencia: "12/05/2026", valor: 9906.65, tipo: "entrada", status: "confirmado", categoria: "Depósito para o Marcelo" },
    { data_competencia: "13/05/2026", valor: 19813.3, tipo: "saída", status: "confirmado", categoria: "Saída para o Marcelo" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 1000);          // só a despesa real da casa
  assert.strictEqual(r.cota.Marcelo, arred(1000 * (20000 / 24000)));
  assert.strictEqual(r.pago.Marcelo, 8000);           // só a contribuição "Depósito Marcelo"
  assert.strictEqual(r.saldo.Marcelo, arred(8000 - r.cota.Marcelo));
});

// ─── gastos exclusivos no rateio (cobrados 100% de quem é) ───────────
teste("rateioMes: gasto exclusivo 'Gastos Marcelo' entra 100% na cota do Marcelo (não ×prop)", () => {
  const lanc = [
    { data_competencia: "10/05/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
    { data_competencia: "11/05/2026", valor: 500, tipo: "saída", status: "confirmado", categoria: "Gastos Marcelo" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 1500);            // base 1000 + exclusivo 500
  // base 1000 × 0.8333 = 833.33 ; + 500 exclusivo = 1333.33
  assert.strictEqual(r.cota.Marcelo, arred(1000 * (20000 / 24000) + 500));
  assert.strictEqual(r.cota.Harumi, arred(1000 * (4000 / 24000)));
  // conservação: Σ cotas == total de saídas confirmadas não-transferência
  assert.strictEqual(arred(r.cota.Marcelo + r.cota.Harumi), 1500);
});

teste("rateioMes: conservação Σcotas ignora linha 'previsto' (rev #3)", () => {
  const lanc = [
    { data_competencia: "10/05/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
    { data_competencia: "10/05/2026", valor: 9999, tipo: "saída", status: "previsto", categoria: "Parcela" },
    { data_competencia: "11/05/2026", valor: 500, tipo: "saída", status: "confirmado", categoria: "Gastos Harumi" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 1500);             // previsto 9999 ignorado
  assert.strictEqual(arred(r.cota.Marcelo + r.cota.Harumi), 1500);
  assert.strictEqual(r.cota.Harumi, arred(1000 * (4000 / 24000) + 500));
});

teste("conservação: Σcotas == base exata mesmo com proporção que arredonda (sem dívida-fantasma)", () => {
  // salários 1:199 → prop 0.005/0.995; base 1.00 → arred ingênuo daria 0.01+1.00=1.01 (≠1.00)
  const sal = { A: 1, B: 199 };
  const lanc = [{ data_competencia: "10/05/2026", valor: 1.0, tipo: "saída", status: "confirmado", categoria: "Outros" }];
  const r = rateioMes(lanc, sal, "05/2026");
  assert.strictEqual(r.totalDespesas, 1.0);
  assert.strictEqual(arred(r.cota.A + r.cota.B), 1.0); // fecha exato, sem centavo órfão
});

// ─── rateioAcumulado (desde o início dos dados, até o mês alvo) ──────
const LANC_MULTI = [
  // 04/2026: despesa 1000, Marcelo depositou 400
  { data_competencia: "10/04/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  { data_competencia: "10/04/2026", valor: 400, tipo: "entrada", status: "confirmado", categoria: "Depósito Marcelo" },
  // 05/2026: despesa 2000, Harumi depositou 100
  { data_competencia: "10/05/2026", valor: 2000, tipo: "saída", status: "confirmado", categoria: "Aluguel" },
  { data_competencia: "12/05/2026", valor: 100, tipo: "entrada", status: "confirmado", categoria: "Depósito Harumi" },
  // 06/2026 (futuro em relação ao corte 05): NÃO deve entrar
  { data_competencia: "10/06/2026", valor: 5000, tipo: "saída", status: "confirmado", categoria: "Viagem" },
  // data ilegível: descartada (rev #7)
  { data_competencia: "lixo", valor: 7777, tipo: "saída", status: "confirmado", categoria: "Outros" },
];

teste("rateioAcumulado: soma meses ≤ alvo, ignora meses futuros e datas ilegíveis", () => {
  const r = rateioAcumulado(LANC_MULTI, SAL, "05/2026");
  assert.strictEqual(r.acumulado, true);
  assert.strictEqual(r.totalDespesas, 3000);             // 1000 + 2000 (06 e lixo fora)
  assert.strictEqual(r.pago.Marcelo, 400);
  assert.strictEqual(r.pago.Harumi, 100);
});

teste("rateioAcumulado: saldo negativo detecta dívida acumulada", () => {
  const r = rateioAcumulado(LANC_MULTI, SAL, "05/2026");
  // cota Marcelo = 3000 × 20000/24000 = 2500 ; pago 400 → deve 2100
  assert.strictEqual(r.cota.Marcelo, arred(3000 * (20000 / 24000)));
  assert.strictEqual(r.saldo.Marcelo, arred(400 - r.cota.Marcelo));
  assert.ok(r.saldo.Marcelo < 0);
  assert.strictEqual(r.acerto.Marcelo, arred(r.cota.Marcelo - 400));
});

teste("rateioAcumulado: mês anterior a todo histórico → tudo zero, não quebra", () => {
  const r = rateioAcumulado(LANC_MULTI, SAL, "01/2026");
  assert.strictEqual(r.totalDespesas, 0);
  assert.strictEqual(r.cota.Marcelo, 0);
  assert.strictEqual(r.pago.Marcelo, 0);
  assert.strictEqual(r.saldo.Marcelo, 0);
});

teste("rateioAcumulado: salários zerados → lança (proporcoes) — webhook trata via fallback (rev #2)", () => {
  assert.throws(() => rateioAcumulado(LANC_MULTI, { Marcelo: 0, Harumi: 0 }, "05/2026"));
});

teste("rateioAcumulado: calcula histórico com evolução de saldos e exclusivos", () => {
  const r = rateioAcumulado(LANC_MULTI, SAL, "05/2026");
  assert.ok(r.historico);
  assert.strictEqual(r.historico.length, 2);
  assert.strictEqual(r.historico[0].mes, "04/2026");
  assert.strictEqual(r.historico[1].mes, "05/2026");
  
  // Marcelo cota em 04/2026: 1000 * (20/24) = 833.33. Pago: 400. Saldo: 400 - 833.33 = -433.33
  assert.strictEqual(r.historico[0].saldoAcumulado.Marcelo, -433.33);
  assert.strictEqual(r.historico[0].exclusivo.Marcelo, 0);

  // Harumi cota em 05/2026: 2000 * (4/24) = 333.33. Pago: 100. Saldo: 100 - 333.33 = -233.33
  // Saldo acumulado Harumi em 05/2026: -166.67 + -233.33 = -400.00
  assert.strictEqual(r.historico[1].saldoAcumulado.Harumi, -400);
});

// INVARIANTE (code-review #1): o saldo do CARD == última linha de saldoAcumulado do modal,
// mesmo com proporção que gera resíduo de centavo. Antes o card vinha de um cálculo agregado
// separado e podia divergir do modal por centavos. Agora é a mesma soma mês-a-mês.
teste("rateioAcumulado: card (saldo) == última linha do histórico, mesmo com arredondamento", () => {
  const sal = { A: 1, B: 199 }; // prop 0.005/0.995 → resíduo de centavo
  const lanc = [
    { data_competencia: "10/04/2026", valor: 100.01, tipo: "saída", status: "confirmado", categoria: "X" },
    { data_competencia: "10/05/2026", valor: 33.33, tipo: "saída", status: "confirmado", categoria: "Y" },
    { data_competencia: "12/05/2026", valor: 50, tipo: "entrada", status: "confirmado", categoria: "Depósito A" },
  ];
  const r = rateioAcumulado(lanc, sal, "05/2026");
  const ultima = r.historico.at(-1).saldoAcumulado;
  assert.strictEqual(r.saldo.A, ultima.A);
  assert.strictEqual(r.saldo.B, ultima.B);
  // e a soma das cotas fecha o total acumulado (sem centavo órfão)
  assert.strictEqual(arred(r.cota.A + r.cota.B), r.totalDespesas);
});

// ─── Metas fora do rateio (poupança à parte) ────────────────────────
teste("ehMeta reconhece 'Meta: ...' e ignora o resto", () => {
  assert.ok(ehMeta("Meta: Viagem Lua de Mel"));
  assert.ok(ehMeta("meta: iptu"));
  assert.ok(!ehMeta("Supermercado"));
  assert.ok(!ehMeta("Metas")); // sem os dois-pontos não casa
});

teste("rateioMes: 'Meta: ...' NÃO entra na despesa da casa nem na cota", () => {
  const lanc = [
    { data_competencia: "10/05/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
    { data_competencia: "11/05/2026", valor: 4275, tipo: "saída", status: "confirmado", categoria: "Meta: Viagem Lua de Mel" },
    { data_competencia: "12/05/2026", valor: 1982, tipo: "saída", status: "confirmado", categoria: "Meta: IPTU" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 1000); // só o Supermercado; Metas fora
  assert.strictEqual(r.cota.Marcelo, arred(1000 * (20000 / 24000)));
});

// ─── Resgate de CDB com abatimento da Cota da Casa (gstack/specs/resgate-cdb-abatimento.md) ──
teste("ehAbatimentoCdb reconhece só a variante '(abatimento cdb)'; 'Meta: ...' comum não casa", () => {
  assert.ok(ehAbatimentoCdb("Meta: Viagem Lua de Mel (abatimento cdb)"));
  assert.ok(ehAbatimentoCdb("meta: iptu (ABATIMENTO CDB)")); // case/acento-insensível
  assert.ok(!ehAbatimentoCdb("Meta: Viagem Lua de Mel"));
  assert.ok(!ehAbatimentoCdb("Supermercado"));
});

teste("rateioMes: entrada 'Meta: X (abatimento cdb)' reduz a base proporcionalmente (exemplo do usuário)", () => {
  const lanc = [
    { data_competencia: "05/05/2026", valor: 12992.98, tipo: "saída", status: "confirmado", categoria: "Condominio" },
    { data_competencia: "20/05/2026", valor: 2264.04, tipo: "entrada", status: "confirmado", categoria: "Meta: Viagem (abatimento cdb)" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  const baseEsperada = arred(12992.98 - 2264.04);
  assert.strictEqual(r.totalDespesas, baseEsperada);
  // Marcelo=20.000, total da casa=24.000 → redução de 2264.04 × 20000/24000 = 1886.70
  assert.strictEqual(r.cota.Marcelo, arred(baseEsperada * (20000 / 24000)));
  assert.strictEqual(arred(12992.98 * (20000 / 24000) - r.cota.Marcelo), 1886.70);
});

teste("rateioMes: 'Meta: X' sem sufixo continua 100% fora do rateio (não-regressão)", () => {
  const lanc = [
    { data_competencia: "05/05/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
    { data_competencia: "20/05/2026", valor: 2264.04, tipo: "entrada", status: "confirmado", categoria: "Meta: Viagem" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, 1000); // resgate sem o sufixo não abate nada
  assert.strictEqual(r.pago.Marcelo, 0);     // e não conta como "pago" (categoria não é "Depósito Marcelo")
});

teste("rateioMes: abatimento maior que a base do mês deixa totalDespesas negativo (sem clamp)", () => {
  const lanc = [
    { data_competencia: "05/05/2026", valor: 500, tipo: "saída", status: "confirmado", categoria: "Gás" },
    { data_competencia: "20/05/2026", valor: 2000, tipo: "entrada", status: "confirmado", categoria: "Meta: Viagem (abatimento cdb)" },
  ];
  const r = rateioMes(lanc, SAL, "05/2026");
  assert.strictEqual(r.totalDespesas, -1500);
});

// ─── rateioAcumulado: mês de início (marco da conta da casa) ─────────
teste("rateioAcumulado: mesInicio descarta meses pré-rastreio", () => {
  const r = rateioAcumulado(LANC_MULTI, SAL, "05/2026", "05/2026");
  // só 05/2026 (despesa 2000); 04/2026 (1000) fica fora
  assert.strictEqual(r.mesInicio, "05/2026");
  assert.strictEqual(r.totalDespesas, 2000);
  assert.strictEqual(r.historico.length, 1);
  assert.strictEqual(r.historico[0].mes, "05/2026");
  assert.strictEqual(r.pago.Marcelo, 0);   // o depósito de 04 (400) ficou fora
  assert.strictEqual(r.pago.Harumi, 100);
});

teste("rateioAcumulado: sem mesInicio inclui tudo (compatibilidade)", () => {
  const r = rateioAcumulado(LANC_MULTI, SAL, "05/2026");
  assert.strictEqual(r.mesInicio, null);
  assert.strictEqual(r.totalDespesas, 3000);
});

console.log(`\n${passou} testes passaram.`);
