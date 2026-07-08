// Gera workflows-harumi/dashboard-data.json — variante Notion do backend do dashboard
// web (scripts/gerar-workflow-dashboard.js), consumido pelo app React em
// dashboard-web-harumi/ (servido em /dashboard-harubs no Caddy). Reaproveita
// totaisMes/gastosPorCategoria/comprometidoFuturo/previsaoProximoMes de dashboard.js
// sem alteração. Sem rateio (instância individual): `rateio` sempre {}, `avisos`
// sempre [], previsaoProximoMes é chamada com salário único ({ Harumi: 1 }) só pra
// reaproveitar a função tal como está — depositosPrevistos do retorno é ignorado.
// Rodar: node scripts/gerar-workflow-dashboard-data-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const semExports = (s) => s.replace(/module\.exports[\s\S]*$/, "");
const semRequireLocal = (s) => s.replace(/^\s*const \{[^}]*\}\s*=\s*require\(["'][^"']*\.js["']\);\s*$/gm, "");
const lerSrc = (dir, arq) => fs.readFileSync(path.join(RAIZ, dir, "src", arq), "utf-8");

const baseSrc = [
  semExports(lerSrc("workflows", "rateio.js")),
  semExports(lerSrc("workflows", "fatura-aberta.js")),
  semRequireLocal(semExports(lerSrc("workflows", "dashboard.js"))),
].join("\n");

const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const codeNode = (nome, jsCode, pos, extra = {}) => ({
  name: nome, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode }, ...extra,
});

const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: lê tudo que o payload do dashboard-data precisa ──",
  "const [lancamentos, contasFixas, metas, faturaAberta, parcelas, config] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS),",
  "  notionQueryAll($env.NOTION_DB_CONTAS_FIXAS),",
  "  notionQueryAll($env.NOTION_DB_METAS),",
  "  notionQueryAll($env.NOTION_DB_FATURA_ABERTA),",
  "  notionQueryAll($env.NOTION_DB_PARCELAS),",
  "  notionQueryAll($env.NOTION_DB_CONFIG),",
  "]);",
  "return [{ json: { lancamentos, contasFixas, metas, faturaAberta, parcelas, config } }];",
].join("\n");

const responderWebhook = (pos) => ({
  name: "Responder Webhook",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: pos,
  parameters: {
    responseDataSource: "custom",
    responseCode: "={{ $json.error ? 401 : 200 }}",
    responseBody: "={{ $json }}",
    options: {
      responseHeaders: {
        entries: [
          { name: "Content-Type", value: "application/json; charset=utf-8" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
          { name: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
        ],
      },
    },
  },
});

const codigoProcessarERenderizar = baseSrc + notionMapSrc + "\n" + [
  "",
  "// ── Glue (dashboard-data Notion): valida senha, agrega e monta o payload ──",
  "const headers = $('Webhook').first().json.headers || {};",
  "const authHeader = headers['authorization'] || '';",
  "const token = authHeader.replace(/^Bearer\\s+/i, '').trim();",
  "const expectedPassword = ($env.DASHBOARD_PASSWORD_HARUMI || '').trim();",
  "",
  "if (!expectedPassword || token !== expectedPassword) {",
  "  return [{ json: { error: 'Senha inválida' } }];",
  "}",
  "",
  "const mesAnterior = (iso) => { let [y, m] = iso.split('-').map(Number); m -= 1;",
  "  if (m === 0) { m = 12; y -= 1; } return String(m).padStart(2, '0') + '/' + y; };",
  "const mesSeguinte = (mesStr) => { let [m, y] = mesStr.split('/').map(Number); m += 1;",
  "  if (m === 13) { m = 1; y += 1; } return String(m).padStart(2, '0') + '/' + y; };",
  "",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const lancamentos = brutos.lancamentos.map(paraObjetoLancamento);",
  "const contasFixas = brutos.contasFixas.map(paraObjetoContaFixa);",
  "const metasTodas = brutos.metas.map(paraObjetoMeta);",
  "const faturaAbertaRows = brutos.faturaAberta.map(paraObjetoFaturaAberta);",
  "const parcelasRows = brutos.parcelas.map(paraObjetoParcela);",
  "const configRows = brutos.config.map(paraObjetoConfig);",
  "",
  "const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  "let mesReq = '';",
  "try { mesReq = $('Webhook').first().json.query.mes || ''; } catch (e) {}",
  "const mesPassado = mesReq || mesAnterior(hoje);",
  "const mesPrevisao = mesSeguinte(mesPassado);",
  "",
  "const mesesSet = new Set();",
  "for (const l of lancamentos) {",
  "  const m = mesDe(l.data_competencia);",
  "  if (m) mesesSet.add(m);",
  "}",
  "mesesSet.add(mesPassado);",
  "const mesesDisponiveis = [...mesesSet].sort((a, b) => {",
  "  const [ma, ya] = a.split('/').map(Number);",
  "  const [mb, yb] = b.split('/').map(Number);",
  "  return ya !== yb ? ya - yb : ma - mb;",
  "});",
  "",
  "const totais = totaisMes(lancamentos, mesPassado);",
  "const gastos = gastosPorCategoria(lancamentos, mesPassado, contasFixas, []);",
  "// { Harumi: 1 } força proporcoes() a 100% — instância individual, sem rateio;",
  "// só gastos/detalhes do retorno são usados (depositosPrevistos é rateio, descartado).",
  "const previsaoCompleta = previsaoProximoMes(lancamentos, contasFixas, { Harumi: 1 }, mesPrevisao, faturaAbertaRows);",
  "const previsao = { gastos: previsaoCompleta.gastos, detalhes: previsaoCompleta.detalhes };",
  "const comprometido = comprometidoFuturo(faturaAbertaRows, parcelasRows, configRows, hoje);",
  "const metasAtivas = metasTodas.filter((m) => normalizar(m.status) === 'ativa' || normalizar(m.status) === 'ativo');",
  "",
  "const payload = {",
  "  mesPassado,",
  "  mesPrevisao,",
  "  totais,",
  "  gastos,",
  "  rateio: {},",
  "  previsao,",
  "  metas: metasAtivas,",
  "  mesesDisponiveis,",
  "  comprometido,",
  "  avisos: [],",
  "};",
  "",
  "return [{ json: payload }];",
].join("\n");

const workflow = {
  id: "FinDashDataNoti1",
  name: "dashboard-data (Notion — Harumi)",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0011-4000-8000-harumidash001",
      parameters: { httpMethod: "GET", path: "dashboard-data-harumi", responseMode: "responseNode", options: {} },
    },
    codeNode("Ler Dados (Notion)", codigoLerDados, [200, 0], RETRY),
    codeNode("Processar e Renderizar", codigoProcessarERenderizar, [400, 0]),
    responderWebhook([600, 0]),
  ],
  connections: {
    "Webhook": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Processar e Renderizar", type: "main", index: 0 }]] },
    "Processar e Renderizar": { main: [[{ node: "Responder Webhook", type: "main", index: 0 }]] },
  },
};

workflow.nodes.forEach((n, i) => { n.id = `fin-dashdata-notion-${String(i + 1).padStart(2, "0")}`; });
const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
const destino = path.join(destinoDir, "dashboard-data.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
