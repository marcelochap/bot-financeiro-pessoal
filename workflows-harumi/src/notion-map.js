// Mapeamento puro entre o shape "flat" usado pela lógica de negócio reaproveitada de
// workflows/src/*.js (parser-cartao, parser-conta, dashboard, rateio, ...) e o formato
// de properties da API do Notion (POST /v1/pages, POST /v1/databases/{id}/query).
// Sem I/O — só transformação de dados. Concatenado nos Code nodes do n8n junto com
// os módulos puros originais (ver scripts/gerar-workflow-*-notion.js).
// Implementa a Fase A de gstack (schema em workflows-harumi/README... ver plano da branch).

/** "DD/MM/YYYY" ou "YYYY-MM-DD" → "YYYY-MM-DD" (Notion exige ISO); inválido/vazio → null. */
function paraIso(data) {
  if (data === null || data === undefined || data === "") return null;
  const s = String(data).trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/**
 * Texto plano de uma property title/rich_text do Notion. As demais funções de
 * leitura (paraObjeto*) devolvem "YYYY-MM-DD" para datas — mesDe()/normalizarData()
 * em workflows/src/*.js já aceitam esse formato ISO nativamente, então nenhuma
 * conversão adicional é necessária na leitura (só na escrita, via paraIso).
 */
function textoDe(prop) {
  if (!prop) return "";
  const arr = prop.title || prop.rich_text || [];
  return arr.map((t) => t.plain_text || "").join("");
}

const richText = (s) => (s ? [{ text: { content: String(s).slice(0, 2000) } }] : []);
const selectOrNull = (s) => (s ? { select: { name: String(s) } } : { select: null });
const dateOrNull = (isoOuBr) => {
  const iso = paraIso(isoOuBr);
  return iso ? { date: { start: iso } } : { date: null };
};

// ─── Lançamentos ────────────────────────────────────────────────────────────

/** Page do Notion (results[i] de um query em Lançamentos) → objeto flat esperado pelos parsers/dashboard. */
function paraObjetoLancamento(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    data_competencia: (p["Data Competência"] && p["Data Competência"].date && p["Data Competência"].date.start) || "",
    data_original: (p["Data Original"] && p["Data Original"].date && p["Data Original"].date.start) || "",
    descricao: textoDe(p["Descrição"]),
    titulo: "",
    valor: (p["Valor"] && p["Valor"].number) || 0,
    categoria: (p["Categoria"] && p["Categoria"].select && p["Categoria"].select.name) || "",
    tipo: (p["Tipo"] && p["Tipo"].select && p["Tipo"].select.name) || "",
    origem: (p["Origem"] && p["Origem"].select && p["Origem"].select.name) || "",
    status: (p["Status"] && p["Status"].select && p["Status"].select.name) || "",
    id_meta: textoDe(p["Meta"]),
  };
}

/** Objeto flat (saída do parser-cartao/parser-conta) → properties para criar a page no Notion. */
function propsDeLancamento(l) {
  return {
    "Descrição": { title: richText(l.descricao || l.titulo || "(sem descrição)") },
    "Valor": { number: Number(l.valor) || 0 },
    "Categoria": selectOrNull(l.categoria),
    "Tipo": selectOrNull(l.tipo),
    "Origem": selectOrNull(l.origem),
    "Status": selectOrNull(l.status),
    "Meta": { rich_text: richText(l.id_meta) },
    "Data Competência": dateOrNull(l.data_competencia),
    "Data Original": dateOrNull(l.data_original),
  };
}

/** Update parcial (PATCH) de um Lançamento: só Categoria+Meta — não toca nas demais properties. */
function propsCategoriaEMeta(categoria, idMeta) {
  return { "Categoria": selectOrNull(categoria), "Meta": { rich_text: richText(idMeta) } };
}

// ─── Dicionário ─────────────────────────────────────────────────────────────

