// Testes das agregações do dashboard (mês passado + previsão do próximo mês).
// Critérios: gstack/specs/dashboard-reuniao-familiar.md
// Rodar: node workflows/src/dashboard.test.js
const assert = require("node:assert");
const { gastosPorCategoria, totaisMes, previsaoProximoMes } = require("./dashboard.js");

let passou = 0;
function teste(nome, fn) { fn(); passou++; console.log(`PASSOU: ${nome}`); }

const SAL = { "Pessoa A": 15000, "Pessoa B": 3000 };

const LANC = [
  { data_competencia: "03/05/2026", valor: 7000, tipo: "saída", status: "confirmado", categoria: "Condominio" },
  { data_competencia: "10/05/2026", valor: 5000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  { data_competencia: "11/05/2026", valor: 1000, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  { data_competencia: "12/05/2026", valor: 999, tipo: "saída", status: "previsto", categoria: "Outros" }, // previsto: fora do passado
  { data_competencia: "05/05/2026", valor: 9500, tipo: "entrada", status: "confirmado", categoria: "Deposito Pessoa A" },
  // próximo mês (07/2026)
  { data_competencia: "10/07/2026", valor: 728.89, tipo: "saída", status: "previsto", categoria: "Meta Viagem" },
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
  assert.strictEqual(t.entradas, 9500);
  assert.strictEqual(t.saldo, -3500);
});

// ─── previsaoProximoMes ─────────────────────────────────────────────
teste("previsão: parcelas previstas do mês + fixas ausentes (accent-insensitive)", () => {
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026");
  assert.strictEqual(p.gastos.parcelas, 2928.89);   // 728.89 + 1000 + 1200
  assert.strictEqual(p.gastos.fixas, 750);          // só Tênis (Condomínio já presente; Luz inativa)
  assert.strictEqual(p.gastos.total, 3678.89);
});

teste("previsão: depósitos previstos = total × proporção e somam o total", () => {
  const p = previsaoProximoMes(LANC, FIXAS, SAL, "07/2026");
  assert.strictEqual(p.depositosPrevistos["Pessoa A"], 3065.74);
  assert.strictEqual(p.depositosPrevistos["Pessoa B"], 613.15);
  assert.strictEqual(
    Math.round((p.depositosPrevistos["Pessoa A"] + p.depositosPrevistos["Pessoa B"]) * 100) / 100,
    p.gastos.total);
});

console.log(`\n${passou} testes passaram.`);
