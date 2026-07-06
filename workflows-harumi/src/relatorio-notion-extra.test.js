// Testes de workflows-harumi/src/relatorio-notion-extra.js.
// Rodar: node workflows-harumi/src/relatorio-notion-extra.test.js
const assert = require("node:assert");
const { montarRelatorioIndividual } = require("./relatorio-notion-extra.js");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

const LANCAMENTOS = [
  { data_competencia: "10/03/2026", valor: 500, tipo: "saída", status: "confirmado", origem: "cartao", categoria: "Supermercado" },
  { data_competencia: "15/03/2026", valor: 3000, tipo: "entrada", status: "confirmado", origem: "conta", categoria: "Salário" },
  { data_competencia: "10/02/2026", valor: 9999, tipo: "saída", status: "confirmado", origem: "cartao", categoria: "Outro mês" },
];
const CONTAS_FIXAS = [
  { nome: "Aluguel", dia_vencimento: "5", valor_esperado: 1200, ativo: "sim" },
  { nome: "Antiga", dia_vencimento: "10", valor_esperado: 50, ativo: "não" },
];

teste("montarRelatorioIndividual NÃO tem a seção Rateio (modo individual)", () => {
  const { texto } = montarRelatorioIndividual(
    { lancamentos: LANCAMENTOS, contasFixas: CONTAS_FIXAS, config: {} },
    { mesGastos: "03/2026", mesFixos: "03/2026" }
  );
  assert.ok(!texto.includes("Rateio"), "não deveria haver seção Rateio no modo individual");
  assert.ok(texto.includes("Gastos do mês"));
  assert.ok(texto.includes("Contas fixas"));
});

teste("montarRelatorioIndividual calcula saídas/entradas/saldo do mês certo", () => {
  const { texto } = montarRelatorioIndividual(
    { lancamentos: LANCAMENTOS, contasFixas: [], config: {} },
    { mesGastos: "03/2026", mesFixos: "03/2026" }
  );
  assert.ok(texto.includes("Saídas: R$ 500,00"));
  assert.ok(texto.includes("Entradas: R$ 3.000,00"));
  assert.ok(!texto.includes("9.999"), "lançamento de fevereiro não deveria entrar no relatório de março");
});

teste("montarRelatorioIndividual só ativa (dia_vencimento) só conta fixa ativa aparece", () => {
  const { texto } = montarRelatorioIndividual(
    { lancamentos: [], contasFixas: CONTAS_FIXAS, config: {} },
    { mesGastos: "03/2026", mesFixos: "03/2026" }
  );
  assert.ok(texto.includes("Aluguel"));
  assert.ok(!texto.includes("Antiga"), "conta fixa inativa não deveria aparecer");
});

teste("montarRelatorioIndividual inclui link do Dashboard só se urlDashboard for passado", () => {
  const semLink = montarRelatorioIndividual({ lancamentos: [], contasFixas: [], config: {} }, { mesGastos: "03/2026", mesFixos: "03/2026" });
  assert.ok(!semLink.texto.includes("http"));
  const comLink = montarRelatorioIndividual({ lancamentos: [], contasFixas: [], config: {} }, { mesGastos: "03/2026", mesFixos: "03/2026", urlDashboard: "https://notion.so/x" });
  assert.ok(comLink.texto.includes("https://notion.so/x"));
});

console.log(`\n${passou} teste(s) passaram.`);
