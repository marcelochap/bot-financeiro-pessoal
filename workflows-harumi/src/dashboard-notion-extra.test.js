// Testes de workflows-harumi/src/dashboard-notion-extra.js.
// Rodar: node workflows-harumi/src/dashboard-notion-extra.test.js
const assert = require("node:assert");
const { montarResumoDashboardNotion } = require("./dashboard-notion-extra.js");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

const LANCAMENTOS = [
  { data_competencia: "10/03/2026", valor: 500, tipo: "saída", status: "confirmado", categoria: "Supermercado" },
  { data_competencia: "15/03/2026", valor: 3000, tipo: "entrada", status: "confirmado", categoria: "Salário" },
  { data_competencia: "12/03/2026", valor: 200, tipo: "saída", status: "confirmado", categoria: "Meta: Viagem", id_meta: "Viagem" },
];
const METAS_ATIVAS = [{ nome: "Viagem", orcamento_total: 1000, prazo: "2026-12", status: "ativa" }];

teste("montarResumoDashboardNotion produz texto plano (sem tags HTML)", () => {
  const r = montarResumoDashboardNotion({ lancamentos: LANCAMENTOS, contasFixas: [], metas: METAS_ATIVAS }, "03/2026");
  assert.ok(!r.texto.includes("<b>"), "não deveria ter tags HTML — o texto vai num bloco do Notion, não no Telegram");
  // 700 = 500 (Supermercado) + 200 (Meta: Viagem) — totaisMes é a visão de fluxo de
  // caixa (inclui gastos de meta); só gastosPorCategoria os exclui da lista por categoria.
  assert.ok(r.texto.includes("Saídas: R$ 700,00"));
  assert.ok(r.texto.includes("Entradas: R$ 3.000,00"));
});

teste("montarResumoDashboardNotion inclui metas ativas com progresso", () => {
  const r = montarResumoDashboardNotion({ lancamentos: LANCAMENTOS, contasFixas: [], metas: METAS_ATIVAS }, "03/2026");
  assert.ok(r.texto.includes("🎯 Viagem"));
  assert.strictEqual(r.metasAtivas, 1);
});

teste("montarResumoDashboardNotion: sem categorias/metas não quebra (listas vazias omitidas)", () => {
  const r = montarResumoDashboardNotion({ lancamentos: [], contasFixas: [], metas: [] }, "01/2020");
  assert.ok(!r.texto.includes("Por categoria"));
  assert.ok(!r.texto.includes("Metas ativas"));
  assert.strictEqual(r.saidas, 0);
  assert.strictEqual(r.metasAtivas, 0);
});

console.log(`\n${passou} teste(s) passaram.`);
