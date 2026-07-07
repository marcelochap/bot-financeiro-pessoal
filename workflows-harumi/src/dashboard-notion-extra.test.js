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

// ─── Fase E: Comprometido Futuro + Previsão Próximo Mês ──────────────────────
const FATURA_ABERTA_ROWS = [
  { ciclo: "10/07/2026", data_compra: "14/06/2026", estabelecimento: "Mercado", categoria_c6: "Alimentação", valor: 150, parcelas_total: "", status: "fechado" },
  { ciclo: "10/07/2026", data_compra: "15/06/2026", estabelecimento: "ClubeW", categoria_c6: "Lazer", valor: 89.9, parcelas_total: 12, status: "fechado" },
];
const PARCELAS_ROWS = [
  { estabelecimento: "ClubeW", valor: 89.9, M: 12, N_no_seed: 3, ciclo_referencia: "10/07/2026" },
];

teste("montarResumoDashboardNotion: sem hojeISO/mesPrevisto não calcula comprometido/previsao (retrocompat Fase D)", () => {
  const r = montarResumoDashboardNotion({ lancamentos: [], contasFixas: [], metas: [] }, "06/2026");
  assert.strictEqual(r.comprometido, undefined);
  assert.strictEqual(r.previsao, undefined);
});

teste("montarResumoDashboardNotion: com hojeISO calcula comprometido (fatura aberta + parcelas projetadas)", () => {
  const r = montarResumoDashboardNotion({
    lancamentos: [], contasFixas: [], metas: [],
    faturaAbertaRows: FATURA_ABERTA_ROWS, parcelasRows: PARCELAS_ROWS, configRows: [],
    hojeISO: "2026-06-20",
  }, "06/2026");
  assert.ok(r.comprometido);
  assert.strictEqual(r.comprometido.faturaAberta.ciclo, "10/07/2026");
  assert.strictEqual(r.comprometido.faturaAberta.total, 239.9);
  assert.strictEqual(r.comprometido.faturaAberta.porCategoria.length, 2);
  assert.ok(r.comprometido.parcelas.length > 0);
});

teste("montarResumoDashboardNotion: com mesPrevisto calcula previsão (sem depositosPrevistos de rateio)", () => {
  const contasFixas = [{ nome: "Aluguel", valor_esperado: 1200, ativo: "sim" }];
  const r = montarResumoDashboardNotion({
    lancamentos: [], contasFixas, metas: [],
    faturaAbertaRows: FATURA_ABERTA_ROWS, mesPrevisto: "07/2026",
  }, "06/2026");
  assert.ok(r.previsao);
  assert.strictEqual(r.previsao.gastos.fixas, 1200);
  assert.strictEqual(r.previsao.gastos.parcelas, 239.9); // fatura fechada que vence em 07/2026
  assert.strictEqual(r.previsao.gastos.total, 1439.9);
  assert.ok(!("depositosPrevistos" in r.previsao));
});

teste("blocosDashboardNotion: toggle de Fatura Aberta some, aviso aparece quando não há fatura capturada", () => {
  const semFatura = blocosDashboardNotion({
    saldo: 0, saidas: 0, entradas: 0, categorias: [], metas: [],
    comprometido: { faturaAberta: null, parcelas: [], horizonte: 6 },
  });
  const avisoFatura = semFatura.find((b) => b.type === "paragraph" && b.paragraph.rich_text[0].text.content.includes("/faturaaberta"));
  assert.ok(avisoFatura, "deveria avisar que não há fatura aberta capturada");
  const avisoParcelas = semFatura.find((b) => b.type === "paragraph" && b.paragraph.rich_text[0].text.content.includes("/seedparcelas"));
  assert.ok(avisoParcelas, "deveria avisar que não há parcela projetada");
});

teste("blocosDashboardNotion: toggle de Fatura Aberta mostra ciclo/total/categorias quando há dados", () => {
  const comFatura = blocosDashboardNotion({
    saldo: 0, saidas: 0, entradas: 0, categorias: [], metas: [],
    comprometido: {
      faturaAberta: { ciclo: "10/07/2026", total: 239.9, status: "fechado", porCategoria: [{ categoria: "Alimentação", total: 150 }, { categoria: "Lazer", total: 89.9 }] },
      parcelas: [{ vencimento: "10/08/2026", total: 89.9 }],
      horizonte: 6,
    },
  });
  const toggleFatura = comFatura.find((b) => b.type === "toggle" && b.toggle.rich_text[0].text.content.includes("Fatura Aberta"));
  assert.ok(toggleFatura);
  assert.strictEqual(toggleFatura.toggle.children.length, 2);
  const toggleParcelas = comFatura.find((b) => b.type === "toggle" && b.toggle.rich_text[0].text.content.includes("Parcelas futuras"));
  assert.ok(toggleParcelas);
  assert.ok(toggleParcelas.toggle.children[0].bulleted_list_item.rich_text[0].text.content.includes("10/08/2026"));
});

teste("blocosDashboardNotion: toggle de Previsão Próximo Mês mostra fixas/fatura/detalhes", () => {
  const blocos = blocosDashboardNotion({
    saldo: 0, saidas: 0, entradas: 0, categorias: [], metas: [],
    previsao: { mesPrevisto: "07/2026", gastos: { fixas: 1200, parcelas: 239.9, total: 1439.9 }, detalhes: [{ categoria: "Aluguel", valor: 1200 }, { categoria: "Fatura Cartão C6", valor: 239.9 }] },
  });
  const togglePrevisao = blocos.find((b) => b.type === "toggle" && b.toggle.rich_text[0].text.content.includes("Previsão"));
  assert.ok(togglePrevisao);
  assert.strictEqual(togglePrevisao.toggle.children.length, 4); // fixas + fatura + 2 detalhes
});

console.log(`\n${passou} teste(s) passaram.`);
