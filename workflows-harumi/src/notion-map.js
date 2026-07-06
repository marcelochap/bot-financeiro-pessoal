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

/** Log só é escrito pelas workflows de ingestão (nunca lido) — só propsDeLog é necessário por ora. */
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
  paraObjetoDicionario,
  paraDicionarioChaveCategoria,
  propsDeDicionario,
  paraObjetoCategoria,
  propsDeCategoria,
  paraObjetoConfig,
  propsDeConfig,
  propsDeLog,
};
