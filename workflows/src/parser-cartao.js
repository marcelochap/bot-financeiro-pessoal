// Parser da fatura C6 cartão — lógica pura do Code node do workflow ingestao-csv-cartao.
// Implementa gstack/plans/ingestao-csv-cartao.md. Sem dependências externas.

const COLUNAS = [
  "Data de Compra", "Nome no Cartão", "Final do Cartão", "Categoria", "Descrição",
  "Parcela", "Valor (em US$)", "Cotação (em R$)", "Valor (em R$)",
];

/** Divide uma linha CSV com separador ; respeitando campos entre aspas. */
function splitLinha(linha) {
  const campos = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (c === ";" && !dentroAspas) {
      campos.push(atual); atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/** DD/MM/YYYY → Date (para ordenação por proximidade). */
function paraData(ddmmyyyy) {
  const [d, m, a] = ddmmyyyy.split("/").map(Number);
  const data = new Date(a, m - 1, d);
  if (Number.isNaN(data.getTime())) throw new Error(`data inválida: ${ddmmyyyy}`);
  return data;
}

/** Extrai a data de vencimento de "Fatura_YYYY-MM-DD.csv". Lança erro se fora do padrão. */
function vencimentoDoNome(nomeArquivo) {
  const m = /Fatura_(\d{4})-(\d{2})-(\d{2})\.csv$/i.exec(nomeArquivo);
  if (!m) throw new Error(`nome de arquivo fora do padrão Fatura_YYYY-MM-DD.csv: ${nomeArquivo}`);
  return `${m[3]}/${m[2]}/${m[1]}`; // DD/MM/YYYY
}

/**
 * Cancela pares 1:1 (estorno negativo + positivo de mesma descrição e |valor|,
 * o mais próximo em data). Retorna { mantidos, cancelados }.
 */
function cancelarPares(linhas) {
  const mantidos = [...linhas];
  const cancelados = [];
  const ehParAnuidade = (neg, pos) =>
    neg["Descrição"] === "Estorno Tarifa" && pos["Descrição"].startsWith("Anuidade");

  for (const neg of linhas.filter((l) => l._valor < 0)) {
    if (!mantidos.includes(neg)) continue;
    const candidatos = mantidos.filter(
      (pos) =>
        pos._valor > 0 &&
        Math.abs(pos._valor) === Math.abs(neg._valor) &&
        (pos["Descrição"] === neg["Descrição"] || ehParAnuidade(neg, pos))
    );
    if (candidatos.length === 0) continue;
    candidatos.sort(
      (a, b) =>
        Math.abs(paraData(a["Data de Compra"]) - paraData(neg["Data de Compra"])) -
        Math.abs(paraData(b["Data de Compra"]) - paraData(neg["Data de Compra"]))
    );
    const par = candidatos[0];
    mantidos.splice(mantidos.indexOf(neg), 1);
    mantidos.splice(mantidos.indexOf(par), 1);
    cancelados.push({
      estorno: { descricao: neg["Descrição"], data: neg["Data de Compra"], valor: neg._valor },
      original: { descricao: par["Descrição"], data: par["Data de Compra"], valor: par._valor },
    });
  }
  return { mantidos, cancelados };
}

/** Busca categoria no dicionário: descrição CONTÉM chave (case-insensitive). */
function categorizar(descricao, dicionario) {
  const alvo = descricao.toUpperCase();
  const regra = dicionario.find((r) => alvo.includes(r.chave.toUpperCase()));
  return regra ? regra.categoria : "";
}

/**
 * Processa a fatura completa.
 * @param {string} csvText conteúdo do CSV (UTF-8)
 * @param {string} nomeArquivo ex.: Fatura_2026-06-10.csv
 * @param {{chave: string, categoria: string}[]} dicionario regras origem=cartao
 * @param {{nome: string}[]} metas metas ativas (aba Metas)
 * @returns {{lancamentos: object[], cancelados: object[], avisos: string[], resumo: object}}
 */
function processarFatura(csvText, nomeArquivo, dicionario, metas) {
  const vencimento = vencimentoDoNome(nomeArquivo);
  const linhasTexto = csvText.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhasTexto.length === 0) throw new Error("CSV vazio");

  const header = splitLinha(linhasTexto[0]);
  if (JSON.stringify(header) !== JSON.stringify(COLUNAS)) {
    throw new Error(`colunas inesperadas: ${header.join(" | ")}`);
  }
  if (linhasTexto.length === 1) {
    return { lancamentos: [], cancelados: [], avisos: [], resumo: { total: 0, quantidade: 0 } };
  }

  let linhas = linhasTexto.slice(1).map((texto, i) => {
    const campos = splitLinha(texto);
    if (campos.length !== COLUNAS.length) {
      throw new Error(`linha ${i + 2}: esperadas ${COLUNAS.length} colunas, vieram ${campos.length}`);
    }
    const obj = Object.fromEntries(COLUNAS.map((c, j) => [c, campos[j]]));
    obj._valor = Number(obj["Valor (em R$)"]);
    if (Number.isNaN(obj._valor)) throw new Error(`linha ${i + 2}: valor inválido "${obj["Valor (em R$)"]}"`);
    paraData(obj["Data de Compra"]);
    return obj;
  });

  // Regra: Inclusao de Pagamento é ignorado
  linhas = linhas.filter((l) => l["Descrição"] !== "Inclusao de Pagamento");

  // Regra: cancelamento 1:1 de estornos e do par Anuidade/Estorno Tarifa
  const { mantidos, cancelados } = cancelarPares(linhas);

  const avisos = [];
  const lancamentos = mantidos.map((l) => {
    const categoria = categorizar(l["Descrição"], dicionario);
    let idMeta = "";
    if (categoria.startsWith("Meta: ")) {
      const nomeMeta = categoria.slice(6);
      if (metas.some((m) => m.nome === nomeMeta)) idMeta = nomeMeta;
      else avisos.push(`meta não encontrada para categoria "${categoria}"`);
    }
    const sufixo = l["Parcela"] !== "Única" ? ` (${l["Parcela"]})` : "";
    // Convenção canônica do projeto: valor sempre positivo, direção em tipo
    return {
      data_competencia: vencimento,
      data_original: l["Data de Compra"],
      descricao: l["Descrição"] + sufixo,
      titulo: "",
      valor: Math.abs(l._valor),
      categoria,
      tipo: l._valor < 0 ? "entrada" : "saída",
      origem: "cartao",
      status: "confirmado",
      id_meta: idMeta,
    };
  });

  const datas = mantidos.map((l) => paraData(l["Data de Compra"]));
  const fmt = (d) => d.toLocaleDateString("pt-BR");
  const resumo = {
    quantidade: lancamentos.length,
    // total líquido da fatura: saídas menos créditos mantidos
    total: Math.round(
      lancamentos.reduce((s, l) => s + (l.tipo === "saída" ? l.valor : -l.valor), 0) * 100
    ) / 100,
    periodo_inicio: datas.length ? fmt(new Date(Math.min(...datas))) : "",
    periodo_fim: datas.length ? fmt(new Date(Math.max(...datas))) : "",
    vencimento,
    pares_cancelados: cancelados.length,
  };
  return { lancamentos, cancelados, avisos, resumo };
}

module.exports = { processarFatura, vencimentoDoNome, splitLinha };
