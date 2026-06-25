// Parser da FATURA ABERTA do C6 — lógica pura do Code node do futuro workflow.
// O C6 não exporta CSV da fatura não-fechada; o Marcelo cola, no Telegram, o TEXTO
// REAL selecionável do app web (Ctrl+C) — não OCR, não print. Parser determinístico,
// sem LLM. Implementa gstack/specs/fatura-aberta-projecao.md (Fatia 1: parser + checksum).
//
// Convenções herdadas do projeto: valor sempre positivo (direção fica no consumidor);
// "Inclusao de Pagamento"/negativos são excluídos do gasto e do checksum (mesma ideia do
// ehTransferencia). Parser nunca trava: linha que não casa o padrão vira aviso.

// O C6 rotula os dias mais recentes como "Hoje"/"Ontem" em vez do nome do dia da semana.
// Sem eles no padrão, a 1ª data reconhecida pulava o bloco do dia atual e seus lançamentos
// eram silenciosamente descartados (bug do R$ 733,97 — o checksum não fechava).
const DIAS_SEMANA = "Domingo|Segunda-feira|Terça-feira|Quarta-feira|Quinta-feira|Sexta-feira|Sábado|Hoje|Ontem";
const RE_DIA = new RegExp(`^(?:${DIAS_SEMANA}),\\s*(\\d{2})/(\\d{2})/(\\d{2})$`);
const RE_VALOR = /^-?R\$\s/;
const RE_PARCELAS = /^Em\s+(\d+)x$/i;
const RE_PAGAMENTO = /Inclusao de Pagamento|Pagamento recebido|Retirada/i;
const ASSINATURA = "Total dessa fatura";

/** "R$ 1.234,56" / "-R$ 9.363,91" → number (com sinal). Inválido → null (não trava). */
function parseReais(s) {
  const txt = String(s).trim();
  if (!RE_VALOR.test(txt)) return null;
  const limpo = txt.replace(/^-?R\$\s*/, "").replace(/\./g, "").replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  if (!Number.isFinite(n)) return null;
  const valor = (txt.startsWith("-") ? -1 : 1) * Math.abs(n);
  return Math.round(valor * 100) / 100;
}

/** "Domingo, 14/06/26" → "14/06/2026" (DD/MM/AA→YYYY, R7). Não-dia → null. */
function diaParaData(linha) {
  const m = RE_DIA.exec(linha.trim());
  if (!m) return null;
  return `${m[1]}/${m[2]}/20${m[3]}`;
}

const arredonda = (n) => Math.round(n * 100) / 100;

/**
 * Parseia o texto colado da fatura aberta do C6 web.
 * @param {string} texto bloco copiado do app web (pode vir de 1+ mensagens concatenadas)
 * @returns {{
 *   competencia_label: string|null,
 *   total: number|null,
 *   lancamentos: {data:string, categoria_c6:string, estabelecimento:string, valor:number, parcelas_total:number|null}[],
 *   pagamentos: {data:string|null, descricao:string, valor:number}[],
 *   checksum: {somado:number, total:number|null, diferenca:number|null, bate:boolean},
 *   avisos: string[]
 * }}
 */
