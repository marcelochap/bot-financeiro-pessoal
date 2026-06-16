// Testes das agregações do dashboard (mês passado + previsão do próximo mês).
// Critérios: gstack/specs/dashboard-reuniao-familiar.md
// Rodar: node workflows/src/dashboard.test.js
const assert = require("node:assert");
const { gastosPorCategoria, totaisMes, previsaoProximoMes } = require("./dashboard.js");

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
});

teste("previsão: depósitos previstos = total × proporção e somam o total", () => {
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026");
  assert.strictEqual(p.depositosPrevistos.Marcelo, 4109.91);
  assert.strictEqual(p.depositosPrevistos.Harumi, 821.98);
  assert.strictEqual(
    Math.round((p.depositosPrevistos.Marcelo + p.depositosPrevistos.Harumi) * 100) / 100,
    p.gastos.total);
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

console.log(`\n${passou} testes passaram.`);

