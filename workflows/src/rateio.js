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

/** "MM/YYYY" → número YYYYMM comparável (ex.: "05/2026" → 202605); inválido → null. */
function mesParaNum(mes) {
  const m = /^(\d{2})\/(\d{4})$/.exec(String(mes == null ? "" : mes).trim());
  if (!m) return null;
  return Number(m[2]) * 100 + Number(m[1]);
}

/**
 * Pessoa dona de uma categoria exclusiva "Gastos {pessoa}", ou null. Despesa
 * exclusiva NÃO é dividida por salário: é cobrada 100% de quem é (decisão do Marcelo).
 */
function categoriaExclusivaDe(categoria, pessoas) {
  const c = normalizar(categoria);
  for (const p of pessoas) {
    if (c === "gastos " + normalizar(p)) return p;
  }
  return null;
}

/**
 * Movimentação PESSOAL (não é da casa): "Depósito para o/a {pessoa}" (entrada) e
 * "Saída para o/a {pessoa}" (saída). Dinheiro que passou pela conta mas é pessoal —
 * ex.: Pix de terceiros que era do Marcelo + o Pix que ele mandou de volta p/ si.
 * APARECE no fluxo de caixa (entradas/saídas), mas é NEUTRA ao rateio: não é
 * contribuição (pago) nem custo/dívida da casa (base/cota). Distingue-se de "Retirada"
 * (pgto de fatura / aplicação CDB), que é transferência excluída de tudo.
 */
function ehMovimentacaoPessoal(categoria) {
  const c = normalizar(categoria);
  return /^deposito para /.test(c) || /^saida para /.test(c);
}

/**
 * Categoria de META ("Meta: Viagem Lua de Mel", "Meta: IPTU", ...). É poupança/objetivo
 * rastreado à parte na aba Metas — NÃO é despesa mensal compartilhada da casa. Fica FORA
 * do rateio e do treemap de gastos da casa (decisão do Marcelo). Aparece no fluxo de caixa.
 */
function ehMeta(categoria) {
  return /^meta:/.test(normalizar(categoria));
}

/**
 * Resgate de CDB associado a uma meta E marcado para abater a Cota da Casa
 * ("Meta: <nome> (abatimento cdb)", gravado pelo botão `metaab|` da categorização —
 * gstack/specs/resgate-cdb-abatimento.md). Ao contrário de `ehMeta` (poupança à parte,
 * 100% fora do rateio), esta variante É uma entrada que reduz a despesa compartilhada
 * do mês — o resgate cobriu parte de uma conta da casa, então conta como "despesa a
 * menos" antes do split proporcional, não como depósito de uma pessoa só.
 */
function ehAbatimentoCdb(categoria) {
  return /^meta:.*\(abatimento cdb\)$/.test(normalizar(categoria));
}

/**
 * Núcleo do rateio sobre um conjunto JÁ filtrado de lançamentos (DRY entre rateioMes
 * e rateioAcumulado). `prop` = proporções por pessoa (de proporcoes()).
 * - base dividida = saídas confirmadas não-transferência, não-exclusivas e não-pessoais;
 * - exclusivo[p] = Σ saídas confirmadas "Gastos {p}" (100% da pessoa);
 * - cota[p] = base × prop[p] + exclusivo[p];   pago[p] = entradas "Depósito {p}";
 * - saldo = pago − cota;  acerto = cota − pago (positivo = a pessoa deve).
 * Movimentações pessoais ("Depósito/Saída para o ...") são IGNORADAS aqui (neutras).
 * Resgate de CDB marcado como abatimento (`ehAbatimentoCdb`, entrada) SUBTRAI de
 * `base` — é uma despesa a menos da casa, dividida por todos na mesma proporção,
 * não um depósito de uma pessoa só. Pode deixar `base` negativa (raro, sem clamp).
 * Conservação: Σ cotas = base + Σ exclusivos = Σ saídas confirmadas não-transferência/pessoais.
 * @returns {{totalDespesas, cota, pago, saldo, acerto}}
 */
function calcularRateio(lancamentos, prop) {
  const pessoas = Object.keys(prop);
  const exclusivo = {};
  for (const p of pessoas) exclusivo[p] = 0;
  let base = 0;
  for (const l of lancamentos) {
    if (l.status !== "confirmado") continue;
    if (l.tipo === "entrada") {
      if (ehAbatimentoCdb(l.categoria)) base = arred(base - valorNum(l.valor));
      continue;
    }
    if (l.tipo !== "saída") continue;
    // fora do rateio: transferência interna, movimentação pessoal e Metas (poupança à parte)
    if (ehTransferencia(l.categoria) || ehMovimentacaoPessoal(l.categoria) || ehMeta(l.categoria)) continue;
    const dono = categoriaExclusivaDe(l.categoria, pessoas);
    if (dono) exclusivo[dono] = arred(exclusivo[dono] + valorNum(l.valor));
    else base = arred(base + valorNum(l.valor));
  }
  const totalDespesas = arred(base + pessoas.reduce((s, p) => s + exclusivo[p], 0));

  // Divide a base entre as pessoas; a ÚLTIMA absorve o resíduo de arredondamento para
  // garantir Σ(parte dividida) == base exatamente — sem dívida-fantasma de R$ 0,01 no
  // saldo cumulativo (que nunca quitaria). O exclusivo de cada um soma à parte dele.
  const parteBase = {};
  let alocado = 0;
  pessoas.forEach((p, idx) => {
    if (idx === pessoas.length - 1) parteBase[p] = arred(base - alocado);
    else { parteBase[p] = arred(base * prop[p]); alocado = arred(alocado + parteBase[p]); }
  });

  const cota = {}, pago = {}, saldo = {}, acerto = {};
  for (const p of pessoas) {
    cota[p] = arred(parteBase[p] + exclusivo[p]);
    const alvo = normalizar(`deposito ${p}`);
    pago[p] = arred(lancamentos
      .filter((l) => l.tipo === "entrada" && normalizar(l.categoria) === alvo)
      .reduce((s, l) => s + valorNum(l.valor), 0));
    saldo[p] = arred(pago[p] - cota[p]);
    acerto[p] = arred(cota[p] - pago[p]);
  }
  return { totalDespesas, cota, pago, saldo, acerto };
}

