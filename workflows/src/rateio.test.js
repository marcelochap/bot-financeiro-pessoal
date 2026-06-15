// Testes do rateio proporcional ao salário (dashboard da reunião familiar).
// Critérios: gstack/specs/dashboard-reuniao-familiar.md
// Rodar: node workflows/src/rateio.test.js
const assert = require("node:assert");
const { proporcoes, rateioMes } = require("./rateio.js");

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

console.log(`\n${passou} testes passaram.`);
