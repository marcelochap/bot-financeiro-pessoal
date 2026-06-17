// Lógica pura da gestão de metas — progresso derivado dos Lançamentos, mensagem
// e teclados inline do /metas, parse de /novameta e dos callbacks gm*.
// Implementa gstack/plans/gerenciar-metas.md.
//
// Progresso é SEMPRE derivado dos Lançamentos (fonte da verdade); a coluna C de
// Metas (valor_acumulado) é só cache reescrito no glue, nunca lida como fonte.
// CRUD distinto da associação lançamento→meta da categorização (prefixo meta|).

const TEMPLATE_NOVAMETA =
  "Para criar uma meta, envie:\n" +
  "/novameta <nome> | <orçamento> | <prazo>\n" +
  "Ex.: /novameta Cama Nova | 1800 | 2026-12";

function formatarReal(n) {
  const [int, dec] = Number(n).toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

function assertCb(botao) {
  if (Buffer.byteLength(botao.callback_data, "utf-8") > 64) {
    throw new Error(`callback_data excede 64 bytes: ${botao.callback_data}`);
  }
  return botao;
}

/**
 * Progresso de cada meta ATIVA, derivado dos Lançamentos.
 * acumulado = Σ |valor| dos lançamentos com status=confirmado e id_meta==nome
 * (match exato após trim dos dois lados — espaço de borda casa, case-sensitive).
 * @param {Array<{nome,orcamento_total,prazo,status}>} metas aba Metas (A:F)
 * @param {Array<{valor,status,id_meta}>} lancamentos aba Lançamentos (A:J)
 * @returns {Array<{nome,orcamento,acumulado,pct:(number|null),prazo}>}
 */
function calcularProgresso(metas, lancamentos) {
  return (metas || [])
    .filter((m) => String(m.status || "").trim().toLowerCase() === "ativa")
    .map((m) => {
      const nome = String(m.nome || "").trim();
      const orcamento = Number(m.orcamento_total) || 0;
      const acumulado = (lancamentos || [])
        .filter(
          (l) =>
            String(l.status || "").trim().toLowerCase() === "confirmado" &&
            String(l.id_meta || "").trim() === nome
        )
        .reduce((s, l) => s + Math.abs(Number(l.valor) || 0), 0);
      const pct = orcamento > 0 ? Math.round((acumulado / orcamento) * 100) : null;
      return { nome, orcamento, acumulado, pct, prazo: String(m.prazo || "").trim() };
    });
}

/** Mensagem do /metas: lista cada meta ativa; vazio → convite a criar. */
function montarMensagemMetas(progresso) {
  if (!progresso || progresso.length === 0) {
    return `🎯 Você ainda não tem metas ativas.\n\n${TEMPLATE_NOVAMETA}`;
  }
  const linhas = progresso.map((p) => {
    const acum = formatarReal(p.acumulado);
    if (p.pct === null) return `🎯 ${p.nome}\n   ${acum} acumulado · até ${p.prazo}`;
    return `🎯 ${p.nome}\n   ${acum} / ${formatarReal(p.orcamento)} (${p.pct}%) · até ${p.prazo}`;
  });
  return `Suas metas ativas:\n\n${linhas.join("\n\n")}`;
}

/** Teclado do /metas: 🏁 Encerrar por meta (gmenc|) + linha final ➕ Nova meta (gmnova|). */
function montarTecladoMetas(progresso) {
  const linhas = (progresso || []).map((p) => [
    assertCb({ text: `🏁 Encerrar ${p.nome}`, callback_data: `gmenc|${p.nome}` }),
  ]);
  linhas.push([assertCb({ text: "➕ Nova meta", callback_data: "gmnova|" })]);
  return { inline_keyboard: linhas };
}

/** Teclado de confirmação de encerramento (2 toques): ✅ Confirmar → gmok|<nome>. */
function montarTecladoConfirmarEncerrar(nome) {
  return {
    inline_keyboard: [
      [assertCb({ text: "✅ Confirmar encerramento", callback_data: `gmok|${nome}` })],
    ],
  };
}

/** Valor em formato BR: ponto milhar, vírgula decimal. Inválido → null. */
function parsearValorBR(bruto) {
  const s = String(bruto || "")
    .replace(/r\$/i, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Prazo aceito: AAAA-MM ou AAAA-MM-DD (mês 1–12, dia 1–31). */
function prazoValido(prazo) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(prazo || "").trim());
  if (!m) return false;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return false;
  if (m[3]) {
    const dia = Number(m[3]);
    if (dia < 1 || dia > 31) return false;
  }
  return true;
}

/** Nome de meta: trim, não vazio, sem '|', curto o bastante p/ caber no callback_data. */
function validarNomeMeta(nome) {
  const n = String(nome || "").trim();
  if (n === "") return { ok: false, erro: "Nome da meta não pode ser vazio." };
  if (n.includes("|")) return { ok: false, erro: "Nome da meta não pode conter '|'." };
  if (Buffer.byteLength(`gmok|${n}`, "utf-8") > 64) {
    return { ok: false, erro: "Nome da meta longo demais (máx ~59 caracteres)." };
  }
  return { ok: true, nome: n };
}

/**
 * Interpreta `/novameta <nome> | <orçamento> | <prazo>` (stateless).
 * @returns {{ok:true, meta:{nome,orcamento,prazo}} | {ok:false, erro:string}}
 */
function parsearNovaMeta(texto) {
  const corpo = String(texto || "").replace(/^\/novameta(@\S+)?/i, "").trim();
  const partes = corpo.split("|").map((p) => p.trim());
  const erroFmt = (msg) => ({ ok: false, erro: `${msg}\n\n${TEMPLATE_NOVAMETA}` });
  if (partes.length !== 3 || partes.some((p) => p === "")) {
    return erroFmt("Formato inválido — preencha nome, orçamento e prazo separados por '|'.");
  }
  const [nomeBruto, orcamentoBruto, prazo] = partes;
  const vn = validarNomeMeta(nomeBruto);
  if (!vn.ok) return erroFmt(vn.erro);
  const orcamento = parsearValorBR(orcamentoBruto);
  if (orcamento === null || orcamento <= 0) return erroFmt("Orçamento inválido — use um número, ex.: 1800.");
  if (!prazoValido(prazo)) return erroFmt("Prazo inválido — use AAAA-MM, ex.: 2026-12.");
  return { ok: true, meta: { nome: vn.nome, orcamento, prazo } };
}

/** Já existe meta ATIVA com esse nome? (homônimo de encerrada é permitido). */
function nomeJaExisteAtiva(nome, metas) {
  const alvo = String(nome || "").trim();
  return (metas || []).some(
    (m) =>
      String(m.status || "").trim().toLowerCase() === "ativa" &&
      String(m.nome || "").trim() === alvo
  );
}

/** Parse dos callbacks gm*. gmnova| → nova; gmenc|<nome>; gmok|<nome>. Inválido → null. */
function parsearCallbackMetaGestao(data) {
  const s = String(data || "");
  if (s === "gmnova|") return { acao: "nova" };
  const m = /^(gmenc|gmok)\|(.+)$/.exec(s);
  if (!m) return null;
  return { acao: m[1] === "gmenc" ? "encerrar-confirmar" : "encerrar-ok", nome: m[2] };
}

module.exports = {
  TEMPLATE_NOVAMETA,
  calcularProgresso,
  montarMensagemMetas,
  montarTecladoMetas,
  montarTecladoConfirmarEncerrar,
  parsearNovaMeta,
  parsearCallbackMetaGestao,
  validarNomeMeta,
  nomeJaExisteAtiva,
};
