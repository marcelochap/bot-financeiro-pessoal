// Testes do mapeamento Notion↔objeto-flat (workflows-harumi/src/notion-map.js).
// Foco nas quinas que diferem de Sheets: select vazio, date vazio, number nulo,
// texto sem acento. Rodar: node workflows-harumi/src/notion-map.test.js
const assert = require("node:assert");
const {
  paraIso,
  textoDe,
  paraObjetoLancamento,
  propsDeLancamento,
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
  propsDeLog,
} = require("./notion-map.js");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

// ─── paraIso ────────────────────────────────────────────────────────────────
teste("paraIso converte DD/MM/YYYY para YYYY-MM-DD", () => {
  assert.strictEqual(paraIso("10/06/2026"), "2026-06-10");
});
teste("paraIso mantém YYYY-MM-DD (já ISO, inclusive com hora)", () => {
  assert.strictEqual(paraIso("2026-06-10"), "2026-06-10");
  assert.strictEqual(paraIso("2026-06-10T00:00:00.000Z"), "2026-06-10");
});
teste("paraIso: vazio/null/undefined/lixo → null", () => {
  assert.strictEqual(paraIso(""), null);
  assert.strictEqual(paraIso(null), null);
  assert.strictEqual(paraIso(undefined), null);
  assert.strictEqual(paraIso("não é data"), null);
});

// ─── textoDe ────────────────────────────────────────────────────────────────
teste("textoDe extrai texto de title/rich_text; vazio/ausente → ''", () => {
  assert.strictEqual(textoDe({ title: [{ plain_text: "Mercado" }] }), "Mercado");
  assert.strictEqual(textoDe({ rich_text: [{ plain_text: "abc" }, { plain_text: "def" }] }), "abcdef");
  assert.strictEqual(textoDe({ title: [] }), "");
  assert.strictEqual(textoDe(undefined), "");
  assert.strictEqual(textoDe(null), "");
});

// ─── Lançamentos: page Notion → objeto flat ────────────────────────────────
teste("paraObjetoLancamento desembrulha uma page completa", () => {
  const page = {
    id: "page-123",
    properties: {
      "Descrição": { title: [{ plain_text: "MERCADOLIVRE" }] },
      "Data Competência": { date: { start: "2026-06-10" } },
      "Data Original": { date: { start: "2026-05-27" } },
      "Valor": { number: 251.64 },
      "Categoria": { select: { name: "Compras" } },
      "Tipo": { select: { name: "saída" } },
      "Origem": { select: { name: "cartao" } },
      "Status": { select: { name: "confirmado" } },
      "Meta": { rich_text: [{ plain_text: "Viagem Lua de Mel" }] },
    },
  };
  const o = paraObjetoLancamento(page);
  assert.strictEqual(o._id, "page-123");
  assert.strictEqual(o.descricao, "MERCADOLIVRE");
  assert.strictEqual(o.data_competencia, "2026-06-10");
  assert.strictEqual(o.valor, 251.64);
  assert.strictEqual(o.categoria, "Compras");
  assert.strictEqual(o.tipo, "saída");
  assert.strictEqual(o.origem, "cartao");
  assert.strictEqual(o.status, "confirmado");
  assert.strictEqual(o.id_meta, "Viagem Lua de Mel");
});

teste("paraObjetoLancamento: properties ausentes/vazias não quebram (number null, select null, date null)", () => {
  const page = {
    id: "page-456",
    properties: {
      "Descrição": { title: [] },
      "Data Competência": { date: null },
      "Data Original": { date: null },
      "Valor": { number: null },
      "Categoria": { select: null },
      "Tipo": { select: null },
      "Origem": { select: null },
      "Status": { select: null },
      "Meta": { rich_text: [] },
    },
  };
  const o = paraObjetoLancamento(page);
  assert.strictEqual(o.descricao, "");
  assert.strictEqual(o.data_competencia, "");
  assert.strictEqual(o.valor, 0);
  assert.strictEqual(o.categoria, "");
  assert.strictEqual(o.id_meta, "");
});

