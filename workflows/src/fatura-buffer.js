// Lógica pura do fatura-buffer — remonta a fatura aberta colada em N mensagens (o Telegram
// divide colagens > 4096 chars). Acumula fragmentos e FECHA quando o checksum bate (decisão
// determinística e síncrona — sem timer/Wait/poller). TDD em fatura-buffer.test.js.
// Implementa gstack/specs/fatura-aberta-buffer-colagem.md.
const { parseFaturaAberta } = require("./fatura-aberta.js");

// Idêntico ao RESPOSTAS.emConstrucao("Entendimento de linguagem natural") do roteador.js — o
// stub de NL migrou para cá (texto livre sem sessão de fatura aberta).
const STUB_NL = "🚧 Entendimento de linguagem natural em construção — chega nas próximas fases.";

// Remove o comando inicial (/faturaaberta) E a quebra de linha/espaço que o segue, deixando o
// texto_acumulado puro (a fatura costuma vir como "/faturaaberta\n<fatura>"). É mais estrito que
// o stripCmd do fatura-aberta (que só apara [ \t]); como o buffer passa o texto JÁ puro adiante,
// o stripCmd do fatura-aberta vira no-op e o parse roda sobre a mesma string nos dois.
const stripCmd = (s) => String(s == null ? "" : s).replace(/^\/\S+[ \t\r\n]*/, "");

const brl = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",");

/** Concatena um fragmento ao acumulado, preservando quebras de linha. */
function montarTextoBuffer(acumulado, fragmento) {
  const a = String(acumulado == null ? "" : acumulado);
  const f = String(fragmento == null ? "" : fragmento);
  return a.trim() ? a + "\n" + f : f;
}

function respostaProgresso(parse) {
  const n = parse.lancamentos.length;
  if (parse.total === null) {
    // total ausente → o parser faz early-return e lancamentos vem vazio; não reportar "0".
    return `📥 Recebi seu trecho, mas ainda não vi "Total dessa fatura". ` +
      `Continue colando, ou /faturaaberta para recomeçar.`;
  }
  const ck = parse.checksum;
  return `📥 Recebi ${n} lançamento(s), somei ${brl(ck.somado)} de ${brl(ck.total)}. ` +
    `Faltam ${brl(ck.diferenca)} — continue colando, ou /faturaaberta para recomeçar.`;
}

function respostaEstouro(parse) {
  const ck = parse.checksum;
  return `⚠️ A soma (${brl(ck.somado)}) passou do Total (${brl(ck.total)}) em ` +
    `${brl(-ck.diferenca)} — possível estorno/duplicata. /faturaaberta para recomeçar.`;
}

/**
 * Decide o fluxo do buffer dado o estado e a mensagem recebida.
 * @param {{aberto:(boolean|string), texto_acumulado:string, atualizado_em:(number|string)}} estado
 * @param {"fatura-aberta-cmd"|"texto-livre"} rota
 * @param {string} texto fragmento recebido (com ou sem /faturaaberta na frente)
 * @param {number} agoraMs epoch ms de agora
 * @param {number} ttlMs janela de expiração da sessão (ms)
 * @returns {{acao:"flush"|"aguardar"|"estouro"|"stub-nl"|"rotear",
 *   novoTexto?:string, textoFlush?:string, resposta?:string, aberto?:boolean}}
 */
function decidirFluxoBuffer(estado, rota, texto, agoraMs, ttlMs) {
  const e = estado || {};
  const aberto = e.aberto === true || String(e.aberto || "").trim().toLowerCase() === "sim";
  const atualizado = Number(e.atualizado_em || 0) || 0;
  const expirado = aberto && Number(agoraMs) - atualizado > Number(ttlMs);

  let novoTexto;
  if (rota === "fatura-aberta-cmd") {
    novoTexto = stripCmd(texto); // /faturaaberta sempre RESETA a sessão (só o 1º fragmento)
  } else if (rota === "texto-livre") {
    if (!aberto || expirado) return { acao: "stub-nl", resposta: STUB_NL };
    novoTexto = montarTextoBuffer(e.texto_acumulado, texto);
  } else {
    return { acao: "rotear" };
  }

  const parse = parseFaturaAberta(novoTexto);
  if (parse.total !== null && parse.checksum.bate) {
    return { acao: "flush", textoFlush: novoTexto };
  }
  if (parse.total !== null && parse.checksum.diferenca < 0) {
    return { acao: "estouro", novoTexto, aberto: true, resposta: respostaEstouro(parse) };
  }
  // total ausente (assinatura ainda não veio) ou diferença > 0 (faltam) → acumular mais
  return { acao: "aguardar", novoTexto, aberto: true, resposta: respostaProgresso(parse) };
}

module.exports = { montarTextoBuffer, decidirFluxoBuffer, STUB_NL };
