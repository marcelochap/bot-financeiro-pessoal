// Parser do extrato C6 conta corrente — lógica pura do Code node do workflow
// ingestao-csv-conta. Implementa gstack/plans/ingestao-csv-conta.md.
// splitLinha é duplicado de parser-cartao.js de propósito: cada arquivo precisa ser
// autocontido para ser embutido no Code node do n8n.

const COLUNAS = [
  "Data Lançamento", "Data Contábil", "Título", "Descrição",
  "Entrada(R$)", "Saída(R$)", "Saldo do Dia(R$)",
];
const LINHAS_METADATA = 8;

/** Divide uma linha CSV (RFC 4180) com separador configurável respeitando aspas. */
function splitLinha(linha, sep) {
  const campos = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (c === sep && !dentroAspas) {
      campos.push(atual); atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/** Valida DD/MM/YYYY. */
function validarData(ddmmyyyy) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ddmmyyyy)) throw new Error(`data inválida: ${ddmmyyyy}`);
  return ddmmyyyy;
}

/**
 * Processa o extrato completo.
 * @param {string} csvText conteúdo do CSV (UTF-8, pode ter BOM)
 * @param {string} nomeArquivo identificador opaco (só para log)
 * @param {{chave: string, categoria: string}[]} dicionario regras origem=conta
 * @param {{nome: string}[]} metas metas ativas (aba Metas)
 * @returns {{lancamentos: object[], descartados: object[], avisos: string[], resumo: object}}
 */
function processarExtrato(csvText, nomeArquivo, dicionario, metas) {
  const linhas = csvText.replace(/^﻿/, "").split(/\r?\n/);
  if (linhas.length < LINHAS_METADATA + 1) {
    throw new Error(`arquivo com ${linhas.length} linhas — esperadas ${LINHAS_METADATA} de metadata + header`);
  }
  const header = splitLinha(linhas[LINHAS_METADATA], ",");
  if (JSON.stringify(header) !== JSON.stringify(COLUNAS)) {
    throw new Error(`header inesperado na linha ${LINHAS_METADATA + 1}: ${header.join(" | ")}`);
  }
  const meta = linhas.slice(0, LINHAS_METADATA).join("\n");
  const mPeriodo = /Extrato de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/.exec(meta);
  const periodo = mPeriodo ? { inicio: mPeriodo[1], fim: mPeriodo[2] } : { inicio: "", fim: "" };

  const avisos = [];
  const descartados = [];
  const lancamentos = [];

  linhas.slice(LINHAS_METADATA + 1).forEach((texto, i) => {
    if (texto.trim() === "") return;
    const numLinha = LINHAS_METADATA + 2 + i;
    let c = splitLinha(texto, ",");
    // Quirk C6: a linha inteira pode vir envolta em aspas ("a,b,""c""...,x") — aí o
    // splitLinha (RFC 4180) colapsa ""→" e devolve a linha real como campo único.
    // Re-split do conteúdo desembrulhado p/ alinhar as colunas (amostra real linha 24).
    if (c.length === 1 && COLUNAS.length > 1) {
      const reSplit = splitLinha(c[0], ",");
      if (reSplit.length === COLUNAS.length) c = reSplit;
    }
    if (c.length !== COLUNAS.length) {
      throw new Error(`linha ${numLinha}: esperadas ${COLUNAS.length} colunas, vieram ${c.length}`);
    }
    const [dataLanc, , titulo, descricao, entradaStr, saidaStr] = c;
    validarData(dataLanc);
    const entrada = Number(entradaStr);
    const saida = Number(saidaStr);
    if (Number.isNaN(entrada) || Number.isNaN(saida)) {
      throw new Error(`linha ${numLinha}: valor inválido "${entradaStr}"/"${saidaStr}"`);
    }
    if (entrada > 0 && saida > 0) {
      throw new Error(`linha ${numLinha}: Entrada e Saída preenchidas simultaneamente`);
    }
    if (entrada === 0 && saida === 0) {
      descartados.push({ linha: numLinha, titulo });
      avisos.push(`linha ${numLinha} descartada: Entrada e Saída zeradas (${titulo})`);
      return;
    }
    const tipo = entrada > 0 ? "entrada" : "saída";
    const valor = entrada > 0 ? entrada : saida;

    // Categoria pela chave Título; pseudo-categoria resolve pela direção e
    // NUNCA chega à aba Lançamentos
    const alvo = titulo.toUpperCase();
    const regra = dicionario.find((r) => alvo.includes(r.chave.toUpperCase()));
    let categoria = regra ? regra.categoria : "";
    // Pseudo-categorias (resolvem pela direção; nunca chegam à aba Lançamentos).
    // Dois `if` independentes de igualdade exata — sem dependência de ordem.
    if (categoria === "Pagamento/Retirada") categoria = tipo === "entrada" ? "Pagamento" : "Retirada";
    // Pix recebido do próprio Marcelo = depósito p/ a casa; Pix enviado p/ ele mesmo = "Saída
    // para o Marcelo" (movimentação pessoal: aparece no fluxo de caixa, mas é NEUTRA ao rateio).
    // NÃO é "Retirada" — esta segue reservada a pgto de fatura e aplicação de CDB (transferências).
    if (categoria === "Depósito Marcelo/Retirada") categoria = tipo === "entrada" ? "Depósito Marcelo" : "Saída para o Marcelo";

    let idMeta = "";
    if (categoria.startsWith("Meta: ")) {
      const nomeMeta = categoria.slice(6);
      if (metas.some((m) => m.nome === nomeMeta)) idMeta = nomeMeta;
      else avisos.push(`meta não encontrada para categoria "${categoria}" (linha ${numLinha})`);
    }
    if (categoria === "" && alvo.includes("RESGATE") && alvo.includes("CDB")) {
      avisos.push(`resgate de CDB sem meta associada (linha ${numLinha}) — associar no fluxo de categorização`);
    }

    lancamentos.push({
      data_competencia: dataLanc,
      data_original: dataLanc,
      descricao,
      titulo,
      valor,
      categoria,
      tipo,
      origem: "conta",
      status: "confirmado",
      id_meta: idMeta,
    });
  });

  const soma = (tipo) =>
    Math.round(lancamentos.filter((l) => l.tipo === tipo).reduce((s, l) => s + l.valor, 0) * 100) / 100;
  const resumo = {
    quantidade: lancamentos.length,
    entradas: { n: lancamentos.filter((l) => l.tipo === "entrada").length, total: soma("entrada") },
    saidas: { n: lancamentos.filter((l) => l.tipo === "saída").length, total: soma("saída") },
    periodo_inicio: periodo.inicio,
    periodo_fim: periodo.fim,
    descartados: descartados.length,
    arquivo: nomeArquivo,
  };
  return { lancamentos, descartados, avisos, resumo };
}

