// Testes das agregações do dashboard (mês passado + previsão do próximo mês).
// Critérios: gstack/specs/dashboard-reuniao-familiar.md
// Rodar: node workflows/src/dashboard.test.js
const assert = require("node:assert");
const { gastosPorCategoria, totaisMes, previsaoProximoMes, comprometidoFuturo } = require("./dashboard.js");

let passou = 0;
function teste(nome, fn) { fn(); passou++; console.log(`PASSOU: ${nome}`); }

const SAL = { Marcelo: 20000, Harumi: 4000 };
const arred = (n) => Math.round(n * 100) / 100;

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
teste("gastosPorCategoria: só saída confirmado do mês, ordenado desc (sem contas fixas → previsto 0, orcamento 0)", () => {
  const r = gastosPorCategoria(LANC, "05/2026");
  assert.deepStrictEqual(r, [
    { categoria: "Condominio", previsto: 0, confirmado: 7000, orcamento: 0 },
    { categoria: "Supermercado", previsto: 0, confirmado: 6000, orcamento: 0 },
  ]);
});

teste("gastosPorCategoria: coluna previsto vem das Contas Fixas ativas; mostra fixa não-paga", () => {
  const fixas = [
    { nome: "Condominio", valor_esperado: 1253, ativo: "sim" }, // tem confirmado (7000) + previsto
    { nome: "Luz", valor_esperado: 500, ativo: "sim" },          // ativa mas SEM gasto no mês → confirmado 0
    { nome: "Inativa", valor_esperado: 999, ativo: "não" },      // ignorada
  ];
  const r = gastosPorCategoria(LANC, "05/2026", fixas);
  const cond = r.find((c) => c.categoria === "Condominio");
  const luz = r.find((c) => c.categoria === "Luz");
  // sem aba Orçamentos: orcamento cai no fallback (previsto = valor_esperado da fixa)
  assert.deepStrictEqual(cond, { categoria: "Condominio", previsto: 1253, confirmado: 7000, orcamento: 1253 });
  assert.deepStrictEqual(luz, { categoria: "Luz", previsto: 500, confirmado: 0, orcamento: 500 });
  assert.ok(!r.some((c) => c.categoria === "Inativa"));
});

// ─── orcamento (teto de acompanhamento, aba Orçamentos) ─────────────
teste("gastosPorCategoria: teto da aba Orçamentos sobrepõe o fallback; variável ganha teto sem fixa", () => {
  const fixas = [{ nome: "Condominio", valor_esperado: 1253, ativo: "sim" }];
  const orcamentos = [
    { categoria: "Supermercado", teto_mensal: "1.200,00", ativo: "sim" }, // variável (sem fixa) + PT-BR
    { categoria: "Condominio", teto_mensal: 1300, ativo: "sim" },          // sobrepõe o previsto 1253
  ];
  const r = gastosPorCategoria(LANC, "05/2026", fixas, orcamentos);
  const sup = r.find((c) => c.categoria === "Supermercado");
  const cond = r.find((c) => c.categoria === "Condominio");
  assert.strictEqual(sup.orcamento, 1200);   // veio do teto (variável), PT-BR parseado
  assert.strictEqual(sup.previsto, 0);        // continua sem previsto (não é fixa)
  assert.strictEqual(cond.orcamento, 1300);   // teto sobrepõe o fallback (1253)
});

teste("gastosPorCategoria: teto inativo ou inválido cai no fallback (previsto)", () => {
  const fixas = [{ nome: "Condominio", valor_esperado: 1253, ativo: "sim" }];
  const orcamentos = [
    { categoria: "Condominio", teto_mensal: 999, ativo: "não" },     // inativo → ignorado → fallback 1253
    { categoria: "Supermercado", teto_mensal: "", ativo: "sim" },    // vazio → não registra → fallback (0)
  ];
  const r = gastosPorCategoria(LANC, "05/2026", fixas, orcamentos);
  assert.strictEqual(r.find((c) => c.categoria === "Condominio").orcamento, 1253);
  assert.strictEqual(r.find((c) => c.categoria === "Supermercado").orcamento, 0);
});

