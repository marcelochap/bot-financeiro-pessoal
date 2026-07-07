// Gera workflows-harumi/dashboard.json — "dashboard no Notion" (Fase D): n8n calcula
// tudo (reaproveitando totaisMes/gastosPorCategoria de dashboard.js e calcularProgresso
// de metas.js, sem alteração) e escreve o resultado pronto na database "Dashboard Mensal"
// do Notion — Harumi vê nativamente, sem precisar do app React (dashboard-web/).
// Sem comprometidoFuturo/previsaoProximoMes (dependem de FaturaAberta/Parcelas — Fase E).
// Rodar: node scripts/gerar-workflow-dashboard-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const semExports = (s) => s.replace(/module\.exports[\s\S]*$/, "");
const semRequireLocal = (s) => s.replace(/^\s*const \{[^}]*\}\s*=\s*require\(["'][^"']*\.js["']\);\s*$/gm, "");
const lerSrc = (dir, arq) => fs.readFileSync(path.join(RAIZ, dir, "src", arq), "utf-8");

// rateio (base) → dashboard (usa rateio) → metas (progresso) → dashboard-notion-extra
// (usa dashboard+rateio+metas) — um escopo só no Code node. fatura-aberta.js fica de
// fora (só é preciso por comprometidoFuturo, que não chamamos — mesmo raciocínio do
// gerador de relatório: função nunca invocada não precisa ter suas deps presentes).
const baseSrc = [
  semExports(lerSrc("workflows", "rateio.js")),
  semRequireLocal(semExports(lerSrc("workflows", "dashboard.js"))),
  semRequireLocal(semExports(lerSrc("workflows", "metas.js"))),
  semRequireLocal(semExports(lerSrc("workflows-harumi", "dashboard-notion-extra.js"))),
].join("\n");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBotHarumi01", name: "Telegram Bot (Harumi)" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const codeNode = (nome, jsCode, pos, extra = {}) => ({
  name: nome, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode }, ...extra,
});

const telegramMsg = (nome, texto, pos) => ({
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  parameters: { chatId: "={{ $env.TELEGRAM_CHAT_ID_HARUMI }}", text: texto, additionalFields: { appendAttribution: false } },
  credentials: CRED_TELEGRAM,
});

const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: Lançamentos + Contas Fixas + Metas ativas ──",
  "const [lancamentos, contasFixas, metasAtivas] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS),",
  "  notionQueryAll($env.NOTION_DB_CONTAS_FIXAS),",
  "  notionQueryAll($env.NOTION_DB_METAS, { property: 'Status', select: { equals: 'ativa' } }),",
  "]);",
  "return [{ json: { lancamentos, contasFixas, metasAtivas } }];",
].join("\n");

const codigoCalcular = baseSrc + notionMapSrc + "\n" + [
  "",
  "// ── Glue: agrega o mês vigente a partir dos dados do Notion ──",
  "const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  "const [ano, mesNum] = hoje.split('-');",
  "const mes = mesNum + '/' + ano;",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const lancamentos = brutos.lancamentos.map(paraObjetoLancamento);",
  "const contasFixas = brutos.contasFixas.map(paraObjetoContaFixa);",
  "const metas = brutos.metasAtivas.map(paraObjetoMeta);",
  "const resumo = montarResumoDashboardNotion({ lancamentos, contasFixas, metas }, mes);",
  "return [{ json: { mes, ...resumo } }];",
].join("\n");

// Upsert (query por Mês → update ou create) + substitui o corpo pelos blocos nativos
// de blocosDashboardNotion (callout + colunas + toggles) — número de blocos de topo
// continua pequeno e previsível (3 a 5), independente de quantas categorias/metas
// existam (essas ficam aninhadas DENTRO dos toggles, não como blocos de topo).
const extraSrc = semRequireLocal(semExports(lerSrc("workflows-harumi", "dashboard-notion-extra.js")));

const codigoUpsertDashboard = [
  notionHttpSrc,
  notionMapSrc,
  extraSrc,
  "",
  "// ── Glue: cria ou atualiza a page do mês em Dashboard Mensal + corpo (blocos nativos) ──",
  "const item = $json;",
  "const existentes = await notionQueryAll($env.NOTION_DB_DASHBOARD_MENSAL,",
  "  { property: 'Mês', title: { equals: item.mes } });",
  "const props = propsDeDashboardMensal({ mes: item.mes, saidas: item.saidas, entradas: item.entradas,",
  "  saldo: item.saldo, metasAtivas: item.metasAtivas, geradoEm: new Date().toISOString() });",
  "",
  "let pageId;",
  "if (existentes.length) {",
  "  pageId = existentes[0].id;",
  "  await notionUpdatePage(pageId, props);",
  "  const filhos = await HELPERS.httpRequest({ method: 'GET',",
  "    url: `https://api.notion.com/v1/blocks/${pageId}/children`, headers: notionHeaders(), json: true });",
  "  for (const b of (filhos.results || [])) {",
  "    await HELPERS.httpRequest({ method: 'PATCH', url: `https://api.notion.com/v1/blocks/${b.id}`,",
  "      headers: notionHeaders(), body: { archived: true }, json: true });",
  "  }",
  "} else {",
  "  const criado = await notionCreatePage($env.NOTION_DB_DASHBOARD_MENSAL, props);",
  "  pageId = criado.id;",
  "}",
  "",
  "await HELPERS.httpRequest({",
  "  method: 'PATCH', url: `https://api.notion.com/v1/blocks/${pageId}/children`,",
  "  headers: notionHeaders(),",
  "  body: { children: blocosDashboardNotion(item) },",
  "  json: true,",
  "});",
  "return [{ json: { ok: true, pageId, mes: item.mes } }];",
].join("\n");

const workflow = {
  id: "FinDashNotion01",
  name: "dashboard (Notion — Harumi)",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    // Gatilho duplo: cron semanal (rede de segurança) + Execute Workflow (chamado
    // pelo /dashboard do roteador) — mesmo padrão de lembretes-agendados.
    { name: "Cron Semanal", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, -100], parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 8 * * 1" }] } } },
    { name: "Início Comando", type: "n8n-nodes-base.executeWorkflowTrigger", typeVersion: 1.1, position: [0, 100], parameters: { inputSource: "passthrough" } },
    codeNode("Ler Dados (Notion)", codigoLerDados, [200, 0], RETRY),
    codeNode("Calcular", codigoCalcular, [400, 0]),
    codeNode("Upsert Dashboard (Notion)", codigoUpsertDashboard, [600, 0], RETRY),
    telegramMsg(
      "Avisar Atualizado",
      "=📊 Dashboard atualizado! Confira a database \"Dashboard Mensal\" no Notion (mês {{ $json.mes }}).",
      [800, 0]
    ),
  ],
  connections: {
    "Cron Semanal": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Início Comando": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Calcular", type: "main", index: 0 }]] },
    "Calcular": { main: [[{ node: "Upsert Dashboard (Notion)", type: "main", index: 0 }]] },
    "Upsert Dashboard (Notion)": { main: [[{ node: "Avisar Atualizado", type: "main", index: 0 }]] },
  },
};

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
workflow.nodes.forEach((n, i) => { n.id = `fin-dash-notion-${String(i + 1).padStart(2, "0")}`; });
const destino = path.join(destinoDir, "dashboard.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
