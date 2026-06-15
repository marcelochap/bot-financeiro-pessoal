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

/**
 * Normaliza uma data vinda da planilha para a chave canônica "DD/MM/YYYY".
 * Aceita os três formatos que o nó googleSheets pode devolver:
 *   - "DD/MM/YYYY" (string) → como está;
 *   - "YYYY-MM-DD" (string ISO) → reordena;
 *   - serial do Sheets (número ou string só-dígitos; dias desde 1899-12-30).
 * Qualquer outra coisa → null (linha ignorada no cálculo, não trava).
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

/**
 * Decide se a fatura (identificada pelo vencimento) já está na planilha.
 * @param {{origem, data_competencia}[]} existentes linhas atuais de Lançamentos
 * @param {string} vencimentoDDMMYYYY vencimento do arquivo (vencimentoDoNome → DD/MM/YYYY)
 * @returns {{bloqueada: boolean, quantidade: number}}
 */
function faturaJaImportada(existentes, vencimentoDDMMYYYY) {
  const alvo = normalizarData(vencimentoDDMMYYYY);
  const quantidade = (existentes || []).filter(
    (r) => String(r.origem) === "cartao" && normalizarData(r.data_competencia) === alvo
  ).length;
  return { bloqueada: quantidade > 0, quantidade };
}

module.exports = {
  processarFatura,
  vencimentoDoNome,
  splitLinha,
  normalizarData,
  faturaJaImportada,
};
