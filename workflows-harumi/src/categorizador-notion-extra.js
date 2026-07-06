// Complemento de workflows/src/categorizador.js para a variante Notion: SÓ
// montarTeclado/parsearCallback mudam (o resto — montarPrompt, parsearRespostaGemini,
// chaveDicionario, ehResgateCdb — é reaproveitado sem alteração, concatenado junto).
//
// Por quê um módulo à parte em vez de editar categorizador.js: o original embute o
// NÚMERO DA LINHA do Sheets no callback_data ("cat|row|categoria"). O Notion não tem
// row number — o id da page é um UUID de 32+ caracteres, que somado ao nome da
// categoria estoura o limite de 64 bytes do callback_data do Telegram. Solução: o
// callback_data carrega o id da page (sem hífens) + um ÍNDICE na lista de categorias/
// metas ATIVAS, em vez do nome. Quem recebe o clique (aplicar-categoria) precisa
// reconsultar Categorias/Metas com o MESMO filtro+ordenação (Nome ascendente — ver
// notion-map.js) usado para montar o teclado, para o índice apontar pro item certo.
// categorizador.js (Sheets) fica intocado — o bot do Marcelo não é afetado.

/** IDs do Notion vêm com hífen da API; sem hífen cabe mais no callback_data. */
function semHifen(pageId) {
  return String(pageId || "").replace(/-/g, "");
}

/**
 * @param {string} pageId id da page do Lançamento (com ou sem hífen — normalizado aqui)
 * @param {string[]} categorias ativas, MESMA ordem usada por quem chama (ordenar por Nome)
 * @param {string[]} metas ativas, mesma regra
 */
function montarTecladoNotion(pageId, categorias, metas) {
  const id = semHifen(pageId);
  const botoes = [
    ...categorias.map((c, i) => ({ text: c, callback_data: `cat|${id}|${i}` })),
    ...metas.map((m, i) => ({ text: `🎯 ${m}`, callback_data: `meta|${id}|${i}` })),
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

/** Teclado só de metas (caso RESGATE CDB) — mesma convenção do original. */
function montarTecladoMetasNotion(pageId, metas) {
  return montarTecladoNotion(pageId, [], metas);
}

/** Parse do callback_data no formato Notion (id sem hífen + índice numérico). */
function parsearCallbackNotion(data) {
  const m = /^(cat|meta)\|([a-f0-9]{32})\|(\d+)$/.exec(String(data || ""));
  if (!m) return null;
  return { tipo: m[1], pageId: m[2], indice: Number(m[3]) };
}

module.exports = { semHifen, montarTecladoNotion, montarTecladoMetasNotion, parsearCallbackNotion };
