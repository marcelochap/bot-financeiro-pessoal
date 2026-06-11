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
    const c = splitLinha(texto, ",");
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
    if (categoria === "Pagamento/Retirada") categoria = tipo === "entrada" ? "Pagamento" : "Retirada";

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

module.exports = { processarExtrato, splitLinha };
