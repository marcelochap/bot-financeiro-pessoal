// Agregações do dashboard da reunião familiar — lógica pura. TDD em dashboard.test.js.
// Módulo Node consumido pelo runner (não é Code node n8n).
// Implementa gstack/specs/dashboard-reuniao-familiar.md.
const { proporcoes, normalizar, mesDe, arred, ehTransferencia, ehMovimentacaoPessoal, valorNum, categoriaExclusivaDe } = require("./rateio.js");
const { projetarComprometido, normalizarCiclo, vencimentoCicloAberto, mesesEntreVencimentos } = require("./fatura-aberta.js");

/** Saídas confirmadas do mês agrupadas por categoria, ordenadas desc. */
function gastosPorCategoria(lancamentos, mes) {
  const acc = new Map();
  for (const l of lancamentos) {
    if (l.tipo !== "saída" || l.status !== "confirmado" || mesDe(l.data_competencia) !== mes) continue;
    if (ehTransferencia(l.categoria) || ehMovimentacaoPessoal(l.categoria)) continue; // só gastos da casa
    acc.set(l.categoria, (acc.get(l.categoria) || 0) + valorNum(l.valor));
  }
  return [...acc.entries()]
    .map(([categoria, total]) => ({ categoria, total: arred(total) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Totais confirmados do mês: saídas, entradas, saldo. É a visão de FLUXO DE CAIXA — inclui
 * movimentações pessoais ("Depósito/Saída para o ..."), que o usuário quer ver entrando/saindo.
 * Só exclui transferências internas (pgto de fatura / aplicação CDB), que dobrariam contagem.
 * (Logo, `saidas` pode ser > Σ gastosPorCategoria, que mostra só os gastos da casa.)
 */
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
function previsaoProximoMes(lancamentos, contasFixas, salarios, mes, faturaAbertaRows) {
  const prop = proporcoes(salarios);
  const pessoas = Object.keys(prop);

  // 1. Gastos fixos ativos
  const fixas = arred((contasFixas || [])
    .filter((f) => normalizar(f.ativo) === "sim")
    .reduce((s, f) => s + valorNum(f.valor_esperado), 0));

  // 2. Fatura aberta fechada
  const faFechadas = (faturaAbertaRows || []).filter((r) => normalizar(r.status) === "fechado");
  const faturaTotal = arred(faFechadas.reduce((s, r) => s + valorNum(r.valor), 0));

  // 3. Gastos exclusivos/pessoais na fatura aberta
  const exclusivoFatura = {};
  for (const p of pessoas) {
    exclusivoFatura[p] = 0;
  }
  for (const r of faFechadas) {
    const dono = categoriaExclusivaDe(r.categoria_c6, pessoas);
    if (dono) {
      exclusivoFatura[dono] = arred(exclusivoFatura[dono] + valorNum(r.valor));
    }
  }
  const exclusivoFaturaTotal = arred(pessoas.reduce((s, p) => s + exclusivoFatura[p], 0));

  // 4. Base comum (compartilhada)
  const faturaBase = arred(faturaTotal - exclusivoFaturaTotal);
  const totalPrevistoBase = arred(fixas + faturaBase);

  // 5. Rateio da base proporcional ao salário (conservação de resíduo de arredondamento)
  const parteBase = {};
  let alocado = 0;
  pessoas.forEach((p, idx) => {
    if (idx === pessoas.length - 1) {
      parteBase[p] = arred(totalPrevistoBase - alocado);
    } else {
      parteBase[p] = arred(totalPrevistoBase * prop[p]);
      alocado = arred(alocado + parteBase[p]);
    }
  });

  // 6. Depósito previsto = cota base proporcional + gastos exclusivos individuais
  const depositosPrevistos = {};
  for (const p of pessoas) {
    depositosPrevistos[p] = arred(parteBase[p] + exclusivoFatura[p]);
  }

  // 7. Detalhes
  const detalhes = [];
  for (const f of contasFixas || []) {
    if (normalizar(f.ativo) === "sim") {
      detalhes.push({ categoria: f.nome, valor: valorNum(f.valor_esperado) });
    }
  }
  if (faturaTotal > 0) {
    detalhes.push({ categoria: "Fatura Cartão C6", valor: faturaTotal });
  }

  const total = arred(fixas + faturaTotal);

  return { gastos: { fixas, parcelas: faturaTotal, total }, detalhes, depositosPrevistos };
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