function paraObjetoDicionario(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    descricao_original: textoDe(p["Descrição Original"]),
    categoria_mapeada: (p["Categoria Mapeada"] && p["Categoria Mapeada"].select && p["Categoria Mapeada"].select.name) || "",
    origem: (p["Origem"] && p["Origem"].select && p["Origem"].select.name) || "",
    criado_em: (p["Criado Em"] && p["Criado Em"].date && p["Criado Em"].date.start) || "",
  };
}

/** Dicionário lido vira { chave, categoria } (contrato de parser-cartao.categorizar / parser-conta). */
function paraDicionarioChaveCategoria(objetosDicionario) {
  return objetosDicionario.map((d) => ({ chave: d.descricao_original, categoria: d.categoria_mapeada }));
}

function propsDeDicionario(d) {
  // Criado Em nunca fica vazio: cai no dia de hoje se d.criado_em não vier preenchido.
  const criadoEm = paraIso(d.criado_em) || new Date().toISOString().slice(0, 10);
  return {
    "Descrição Original": { title: richText(d.descricao_original || "(vazio)") },
    "Categoria Mapeada": selectOrNull(d.categoria_mapeada),
    "Origem": selectOrNull(d.origem),
    "Criado Em": { date: { start: criadoEm } },
  };
}

// ─── Categorias ─────────────────────────────────────────────────────────────

function paraObjetoCategoria(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    nome: textoDe(p["Nome"]),
    tipo: (p["Tipo"] && p["Tipo"].select && p["Tipo"].select.name) || "",
    ativo: !!(p["Ativo"] && p["Ativo"].checkbox),
  };
}

function propsDeCategoria(c) {
  return {
    "Nome": { title: richText(c.nome || "(sem nome)") },
    "Tipo": selectOrNull(c.tipo),
    "Ativo": { checkbox: !!c.ativo },
  };
}

// ─── Metas ──────────────────────────────────────────────────────────────────
// Prazo fica RICH_TEXT (não Date): metas.js aceita "AAAA-MM" (sem dia) além de
// "AAAA-MM-DD" — um Date do Notion exige dia, então forçaria uma escolha arbitrária
// (dia 1? último dia?) que a lógica pura nunca precisou fazer. Texto preserva o
// valor exatamente como o usuário digitou em /novameta.

function paraObjetoMeta(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    nome: textoDe(p["Nome"]),
    orcamento_total: (p["Orçamento Total"] && p["Orçamento Total"].number) || 0,
    valor_acumulado: (p["Valor Acumulado"] && p["Valor Acumulado"].number) || 0,
    prazo: textoDe(p["Prazo"]),
    status: (p["Status"] && p["Status"].select && p["Status"].select.name) || "",
    criado_em: (p["Criado Em"] && p["Criado Em"].date && p["Criado Em"].date.start) || "",
  };
}

function propsDeMeta(m) {
  const criadoEm = paraIso(m.criado_em) || new Date().toISOString().slice(0, 10);
  return {
    "Nome": { title: richText(m.nome || "(sem nome)") },
    "Orçamento Total": { number: Number(m.orcamento_total) || 0 },
    "Valor Acumulado": { number: Number(m.valor_acumulado) || 0 },
    "Prazo": { rich_text: richText(m.prazo) },
    "Status": selectOrNull(m.status),
    "Criado Em": { date: { start: criadoEm } },
  };
}

/** Update parcial: só o cache de progresso (nunca fonte da verdade — ver metas.js). */
function propsValorAcumulado(valor) {
  return { "Valor Acumulado": { number: Number(valor) || 0 } };
}

/** Update parcial: só o Status (ex.: encerrar uma meta). */
function propsStatus(status) {
  return { "Status": selectOrNull(status) };
}

// ─── Contas Fixas ───────────────────────────────────────────────────────────
// Dia Vencimento fica RICH_TEXT (não Number): lembretes.js aceita tanto um dia
// numérico (1–31) quanto o literal "sexta-feira" (contas semanais) — um Number
// do Notion não representaria essa segunda forma.

