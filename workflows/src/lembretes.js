// Lógica pura dos lembretes agendados — decide quem lembrar hoje a partir das
// abas Contas Fixas e Log (estado append-only), monta mensagem/teclado e
// interpreta callbacks pg|/np|. Implementa gstack/plans/lembretes-agendados.md.
// "hoje" SEMPRE entra como parâmetro YYYY-MM-DD (timezone resolvida no glue).

function dataUTC(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDe(d) {
  return d.toISOString().slice(0, 10);
}

function diasNoMes(ano, mes1a12) {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

/** Dia de vencimento efetivo no mês (dia 30 em fevereiro → último dia). */
function vencimentoNoMes(dia, ano, mes1a12) {
  return Math.min(dia, diasNoMes(ano, mes1a12));
}

function temLog(logs, acao, chave, dia) {
  return logs.some(
    (l) =>
      l.acao === acao &&
      String(l.valor_anterior) === chave &&
      (dia === undefined || String(l.valor_novo).split("|")[1] === dia)
  );
}

/**
 * Decide os lembretes do dia e as contas inválidas a notificar.
 * @param {Array<{nome, dia_vencimento, valor_esperado, ativo}>} contas aba Contas Fixas
 * @param {Array<{acao, valor_anterior, valor_novo}>} logs aba Log
 * @param {string} hojeISO data local (America/Sao_Paulo) em YYYY-MM-DD
 * @returns {{lembretes: Array<{conta, referencia, tipo, valor, data_vencimento,
 *   pendencia_anterior}>, invalidas: Array<{conta, motivo}>}}
 */
function decidirLembretes(contas, logs, hojeISO) {
  const hoje = dataUTC(hojeISO);
  const amanha = new Date(hoje.getTime() + 86400000);
  const lembretes = [];
  const invalidas = [];

  for (const c of contas) {
    if (String(c.ativo).trim().toLowerCase() !== "sim") continue;
    const nome = String(c.nome || "").trim();
    const valor = Number(c.valor_esperado);
    const diaVenc = String(c.dia_vencimento).trim().toLowerCase();

    let motivo = null;
    if (nome.includes("|")) motivo = "nome contém '|' (quebraria o teclado)";
    // pior caso de callback_data: np|<nome>|2024-07-05 — limite Telegram 64 bytes
    else if (Buffer.byteLength(`np|${nome}|2024-07-05`, "utf-8") > 64) {
      motivo = "nome longo demais para o teclado (limite de 64 bytes do Telegram)";
    } else if (diaVenc !== "sexta-feira") {
      const dia = Number(diaVenc);
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
        motivo = `dia_vencimento inválido: "${c.dia_vencimento}"`;
      }
    }
    if (motivo) {
      if (!temLog(logs, "lembrete_erro", `${nome}|invalida`)) invalidas.push({ conta: nome, motivo });
      continue;
    }

    let lembrete = null;
    if (diaVenc === "sexta-feira") {
      if (hoje.getUTCDay() === 5) {
        const sextaAnterior = isoDe(new Date(hoje.getTime() - 7 * 86400000));
        const pendente =
          temLog(logs, "lembrete_enviado", `${nome}|${sextaAnterior}`) &&
          !temLog(logs, "pagamento_confirmado", `${nome}|${sextaAnterior}`);
        lembrete = {
          conta: nome,
          referencia: hojeISO,
          tipo: "semanal",
          valor,
          data_vencimento: hojeISO,
          pendencia_anterior: pendente ? sextaAnterior : null,
        };
      }
    } else {
      const dia = Number(diaVenc);
      // D0: hoje é o vencimento efetivo deste mês
      if (hoje.getUTCDate() === vencimentoNoMes(dia, hoje.getUTCFullYear(), hoje.getUTCMonth() + 1)) {
        lembrete = { tipo: "D0", venc: hoje };
      }
      // D-1: amanhã é o vencimento efetivo (referência = mês do VENCIMENTO)
      else if (
        amanha.getUTCDate() === vencimentoNoMes(dia, amanha.getUTCFullYear(), amanha.getUTCMonth() + 1)
      ) {
        lembrete = { tipo: "D-1", venc: amanha };
      }
      if (lembrete) {
        lembrete = {
          conta: nome,
          referencia: isoDe(lembrete.venc).slice(0, 7),
          tipo: lembrete.tipo,
          valor,
          data_vencimento: isoDe(lembrete.venc),
          pendencia_anterior: null,
        };
      }
    }
    if (!lembrete) continue;

    const chave = `${nome}|${lembrete.referencia}`;
    if (temLog(logs, "pagamento_confirmado", chave)) continue; // já pago no período
    if (temLog(logs, "lembrete_enviado", chave, hojeISO)) continue; // idempotência: já enviado hoje
    lembretes.push(lembrete);
  }

  return { lembretes, invalidas };
}

function formatarReal(n) {
  const [int, dec] = Number(n).toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

function ddmm(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** Texto do lembrete: conta, valor esperado, quando vence e pendência (semanal). */
function montarMensagemLembrete(l) {
  const valor = formatarReal(l.valor);
  let texto;
  if (l.tipo === "D-1") texto = `⏰ ${l.conta} — ${valor} vence amanhã (${ddmm(l.data_vencimento)}).`;
  else if (l.tipo === "D0") texto = `‼️ ${l.conta} — ${valor} vence HOJE (${ddmm(l.data_vencimento)}).`;
  else {
    texto = `💼 ${l.conta} — ${valor} (sexta, ${ddmm(l.data_vencimento)}).`;
    if (l.pendencia_anterior) {
      texto += `\n⚠️ A sexta passada (${ddmm(l.pendencia_anterior)}) ficou pendente.`;
    }
  }
  return `${texto}\nJá pagou?`;
}

/** Teclado ✅/⏰ com callback pg|/np|. Lança se exceder 64 bytes (limite Telegram). */
function montarTecladoLembrete(l) {
  const botoes = [
    { text: "✅ Paguei", callback_data: `pg|${l.conta}|${l.referencia}` },
    { text: "⏰ Ainda não", callback_data: `np|${l.conta}|${l.referencia}` },
  ];
  for (const b of botoes) {
    if (Buffer.byteLength(b.callback_data, "utf-8") > 64) {
      throw new Error(`callback_data excede 64 bytes: ${b.callback_data}`);
    }
  }
  return { inline_keyboard: [botoes] };
}

/** Parse do callback_data pg|/np|. Inválido/desconhecido → null. */
function parsearCallbackLembrete(data) {
  const m = /^(pg|np)\|([^|]+)\|(.+)$/.exec(String(data || ""));
  if (!m) return null;
  return { acao: m[1], conta: m[2], referencia: m[3] };
}

module.exports = {
  decidirLembretes,
  montarMensagemLembrete,
  montarTecladoLembrete,
  parsearCallbackLembrete,
};
