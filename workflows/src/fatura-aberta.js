// Parser da FATURA ABERTA do C6 — lógica pura do Code node do futuro workflow.
// O C6 não exporta CSV da fatura não-fechada; o Marcelo cola, no Telegram, o TEXTO
// REAL selecionável do app web (Ctrl+C) — não OCR, não print. Parser determinístico,
// sem LLM. Implementa gstack/specs/fatura-aberta-projecao.md (Fatia 1: parser + checksum).
//
// Convenções herdadas do projeto: valor sempre positivo (direção fica no consumidor);
// "Inclusao de Pagamento"/negativos são excluídos do gasto e do checksum (mesma ideia do
// ehTransferencia). Parser nunca trava: linha que não casa o padrão vira aviso.

const DIAS_SEMANA = "Domingo|Segunda-feira|Terça-feira|Quarta-feira|Quinta-feira|Sexta-feira|Sábado";
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

module.exports = { parseFaturaAberta, parseReais, diaParaData };
