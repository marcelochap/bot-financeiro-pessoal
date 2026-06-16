// Rateio proporcional ao salário — lógica pura do dashboard da reunião familiar.
// TDD em rateio.test.js. Módulo Node consumido pelo runner (não é Code node n8n).
// Implementa gstack/specs/dashboard-reuniao-familiar.md.

/** Remove acento e caixa para comparar categorias/nomes (Deposito ~ Depósito). */
function normalizar(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

const arred = (n) => Math.round(n * 100) / 100;

/** salarios: {pessoa: salario} ou [{pessoa, salario}] → {pessoa: proporção}. */
function proporcoes(salarios) {
  const pares = Array.isArray(salarios)
    ? salarios.map((s) => [s.pessoa, Number(s.salario)])
    : Object.entries(salarios).map(([p, v]) => [p, Number(v)]);
  const total = pares.reduce((s, [, v]) => s + v, 0);
  if (!(total > 0)) throw new Error("soma dos salários deve ser > 0 (configurar aba Salários)");
  const out = {};
  for (const [p, v] of pares) out[p] = v / total;
  return out;
}

/** "DD/MM/YYYY" → "MM/YYYY" | null. */
function mesDe(ddmmyyyy) {
  const m = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(String(ddmmyyyy).trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Rateio do mês (`mes` = "MM/YYYY"). Cota = despesas confirmadas do mês ×
 * proporção; pago = depósitos "Deposito {pessoa}" do mês; saldo = pago − cota;
 * acerto = cota − pago (positivo = a pessoa deve esse valor da sua parte).
 * @returns {{mes, totalDespesas, proporcoes, cota, pago, saldo, acerto}}
 */
function rateioMes(lancamentos, salarios, mes) {
  const prop = proporcoes(salarios);
  const doMes = lancamentos.filter((l) => mesDe(l.data_competencia) === mes);
  const totalDespesas = arred(
    doMes.filter((l) => l.tipo === "saída" && l.status === "confirmado")
      .reduce((s, l) => s + Number(l.valor), 0));

  const cota = {}, pago = {}, saldo = {}, acerto = {};
  for (const p of Object.keys(prop)) {
    cota[p] = arred(totalDespesas * prop[p]);
    const alvo = normalizar(`deposito ${p}`);
    pago[p] = arred(
      doMes.filter((l) => l.tipo === "entrada" && normalizar(l.categoria) === alvo)
        .reduce((s, l) => s + Number(l.valor), 0));
    saldo[p] = arred(pago[p] - cota[p]);
    acerto[p] = arred(cota[p] - pago[p]);
  }
  return { mes, totalDespesas, proporcoes: prop, cota, pago, saldo, acerto };
}

module.exports = { proporcoes, rateioMes, normalizar, mesDe, arred };
