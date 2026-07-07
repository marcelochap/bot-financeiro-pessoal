// Resumo mensal do dashboard em blocos NATIVOS do Notion (callout de saldo, colunas
// para saídas/entradas, toggle por categoria/metas — não mais um parágrafo de texto
// único). Reaproveita totaisMes/gastosPorCategoria (dashboard.js), arred (rateio.js)
// e calcularProgresso (metas.js) sem alteração. Requires normais (mesmo padrão de
// relatorio-notion-extra.js) — o gerador remove essas linhas antes de concatenar tudo
// num só Code node.
const { totaisMes, gastosPorCategoria, comprometidoFuturo, previsaoProximoMes } = require("../../workflows/src/dashboard.js");
const { arred } = require("../../workflows/src/rateio.js");
const { calcularProgresso } = require("../../workflows/src/metas.js");

function brl(n) {
  const [int, dec] = Math.abs(arred(Number(n))).toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

// Notion não tem bloco nativo de barra de progresso — simula com blocos Unicode
// cheios/vazios dentro do texto. pct null (sem orçamento definido) → sem barra.
function barraUnicode(pct) {
  if (pct === null || pct === undefined) return "";
  const cheio = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `${"▓".repeat(cheio)}${"░".repeat(10 - cheio)} ${pct}%`;
}

/**
 * @param {{lancamentos, contasFixas, metas, faturaAbertaRows, parcelasRows, configRows,
 *   hojeISO, mesPrevisto}} dados metas = SÓ as ativas (aba/database já filtrada).
 *   `hojeISO`/`mesPrevisto` são OPCIONAIS: só presentes → calcula comprometido/previsão
 *   (Fase E). Sem eles, o resumo fica igual ao da Fase D (retrocompat).
 * @param {string} mes "MM/YYYY"
 * @returns {{saidas, entradas, saldo, metasAtivas, categorias, metas, comprometido?, previsao?}}
 *   dados estruturados (sem formatação de bloco — isso fica a cargo de blocosDashboardNotion)
 */
function montarResumoDashboardNotion(dados, mes) {
  const { lancamentos, contasFixas, metas, faturaAbertaRows, parcelasRows, configRows, hojeISO, mesPrevisto } = dados;
  const tot = totaisMes(lancamentos, mes);
  const cats = gastosPorCategoria(lancamentos, mes, contasFixas, []);
  const prog = calcularProgresso(metas, lancamentos);

  const categorias = cats.slice(0, 10).map((c) => ({
    categoria: c.categoria,
    confirmado: c.confirmado,
    orcamento: c.orcamento,
    pct: c.orcamento > 0 ? Math.round((c.confirmado / c.orcamento) * 100) : null,
  }));

  const metasAtivas = prog.map((p) => ({
    nome: p.nome,
    acumulado: p.acumulado,
    orcamento: p.orcamento,
    pct: p.pct,
    prazo: p.prazo,
  }));

  const resumo = {
    saidas: tot.saidas,
    entradas: tot.entradas,
    saldo: tot.saldo,
    metasAtivas: metasAtivas.length,
    categorias,
    metas: metasAtivas,
  };

  // Comprometido futuro (fatura aberta do ciclo corrente + projeção de parcelas) —
  // prospectivo a partir de hojeISO, independente do mês selecionado (mesma semântica
  // do dashboard-web v2). Individual: sem depositosPrevistos (isso é rateio/casal).
  if (hojeISO) {
    resumo.comprometido = comprometidoFuturo(faturaAbertaRows || [], parcelasRows || [], configRows || [], hojeISO);
  }
  if (mesPrevisto) {
    // { Harumi: 1 } força proporcoes() a 100% — instância individual, sem rateio.
    // Só gastos/detalhes são usados; depositosPrevistos (rateio) é descartado.
    const previsao = previsaoProximoMes(lancamentos, contasFixas, { Harumi: 1 }, mesPrevisto, faturaAbertaRows || []);
    resumo.previsao = { mesPrevisto, gastos: previsao.gastos, detalhes: previsao.detalhes };
  }

  return resumo;
}

// Monta os blocos filhos da página do mês: callout de saldo (verde/vermelho conforme
// sinal) + colunas de saídas/entradas + divisor + toggle "Por categoria" + toggle
// "Metas ativas" (toggles omitidos se a lista correspondente estiver vazia — mesmo
// comportamento da versão em texto que este código substitui).
function blocosDashboardNotion(resumo) {
  const positivo = resumo.saldo >= 0;

  const blocos = [
    {
      object: "block",
      type: "callout",
      callout: {
        icon: { type: "emoji", emoji: positivo ? "✅" : "⚠️" },
        color: positivo ? "green_background" : "red_background",
        rich_text: [{ text: { content: `Saldo do mês: ${brl(resumo.saldo)}` }, annotations: { bold: true } }],
      },
    },
    {
      object: "block",
      type: "column_list",
      column_list: {
        children: [
          {
            object: "block",
            type: "column",
            column: {
              children: [
                { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: `Saídas\n${brl(resumo.saidas)}` } }] } },
              ],
            },
          },
          {
            object: "block",
            type: "column",
            column: {
              children: [
                { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: `Entradas\n${brl(resumo.entradas)}` } }] } },
              ],
            },
          },
        ],
      },
    },
    { object: "block", type: "divider", divider: {} },
  ];

  if (resumo.categorias.length) {
    blocos.push({
      object: "block",
      type: "toggle",
      toggle: {
        rich_text: [{ text: { content: "📊 Por categoria" } }],
        children: resumo.categorias.map((c) => ({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                text: {
                  content:
                    `${c.categoria}: ${brl(c.confirmado)}` +
                    (c.orcamento > 0 ? `  de ${brl(c.orcamento)}  ${barraUnicode(c.pct)}` : ""),
                },
              },
            ],
          },
        })),
      },
    });
  }

  if (resumo.metas.length) {
    blocos.push({
      object: "block",
      type: "toggle",
      toggle: {
        rich_text: [{ text: { content: "🎯 Metas ativas" } }],
        children: resumo.metas.map((m) => ({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                text: {
                  content:
                    `${m.nome}: ${brl(m.acumulado)}` +
                    (m.orcamento > 0 ? `  / ${brl(m.orcamento)}  ${barraUnicode(m.pct)}` : "") +
                    `  · até ${m.prazo}`,
                },
              },
            ],
          },
        })),
      },
    });
  }

  // Comprometido Futuro (Fase E) — só aparece se o resumo foi calculado com hojeISO
  // (ver montarResumoDashboardNotion). Sem fatura/parcela ainda capturada → aviso em
  // vez de toggle vazio (nada pra recolher).
  if (resumo.comprometido) {
    const fa = resumo.comprometido.faturaAberta;
    if (fa) {
      blocos.push({
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: [{ text: { content: `🧾 Fatura Aberta — vence ${fa.ciclo} — ${brl(fa.total)}` } }],
          children: fa.porCategoria.map((c) => ({
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: [{ text: { content: `${c.categoria}: ${brl(c.total)}` } }] },
          })),
        },
      });
    } else {
      blocos.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ text: { content: "🧾 Nenhuma fatura aberta capturada — use /faturaaberta (colar ou enviar .txt)." } }],
        },
      });
    }

    const parcelasFuturas = resumo.comprometido.parcelas.filter((p) => p.total > 0);
    if (parcelasFuturas.length) {
      blocos.push({
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: [{ text: { content: "📅 Parcelas futuras" } }],
          children: parcelasFuturas.map((p) => ({
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: [{ text: { content: `${p.vencimento}: ${brl(p.total)}` } }] },
          })),
        },
      });
    } else {
      blocos.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ text: { content: "📅 Nenhuma parcela futura projetada — use /seedparcelas." } }] },
      });
    }
  }

  // Previsão Próximo Mês (Fase E) — contas fixas + fatura fechada que vence no mês
  // seguinte. Sem depósito previsto (rateio/casal) — só o total e o detalhamento.
  if (resumo.previsao) {
    const p = resumo.previsao;
    blocos.push({
      object: "block",
      type: "toggle",
      toggle: {
        rich_text: [{ text: { content: `🔮 Previsão — ${p.mesPrevisto} — total ${brl(p.gastos.total)}` } }],
        children: [
          {
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: [{ text: { content: `Contas fixas: ${brl(p.gastos.fixas)}` } }] },
          },
          {
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: [{ text: { content: `Fatura do cartão: ${brl(p.gastos.parcelas)}` } }] },
          },
          ...p.detalhes.map((d) => ({
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: { rich_text: [{ text: { content: `${d.categoria}: ${brl(d.valor)}` } }] },
          })),
        ],
      },
    });
  }

  return blocos;
}

module.exports = { montarResumoDashboardNotion, blocosDashboardNotion, barraUnicode };
