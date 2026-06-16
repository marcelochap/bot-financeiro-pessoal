// Testes do relatório mensal (Telegram). Critérios: gstack/plans/relatorio-mensal.md
// Dados sintéticos (não cravar números do seed). Rodar: node workflows/src/relatorio.test.js
const assert = require("node:assert");
const { contasFixasDoMes, montarRelatorio, deveEnviarCron } = require("./relatorio.js");

let passou = 0;
function teste(nome, fn) { fn(); passou++; console.log(`PASSOU: ${nome}`); }

const FIXAS = [
  { nome: "Condomínio", dia_vencimento: 5, valor_esperado: 1253, ativo: "sim" },
  { nome: "Claro", dia_vencimento: 8, valor_esperado: 159, ativo: "sim" },
  { nome: "Gás", dia_vencimento: 11, valor_esperado: 90, ativo: "sim" },
  { nome: "Empregada", dia_vencimento: "sexta-feira", valor_esperado: 2240, ativo: "sim" },
  { nome: "Inativa", dia_vencimento: 9, valor_esperado: 100, ativo: "não" },
];
const CONFIG = { cartao_vencimento_dia: "10" };
// fatura de 03/2025 = 200 + 300 = 500 (data_competencia = vencimento dia 10)
const LANC_FIXOS = [
  { data_competencia: "10/03/2025", valor: 200, tipo: "saída", status: "confirmado", origem: "cartao", categoria: "Supermercado" },
  { data_competencia: "10/03/2025", valor: 300, tipo: "saída", status: "previsto", origem: "cartao", categoria: "Compras" },
  { data_competencia: "10/02/2025", valor: 999, tipo: "saída", status: "confirmado", origem: "cartao", categoria: "Outros" }, // outro mês
];
const SAL = [{ pessoa: "Marcelo", salario: 20000 }, { pessoa: "Harumi", salario: 4000 }];

// ─── contasFixasDoMes ───────────────────────────────────────────────
teste("contasFixasDoMes: mensais + cartão + empregada agrupada, ordenado por dia, sem inativa", () => {
  const r = contasFixasDoMes(FIXAS, LANC_FIXOS, CONFIG, "03/2025");
  const nomes = r.linhas.map((l) => l.nome);
  assert.deepStrictEqual(nomes, ["Condomínio", "Claro", "Cartão C6", "Gás", "Empregada"]);
  assert.strictEqual(nomes.filter((n) => n === "Empregada").length, 1); // 1 linha, não 4-5
  assert.strictEqual(r.linhas.find((l) => l.nome === "Empregada").vencimento, "sextas");
  const cartao = r.linhas.find((l) => l.nome === "Cartão C6");
  assert.strictEqual(cartao.valor, 500);
  assert.strictEqual(cartao.vencimento, "dia 10");
  assert.ok(!nomes.includes("Inativa"));
  assert.strictEqual(r.subtotal, 1253 + 159 + 90 + 2240 + 500);
});

teste("contasFixasDoMes: sem fatura no mês → cartão valor 0 com obs", () => {
  const r = contasFixasDoMes(FIXAS, [], CONFIG, "07/2025");
  const cartao = r.linhas.find((l) => l.nome === "Cartão C6");
  assert.strictEqual(cartao.valor, 0);
  assert.match(cartao.obs || "", /não importada/i);
});

// ─── deveEnviarCron ─────────────────────────────────────────────────
teste("deveEnviarCron: suprime mesGastos já enviado; envia mês novo / log vazio", () => {
  const logs = [{ acao: "relatorio_enviado", valor_anterior: "02/2025" }];
  assert.strictEqual(deveEnviarCron(logs, "02/2025"), false);
  assert.strictEqual(deveEnviarCron(logs, "03/2025"), true);
  assert.strictEqual(deveEnviarCron([], "03/2025"), true);
});

// ─── montarRelatorio ────────────────────────────────────────────────
const LANC_GASTOS = [
  { data_competencia: "03/03/2025", valor: 7000, tipo: "saída", status: "confirmado", categoria: "Condominio", origem: "conta" },
  { data_competencia: "10/03/2025", valor: 5000, tipo: "saída", status: "confirmado", categoria: "Supermercado", origem: "cartao" },
  { data_competencia: "05/03/2025", valor: 8000, tipo: "entrada", status: "confirmado", categoria: "Deposito Marcelo", origem: "conta" },
];

teste("montarRelatorio: compõe gastos, rateio, fixas e link", () => {
  const { texto } = montarRelatorio(
    { lancamentos: [...LANC_GASTOS, ...LANC_FIXOS], contasFixas: FIXAS, salarios: SAL, config: CONFIG },
    { mesGastos: "03/2025", mesFixos: "03/2025", urlPlanilha: "https://docs.google.com/x" });
  assert.match(texto, /Relat[óo]rio/i);
  assert.match(texto, /mar[çc]o\/2025|03\/2025/);
  assert.ok(texto.includes("Condomínio"));   // conta fixa
  assert.ok(texto.includes("Cartão C6"));     // fatura cartão
  assert.ok(texto.includes("Empregada"));
  assert.ok(texto.includes("Marcelo") && texto.includes("Harumi")); // rateio
  assert.match(texto, /https:\/\/docs\.google\.com\/x/);
});

teste("montarRelatorio: top 5 categorias + 'Outras'; escapa < > &", () => {
  const cats = ["A<x", "B&B", "C", "D", "E", "F", "G"]; // valores desc por índice
  const lanc = cats.map((c, i) => ({
    data_competencia: `0${i + 1}/03/2025`, valor: (7 - i) * 100,
    tipo: "saída", status: "confirmado", categoria: c, origem: "conta",
  }));
  const { texto } = montarRelatorio(
    { lancamentos: lanc, contasFixas: [], salarios: SAL, config: CONFIG },
    { mesGastos: "03/2025", mesFixos: "03/2025", urlPlanilha: "x" });
  assert.ok(texto.includes("A&lt;x"));   // < escapado
  assert.ok(texto.includes("B&amp;B"));  // & escapado
  assert.ok(texto.includes("Outras"));   // F e G agregados
  assert.ok(!texto.includes("A<x"));     // cru não vaza
});

teste("montarRelatorio: salários zerados → rateio degrada sem lançar, resto intacto", () => {
  const { texto } = montarRelatorio(
    { lancamentos: LANC_GASTOS, contasFixas: FIXAS,
      salarios: [{ pessoa: "A", salario: 0 }, { pessoa: "B", salario: 0 }], config: CONFIG },
    { mesGastos: "03/2025", mesFixos: "03/2025", urlPlanilha: "x" });
  assert.match(texto, /rateio indispon[íi]vel/i);
  assert.ok(texto.includes("Condomínio")); // contas fixas seguem
});

console.log(`\n${passou} testes passaram.`);
