// Agregações do dashboard da reunião familiar — lógica pura. TDD em dashboard.test.js.
// Módulo Node consumido pelo runner (não é Code node n8n).
// Implementa gstack/specs/dashboard-reuniao-familiar.md.
const { proporcoes, normalizar, mesDe, arred, ehTransferencia, valorNum } = require("./rateio.js");
const { projetarComprometido, normalizarCiclo, vencimentoCicloAberto, mesesEntreVencimentos } = require("./fatura-aberta.js");

/** Saídas confirmadas do mês agrupadas por categoria, ordenadas desc. */
function gastosPorCategoria(lancamentos, mes) {
  const acc = new Map();
  for (const l of lancamentos) {
    if (l.tipo !== "saída" || l.status !== "confirmado" || mesDe(l.data_competencia) !== mes) continue;
    if (ehTransferencia(l.categoria)) continue;
    acc.set(l.categoria, (acc.get(l.categoria) || 0) + valorNum(l.valor));
  }
  return [...acc.entries()]
    .map(([categoria, total]) => ({ categoria, total: arred(total) }))
    .sort((a, b) => b.total - a.total);
}

/** Totais confirmados do mês: saídas, entradas, saldo. */
function totaisMes(lancamentos, mes) {
  const soma = (tipo) => arred(lancamentos
    .filter((l) => l.tipo === tipo && l.status === "confirmado" && mesDe(l.data_competencia) === mes
      && !ehTransferencia(l.categoria))
    .reduce((s, l) => s + valorNum(l.valor), 0));
  const saidas = soma("saída");
  const entradas = soma("entrada");
  return { saidas, entradas, saldo: arred(entradas - saidas) };
}

/**
 * Previsão do próximo mês (`mes` = "MM/YYYY"): parcelas já lançadas (saídas
 * previstas do mês) + projeção das contas fixas ativas cuja categoria ainda NÃO
 * aparece no mês. Depósitos previstos = total × proporção (regra do Marcelo).
 * @param {{nome, valor_esperado, ativo}[]} contasFixas aba Contas Fixas
 * @returns {{gastos:{fixas,parcelas,total}, depositosPrevistos:{[pessoa]:number}}}
 */
function previsaoProximoMes(lancamentos, contasFixas, salarios, mes) {
  const doMes = lancamentos.filter((l) => mesDe(l.data_competencia) === mes);

  // C2: provisórios da fatura aberta (origem=fatura-aberta) NÃO entram aqui — eles têm
  // bloco próprio ("Comprometido futuro", v2); somá-los duplicaria o comprometido.
  const parcelas = arred(doMes
    .filter((l) => l.tipo === "saída" && l.status === "previsto" && l.origem !== "fatura-aberta")
    .reduce((s, l) => s + valorNum(l.valor), 0));
  const fixas = arred((contasFixas || [])
    .filter((f) => normalizar(f.ativo) === "sim")
    .reduce((s, f) => s + valorNum(f.valor_esperado), 0));
  const total = arred(fixas + parcelas);

  const detalhes = [];
  for (const f of contasFixas || []) {
    if (normalizar(f.ativo) === "sim") {
      detalhes.push({ categoria: f.nome, valor: valorNum(f.valor_esperado) });
    }
  }
  for (const l of doMes) {
    if (l.tipo === "saída" && l.status === "previsto" && l.origem !== "fatura-aberta") {
      detalhes.push({ categoria: l.categoria || "Parcela", valor: valorNum(l.valor) });
    }
  }

  const prop = proporcoes(salarios);
  const depositosPrevistos = {};
  for (const p of Object.keys(prop)) depositosPrevistos[p] = arred(total * prop[p]);

  return { gastos: { fixas, parcelas, total }, detalhes, depositosPrevistos };
}

/**
 * Comprometido futuro (v2): fatura aberta do ciclo corrente + projeção das parcelas.
 * Prospectivo a partir de `hojeISO` (YYYY-MM-DD) — independe do seletor de mês. Bloco
 * separado da previsão (anti-dupla-contagem): a projeção é derivada da aba `Parcelas`,
 * nunca de `Lançamentos`.
 * @param {object[]} faturaAbertaRows linhas da aba FaturaAberta (A:G)
 * @param {object[]} parcelasRows linhas da aba Parcelas (A:E) — ciclo_referencia em serial
 * @param {object[]} configRows aba Config (chave|valor) — comprometido_horizonte (default 6)
 * @returns {{faturaAberta:{ciclo,total,status,porCategoria}|null, parcelas:{vencimento,total}[], horizonte:number}}
 */
function comprometidoFuturo(faturaAbertaRows, parcelasRows, configRows, hojeISO) {
  let horizonte = 6;
  const cfg = (configRows || []).find((r) => normalizar(r.chave) === "comprometido_horizonte");
  if (cfg && Math.floor(Number(cfg.valor)) > 0) horizonte = Math.floor(Number(cfg.valor));

  // Fatura aberta: só status='fechado' (R3 — rascunho/não-fechado fora do dashboard).
  let faFechadas = (faturaAbertaRows || []).filter((r) => normalizar(r.status) === "fechado");
  let faturaAberta = null;
  if (faFechadas.length) {
    // A aba é clear+write de um único ciclo; mas se sobrarem 'fechado' de ciclos diferentes
    // (reseed parcial), ancora no ciclo mais recente — evita total e rótulo divergirem.
    const ciclos = [...new Set(faFechadas.map((r) => normalizarCiclo(r.ciclo)))]
      .filter(Boolean)
      .sort((a, b) => -(mesesEntreVencimentos(a, b) || 0)); // crescente (mesesEntre = b−a)
    const ciclo = ciclos[ciclos.length - 1];
    faFechadas = faFechadas.filter((r) => normalizarCiclo(r.ciclo) === ciclo);
    const total = arred(faFechadas.reduce((s, r) => s + valorNum(r.valor), 0));
    const catMap = new Map();
    for (const r of faFechadas) {
      const c = (r.categoria_c6 && String(r.categoria_c6).trim()) || "Outros";
      catMap.set(c, (catMap.get(c) || 0) + valorNum(r.valor));
    }
    const porCategoria = [...catMap.entries()]
      .map(([categoria, t]) => ({ categoria, total: arred(t) }))
      .sort((a, b) => b.total - a.total);
    faturaAberta = { ciclo, total, status: "fechado", porCategoria };
  }

  // Âncora = max(ciclo da fatura aberta, vencimento do ciclo aberto de hoje) — Q2.
  // Se vencHoje falhar (hoje malformado), usa o ciclo da fatura aberta como âncora.
  const vencHoje = vencimentoCicloAberto(hojeISO);
  let ancora = vencHoje;
  if (faturaAberta && (!vencHoje || mesesEntreVencimentos(vencHoje, faturaAberta.ciclo) > 0)) {
    ancora = faturaAberta.ciclo;
  }

  const parcelaRows = (parcelasRows || []).map((r) => ({
    estabelecimento: r.estabelecimento,
    valor: valorNum(r.valor),
    M: Number(r.M),
    N_no_seed: Number(r.N_no_seed),
    ciclo_referencia: normalizarCiclo(r.ciclo_referencia),
  }));
  const parcelas = ancora ? projetarComprometido(parcelaRows, ancora, horizonte) : [];
  return { faturaAberta, parcelas, horizonte };
}

module.exports = { gastosPorCategoria, totaisMes, previsaoProximoMes, comprometidoFuturo };
