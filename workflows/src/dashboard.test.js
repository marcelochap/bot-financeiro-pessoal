// Testes das agregações do dashboard (mês passado + previsão do próximo mês).
// Critérios: gstack/specs/dashboard-reuniao-familiar.md
// Rodar: node workflows/src/dashboard.test.js
const assert = require("node:assert");
const { gastosPorCategoria, totaisMes, previsaoProximoMes, comprometidoFuturo } = require("./dashboard.js");

let passou = 0;
function teste(nome, fn) { fn(); passou++; console.log(`PASSOU: ${nome}`); }

const SAL = { Marcelo: 20000, Harumi: 4000 };

const LANC = [
  { data_competencia: "03/05/2026", valor: 7000, tipo: "saída", status: "confirmado", categoria: "Condominio" },
  { data_competencia: "10/05/2026", valor: 5000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  { data_competencia: "11/05/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  { data_competencia: "12/05/2026", valor: 999, tipo: "saída", status: "previsto", categoria: "Outros" }, // previsto: fora do passado
  { data_competencia: "05/05/2026", valor: 9000, tipo: "entrada", status: "confirmado", categoria: "Deposito Marcelo" },
  // próximo mês (07/2026)
  { data_competencia: "10/07/2026", valor: 728.89, tipo: "saída", status: "previsto", categoria: "Viagem Lua de mel" },
  { data_competencia: "10/07/2026", valor: 1000, tipo: "saída", status: "previsto", categoria: "Outros" },
  { data_competencia: "05/07/2026", valor: 1200, tipo: "saída", status: "previsto", categoria: "Condominio" }, // já presente
];

const FIXAS = [
  { nome: "Condomínio", valor_esperado: 1253, ativo: "sim" }, // com acento; já presente em julho → NÃO projeta
  { nome: "Tênis", valor_esperado: 750, ativo: "sim" },        // projeta
  { nome: "Luz", valor_esperado: 521, ativo: "não" },          // inativa → NÃO projeta
];

// ─── gastosPorCategoria (mês passado) ───────────────────────────────
teste("gastosPorCategoria: só saída confirmado do mês, ordenado desc", () => {
  const r = gastosPorCategoria(LANC, "05/2026");
  assert.deepStrictEqual(r, [
    { categoria: "Condominio", total: 7000 },
    { categoria: "Supermercado", total: 6000 },
  ]);
});

teste("totaisMes: saídas/entradas confirmadas + saldo", () => {
  const t = totaisMes(LANC, "05/2026");
  assert.strictEqual(t.saidas, 13000);
  assert.strictEqual(t.entradas, 9000);
  assert.strictEqual(t.saldo, -4000);
});

// ─── previsaoProximoMes ─────────────────────────────────────────────
teste("previsão: parcelas previstas do mês + TODAS as fixas ativas (estática)", () => {
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026");
  assert.strictEqual(p.gastos.parcelas, 2928.89);   // 728.89 + 1000 + 1200
  assert.strictEqual(p.gastos.fixas, 2003);         // Condomínio (1253) + Tênis (750) = 2003 (Luz inativa 521 ignorada)
  assert.strictEqual(p.gastos.total, 4931.89);
  assert.deepStrictEqual(p.detalhes, [
    { categoria: "Condomínio", valor: 1253 },
    { categoria: "Tênis", valor: 750 },
    { categoria: "Viagem Lua de mel", valor: 728.89 },
    { categoria: "Outros", valor: 1000 },
    { categoria: "Condominio", valor: 1200 }
  ]);
});

teste("previsão: depósitos previstos = total × proporção e somam o total", () => {
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026");
  assert.strictEqual(p.depositosPrevistos.Marcelo, 4109.91);
  assert.strictEqual(p.depositosPrevistos.Harumi, 821.98);
  assert.strictEqual(
    Math.round((p.depositosPrevistos.Marcelo + p.depositosPrevistos.Harumi) * 100) / 100,
    p.gastos.total);
});

// ─── C2: provisórios da fatura aberta não poluem a regra 3 ──────────
teste("previsão: provisórios origem=fatura-aberta são excluídos (C2)", () => {
  const comFatura = [
    ...LANC,
    // provisório da fatura aberta no próximo mês: tipo=saída, status=previsto
    { data_competencia: "10/07/2026", valor: 5000, tipo: "saída", status: "previsto", categoria: "Compras", origem: "fatura-aberta" },
  ];
  const p = previsaoProximoMes(comFatura, FIXAS, SAL, "07/2026");
  assert.strictEqual(p.gastos.parcelas, 2928.89); // inalterado — o 5000 NÃO entrou
  assert.ok(!p.detalhes.some((d) => d.valor === 5000));
});

// ─── validação de transações vazias ─────────────────────────────────
teste("gastosPorCategoria e totaisMes com lançamentos vazios", () => {
  const t = totaisMes([], "05/2026");
  assert.strictEqual(t.saidas, 0);
  assert.strictEqual(t.entradas, 0);
  assert.strictEqual(t.saldo, 0);

  const g = gastosPorCategoria([], "05/2026");
  assert.deepStrictEqual(g, []);
});

// ─── exclusão de transferências internas (pagamento de fatura etc.) ──
teste("transferências (Pagamento/Retirada) não contam como gasto nem receita", () => {
  const comTransf = [
    { data_competencia: "10/05/2026", valor: 5000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
    { data_competencia: "12/05/2026", valor: 4321, tipo: "saída", status: "confirmado", categoria: "Retirada" },   // pagto fatura → transferência
    { data_competencia: "05/05/2026", valor: 9000, tipo: "entrada", status: "confirmado", categoria: "Deposito Marcelo" },
    { data_competencia: "06/05/2026", valor: 1750, tipo: "entrada", status: "confirmado", categoria: "Pagamento" }, // transferência própria recebida
  ];
  const t = totaisMes(comTransf, "05/2026");
  assert.strictEqual(t.saidas, 5000);    // Retirada (4321) excluída
  assert.strictEqual(t.entradas, 9000);  // Pagamento (1750) excluído
  assert.strictEqual(t.saldo, 4000);

  const g = gastosPorCategoria(comTransf, "05/2026");
  assert.deepStrictEqual(g, [{ categoria: "Supermercado", total: 5000 }]); // sem "Retirada"
});

// ─── comprometidoFuturo (v2): fatura aberta + projeção de parcelas ───
const FA = [
  { ciclo: "10/07/2026", estabelecimento: "MERCADO", categoria_c6: "Supermercados", valor: 100, status: "fechado" },
  { ciclo: "10/07/2026", estabelecimento: "BAR", categoria_c6: "Restaurante", valor: 50, status: "fechado" },
  { ciclo: "10/07/2026", estabelecimento: "X", categoria_c6: "Supermercados", valor: 30, status: "rascunho" }, // R3: fora
];
const PARC = [
  { estabelecimento: "CLUBEW", valor: 123.54, M: 12, N_no_seed: 1, ciclo_referencia: "10/07/2026" },
];

teste("comprometidoFuturo: fatura aberta soma só 'fechado' + porCategoria desc", () => {
  const c = comprometidoFuturo(FA, [], [], "2026-07-02");
  assert.strictEqual(c.faturaAberta.total, 150);              // rascunho (30) excluído
  assert.strictEqual(c.faturaAberta.ciclo, "10/07/2026");
  assert.strictEqual(c.faturaAberta.status, "fechado");
  assert.deepStrictEqual(c.faturaAberta.porCategoria, [
    { categoria: "Supermercados", total: 100 },
    { categoria: "Restaurante", total: 50 },
  ]);
});

teste("comprometidoFuturo: sem fatura fechada → faturaAberta = null", () => {
  const c = comprometidoFuturo([{ ciclo: "10/07/2026", valor: 30, status: "rascunho" }], [], [], "2026-07-02");
  assert.strictEqual(c.faturaAberta, null);
});

teste("comprometidoFuturo: projeção CLUBEW 1/12 → horizonte itens, R$ 123,54", () => {
  const c = comprometidoFuturo(FA, PARC, [], "2026-07-02"); // vencHoje 10/07 == ciclo FA
  assert.strictEqual(c.horizonte, 6);
  assert.strictEqual(c.parcelas.length, 6);                  // Q1: length === horizonte
  assert.strictEqual(c.parcelas[0].vencimento, "10/08/2026");
  assert.ok(c.parcelas.every((p) => p.total === 123.54));
});

teste("comprometidoFuturo: Parcelas vazia → horizonte itens com total 0 (Q1)", () => {
  const c = comprometidoFuturo(FA, [], [], "2026-07-02");
  assert.strictEqual(c.parcelas.length, 6);
  assert.ok(c.parcelas.every((p) => p.total === 0));
});

teste("comprometidoFuturo (Q2): fatura velha não regravada → projeta a partir de HOJE", () => {
  const faVelha = [{ ciclo: "10/05/2026", valor: 100, status: "fechado", categoria_c6: "X" }];
  const c = comprometidoFuturo(faVelha, PARC, [], "2026-07-15"); // vencHoje 10/08 > ciclo 10/05
  // âncora = max(10/08, 10/05) = 10/08 → 1ª projeção 10/09 (futuro), não a partir da fatura velha
  assert.strictEqual(c.parcelas[0].vencimento, "10/09/2026");
});

teste("comprometidoFuturo: horizonte vem da aba Config", () => {
  const cfg = [{ chave: "comprometido_horizonte", valor: 3 }];
  const c = comprometidoFuturo(FA, PARC, cfg, "2026-07-02");
  assert.strictEqual(c.horizonte, 3);
  assert.strictEqual(c.parcelas.length, 3);
});

teste("comprometidoFuturo: ciclo_referencia em serial do Sheets é normalizado", () => {
  const parcSerial = [{ estabelecimento: "CLUBEW", valor: 123.54, M: 12, N_no_seed: 1, ciclo_referencia: 46213 }];
  const c = comprometidoFuturo(FA, parcSerial, [], "2026-07-02"); // 46213 = 10/07/2026
  assert.strictEqual(c.parcelas.length, 6);
  assert.ok(c.parcelas.every((p) => p.total === 123.54)); // se não normalizasse, projeção quebraria
});

teste("comprometidoFuturo: só o ciclo fechado mais recente conta (reseed parcial)", () => {
  const faDoisCiclos = [
    { ciclo: "10/06/2026", valor: 999, status: "fechado", categoria_c6: "Velho" }, // ciclo antigo
    { ciclo: "10/07/2026", valor: 100, status: "fechado", categoria_c6: "Novo" },
    { ciclo: "10/07/2026", valor: 50, status: "fechado", categoria_c6: "Novo" },
  ];
  const c = comprometidoFuturo(faDoisCiclos, [], [], "2026-07-02");
  assert.strictEqual(c.faturaAberta.ciclo, "10/07/2026"); // o mais recente
  assert.strictEqual(c.faturaAberta.total, 150);          // não soma o ciclo antigo (999)
});

// Não-sobreposição (critério da spec): a mesma parcela não pode aparecer no "Comprometido
// Futuro" (derivado de Parcelas) e na "Previsão Próximo Mês" (derivada de Lançamentos).
teste("não-sobreposição: parcela em Parcelas vs previsto em Lançamentos no mesmo mês", () => {
  // Cenário: hoje 02/07; previsão cobre 07/2026, comprometido projeta a partir de 08/2026.
  const lanc = [
    // um 'previsto' real de cartão em 08/2026 (ex.: parcela já lançada como saída prevista)
    { data_competencia: "10/08/2026", valor: 123.54, tipo: "saída", status: "previsto", categoria: "Compras", origem: "cartao" },
  ];
  const parc = [
    { estabelecimento: "CLUBEW", valor: 123.54, M: 12, N_no_seed: 1, ciclo_referencia: "10/07/2026" },
  ];
  // Previsão olha o mês seguinte a hoje (07/2026) → NÃO inclui o de 08/2026.
  const prev = previsaoProximoMes(lanc, [], SAL, "07/2026");
  assert.strictEqual(prev.gastos.parcelas, 0); // o previsto de 08 não entra na previsão de 07

  // Comprometido projeta 08/2026 em diante (a partir do ciclo aberto 10/07).
  const c = comprometidoFuturo([], parc, [], "2026-07-02");
  assert.strictEqual(c.parcelas[0].vencimento, "10/08/2026");
  // O gasto de 123,54 de agosto está SÓ no comprometido, nunca somado na previsão de julho.
  assert.strictEqual(c.parcelas[0].total, 123.54);
});

console.log(`\n${passou} testes passaram.`);