function paraObjetoContaFixa(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    nome: textoDe(p["Nome"]),
    dia_vencimento: textoDe(p["Dia Vencimento"]),
    valor_esperado: (p["Valor Esperado"] && p["Valor Esperado"].number) || 0,
    // string "sim"/"não": lembretes.js/relatorio.js comparam com essa convenção
    // (normalizar(f.ativo) === "sim"), herdada do Sheets — o checkbox boolean do
    // Notion é traduzido aqui pra não precisar tocar nos dois arquivos compartilhados.
    ativo: (p["Ativo"] && p["Ativo"].checkbox) ? "sim" : "não",
  };
}

function propsDeContaFixa(c) {
  return {
    "Nome": { title: richText(c.nome || "(sem nome)") },
    "Dia Vencimento": { rich_text: richText(c.dia_vencimento) },
    "Valor Esperado": { number: Number(c.valor_esperado) || 0 },
    "Ativo": { checkbox: String(c.ativo).trim().toLowerCase() === "sim" },
  };
}

// ─── Dashboard Mensal ───────────────────────────────────────────────────────

function paraObjetoDashboardMensal(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    mes: textoDe(p["Mês"]),
    saidas: (p["Saídas"] && p["Saídas"].number) || 0,
    entradas: (p["Entradas"] && p["Entradas"].number) || 0,
    saldo: (p["Saldo"] && p["Saldo"].number) || 0,
    metas_ativas: (p["Metas Ativas"] && p["Metas Ativas"].number) || 0,
    gerado_em: (p["Gerado Em"] && p["Gerado Em"].date && p["Gerado Em"].date.start) || "",
  };
}

/** "MM/YYYY" → YYYYMM (número). O título "MM/YYYY" não ordena cronologicamente como
 * texto ("01/2027" vem antes de "12/2026" alfabeticamente) — esta é a coluna de apoio
 * usada pela view "Mais recentes" (SORT BY "Mês Ordinal" DESC). */
function mesOrdinal(mesMMYYYY) {
  const m = /^(\d{2})\/(\d{4})$/.exec(String(mesMMYYYY || "").trim());
  return m ? Number(m[2]) * 100 + Number(m[1]) : 0;
}

function propsDeDashboardMensal(d) {
  return {
    "Mês": { title: richText(d.mes) },
    "Mês Ordinal": { number: mesOrdinal(d.mes) },
    "Saídas": { number: Number(d.saidas) || 0 },
    "Entradas": { number: Number(d.entradas) || 0 },
    "Saldo": { number: Number(d.saldo) || 0 },
    "Metas Ativas": { number: Number(d.metasAtivas) || 0 },
    "Gerado Em": { date: { start: d.geradoEm || new Date().toISOString() } },
  };
}

// ─── FaturaAberta ───────────────────────────────────────────────────────────
// Snapshot do ciclo aberto corrente (Fase E). Igual ao padrão Sheets original:
// clear+write a cada /faturaaberta — no Notion isso vira "arquiva as pages
// existentes, cria as novas" (mesmo substituto usado no upsert do Dashboard
// Mensal). `ciclo`/`data_compra` ficam RICH_TEXT (não Date) pelo mesmo motivo
// de Prazo/Dia Vencimento: fatura-aberta.js compara strings "DD/MM/YYYY" via
// normalizarCiclo, não precisa de filtro de Date nativo do Notion.

function paraObjetoFaturaAberta(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    ciclo: textoDe(p["Ciclo"]),
    data_compra: textoDe(p["Data Compra"]),
    estabelecimento: textoDe(p["Estabelecimento"]),
    categoria_c6: textoDe(p["Categoria C6"]),
    valor: (p["Valor"] && p["Valor"].number) || 0,
    parcelas_total: p["Parcelas Total"] && p["Parcelas Total"].number != null ? p["Parcelas Total"].number : "",
    status: (p["Status"] && p["Status"].select && p["Status"].select.name) || "",
  };
}

