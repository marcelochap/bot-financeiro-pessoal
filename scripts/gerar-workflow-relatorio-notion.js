// Gera workflows-harumi/relatorio-mensal.json, relatorio-sob-demanda.json e
// teste-relatorio.json — variante Notion + modo individual (Fase C) do gerador
// original (scripts/gerar-workflow-relatorio.js). Reaproveita totaisMes/
// gastosPorCategoria (dashboard.js) e contasFixasDoMes/nomeMes/brl/esc (relatorio.js)
// sem alteração; troca só montarRelatorio → montarRelatorioIndividual (sem a seção
// Rateio — ver workflows-harumi/src/relatorio-notion-extra.js) e a leitura Sheets→Notion.
// Sem Salários (conceito exclusivo do modo casal).
// Rodar: node scripts/gerar-workflow-relatorio-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc, codigoGravarPages } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const semExports = (s) => s.replace(/module\.exports[\s\S]*$/, "");
// Remove qualquer `const {...} = require("....js")` (relativo "./" OU "../../") — os
// três/quatro módulos concatenados abaixo compartilham um escopo só no Code node.
const semRequireLocal = (s) => s.replace(/^\s*const \{[^}]*\}\s*=\s*require\(["'][^"']*\.js["']\);\s*$/gm, "");
const lerSrc = (dir, arq) => fs.readFileSync(path.join(RAIZ, dir, "src", arq), "utf-8");

// rateio (base) → dashboard (usa rateio) → relatorio (usa ambos) → relatorio-notion-extra
// (usa os três) — mesma ordem/motivo do gerador original, só com um módulo a mais no fim.
const baseSrc = [
  semExports(lerSrc("workflows", "rateio.js")),
  semRequireLocal(semExports(lerSrc("workflows", "dashboard.js"))),
  semRequireLocal(semExports(lerSrc("workflows", "relatorio.js"))),
  semRequireLocal(semExports(lerSrc("workflows-harumi", "relatorio-notion-extra.js"))),
].join("\n");

const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const codeNode = (nome, jsCode, pos, extra = {}) => ({
  name: nome, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode }, ...extra,
});

// HTTP cru (parse_mode HTML + disable_web_page_preview) — mesmo padrão do original.
const enviarRelatorio = (nome, pos) => ({
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  ...RETRY,
  onError: "continueRegularOutput",
  parameters: {
    method: "POST",
    url: "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage",
    sendBody: true, specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $json.texto, parse_mode: 'HTML', disable_web_page_preview: true }) }}",
    options: {},
  },
});

const GLUE_HELPERS = [
  "const mesVigente = (iso) => { const [y, m] = iso.split('-'); return m + '/' + y; };",
  "const mesAnterior = (iso) => { let [y, m] = iso.split('-').map(Number); m -= 1;",
  "  if (m === 0) { m = 12; y -= 1; } return String(m).padStart(2, '0') + '/' + y; };",
  "const cfgDict = (rows) => { const o = {}; for (const r of rows) o[r.chave] = r.valor; return o; };",
].join("\n");

// ════════════════════════════════════════════════════════════════════
// Workflow 1: relatorio-mensal (Notion) — cron dia 1, 09:00, idempotente via Log
// ════════════════════════════════════════════════════════════════════
const codigoLerDadosCron = [
  notionHttpSrc,
  "",
  "// ── Glue: Lançamentos + Contas Fixas + Config + Log (só 'relatorio_enviado') ──",
  "const [lancamentos, contasFixas, configRows, logRelatorio] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS),",
  "  notionQueryAll($env.NOTION_DB_CONTAS_FIXAS),",
  "  notionQueryAll($env.NOTION_DB_CONFIG),",
  "  notionQueryAll($env.NOTION_DB_LOG, { property: 'Ação', rich_text: { equals: 'relatorio_enviado' } }),",
  "]);",
  "return [{ json: { lancamentos, contasFixas, configRows, logRelatorio } }];",
].join("\n");

const codigoMontarCron = baseSrc + notionMapSrc + "\n" + [
  "",
  "// ── Glue (cron): fecha o mês anterior; contas fixas do mês vigente (Notion) ──",
  GLUE_HELPERS,
  "const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const lanc = brutos.lancamentos.map(paraObjetoLancamento);",
  "const fixas = brutos.contasFixas.map(paraObjetoContaFixa);",
  "const cfg = cfgDict(brutos.configRows.map(paraObjetoConfig));",
  "const logs = brutos.logRelatorio.map(paraObjetoLog);",
  "const mesGastos = mesAnterior(hoje), mesFixos = mesVigente(hoje);",
  "if (!deveEnviarCron(logs, mesGastos)) return []; // já enviou este mês → no-op",
  "const { texto } = montarRelatorioIndividual({ lancamentos: lanc, contasFixas: fixas, config: cfg },",
  "  { mesGastos, mesFixos });",
  "return [{ json: { texto, log: { timestamp: new Date().toISOString(),",
  "  acao: 'relatorio_enviado', entidade: 'Relatorio', valor_anterior: mesGastos,",
  "  valor_novo: '', origem: 'relatorio-mensal' } } }];",
].join("\n");

