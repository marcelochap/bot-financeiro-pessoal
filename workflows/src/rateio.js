// Rateio proporcional ao salário — lógica pura do dashboard da reunião familiar.
// TDD em rateio.test.js. Módulo Node consumido pelo runner (não é Code node n8n).
// Implementa gstack/specs/dashboard-reuniao-familiar.md.

/** Remove acento e caixa para comparar categorias/nomes (Deposito ~ Depósito). */
function normalizar(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

const arred = (n) => Math.round(n * 100) / 100;

/**
 * Valor da planilha → número. Defesa contra `valor` gravado como TEXTO (ex.: o nó
 * googleSheets em USER_ENTERED + locale pt_BR pode coagir "1011.87" a texto). Aceita
 * número nativo, "1011.87" (ponto decimal), BR "1.011,56"/"1011,56" e "R$ 1.234,56".
 * Lixo/vazio → 0 (nunca NaN — NaN envenenaria a soma inteira do relatório).
 */
function valorNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  let s = String(v).trim().replace(/^R\$\s*/i, "");
  if (s === "") return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");        // BR: ponto=milhar, vírgula=decimal
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");   // só pontos múltiplos = milhar
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Categorias de transferência interna — movimentação entre contas próprias
 * (ex.: pagar a fatura do cartão, resgate/aplicação, Pix para si mesmo). NÃO são
 * consumo nem receita: o gasto real já está nas compras da fatura (origem=cartao)
 * e contá-las de novo no extrato duplicaria. O parser resolve "Pagamento/Retirada"
 * para uma destas conforme a direção (entrada→Pagamento, saída→Retirada).
 */
const CATEGORIAS_TRANSFERENCIA = new Set(["pagamento", "retirada"]);
function ehTransferencia(categoria) {
  return CATEGORIAS_TRANSFERENCIA.has(normalizar(categoria));
}

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

/**
 * Data da planilha → "MM/YYYY" | null. Aceita os três formatos que o nó de
 * leitura pode devolver (valueRenderOption=UNFORMATTED_VALUE):
 *   - "DD/MM/YYYY" (string) ;
 *   - "YYYY-MM-DD" (string ISO) ;
 *   - serial do Sheets (número ou string só-dígitos): célula formatada como
 *     Data volta como dias desde 1899-12-30, não como string.
 */
function mesDe(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const serial = Math.floor(Number(v));
    if (!Number.isFinite(serial) || serial <= 0) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  }
  const s = String(v).trim();
  let m;
  if ((m = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(s))) return `${m[1]}/${m[2]}`;
  if ((m = /^(\d{4})-(\d{2})-\d{2}/.exec(s))) return `${m[2]}/${m[1]}`;
  return null;
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
    doMes.filter((l) => l.tipo === "saída" && l.status === "confirmado" && !ehTransferencia(l.categoria))
      .reduce((s, l) => s + valorNum(l.valor), 0));

  const cota = {}, pago = {}, saldo = {}, acerto = {};
  for (const p of Object.keys(prop)) {
    cota[p] = arred(totalDespesas * prop[p]);
    const alvo = normalizar(`deposito ${p}`);
    pago[p] = arred(
      doMes.filter((l) => l.tipo === "entrada" && normalizar(l.categoria) === alvo)
        .reduce((s, l) => s + valorNum(l.valor), 0));
    saldo[p] = arred(pago[p] - cota[p]);
    acerto[p] = arred(cota[p] - pago[p]);
  }
  return { mes, totalDespesas, proporcoes: prop, cota, pago, saldo, acerto };
}

module.exports = { proporcoes, rateioMes, normalizar, mesDe, arred, ehTransferencia, valorNum };