/**
 * Normaliza uma data da planilha para "DD/MM/YYYY" (serial/ISO/ddmmyyyy → ddmmyyyy).
 * Duplicado de parser-cartao.js de propósito: o Code node precisa ser autocontido.
 */
function normalizarData(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const serial = Math.floor(Number(v));
    if (!Number.isFinite(serial) || serial <= 0) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) return `${m[1]}/${m[2]}/${m[3]}`;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[3]}/${m[2]}/${m[1]}`;
  return null;
}

/** "DD/MM/YYYY" → número YYYYMMDD comparável; null → -Infinity. */
function chaveOrdinal(ddmmyyyy) {
  if (!ddmmyyyy) return -Infinity;
  const [d, mes, a] = ddmmyyyy.split("/");
  return Number(`${a}${mes}${d}`);
}

/**
 * Filtra os lançamentos do extrato que ainda não estão na planilha, usando o
 * marco d'água (maior data_original já gravada com origem=conta) + o período do
 * arquivo para distinguir extensão legítima de reimportação retroativa.
 * A decisão de IMPORTAR é sempre por linha (`novos`); `situacao` só refina a
 * mensagem. Ver gstack/plans/dedup-importacao.md.
 * @param {object[]} lancamentos saída do parser (data_original DD/MM/YYYY)
 * @param {{origem, data_original}[]} existentes linhas atuais de Lançamentos
 * @param {{inicio, fim}} periodo resumo do parser (DD/MM/YYYY)
 * @returns {{novos: object[], ignorados: object[], marco: string|null,
 *   situacao: "vazia"|"tudo_novo"|"extensao"|"ja_importado"|"retroativo"}}
 */
function filtrarJaImportados(lancamentos, existentes, periodo) {
  // Emenda 15/06 (dep. seed-conta-pessoal): linhas previstas (parcelas futuras
  // semeadas) NÃO entram no marco d'água — senão envenenariam o marco e
  // bloqueariam o próximo extrato real. Blacklist `!== "previsto"` (e não
  // whitelist `=== "confirmado"`) para tolerar linhas sem campo `status`.
  const datasExist = (existentes || [])
    .filter((r) => String(r.origem) === "conta" && r.status !== "previsto")
    .map((r) => normalizarData(r.data_original))
    .filter(Boolean);

  if (datasExist.length === 0) {
    return { novos: lancamentos, ignorados: [], marco: null, situacao: "vazia" };
  }

  const marcoKey = Math.max(...datasExist.map(chaveOrdinal));
  const marco = datasExist.find((d) => chaveOrdinal(d) === marcoKey);

  const novos = [];
  const ignorados = [];
  for (const l of lancamentos) {
    if (chaveOrdinal(normalizarData(l.data_original)) > marcoKey) novos.push(l);
    else ignorados.push(l);
  }

  // Fim efetivo do extrato: o maior entre o período do metadata e a maior
  // data_original das próprias linhas. O fallback nas linhas evita um falso
  // "retroativo" quando o metadata de período veio ilegível (periodo vazio).
  const fimLanc = lancamentos.length
    ? Math.max(...lancamentos.map((l) => chaveOrdinal(normalizarData(l.data_original))))
    : -Infinity;
  const fimKey = Math.max(chaveOrdinal(normalizarData(periodo && periodo.fim)), fimLanc);
  let situacao;
  if (novos.length > 0) {
    situacao = ignorados.length > 0 ? "extensao" : "tudo_novo";
  } else {
    situacao = fimKey < marcoKey ? "retroativo" : "ja_importado";
  }

  return { novos, ignorados, marco, situacao };
}

module.exports = {
  processarExtrato,
  splitLinha,
  normalizarData,
  filtrarJaImportados,
};
