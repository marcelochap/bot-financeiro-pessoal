// Variante individual (sem rateio) de workflows/src/relatorio.js#montarRelatorio.
// Reaproveita totaisMes/gastosPorCategoria (dashboard.js) e contasFixasDoMes/nomeMes/
// brl/esc (relatorio.js) SEM MODIFICÁ-LOS — só omite a seção "Rateio" (que depende de
// Salários, um conceito exclusivo do modo casal e que não existe no Notion da Harumi).
// Requires normais (como o próprio relatorio.js faz) — o gerador remove essas linhas
// (semRequireLocal, mesmo padrão de scripts/gerar-workflow-relatorio.js) antes de
// concatenar tudo num só Code node; aqui eles só existem pra este arquivo ser
// testável via `node relatorio-notion-extra.test.js` normal.
const { totaisMes, gastosPorCategoria } = require("../../workflows/src/dashboard.js");
const { arred } = require("../../workflows/src/rateio.js");
const { contasFixasDoMes, nomeMes, brl, esc } = require("../../workflows/src/relatorio.js");

/**
 * @param {{lancamentos, contasFixas, config}} dados (sem `salarios` — modo individual)
 * @param {{mesGastos, mesFixos, urlDashboard}} opts urlDashboard opcional (Fase D adiciona o link)
 */
function montarRelatorioIndividual(dados, opts) {
  const { lancamentos, contasFixas, config } = dados;
  const { mesGastos, mesFixos, urlDashboard } = opts;
  const L = [];

  const tot = totaisMes(lancamentos, mesGastos);
  L.push(`📊 <b>Relatório — ${esc(nomeMes(mesGastos))}</b>`, "");
  L.push("<b>Gastos do mês</b>");
  L.push(`Saídas: ${brl(tot.saidas)}`);
  L.push(`Entradas: ${brl(tot.entradas)}`);
  L.push(`Saldo: ${brl(tot.saldo)}${tot.saldo < 0 ? " (negativo)" : ""}`);

  const cats = gastosPorCategoria(lancamentos, mesGastos);
  if (cats.length) {
    L.push("", "<b>Por categoria</b>");
    for (const c of cats.slice(0, 5)) L.push(`• ${esc(c.categoria)}: ${brl(c.confirmado)}`);
    const resto = arred(cats.slice(5).reduce((s, c) => s + c.confirmado, 0));
    if (resto > 0) L.push(`• Outras: ${brl(resto)}`);
  }

  const fix = contasFixasDoMes(contasFixas, lancamentos, config, mesFixos);
  L.push("", `<b>Contas fixas — ${esc(nomeMes(mesFixos))}</b>`);
  for (const l of fix.linhas) {
    const obs = l.obs ? ` (${esc(l.obs)})` : "";
    L.push(`• ${esc(l.nome)} — ${brl(l.valor)} — ${esc(l.vencimento)}${obs}`);
  }
  L.push(`Subtotal: ${brl(fix.subtotal)}`);

  if (urlDashboard) L.push("", `🔗 <a href="${esc(urlDashboard)}">Dashboard</a>`);

  return { texto: L.join("\n") };
}

module.exports = { montarRelatorioIndividual };
