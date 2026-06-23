// Relatório mensal financeiro (Telegram) — lógica pura. TDD em relatorio.test.js.
// Implementa gstack/plans/relatorio-mensal.md. Reusa dashboard.js e rateio.js (DRY).
const { totaisMes, gastosPorCategoria } = require("./dashboard.js");
const { rateioMes, mesDe, normalizar, arred, ehTransferencia, valorNum } = require("./rateio.js");

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "MM/YYYY" → "março/2025" (fallback ao próprio valor). */
function nomeMes(mes) {
  const m = /^(\d{2})\/(\d{4})$/.exec(String(mes));
  return m ? `${MESES[Number(m[1]) - 1] || m[1]}/${m[2]}` : String(mes);
}

/** Moeda BR: 1253 → "R$ 1.253,00" (sempre módulo; sinal tratado pelo chamador). */
function brl(n) {
  const [int, dec] = Math.abs(arred(Number(n))).toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

/** Escapa para parse_mode HTML do Telegram. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Contas fixas a pagar no mês vigente (`mesFixos` = "MM/YYYY"), com datas de
 * vencimento. Mensais: 1 linha cada (ordenada por dia). Empregada (semanal):
 * agrupada em 1 linha "sextas". Fatura do cartão: Σ origem="cartao" cuja
 * data_competencia (= vencimento) cai no mês; vencimento = Config.cartao_vencimento_dia.
 * @returns {{linhas: {nome,valor,vencimento,obs?}[], subtotal: number}}
 */
function contasFixasDoMes(contasFixas, lancamentos, config, mesFixos) {
  const linhas = [];
  for (const f of contasFixas || []) {
    if (normalizar(f.ativo) !== "sim") continue;
    const dia = Number(f.dia_vencimento);
    const numerico = Number.isFinite(dia) && String(f.dia_vencimento).trim() !== "";
    linhas.push({
      nome: f.nome,
      valor: arred(valorNum(f.valor_esperado)),
      vencimento: numerico ? `dia ${dia}` : "sextas",
      _dia: numerico ? dia : Infinity,
    });
  }

  const diaCartao = Number((config || {}).cartao_vencimento_dia) || 10;
  // Fatura LÍQUIDA do mês: saídas menos créditos/estornos (entrada). Antes somava
  // entrada como positivo (inflava) e não excluía transferências (ex.: pagamento
  // da própria fatura, se rotulado). Espelha o resumo.total do parser-cartao.
  const fatura = arred((lancamentos || [])
    .filter((l) => normalizar(l.origem) === "cartao" && !ehTransferencia(l.categoria)
      && mesDe(l.data_competencia) === mesFixos)
    .reduce((s, l) => s + (l.tipo === "entrada" ? -valorNum(l.valor) : valorNum(l.valor)), 0));
  const cartao = { nome: "Cartão C6", valor: fatura, vencimento: `dia ${diaCartao}`, _dia: diaCartao };
  if (fatura === 0) cartao.obs = "fatura ainda não importada";
  linhas.push(cartao);

  linhas.sort((a, b) => a._dia - b._dia);
  const subtotal = arred(linhas.reduce((s, l) => s + l.valor, 0));
  for (const l of linhas) delete l._dia;
  return { linhas, subtotal };
}

/** Idempotência do cron: false se já existe `relatorio_enviado` desse mesGastos. */
function deveEnviarCron(logs, mesGastos) {
  return !(logs || []).some(
    (l) => l.acao === "relatorio_enviado" && String(l.valor_anterior) === mesGastos);
}

/**
 * Monta o texto HTML do relatório.
 * @param {{lancamentos, contasFixas, salarios, config}} dados
 * @param {{mesGastos, mesFixos, urlPlanilha}} opts
 * @returns {{texto: string}}
 */
function montarRelatorio(dados, opts) {
  const { lancamentos, contasFixas, salarios, config } = dados;
  const { mesGastos, mesFixos, urlPlanilha } = opts;
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

  L.push("", "<b>Rateio</b>");
  try {
    const r = rateioMes(lancamentos, salarios, mesGastos);
    for (const p of Object.keys(r.acerto)) {
      const a = r.acerto[p];
      const txt = a > 0 ? `deve ${brl(a)}` : a < 0 ? `crédito ${brl(a)}` : "quitado";
      L.push(`• ${esc(p)}: ${txt}`);
    }
  } catch (e) {
    L.push("⚠️ rateio indisponível (configure a aba Salários)");
  }

  const fix = contasFixasDoMes(contasFixas, lancamentos, config, mesFixos);
  L.push("", `<b>Contas fixas — ${esc(nomeMes(mesFixos))}</b>`);
  for (const l of fix.linhas) {
    const obs = l.obs ? ` (${esc(l.obs)})` : "";
    L.push(`• ${esc(l.nome)} — ${brl(l.valor)} — ${esc(l.vencimento)}${obs}`);
  }
  L.push(`Subtotal: ${brl(fix.subtotal)}`);

  if (urlPlanilha) L.push("", `🔗 <a href="${esc(urlPlanilha)}">Dashboard</a>`);

  return { texto: L.join("\n") };
}

module.exports = { contasFixasDoMes, deveEnviarCron, montarRelatorio, nomeMes, brl, esc };