// ─── Lançamentos: objeto flat → properties Notion (ida) ────────────────────
teste("propsDeLancamento gera properties válidas a partir da saída do parser", () => {
  const l = {
    data_competencia: "10/06/2026",
    data_original: "27/05/2026",
    descricao: "MERCADOLIVRE",
    valor: 251.64,
    categoria: "Compras",
    tipo: "saída",
    origem: "cartao",
    status: "confirmado",
    id_meta: "",
  };
  const p = propsDeLancamento(l);
  assert.strictEqual(p["Descrição"].title[0].text.content, "MERCADOLIVRE");
  assert.strictEqual(p["Data Competência"].date.start, "2026-06-10");
  assert.strictEqual(p["Data Original"].date.start, "2026-05-27");
  assert.strictEqual(p["Valor"].number, 251.64);
  assert.strictEqual(p["Categoria"].select.name, "Compras");
  assert.deepStrictEqual(p["Meta"].rich_text, []);
});

teste("propsDeLancamento: categoria/id_meta vazios viram select null / rich_text vazio (sem quebrar)", () => {
  const p = propsDeLancamento({ descricao: "X", valor: 10, categoria: "", tipo: "saída", origem: "conta", status: "confirmado", id_meta: "" });
  assert.strictEqual(p["Categoria"].select, null);
  assert.deepStrictEqual(p["Meta"].rich_text, []);
});

teste("round-trip: propsDeLancamento → (simulando page do Notion) → paraObjetoLancamento preserva os dados", () => {
  const original = {
    data_competencia: "10/06/2026", data_original: "27/05/2026", descricao: "IFD*RESTAURANTE",
    valor: 42.5, categoria: "Alimentação", tipo: "saída", origem: "cartao", status: "confirmado", id_meta: "",
  };
  const props = propsDeLancamento(original);
  // Simula o formato de retorno do Notion para as mesmas properties que acabamos de montar.
  const pageSimulada = {
    id: "abc",
    properties: {
      "Descrição": { title: [{ plain_text: original.descricao }] },
      "Data Competência": { date: props["Data Competência"].date },
      "Data Original": { date: props["Data Original"].date },
      "Valor": { number: props["Valor"].number },
      "Categoria": { select: props["Categoria"].select },
      "Tipo": { select: props["Tipo"].select },
      "Origem": { select: props["Origem"].select },
      "Status": { select: props["Status"].select },
      "Meta": { rich_text: props["Meta"].rich_text },
    },
  };
  const volta = paraObjetoLancamento(pageSimulada);
  assert.strictEqual(volta.descricao, original.descricao);
  assert.strictEqual(volta.data_competencia, "2026-06-10"); // ISO — mesDe()/normalizarData() aceitam
  assert.strictEqual(volta.valor, original.valor);
  assert.strictEqual(volta.categoria, original.categoria);
});

// ─── Dicionário ─────────────────────────────────────────────────────────────
teste("paraObjetoDicionario + paraDicionarioChaveCategoria produz {chave, categoria} (contrato do parser)", () => {
  const page = {
    id: "d1",
    properties: {
      "Descrição Original": { title: [{ plain_text: "MERCADOLIVRE" }] },
      "Categoria Mapeada": { select: { name: "Compras" } },
      "Origem": { select: { name: "cartao" } },
      "Criado Em": { date: { start: "2026-06-01" } },
    },
  };
  const objetos = [paraObjetoDicionario(page)];
  const regras = paraDicionarioChaveCategoria(objetos);
  assert.deepStrictEqual(regras, [{ chave: "MERCADOLIVRE", categoria: "Compras" }]);
});

teste("propsDeDicionario preenche Criado Em com hoje quando não informado", () => {
  const p = propsDeDicionario({ descricao_original: "X", categoria_mapeada: "Y", origem: "conta" });
  assert.match(p["Criado Em"].date.start, /^\d{4}-\d{2}-\d{2}$/);
});

// ─── Categorias ─────────────────────────────────────────────────────────────
teste("paraObjetoCategoria/propsDeCategoria tratam Ativo como boolean (não 'sim'/'não')", () => {
  const page = { id: "c1", properties: { "Nome": { title: [{ plain_text: "Supermercado" }] }, "Tipo": { select: { name: "variável" } }, "Ativo": { checkbox: true } } };
  const o = paraObjetoCategoria(page);
  assert.strictEqual(o.ativo, true);
  const p = propsDeCategoria({ nome: "Supermercado", tipo: "variável", ativo: true });
  assert.strictEqual(p["Ativo"].checkbox, true);
  const pFalse = propsDeCategoria({ nome: "X", tipo: "fixa", ativo: false });
  assert.strictEqual(pFalse["Ativo"].checkbox, false);
});

