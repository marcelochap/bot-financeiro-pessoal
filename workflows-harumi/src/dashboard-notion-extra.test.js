// Testes de workflows-harumi/src/dashboard-notion-extra.js.
// Rodar: node workflows-harumi/src/dashboard-notion-extra.test.js
const assert = require("node:assert");
const { montarResumoDashboardNotion, blocosDashboardNotion, barraUnicode } = require("./dashboard-notion-extra.js");

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

teste("montarResumoDashboardNotion calcula saídas/entradas do mês certo", () => {
  const r = montarResumoDashboardNotion({ lancamentos: LANCAMENTOS, contasFixas: [], metas: METAS_ATIVAS }, "03/2026");
  // 700 = 500 (Supermercado) + 200 (Meta: Viagem) — totaisMes é a visão de fluxo de
  // caixa (inclui gastos de meta); só gastosPorCategoria os exclui da lista por categoria.
  assert.strictEqual(r.saidas, 700);
  assert.strictEqual(r.entradas, 3000);
  assert.strictEqual(r.categorias.length, 1);
  assert.strictEqual(r.categorias[0].categoria, "Supermercado");
});

teste("montarResumoDashboardNotion inclui metas ativas com progresso", () => {
  const r = montarResumoDashboardNotion({ lancamentos: LANCAMENTOS, contasFixas: [], metas: METAS_ATIVAS }, "03/2026");
  assert.strictEqual(r.metasAtivas, 1);
  assert.strictEqual(r.metas[0].nome, "Viagem");
  assert.strictEqual(r.metas[0].pct, 20); // 200 acumulado / 1000 orçamento
});

teste("montarResumoDashboardNotion: sem categorias/metas não quebra (listas vazias)", () => {
  const r = montarResumoDashboardNotion({ lancamentos: [], contasFixas: [], metas: [] }, "01/2020");
  assert.strictEqual(r.categorias.length, 0);
  assert.strictEqual(r.metas.length, 0);
  assert.strictEqual(r.saidas, 0);
  assert.strictEqual(r.metasAtivas, 0);
});

teste("barraUnicode: 10 caracteres, cheio proporcional ao pct; null/undefined → vazio", () => {
  assert.strictEqual(barraUnicode(0), "░░░░░░░░░░ 0%");
  assert.strictEqual(barraUnicode(50), "▓▓▓▓▓░░░░░ 50%");
  assert.strictEqual(barraUnicode(100), "▓▓▓▓▓▓▓▓▓▓ 100%");
  assert.strictEqual(barraUnicode(null), "");
  assert.strictEqual(barraUnicode(undefined), "");
});

teste("blocosDashboardNotion: callout verde quando saldo positivo, vermelho quando negativo", () => {
  const positivo = blocosDashboardNotion({ saldo: 100, saidas: 0, entradas: 0, categorias: [], metas: [] });
  assert.strictEqual(positivo[0].callout.color, "green_background");
  assert.strictEqual(positivo[0].callout.icon.emoji, "✅");

  const negativo = blocosDashboardNotion({ saldo: -50, saidas: 0, entradas: 0, categorias: [], metas: [] });
  assert.strictEqual(negativo[0].callout.color, "red_background");
  assert.strictEqual(negativo[0].callout.icon.emoji, "⚠️");
});

teste("blocosDashboardNotion: sempre tem callout + column_list (2 colunas) + divider", () => {
  const blocos = blocosDashboardNotion({ saldo: 100, saidas: 200, entradas: 300, categorias: [], metas: [] });
  assert.strictEqual(blocos.length, 3);
  assert.strictEqual(blocos[0].type, "callout");
  assert.strictEqual(blocos[1].type, "column_list");
  assert.strictEqual(blocos[1].column_list.children.length, 2);
  assert.strictEqual(blocos[2].type, "divider");
});

teste("blocosDashboardNotion: toggles de categoria/metas só aparecem se houver dados", () => {
  const semNada = blocosDashboardNotion({ saldo: 0, saidas: 0, entradas: 0, categorias: [], metas: [] });
  assert.strictEqual(semNada.length, 3);

  const comCategoria = blocosDashboardNotion({
    saldo: 0, saidas: 0, entradas: 0,
    categorias: [{ categoria: "Mercado", confirmado: 850, orcamento: 1000, pct: 85 }],
    metas: [],
  });
  const toggleCat = comCategoria.find((b) => b.type === "toggle" && b.toggle.rich_text[0].text.content.includes("categoria"));
  assert.ok(toggleCat, "deveria ter o toggle de categorias");
  assert.strictEqual(toggleCat.toggle.children.length, 1);
  assert.ok(toggleCat.toggle.children[0].bulleted_list_item.rich_text[0].text.content.includes("▓▓▓▓▓▓▓▓▓░ 85%"));

  const comMeta = blocosDashboardNotion({
    saldo: 0, saidas: 0, entradas: 0, categorias: [],
    metas: [{ nome: "Viagem", acumulado: 200, orcamento: 1000, pct: 20, prazo: "2026-12" }],
  });
  const toggleMeta = comMeta.find((b) => b.type === "toggle" && b.toggle.rich_text[0].text.content.includes("Metas"));
  assert.ok(toggleMeta, "deveria ter o toggle de metas");
  assert.ok(toggleMeta.toggle.children[0].bulleted_list_item.rich_text[0].text.content.includes("até 2026-12"));
});

console.log(`\n${passou} teste(s) passaram.`);