function parseFaturaAberta(texto) {
  const linhas = String(texto).replace(/^﻿/, "").split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l !== "");
  const avisos = [];

  // Assinatura obrigatória: sem ela, não é fatura C6 → não grava.
  const idxAssinatura = linhas.indexOf(ASSINATURA);
  if (idxAssinatura === -1) {
    avisos.push(`texto sem a assinatura "${ASSINATURA}" — não parece a fatura do C6; nada gravado`);
    return {
      competencia_label: null, total: null, lancamentos: [], pagamentos: [],
      checksum: { somado: 0, total: null, diferenca: null, bate: false }, avisos,
    };
  }

  // Cabeçalho = tudo antes do primeiro dia da semana; competência é a 1ª linha.
  const idxPrimeiroDia = linhas.findIndex((l) => diaParaData(l) !== null);
  const competencia_label = linhas[0] || null;

  // Total dessa fatura = primeiro valor logo após a assinatura.
  let total = null;
  for (let i = idxAssinatura + 1; i < linhas.length; i++) {
    const v = parseReais(linhas[i]);
    if (v !== null) { total = Math.abs(v); break; }
  }

  const lancamentos = [];
  const pagamentos = [];
  let dataAtual = null;

  const corpo = idxPrimeiroDia === -1 ? [] : linhas.slice(idxPrimeiroDia);
  let i = 0;
  while (i < corpo.length) {
    const linha = corpo[i];

    const data = diaParaData(linha);
    if (data) { dataAtual = data; i++; continue; }

    // Acumula descritores (categoria, estabelecimento, ou rótulo de pagamento)
    // até encontrar a primeira linha de valor.
    const descritores = [];
    while (i < corpo.length && !RE_VALOR.test(corpo[i]) && diaParaData(corpo[i]) === null) {
      descritores.push(corpo[i]);
      i++;
    }
    if (i >= corpo.length) {
      if (descritores.length) avisos.push(`descrição sem valor no fim do texto: "${descritores.join(" / ")}"`);
      break;
    }

    // Valor (vem repetido 2×: original e convertido; nacional = iguais → pega o 1º).
    const valor = parseReais(corpo[i]);
    i++;
    while (i < corpo.length && RE_VALOR.test(corpo[i])) i++; // consome a 2ª ocorrência
    // Parcelas opcionais: "Em Mx".
    let parcelas_total = null;
    if (i < corpo.length) {
      const mp = RE_PARCELAS.exec(corpo[i]);
      if (mp) { parcelas_total = Number(mp[1]); i++; }
    }

    if (valor === null) {
      avisos.push(`valor malformado, lançamento ignorado: "${descritores.join(" / ")}"`);
      continue;
    }
    if (descritores.length === 0) {
      avisos.push(`valor sem descrição (${corpo[i - 1]}) ignorado`);
      continue;
    }

    const ehPagamento = valor < 0 || RE_PAGAMENTO.test(descritores.join(" "));
    if (ehPagamento) {
      pagamentos.push({ data: dataAtual, descricao: descritores.join(" / "), valor: Math.abs(valor) });
      continue;
    }

    const categoria_c6 = descritores.length >= 2 ? descritores[0] : "";
    const estabelecimento = descritores.length >= 2
      ? descritores.slice(1).join(" ") : descritores[0];
    lancamentos.push({
      data: dataAtual,
      categoria_c6,
      estabelecimento,
      valor: Math.abs(valor),
      parcelas_total,
    });
  }

  const somado = arredonda(lancamentos.reduce((s, l) => s + l.valor, 0));
  const diferenca = total === null ? null : arredonda(total - somado);
  const bate = total !== null && diferenca === 0;

  return {
    competencia_label,
    total,
    lancamentos,
    pagamentos,
    checksum: { somado, total, diferenca, bate },
    avisos,
  };
}

// ═══════════════ FATIA 2 — parcelas (seed/reseed + projeção) ═════════
//
// O desktop só mostra "Em Mx" (total), nunca "N de M". Inferir N pela data é furado
// (provado). Solução: seed único (Marcelo lê "Parcela N de M" no celular) + índice
// DERIVADO DO CALENDÁRIO — N_atual = N_no_seed + ciclos decorridos desde o seed.
// Assim, pular uma colagem de ciclo NÃO dessincroniza, e recolar o mesmo ciclo não
// incrementa. O seed é reexecutável (= reseed): basta recolar para sobrescrever.

const MESES = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** Normaliza estabelecimento/chave p/ casamento: maiúsculas + colapsa espaços. */
function normalizarChave(s) {
  return String(s).trim().toUpperCase().replace(/\s+/g, " ");
}

/** "julho de 2026" → vencimento "10/07/2026" (ciclo vence dia 10). Inválido → null. */
function mesAnoParaVencimento(label) {
  const m = /^([a-zç]+)\s+de\s+(\d{4})$/i.exec(String(label).trim());
  if (!m) return null;
  const mes = MESES[m[1].toLowerCase()];
  if (!mes) return null;
  return `10/${String(mes).padStart(2, "0")}/${m[2]}`;
}