/**
 * Rateio do mês (`mes` = "MM/YYYY"). Visão de um único mês (usada no relatório).
 * @returns {{mes, totalDespesas, proporcoes, cota, pago, saldo, acerto}}
 */
function rateioMes(lancamentos, salarios, mes) {
  const prop = proporcoes(salarios);
  const doMes = lancamentos.filter((l) => mesDe(l.data_competencia) === mes);
  return { mes, proporcoes: prop, ...calcularRateio(doMes, prop) };
}

/**
 * Rateio CUMULATIVO: meses com `mesInicio ≤ mesDe ≤ mesAte`. Detecta dívida acumulada
 * (decisão do Marcelo). `mesInicio` (opcional, "MM/YYYY") é o marco onde a conta da casa
 * começa — meses anteriores (pré-rastreio) ficam de fora. Lançamentos com data ilegível
 * (`mesDe===null`) são descartados.
 * @returns {{mesAte, mesInicio, acumulado:true, totalDespesas, proporcoes, cota, pago, saldo, acerto}}
 */
function rateioAcumulado(lancamentos, salarios, mesAte, mesInicio) {
  const prop = proporcoes(salarios);
  const ate = mesParaNum(mesAte);
  const inicio = mesParaNum(mesInicio);
  const ateOuAntes = lancamentos.filter((l) => {
    const m = mesParaNum(mesDe(l.data_competencia));
    return m !== null && (ate === null || m <= ate) && (inicio === null || m >= inicio);
  });

  const mesesSet = new Set();
  for (const l of ateOuAntes) {
    const m = mesDe(l.data_competencia);
    if (m) mesesSet.add(m);
  }
  const mesesOrdenados = [...mesesSet].sort((a, b) => mesParaNum(a) - mesParaNum(b));

  const pessoas = Object.keys(prop);
  // FONTE ÚNICA: os totais do card são a SOMA mês-a-mês (mesmo cálculo do histórico do
  // modal). Antes o card vinha de um calcularRateio agregado separado, que podia divergir
  // da soma do modal em centavos (resíduo de arredondamento absorvido 1× vs N×). Agora o
  // card == última linha de saldoAcumulado do histórico, sempre.
  const cota = {}, pago = {}, saldo = {}, acerto = {};
  for (const p of pessoas) { cota[p] = 0; pago[p] = 0; saldo[p] = 0; acerto[p] = 0; }
  let totalDespesas = 0;
  const historico = [];

  for (const m of mesesOrdenados) {
    const doMes = lancamentos.filter((l) => mesDe(l.data_competencia) === m);
    const rMes = calcularRateio(doMes, prop);

    totalDespesas = arred(totalDespesas + rMes.totalDespesas);
    for (const p of pessoas) {
      cota[p] = arred(cota[p] + rMes.cota[p]);
      pago[p] = arred(pago[p] + rMes.pago[p]);
      saldo[p] = arred(saldo[p] + rMes.saldo[p]);
      acerto[p] = arred(cota[p] - pago[p]);
    }

    const exclusivoMes = {};
    for (const p of pessoas) {
      exclusivoMes[p] = 0;
      for (const l of doMes) {
        if (l.tipo === "saída" && l.status === "confirmado"
          && categoriaExclusivaDe(l.categoria, pessoas) === p) {
          exclusivoMes[p] = arred(exclusivoMes[p] + valorNum(l.valor));
        }
      }
    }

    historico.push({
      mes: m,
      totalDespesas: rMes.totalDespesas,
      cota: rMes.cota,
      exclusivo: exclusivoMes,
      pago: rMes.pago,
      saldo: rMes.saldo,
      saldoAcumulado: { ...saldo }, // == card (soma corrente) — modal e card sempre batem
    });
  }

  return { mesAte, mesInicio: mesInicio || null, acumulado: true, proporcoes: prop, totalDespesas, cota, pago, saldo, acerto, historico };
}

module.exports = {
  proporcoes, rateioMes, rateioAcumulado, calcularRateio,
  mesParaNum, categoriaExclusivaDe, ehMovimentacaoPessoal, ehMeta, ehAbatimentoCdb,
  normalizar, mesDe, arred, ehTransferencia, valorNum,
};
