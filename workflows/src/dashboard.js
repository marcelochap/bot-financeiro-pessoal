// Agregações do dashboard da reunião familiar — lógica pura. TDD em dashboard.test.js.
// Módulo Node consumido pelo runner (não é Code node n8n).
// Implementa gstack/specs/dashboard-reuniao-familiar.md.
const { proporcoes, normalizar, mesDe, arred } = require("./rateio.js");

/** Saídas confirmadas do mês agrupadas por categoria, ordenadas desc. */
function gastosPorCategoria(lancamentos, mes) {
  const acc = new Map();
  for (const l of lancamentos) {
    if (l.tipo !== "saída" || l.status !== "confirmado" || mesDe(l.data_competencia) !== mes) continue;
    acc.set(l.categoria, (acc.get(l.categoria) || 0) + Number(l.valor));
  }
  return [...acc.entries()]
    .map(([categoria, total]) => ({ categoria, total: arred(total) }))
    .sort((a, b) => b.total - a.total);
}

/** Totais confirmados do mês: saídas, entradas, saldo. */
function totaisMes(lancamentos, mes) {
  const soma = (tipo) => arred(lancamentos
    .filter((l) => l.tipo === tipo && l.status === "confirmado" && mesDe(l.data_competencia) === mes)
    .reduce((s, l) => s + Number(l.valor), 0));
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
  const catsNoMes = new Set(doMes.map((l) => normalizar(l.categoria)));

  const parcelas = arred(doMes
    .filter((l) => l.tipo === "saída" && l.status === "previsto")
    .reduce((s, l) => s + Number(l.valor), 0));
  const fixas = arred((contasFixas || [])
    .filter((f) => normalizar(f.ativo) === "sim" && !catsNoMes.has(normalizar(f.nome)))
    .reduce((s, f) => s + Number(f.valor_esperado), 0));
  const total = arred(fixas + parcelas);

  const prop = proporcoes(salarios);
  const depositosPrevistos = {};
  for (const p of Object.keys(prop)) depositosPrevistos[p] = arred(total * prop[p]);

  return { gastos: { fixas, parcelas, total }, depositosPrevistos };
}

module.exports = { gastosPorCategoria, totaisMes, previsaoProximoMes };

// CLI: lê os dados das abas (JSON por stdin) e emite o bundle do dashboard.
// Só roda quando invocado direto — não afeta os exports nem os testes.
if (require.main === module) {
  const { rateioMes } = require("./rateio.js");
  let buf = "";
  process.stdin.on("data", (d) => (buf += d)).on("end", () => {
    const { lancamentos, contasFixas, salarios, mesPassado, mesPrevisao } = JSON.parse(buf);
    process.stdout.write(JSON.stringify({
      mesPassado, mesPrevisao,
      totais: totaisMes(lancamentos, mesPassado),
      gastos: gastosPorCategoria(lancamentos, mesPassado),
      rateio: rateioMes(lancamentos, salarios, mesPassado),
      previsao: previsaoProximoMes(lancamentos, contasFixas, salarios, mesPrevisao),
    }));
  });
}
