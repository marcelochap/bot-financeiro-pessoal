// Lógica pura da categorização híbrida — prompt/parse do Gemini, chave do
// Dicionário, teclados inline e parse de callbacks.
// Implementa gstack/plans/categorizacao-hibrida.md.

const LIMIAR_CONFIANCA = 0.8;

/** Prompt de classificação: o Gemini só escolhe entre as categorias ativas. */
function montarPrompt(lancamento, categorias) {
  return [
    "Você categoriza lançamentos financeiros pessoais de um casal brasileiro.",
    `Categorias válidas: ${categorias.join(", ")}.`,
    "Lançamento:",
    `- descrição: ${lancamento.descricao}`,
    `- título: ${lancamento.titulo || "(vazio)"}`,
    `- valor: R$ ${lancamento.valor} (${lancamento.tipo})`,
    `- origem: ${lancamento.origem === "cartao" ? "cartão de crédito" : "conta corrente"}`,
    'Responda APENAS JSON: {"categoria": "<uma das categorias válidas>", "confianca": <0.0 a 1.0>}.',
    "Se nenhuma categoria servir bem, use a mais próxima com confianca baixa.",
  ].join("\n");
}

/**
 * Interpreta a resposta do Gemini. Qualquer problema (não-JSON, categoria fora da
 * lista, confiança inválida) → { valida: false } (degrada para pergunta manual).
 */
function parsearRespostaGemini(texto, categoriasValidas) {
  let obj;
  try {
    obj = JSON.parse(String(texto || "").trim());
  } catch {
    return { valida: false };
  }
  const categoria = String(obj.categoria || "");
  const confianca = Number(obj.confianca);
  if (!categoriasValidas.includes(categoria)) return { valida: false };
  if (Number.isNaN(confianca) || confianca < 0 || confianca > 1) return { valida: false };
  return { valida: true, categoria, confianca, confiante: confianca >= LIMIAR_CONFIANCA };
}

/** Chave para regra nova no Dicionário: Título (conta) ou descrição sem sufixo de parcela (cartão). */
function chaveDicionario(lancamento) {
  if (lancamento.origem === "conta") return String(lancamento.titulo || "").trim();
  return String(lancamento.descricao || "").replace(/ \(\d+\/\d+\)$/, "").trim();
}

/** Resgate de CDB pula o Gemini e pergunta direto a meta (HANDOFF). */
function ehResgateCdb(lancamento) {
  const t = String(lancamento.titulo || "").toUpperCase();
  return t.includes("RESGATE") && t.includes("CDB");
}

/**
 * Teclado inline para pergunta manual. Categorias → `cat|row|nome`;
 * metas ativas → `meta|row|nome` (caminho p/ viagem/hospedagem e CDB).
 * @returns {{inline_keyboard: Array<Array<{text: string, callback_data: string}>>}}
 */
function montarTeclado(row, categorias, metas) {
  const botoes = [
    ...categorias.map((c) => ({ text: c, callback_data: `cat|${row}|${c}` })),
    ...metas.map((m) => ({ text: `🎯 ${m}`, callback_data: `meta|${row}|${m}` })),
  ];
  for (const b of botoes) {
    if (Buffer.byteLength(b.callback_data, "utf-8") > 64) {
      throw new Error(`callback_data excede 64 bytes: ${b.callback_data}`);
    }
  }
  const linhas = [];
  for (let i = 0; i < botoes.length; i += 2) linhas.push(botoes.slice(i, i + 2));
  return { inline_keyboard: linhas };
}

/**
 * Teclado só de metas (caso RESGATE CDB) — gstack/specs/resgate-cdb-abatimento.md.
 * Cada meta ativa ganha DOIS botões: associar só (`meta|row|nome`, ignorado pelo
 * rateio, comportamento de sempre) ou associar E abater proporcionalmente da Cota
 * da Casa (`metaab|row|nome`) — só faz sentido aqui porque o resgate é uma ENTRADA;
 * `montarTeclado` (fluxo geral de viagem/hospedagem, onde a meta liga a uma SAÍDA)
 * continua com um botão só.
 */
function montarTecladoMetas(row, metas) {
  const botoes = metas.flatMap((m) => [
    { text: `🎯 ${m}`, callback_data: `meta|${row}|${m}` },
    { text: `💰 ${m} (abater)`, callback_data: `metaab|${row}|${m}` },
  ]);
  for (const b of botoes) {
    if (Buffer.byteLength(b.callback_data, "utf-8") > 64) {
      throw new Error(`callback_data excede 64 bytes: ${b.callback_data}`);
    }
  }
  const linhas = [];
  for (let i = 0; i < botoes.length; i += 2) linhas.push(botoes.slice(i, i + 2));
  return { inline_keyboard: linhas };
}

/** Parse do callback_data. Inválido/desconhecido → null. */
function parsearCallback(data) {
  const m = /^(cat|meta|metaab)\|(\d+)\|(.+)$/.exec(String(data || ""));
  if (!m) return null;
  return { tipo: m[1], row: Number(m[2]), nome: m[3] };
}

module.exports = {
  LIMIAR_CONFIANCA,
  montarPrompt,
  parsearRespostaGemini,
  chaveDicionario,
  ehResgateCdb,
  montarTeclado,
  montarTecladoMetas,
  parsearCallback,
};
