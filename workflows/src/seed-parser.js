// Parser do seed — carga única do livro-razão real da conta pessoal.
// Lógica pura (TDD em seed-parser.test.js). NÃO é Code node n8n: é módulo Node
// consumido pelo runner (escreve as linhas no Sheets via service account).
// Implementa gstack/specs/seed-conta-pessoal.md.

/** "$1.011,87" → 1011.87. Remove $, milhar-ponto e usa decimal-vírgula→ponto. */
function parseValorBR(s) {
  const limpo = String(s).trim().replace(/^\$/, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  if (!Number.isFinite(n) || limpo === "") throw new Error(`valor inválido: ${s}`);
  return Math.round(n * 100) / 100;
}

/** "DD/MM/YYYY" → número YYYYMMDD comparável. */
function ordinal(ddmmyyyy) {
  const [d, m, a] = ddmmyyyy.split("/");
  return Number(`${a}${m}${d}`);
}

/**
 * Uma linha do CSV de seed → linha A:J. Parseia por ÍNDICE (header vem em
 * mojibake — não casar por string). `status` por data: > hoje → previsto.
 * @param {string[]} campos [data, valor, descricao, categoria]
 * @param {"entrada"|"saída"} tipo carimbado pelo arquivo de origem
 * @param {string} hoje DD/MM/YYYY
 */
function parseLinhaSeed(campos, tipo, hoje) {
  const [dataStr, valorStr, descricaoRaw, categoriaRaw] = campos;
  const data = String(dataStr).trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) throw new Error(`data inválida: ${dataStr}`);
  const descricao = String(descricaoRaw == null ? "" : descricaoRaw).trim();
  const categoria = String(categoriaRaw == null ? "" : categoriaRaw).trim();
  const valor = parseValorBR(valorStr);
  const status = ordinal(data) > ordinal(hoje) ? "previsto" : "confirmado";
  return {
    data_competencia: data,
    data_original: data,
    descricao,
    titulo: descricao,
    valor,
    categoria,
    tipo,
    origem: "conta",
    status,
    id_meta: "",
  };
}

/**
 * Preenche categorias vazias herdando da irmã (mesma `descricao` exata): usa a
 * categoria não-vazia mais frequente daquela descrição. Sem irmã → "Outros" + aviso.
 * @returns {{linhas: object[], avisos: string[]}}
 */
function herdarCategorias(linhas) {
  const freq = new Map(); // descricao → (categoria → contagem)
  for (const l of linhas) {
    const cat = (l.categoria || "").trim();
    if (!cat) continue;
    if (!freq.has(l.descricao)) freq.set(l.descricao, new Map());
    const m = freq.get(l.descricao);
    m.set(cat, (m.get(cat) || 0) + 1);
  }
  const moda = (descricao) => {
    const m = freq.get(descricao);
    if (!m) return null;
    let melhor = null, max = -1;
    for (const [cat, n] of m) if (n > max) { melhor = cat; max = n; }
    return melhor;
  };
  const avisos = [];
  const out = linhas.map((l) => {
    if ((l.categoria || "").trim() !== "") return l;
    const herdada = moda(l.descricao);
    if (herdada) return { ...l, categoria: herdada };
    avisos.push(`categoria vazia sem irmã categorizada (${l.descricao}) → Outros`);
    return { ...l, categoria: "Outros" };
  });
  return { linhas: out, avisos };
}

/** Texto do CSV → linhas de campos (sep ";"), dropando header e linhas vazias. */
function linhasDeCsv(texto) {
  return texto.replace(/^﻿/, "").split(/\r?\n/)
    .slice(1)                                  // dropa o header (mojibake)
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(";"));
}

/**
 * Processa os 2 CSVs do seed (já decodificados de Latin-1 pelo runner).
 * @returns {{linhas: object[], resumo: object, avisos: string[]}}
 */
function processarSeed(entradaTxt, saidaTxt, hoje) {
  const entradas = linhasDeCsv(entradaTxt).map((c) => parseLinhaSeed(c, "entrada", hoje));
  const saidas = linhasDeCsv(saidaTxt).map((c) => parseLinhaSeed(c, "saída", hoje));
  const { linhas, avisos } = herdarCategorias([...entradas, ...saidas]);
  const soma = (t) =>
    Math.round(linhas.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0) * 100) / 100;
  const resumo = {
    total: linhas.length,
    entradas: { n: linhas.filter((l) => l.tipo === "entrada").length, total: soma("entrada") },
    saidas: { n: linhas.filter((l) => l.tipo === "saída").length, total: soma("saída") },
    previstos: linhas.filter((l) => l.status === "previsto").length,
  };
  return { linhas, resumo, avisos };
}

module.exports = { parseValorBR, parseLinhaSeed, herdarCategorias, processarSeed };

// CLI: emite o JSON das linhas para o runner (Python) consumir. Só roda quando
// invocado direto (`node seed-parser.js entrada saida DD/MM/YYYY`) — não afeta
// os exports puros nem os testes (require.main !== module sob require()).
if (require.main === module) {
  const fs = require("node:fs");
  const [, , entradaPath, saidaPath, hoje] = process.argv;
  if (!entradaPath || !saidaPath || !hoje) {
    console.error("uso: node seed-parser.js <entrada.csv> <saida.csv> <DD/MM/YYYY>");
    process.exit(1);
  }
  const e = fs.readFileSync(entradaPath, "latin1");
  const s = fs.readFileSync(saidaPath, "latin1");
  process.stdout.write(JSON.stringify(processarSeed(e, s, hoje)));
}