teste("gastosPorCategoria: categoria só com teto (sem confirmado nem previsto) NÃO entra na tabela", () => {
  const orcamentos = [{ categoria: "Lazer", teto_mensal: 500, ativo: "sim" }];
  const r = gastosPorCategoria(LANC, "05/2026", [], orcamentos);
  assert.ok(!r.some((c) => c.categoria === "Lazer"));
});

teste("totaisMes: saídas/entradas confirmadas + saldo", () => {
  const t = totaisMes(LANC, "05/2026");
  assert.strictEqual(t.saidas, 13000);
  assert.strictEqual(t.entradas, 9000);
  assert.strictEqual(t.saldo, -4000);
});

teste("movimentação pessoal: ENTRA no fluxo de caixa (entradas/saídas), mas fica FORA dos gastos da casa", () => {
  const lanc = LANC.concat([
    { data_competencia: "12/05/2026", valor: 9906.65, tipo: "entrada", status: "confirmado", categoria: "Depósito para o Marcelo" },
    { data_competencia: "13/05/2026", valor: 19813.3, tipo: "saída", status: "confirmado", categoria: "Saída para o Marcelo" },
  ]);
  const t = totaisMes(lanc, "05/2026");
  assert.strictEqual(t.saidas, 32813.3);    // 13000 casa + 19813.3 pessoal (aparece no fluxo)
  assert.strictEqual(t.entradas, 18906.65); // 9000 depósito + 9906.65 pessoal (aparece no fluxo)
  // mas o treemap de gastos da casa NÃO inclui as movimentações pessoais
  const g = gastosPorCategoria(lanc, "05/2026");
  assert.ok(!g.some((c) => c.categoria === "Saída para o Marcelo"));
  assert.ok(!g.some((c) => c.categoria === "Depósito para o Marcelo"));
});

teste("Metas ('Meta: ...') ficam fora do treemap de gastos da casa (poupança à parte)", () => {
  const lanc = LANC.concat([
    { data_competencia: "11/05/2026", valor: 4275, tipo: "saída", status: "confirmado", categoria: "Meta: Viagem Lua de Mel" },
  ]);
  const g = gastosPorCategoria(lanc, "05/2026");
  assert.ok(!g.some((c) => c.categoria === "Meta: Viagem Lua de Mel"));
});

// ─── previsaoProximoMes ─────────────────────────────────────────────
teste("previsão: fatura aberta (que vence no mês) + TODAS as fixas ativas", () => {
  const fa = [
    { status: "fechado", valor: 2500, categoria_c6: "Supermercado", ciclo: "10/07/2026" },
    { status: "fechado", valor: 428.89, categoria_c6: "Lazer", ciclo: "10/07/2026" },
    { status: "rascunho", valor: 300, categoria_c6: "Outros", ciclo: "10/07/2026" } // rascunho ignorado
  ];
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026", fa);
  assert.strictEqual(p.gastos.parcelas, 2928.89);   // 2500 + 428.89
  assert.strictEqual(p.gastos.fixas, 2003);         // Condomínio (1253) + Tênis (750) = 2003 (Luz inativa 521 ignorada)
  assert.strictEqual(p.gastos.total, 4931.89);
  assert.deepStrictEqual(p.detalhes, [
    { categoria: "Condomínio", valor: 1253 },
    { categoria: "Tênis", valor: 750 },
    { categoria: "Fatura Cartão C6", valor: 2928.89 }
  ]);
});

teste("previsão: depósitos previstos = total × proporção e somam o total", () => {
  const fa = [
    { status: "fechado", valor: 2928.89, ciclo: "10/07/2026" }
  ];
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026", fa);
  assert.strictEqual(p.depositosPrevistos.Marcelo, 4109.91);
  assert.strictEqual(p.depositosPrevistos.Harumi, 821.98);
  assert.strictEqual(
    Math.round((p.depositosPrevistos.Marcelo + p.depositosPrevistos.Harumi) * 100) / 100,
    p.gastos.total);
});