function propsDeFaturaAberta(r) {
  return {
    "Estabelecimento": { title: richText(r.estabelecimento || "(sem estabelecimento)") },
    "Ciclo": { rich_text: richText(r.ciclo) },
    "Data Compra": { rich_text: richText(r.data_compra) },
    "Categoria C6": { rich_text: richText(r.categoria_c6) },
    "Valor": { number: Number(r.valor) || 0 },
    "Parcelas Total": { number: r.parcelas_total === "" || r.parcelas_total == null ? null : Number(r.parcelas_total) },
    "Status": selectOrNull(r.status),
  };
}

// ─── Parcelas ───────────────────────────────────────────────────────────────
// Estado do seed de parcelamento (Fase E) — mesmas 5 colunas da aba Sheets
// original (A:E), sem a `chave` de casamento (só usada em memória no seed).

function paraObjetoParcela(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    estabelecimento: textoDe(p["Estabelecimento"]),
    valor: (p["Valor"] && p["Valor"].number) || 0,
    M: (p["M"] && p["M"].number) || 0,
    N_no_seed: (p["N no Seed"] && p["N no Seed"].number) || 0,
    ciclo_referencia: textoDe(p["Ciclo Referência"]),
  };
}

function propsDeParcela(r) {
  return {
    "Estabelecimento": { title: richText(r.estabelecimento || "(sem estabelecimento)") },
    "Valor": { number: Number(r.valor) || 0 },
    "M": { number: Number(r.M) || 0 },
    "N no Seed": { number: Number(r.N_no_seed) || 0 },
    "Ciclo Referência": { rich_text: richText(r.ciclo_referencia) },
  };
}

// ─── Config ─────────────────────────────────────────────────────────────────

function paraObjetoConfig(page) {
  const p = (page && page.properties) || {};
  return { _id: page && page.id, chave: textoDe(p["Chave"]), valor: textoDe(p["Valor"]) };
}

function propsDeConfig(c) {
  return {
    "Chave": { title: richText(c.chave || "(sem chave)") },
    "Valor": { rich_text: richText(c.valor) },
  };
}

// ─── Log ────────────────────────────────────────────────────────────────────

/** Necessário a partir da Fase B: categorizacao-hibrida lê o Log p/ não perguntar 2x. */
function paraObjetoLog(page) {
  const p = (page && page.properties) || {};
  return {
    _id: page && page.id,
    timestamp: (p["Timestamp"] && p["Timestamp"].date && p["Timestamp"].date.start) || "",
    acao: textoDe(p["Ação"]),
    entidade: textoDe(p["Entidade"]),
    valor_anterior: textoDe(p["Valor Anterior"]),
    valor_novo: textoDe(p["Valor Novo"]),
    origem: (p["Origem"] && p["Origem"].select && p["Origem"].select.name) || "",
  };
}

function propsDeLog(l) {
  const registro = `${l.acao || ""} — ${l.entidade || ""}`.trim();
  return {
    "Registro": { title: richText(registro || "log") },
    "Timestamp": { date: { start: l.timestamp || new Date().toISOString() } },
    "Ação": { rich_text: richText(l.acao) },
    "Entidade": { rich_text: richText(l.entidade) },
    "Valor Anterior": { rich_text: richText(l.valor_anterior) },
    "Valor Novo": { rich_text: richText(l.valor_novo) },
    "Origem": selectOrNull(l.origem),
  };
}

module.exports = {
  paraIso,
  textoDe,
  paraObjetoLancamento,
  propsDeLancamento,
  propsCategoriaEMeta,
  paraObjetoDicionario,
  paraDicionarioChaveCategoria,
  propsDeDicionario,
  paraObjetoCategoria,
  propsDeCategoria,
  paraObjetoMeta,
  propsDeMeta,
  propsValorAcumulado,
  propsStatus,
  paraObjetoContaFixa,
  propsDeContaFixa,
  paraObjetoDashboardMensal,
  mesOrdinal,
  propsDeDashboardMensal,
  paraObjetoConfig,
  propsDeConfig,
  paraObjetoLog,
  propsDeLog,
  paraObjetoFaturaAberta,
  propsDeFaturaAberta,
  paraObjetoParcela,
  propsDeParcela,
};
