// Lógica pura do roteador-central — classificação de updates do Telegram e
// detecção de tipo de CSV. Implementa gstack/plans/roteador-central.md.

const RESPOSTAS = {
  boasVindas:
    "👋 Bot Financeiro ativo!\n" +
    "Envie o ZIP/CSV do extrato ou da fatura do C6 que eu processo.\n" +
    "Comandos: /categorizar, /relatorio, /dashboard, /metas, /novameta, " +
    "/faturaaberta, /seedparcelas.",
  emConstrucao: (oque) => `🚧 ${oque} em construção — chega nas próximas fases.`,
  comandoDesconhecido: "Comando não reconhecido. Use /start para ver as opções.",
  pdf: "🚧 Ingestão de PDF em construção — chega nas próximas fases.",
  formatoNaoSuportado:
    "Formato não suportado. Envie um .zip (extrato/fatura C6) ou .csv.",
};

/**
 * Classifica um update do Telegram.
 * @param {object} update update JSON do Telegram (body do webhook)
 * @param {{chatId: string, secret: string, headerSecret: string}} ctx
 *   chatId esperado (TELEGRAM_CHAT_ID); secret esperado (TELEGRAM_WEBHOOK_SECRET,
 *   vazio desliga o check); headerSecret = X-Telegram-Bot-Api-Secret-Token recebido
 * @returns {{rota: "ignorar"|"responder"|"documento", resposta?: string,
 *   file_id?: string, file_name?: string, tipo_arquivo?: "zip"|"csv"}}
 */
function classificarUpdate(update, ctx) {
  const { chatId, secret, headerSecret } = ctx;
  if (secret && headerSecret !== secret) return { rota: "ignorar" };

  // Callback de teclado inline (categorização — item 6; lembretes — item 7).
  // Segurança: valida o REMETENTE do clique; prefixo desconhecido → ignorar.
  // O destino fica na lógica pura para o glue só despachar, sem Switch por regex.
  const cq = update && update.callback_query;
  if (cq) {
    if (String((cq.from || {}).id) !== String(chatId)) return { rota: "ignorar" };
    const prefixo = (/^(cat|meta|pg|np|gmnova|gmenc|gmok)\|/.exec(String(cq.data || "")) || [])[1];
    if (!prefixo) return { rota: "ignorar" };
    let destino;
    if (prefixo === "pg" || prefixo === "np") destino = "responder-lembrete";
    else if (prefixo === "gmnova" || prefixo === "gmenc" || prefixo === "gmok") destino = "gerenciar-metas";
    else destino = "aplicar-categoria"; // cat| e meta| (associação lançamento→meta da categorização)
    return {
      rota: "callback",
      destino,
      callback_id: cq.id,
      data: cq.data,
      chat_id: cq.message && cq.message.chat ? cq.message.chat.id : "",
      message_id: cq.message ? cq.message.message_id : "",
    };
  }

  const msg = update && update.message;
  if (!msg || !msg.chat) return { rota: "ignorar" }; // edited_message etc.
  if (String(msg.chat.id) !== String(chatId)) return { rota: "ignorar" };

  if (msg.document) {
    const nome = String(msg.document.file_name || "");
    const ext = (/\.([a-z0-9]+)$/i.exec(nome) || [, ""])[1].toLowerCase();
    if (ext === "zip" || ext === "csv") {
      return {
        rota: "documento",
        file_id: msg.document.file_id,
        file_name: nome,
        tipo_arquivo: ext,
      };
    }
    if (ext === "pdf") return { rota: "responder", resposta: RESPOSTAS.pdf };
    return { rota: "responder", resposta: RESPOSTAS.formatoNaoSuportado };
  }

  if (typeof msg.text === "string" && msg.text.trim() !== "") {
    const texto = msg.text.trim();
    if (texto.startsWith("/")) {
      const cmd = texto.split(/[\s@]/)[0].toLowerCase();
      if (cmd === "/start") return { rota: "responder", resposta: RESPOSTAS.boasVindas };
      if (cmd === "/categorizar") return { rota: "categorizar" };
      if (cmd === "/relatorio") return { rota: "relatorio" };
      if (cmd === "/dashboard") return { rota: "dashboard" };
      if (cmd === "/metas") return { rota: "metas" };
      if (cmd === "/novameta") return { rota: "nova-meta", texto };
      if (cmd === "/faturaaberta") return { rota: "fatura-aberta", texto };
      if (cmd === "/seedparcelas") return { rota: "seed-parcelas", texto };
      return { rota: "responder", resposta: RESPOSTAS.comandoDesconhecido };
    }
    // Texto livre não vai mais direto ao stub: pode ser a CONTINUAÇÃO de uma colagem de fatura
    // aberta dividida pelo Telegram. Quem decide anexar×stub é o fatura-buffer (que tem o estado).
    return { rota: "texto-livre", texto };
  }

  return { rota: "ignorar" }; // foto, sticker, voz etc.
}

/**
 * Detecta o tipo de um CSV do C6 pelo CONTEÚDO (nome de arquivo não discrimina).
 * Remove BOM antes do match — o extrato real começa com EF BB BF.
 * @param {string} texto conteúdo do CSV
 * @returns {"cartao"|"conta"|"desconhecido"}
 */
function detectarTipoCsv(texto) {
  const t = String(texto || "").replace(/^﻿/, "").replace(/^\s+/, "");
  if (t.startsWith("Data de Compra;")) return "cartao";
  if (t.startsWith("EXTRATO DE CONTA CORRENTE")) return "conta";
  return "desconhecido";
}

module.exports = { classificarUpdate, detectarTipoCsv };