teste("previsão: lançamentos previstos em Lançamentos são ignorados", () => {
  const comPrevisto = [
    ...LANC,
    { data_competencia: "10/07/2026", valor: 5000, tipo: "saída", status: "previsto", categoria: "Compras", origem: "cartao" },
  ];
  const p = previsaoProximoMes(comPrevisto, FIXAS, SAL, "07/2026", [{ status: "fechado", valor: 1000, ciclo: "10/07/2026" }]);
  assert.strictEqual(p.gastos.parcelas, 1000); // usa o valor da fatura aberta, ignora Lancamentos
  assert.ok(!p.detalhes.some((d) => d.valor === 5000));
});

teste("previsão: fatura que NÃO vence no mês previsto é ignorada (item 3)", () => {
  // fatura vence 10/08/2026, mas a previsão é p/ 07/2026 → não entra
  const fa = [{ status: "fechado", valor: 9999, categoria_c6: "Supermercado", ciclo: "10/08/2026" }];
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026", fa);
  assert.strictEqual(p.gastos.parcelas, 0);   // nenhuma fatura vence em 07/2026
  assert.strictEqual(p.gastos.total, p.gastos.fixas); // só as contas fixas
});

teste("previsão: calcula rateio descontando exclusivos da fatura e somando-os ao dono", () => {
  const fa = [
    { status: "fechado", valor: 5000, categoria_c6: "Supermercado", ciclo: "10/07/2026" },     // compartilhado
    { status: "fechado", valor: 1000, categoria_c6: "Gastos Marcelo", ciclo: "10/07/2026" },  // exclusivo Marcelo
    { status: "fechado", valor: 500, categoria_c6: "Gastos Harumi", ciclo: "10/07/2026" }     // exclusivo Harumi
  ];
  // salários Marcelo: 20000, Harumi: 4000 (prop Marcelo: 20/24 = 5/6, Harumi: 1/6)
  // contas fixas: 2003
  // base compartilhada = 2003 + 5000 = 7003
  // cota base Marcelo = 7003 * 5/6 = 5835.83
  // cota base Harumi = 7003 * 1/6 = 1167.17 (fechando 7003)
  // Marcelo previsto = 5835.83 + 1000 = 6835.83
  // Harumi previsto = 1167.17 + 500 = 1667.17
  
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026", fa);
  assert.strictEqual(p.depositosPrevistos.Marcelo, 6835.83);
  assert.strictEqual(p.depositosPrevistos.Harumi, 1667.17);
});

// ─── previsão: resgate de CDB marcado p/ abatimento reduz a base (gstack/specs/resgate-cdb-abatimento.md) ──
teste("previsão: resgate de CDB confirmado no mês (abatimento) reduz a base antes do rateio", () => {
  const comResgate = LANC.concat([
    { data_competencia: "06/07/2026", valor: 2264.04, tipo: "entrada", status: "confirmado",
      categoria: "Meta: Viagem Lua de Mel (abatimento cdb)" },
  ]);
  const fa = [{ status: "fechado", valor: 2928.89, ciclo: "10/07/2026" }];
  const semResgate = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026", fa);
  const comAbatimento = previsaoProximoMes(comResgate, FIXAS, SAL, "07/2026", fa);
  // Marcelo=20.000, total da casa=24.000 → reduz 2264.04 × 20000/24000 = 1886.70
  assert.strictEqual(arred(semResgate.depositosPrevistos.Marcelo - comAbatimento.depositosPrevistos.Marcelo), 1886.70);
  assert.strictEqual(comAbatimento.gastos.total, semResgate.gastos.total); // gasto bruto não muda, só o rateio
});

teste("previsão: 'Meta: X' sem sufixo (poupança comum) NÃO reduz a previsão (não-regressão)", () => {
  const comMetaComum = LANC.concat([
    { data_competencia: "06/07/2026", valor: 2264.04, tipo: "entrada", status: "confirmado",
      categoria: "Meta: Viagem Lua de Mel" },
  ]);
  const fa = [{ status: "fechado", valor: 2928.89, ciclo: "10/07/2026" }];
  const semResgate = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026", fa);
  const comMeta = previsaoProximoMes(comMetaComum, FIXAS, SAL, "07/2026", fa);
  assert.strictEqual(comMeta.depositosPrevistos.Marcelo, semResgate.depositosPrevistos.Marcelo);
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
  assert.deepStrictEqual(g, [{ categoria: "Supermercado", previsto: 0, confirmado: 5000, orcamento: 0 }]); // sem "Retirada"
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