const wfMensal = {
  id: "FinRelatMenNoti1",
  name: "relatorio-mensal (Notion)",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    { name: "Cron Mensal", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 9 1 * *" }] } } },
    codeNode("Ler Dados (Notion)", codigoLerDadosCron, [200, 0], RETRY),
    codeNode("Montar", codigoMontarCron, [400, 0]),
    enviarRelatorio("Enviar Relatório", [600, 0]),
    codeNode("Linha Log", [
      "const envios = $input.all();",
      "return $('Montar').all()",
      "  .filter((i, idx) => !(envios[idx] && envios[idx].json && envios[idx].json.error))",
      "  .map((i) => ({ json: i.json.log }));",
    ].join("\n"), [800, 0]),
    codeNode("Gravar Log", codigoGravarPages("Linha Log", "NOTION_DB_LOG", "propsDeLog"), [1000, 0]),
  ],
  connections: {
    "Cron Mensal": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Montar", type: "main", index: 0 }]] },
    "Montar": { main: [[{ node: "Enviar Relatório", type: "main", index: 0 }]] },
    "Enviar Relatório": { main: [[{ node: "Linha Log", type: "main", index: 0 }]] },
    "Linha Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 2: relatorio-sob-demanda (Notion) — /relatorio via roteador, read-only
// ════════════════════════════════════════════════════════════════════
const codigoLerDadosComando = [
  notionHttpSrc,
  "",
  "// ── Glue: Lançamentos + Contas Fixas + Config (sem Log — comando nunca grava) ──",
  "const [lancamentos, contasFixas, configRows] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS),",
  "  notionQueryAll($env.NOTION_DB_CONTAS_FIXAS),",
  "  notionQueryAll($env.NOTION_DB_CONFIG),",
  "]);",
  "return [{ json: { lancamentos, contasFixas, configRows } }];",
].join("\n");

const codigoMontarComando = baseSrc + notionMapSrc + "\n" + [
  "",
  "// ── Glue (comando): mês vigente p/ gastos E fixas; nunca grava no Log ──",
  GLUE_HELPERS,
  "let hoje = '';",
  "try { const h = String($('Início').first().json.hoje || '');",
  "  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(h)) hoje = h; } catch (e) {}",
  "if (!hoje) hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const lanc = brutos.lancamentos.map(paraObjetoLancamento);",
  "const fixas = brutos.contasFixas.map(paraObjetoContaFixa);",
  "const cfg = cfgDict(brutos.configRows.map(paraObjetoConfig));",
  "const mes = mesVigente(hoje);",
  "const { texto } = montarRelatorioIndividual({ lancamentos: lanc, contasFixas: fixas, config: cfg },",
  "  { mesGastos: mes, mesFixos: mes });",
  "return [{ json: { texto } }];",
].join("\n");

const wfSobDemanda = {
  id: "FinRelatSobNoti1",
  name: "relatorio-sob-demanda (Notion)",
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    { name: "Início", type: "n8n-nodes-base.executeWorkflowTrigger", typeVersion: 1.1, position: [0, 0], parameters: { inputSource: "workflowInputs", workflowInputs: { values: [{ name: "hoje", type: "string" }] } } },
    codeNode("Ler Dados (Notion)", codigoLerDadosComando, [200, 0], RETRY),
    codeNode("Montar", codigoMontarComando, [400, 0]),
    enviarRelatorio("Enviar Relatório", [600, 0]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Montar", type: "main", index: 0 }]] },
    "Montar": { main: [[{ node: "Enviar Relatório", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 3: teste-relatorio (Notion) — harness (só o caminho comando/read-only)
// ════════════════════════════════════════════════════════════════════
const wfTeste = {
  id: "FinTRelatNoti1",
  name: "teste-relatorio (Notion)",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    { name: "Webhook Teste", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: "f1aacea1-0108-4000-8000-harumi0000008", parameters: { httpMethod: "POST", path: "teste-relatorio-harumi", options: {} } },
    {
      name: "Chamar Relatório",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [200, 0],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinRelatSobNoti1", cachedResultName: "relatorio-sob-demanda (Notion)" },
        workflowInputs: {
          mappingMode: "defineBelow",
          value: { hoje: "={{ $json.body.hoje }}" },
          matchingColumns: [],
          schema: [{ id: "hoje", displayName: "hoje", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" }],
        },
        mode: "once",
        options: { waitForSubWorkflow: true },
      },
    },
  ],
  connections: { "Webhook Teste": { main: [[{ node: "Chamar Relatório", type: "main", index: 0 }]] } },
};

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
for (const wf of [wfMensal, wfSobDemanda, wfTeste]) {
  wf.nodes.forEach((n, i) => { n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`; });
  const destino = path.join(destinoDir, `${wf.name.replace(" (Notion)", "")}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