// ─── Metas ──────────────────────────────────────────────────────────────────
teste("Metas: Prazo aceita 'AAAA-MM' (sem dia) sem virar Date — round-trip preserva o texto exato", () => {
  const props = propsDeMeta({ nome: "Cama Nova", orcamento_total: 1800, valor_acumulado: 300, prazo: "2026-12", status: "ativa" });
  assert.strictEqual(props["Prazo"].rich_text[0].text.content, "2026-12");
  const page = { id: "m1", properties: { "Nome": { title: [{ plain_text: "Cama Nova" }] }, "Orçamento Total": { number: 1800 }, "Valor Acumulado": { number: 300 }, "Prazo": { rich_text: [{ plain_text: "2026-12" }] }, "Status": { select: { name: "ativa" } }, "Criado Em": { date: { start: "2026-06-01" } } } };
  const o = paraObjetoMeta(page);
  assert.strictEqual(o.prazo, "2026-12");
  assert.strictEqual(o.orcamento_total, 1800);
});

teste("propsValorAcumulado/propsStatus geram patches parciais mínimos", () => {
  assert.deepStrictEqual(propsValorAcumulado(450.5), { "Valor Acumulado": { number: 450.5 } });
  assert.deepStrictEqual(propsStatus("encerrada"), { "Status": { select: { name: "encerrada" } } });
});

// ─── Contas Fixas ───────────────────────────────────────────────────────────
teste("Contas Fixas: Dia Vencimento aceita texto não-numérico ('sexta-feira')", () => {
  const props = propsDeContaFixa({ nome: "Empregada", dia_vencimento: "sexta-feira", valor_esperado: 800, ativo: "sim" });
  assert.strictEqual(props["Dia Vencimento"].rich_text[0].text.content, "sexta-feira");
  assert.strictEqual(props["Ativo"].checkbox, true);
});

teste("Contas Fixas: Ativo (checkbox boolean do Notion) vira 'sim'/'não' na leitura — convenção que lembretes.js/relatorio.js esperam", () => {
  const pageAtiva = { id: "c1", properties: { "Nome": { title: [{ plain_text: "Aluguel" }] }, "Dia Vencimento": { rich_text: [{ plain_text: "10" }] }, "Valor Esperado": { number: 1500 }, "Ativo": { checkbox: true } } };
  const pageInativa = { id: "c2", properties: { "Nome": { title: [{ plain_text: "Antigo" }] }, "Dia Vencimento": { rich_text: [{ plain_text: "5" }] }, "Valor Esperado": { number: 100 }, "Ativo": { checkbox: false } } };
  assert.strictEqual(paraObjetoContaFixa(pageAtiva).ativo, "sim");
  assert.strictEqual(paraObjetoContaFixa(pageInativa).ativo, "não");
});

teste("Contas Fixas: propsDeContaFixa aceita 'sim'/'não' (não só boolean) — round-trip com paraObjetoContaFixa", () => {
  const props1 = propsDeContaFixa({ nome: "X", dia_vencimento: "15", valor_esperado: 200, ativo: "sim" });
  const props2 = propsDeContaFixa({ nome: "Y", dia_vencimento: "15", valor_esperado: 200, ativo: "não" });
  assert.strictEqual(props1["Ativo"].checkbox, true);
  assert.strictEqual(props2["Ativo"].checkbox, false);
});

// ─── Log ────────────────────────────────────────────────────────────────────
teste("propsDeLog monta um título não-vazio mesmo com campos ausentes", () => {
  const p = propsDeLog({ acao: "importacao_confirmada", entidade: "Lançamentos", valor_novo: "5 lançamentos", origem: "cartao" });
  assert.ok(p["Registro"].title[0].text.content.length > 0);
  assert.strictEqual(p["Valor Novo"].rich_text[0].text.content, "5 lançamentos");
  const vazio = propsDeLog({});
  assert.ok(vazio["Registro"].title[0].text.content.length > 0);
});

console.log(`\n${passou} teste(s) passaram.`);