/** Soma k meses a um vencimento "10/MM/YYYY" (vira o ano). */
function addMesesVencimento(vencimento, k) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(vencimento).trim());
  if (!m) return null;
  const idx = Number(m[2]) - 1 + k;
  const ano = Number(m[3]) + Math.floor(idx / 12);
  const mes = ((idx % 12) + 12) % 12;
  return `${m[1]}/${String(mes + 1).padStart(2, "0")}/${ano}`;
}

const proximoVencimento = (v) => addMesesVencimento(v, 1);

/** Diferença em meses entre dois vencimentos "10/MM/YYYY" (v2 − v1). */
function mesesEntreVencimentos(v1, v2) {
  const a = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v1).trim());
  const b = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v2).trim());
  if (!a || !b) return null;
  return (Number(b[3]) - Number(a[3])) * 12 + (Number(b[2]) - Number(a[2]));
}

/**
 * Normaliza um ciclo/data lido do Sheets para "DD/MM/YYYY". O append do Sheets coage
 * datas em serial (ex.: 46213 = 10/07/2026); ao ler de volta vem o número — esta função
 * o converte de volta. Aceita serial (número ou string-só-dígitos), "DD/MM/YYYY" e
 * "YYYY-MM-DD". Vazio → "".
 */
function normalizarCiclo(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const serial = Math.floor(Number(v));
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }
  const s = String(v).trim();
  let m;
  if (/^(\d{2})\/(\d{2})\/(\d{4})$/.test(s)) return s;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

/**
 * Parseia o bloco do /seedparcelas — uma linha por parcela: "estabelecimento;N/M".
 * Separador canônico ";" (o "|" antigo continua aceito por retrocompat).
 * Reexecutável (reseed). @returns {{entradas:{chave,N,M}[], avisos:string[]}}
 */
function parseSeedParcelas(texto) {
  const entradas = [];
  const avisos = [];
  for (const bruta of String(texto).split(/\r?\n/)) {
    const linha = bruta.trim();
    if (linha === "") continue;
    const m = /^(.+?)\s*[;|]\s*(\d+)\s*\/\s*(\d+)$/.exec(linha);
    if (!m) { avisos.push(`linha de seed malformada (esperado "estab;N/M"): "${linha}"`); continue; }
    const N = Number(m[2]);
    const M = Number(m[3]);
    if (N < 1 || M < 1 || N > M) { avisos.push(`parcela inválida (N/M fora de 1..M): "${linha}"`); continue; }
    entradas.push({ chave: m[1].trim(), N, M });
  }
  return { entradas, avisos };
}

/**
 * Casa cada seed com os lançamentos parcelados por (chave CONTIDA no estabelecimento, M)
 * e monta as linhas da aba Parcelas. Uma linha por lançamento casado (GOL = 4 compras 3x
 * no mesmo dia → 4 linhas). @returns {{rows:object[], avisos:string[]}}
 */
function montarEstadoParcelas(entradas, lancamentosParcelados, vencimentoReferencia) {
  const rows = [];
  const avisos = [];
  const casados = new Set();
  for (const e of entradas) {
    const chaveN = normalizarChave(e.chave);
    const matches = lancamentosParcelados.filter(
      (l) => normalizarChave(l.estabelecimento).includes(chaveN) && l.parcelas_total === e.M
    );
    if (matches.length === 0) {
      avisos.push(`seed sem lançamento correspondente: "${e.chave}" (${e.N}/${e.M})`);
      continue;
    }
    for (const l of matches) {
      casados.add(l);
      rows.push({
        chave: e.chave,
        estabelecimento: l.estabelecimento,
        valor: l.valor,
        M: e.M,
        N_no_seed: e.N,
        ciclo_referencia: vencimentoReferencia,
      });
    }
  }
  for (const l of lancamentosParcelados) {
    if (!casados.has(l)) {
      avisos.push(`parcela sem seed (informe N/M): "${l.estabelecimento}" (Em ${l.parcelas_total}x)`);
    }
  }
  return { rows, avisos };
}

