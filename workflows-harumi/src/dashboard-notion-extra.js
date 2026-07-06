// Resumo mensal do dashboard em texto plano (sem HTML — vira o corpo de UM bloco de
// parágrafo do Notion, que preserva quebras de linha embutidas). Reaproveita
// totaisMes/gastosPorCategoria (dashboard.js), arred (rateio.js) e calcularProgresso
// (metas.js) sem alteração. Requires normais (mesmo padrão de relatorio-notion-extra.js)
// — o gerador remove essas linhas antes de concatenar tudo num só Code node.
const { totaisMes, gastosPorCategoria } = require("../../workflows/src/dashboard.js");
const { arred } = require("../../workflows/src/rateio.js");
const { calcularProgresso } = require("../../workflows/src/metas.js");

function brl(n) {
  const [int, dec] = Math.abs(arred(Number(n))).toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

/**
 * @param {{lancamentos, contasFixas, metas}} dados metas = SÓ as ativas (aba/database já filtrada)
 * @param {string} mes "MM/YYYY"
 * @returns {{saidas, entradas, saldo, metasAtivas, texto}} texto = corpo do bloco Notion
 */
function montarResumoDashboardNotion(dados, mes) {
  const { lancamentos, contasFixas, metas } = dados;
  const tot = totaisMes(lancamentos, mes);
  const cats = gastosPorCategoria(lancamentos, mes, contasFixas, []);
  const prog = calcularProgresso(metas, lancamentos);

  const L = [];
  L.push(`Saídas: ${brl(tot.saidas)}`);
  L.push(`Entradas: ${brl(tot.entradas)}`);
  L.push(`Saldo: ${brl(tot.saldo)}${tot.saldo < 0 ? " (negativo)" : ""}`);

  if (cats.length) {
    L.push("");
    L.push("Por categoria:");
    for (const c of cats.slice(0, 10)) {
      const pct = c.orcamento > 0 ? ` de ${brl(c.orcamento)} (${Math.round((c.confirmado / c.orcamento) * 100)}%)` : "";
      L.push(`• ${c.categoria}: ${brl(c.confirmado)}${pct}`);
    }
  }

  if (prog.length) {
    L.push("");
    L.push("Metas ativas:");
    for (const p of prog) {
      const alvo = p.orcamento > 0 ? ` / ${brl(p.orcamento)}` : "";
      const pct = p.pct === null ? "" : ` (${p.pct}%)`;
      L.push(`🎯 ${p.nome}: ${brl(p.acumulado)}${alvo}${pct} · até ${p.prazo}`);
    }
  }

  return { saidas: tot.saidas, entradas: tot.entradas, saldo: tot.saldo, metasAtivas: prog.length, texto: L.join("\n") };
}

module.exports = { montarResumoDashboardNotion };