/**
 * Vencimento "10/MM/YYYY" do ciclo aberto corrente, derivado de "hoje" (YYYY-MM-DD,
 * America/Sao_Paulo). Ciclo fecha dia 03, vence dia 10; transações 04→03 caem no ciclo que
 * fecha dia 03. Usado pela v2 do dashboard como âncora da projeção quando não há fatura aberta.
 */
function vencimentoCicloAberto(hojeISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hojeISO).trim());
  if (!m) return null;
  let ano = Number(m[1]);
  let mes = Number(m[2]);
  const dia = Number(m[3]);
  if (dia >= 4) {
    mes += 1;
    if (mes === 13) { mes = 1; ano += 1; }
  }
  return `10/${String(mes).padStart(2, "0")}/${ano}`;
}

/** Índice atual da parcela, derivado do calendário (não de contagem de colagens). */
function indiceAtual(parcelaRow, vencimentoAtual) {
  return (
    Number(parcelaRow.N_no_seed) +
    mesesEntreVencimentos(normalizarCiclo(parcelaRow.ciclo_referencia), normalizarCiclo(vencimentoAtual))
  );
}

/**
 * Projeção do comprometido futuro: para cada ciclo à frente (1..horizonte), soma o valor
 * das parcelas ainda ativas (1 ≤ N ≤ M). Derivada — nunca persistida como confirmada.
 * @returns {{vencimento:string, total:number}[]} (um item por ciclo do horizonte)
 */
function projetarComprometido(parcelaRows, vencimentoAtual, horizonte = 6) {
  const out = [];
  for (let k = 1; k <= horizonte; k++) {
    const venc = addMesesVencimento(vencimentoAtual, k);
    let total = 0;
    for (const row of parcelaRows) {
      const N = indiceAtual(row, venc);
      if (N >= 1 && N <= row.M) total += row.valor;
    }
    out.push({ vencimento: venc, total: arredonda(total) });
  }
  return out;
}

// ═══════════════ FATIA 3 — provisórios (aba própria) + reconciliação ═
//
// Decisão de arquitetura (2026-06-18): os provisórios vivem numa aba PRÓPRIA
// (`FaturaAberta`), NÃO em Lançamentos. Snapshot = clear+write da aba (idempotente,
// sem deletar linhas no meio de Lançamentos). De quebra elimina as colisões C1/C2:
// como não entram em Lançamentos, o `faturaJaImportada` (que lê Lançamentos) nunca os
// bloqueia, e a regra 3 do dashboard nunca os soma. A aba guarda só o ciclo aberto
// corrente; o próximo /faturaaberta (novo ciclo) sobrescreve. Reconciliação: quando o
// CSV oficial fecha, os confirmados entram em Lançamentos pelo fluxo existente; a aba
// FaturaAberta é sobrescrita na próxima colagem.

/**
 * Linhas da aba FaturaAberta a partir do texto parseado.
 * Colunas: ciclo | data_compra | estabelecimento | categoria_c6 | valor | parcelas_total | status
 * status = "fechado" (checksum bate) | "rascunho" (não-fechado — não entra no planejamento, R3).
 */
function montarProvisorios(parse, vencimento) {
  const status = parse.checksum && parse.checksum.bate ? "fechado" : "rascunho";
  return parse.lancamentos.map((l) => ({
    ciclo: vencimento,
    data_compra: l.data,
    estabelecimento: l.estabelecimento,
    categoria_c6: l.categoria_c6,
    valor: l.valor,
    parcelas_total: l.parcelas_total === null ? "" : l.parcelas_total,
    status,
  }));
}

module.exports = {
  parseFaturaAberta,
  parseReais,
  diaParaData,
  normalizarChave,
  mesAnoParaVencimento,
  proximoVencimento,
  mesesEntreVencimentos,
  parseSeedParcelas,
  montarEstadoParcelas,
  indiceAtual,
  projetarComprometido,
  normalizarCiclo,
  montarProvisorios,
  vencimentoCicloAberto,
};
