// Gera workflows/relatorio-mensal.json, workflows/relatorio-sob-demanda.json e
// workflows/teste-relatorio.json a partir da lógica testada (workflows/src/relatorio.js,
// que reusa dashboard.js + rateio.js). Rodar: node scripts/gerar-workflow-relatorio.js
// Plano: gstack/plans/relatorio-mensal.md
//
// relatorio.js faz require() de dashboard.js/rateio.js — isso NÃO funciona em Code
// node n8n; por isso os três módulos são concatenados (sem require/module.exports)
// num único escopo. relatorio-mensal = cron (dia 1, 09:00) com idempotência via Log.
// relatorio-sob-demanda = chamado pelo roteador no /relatorio (modo comando, read-only).
// teste-relatorio = harness HTTP que só exercita o caminho comando (NUNCA o cron).
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const lerSrc = (arq) => fs.readFileSync(path.join(RAIZ, "workflows", "src", arq), "utf-8");
const semExports = (s) => s.replace(/module\.exports[\s\S]*$/, "");
// Tolera indentação. IMPORTANTE: rodar DEPOIS de semExports — o bloco CLI do
// dashboard (que tem seu próprio require interno) já foi cortado pelo module.exports.
const semRequireLocal = (s) => s.replace(/^\s*const .*require\("\.\/.*\.js"\);\s*$/gm, "");

// rateio (base) → dashboard (usa rateio) → relatorio (usa ambos), num escopo só.
const baseSrc = [
  semExports(lerSrc("rateio.js")),
  semRequireLocal(semExports(lerSrc("dashboard.js"))),
  semRequireLocal(semExports(lerSrc("relatorio.js"))),
].join("\n");

const CRED_SHEETS = { googleApi: { id: "FinSheetsSA00001", name: "Google Sheets SA" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// ── helpers de nós (mesmo padrão dos demais geradores) ───────────────
const lerDados = (abas, pos) => ({
  name: "Ler Dados",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  ...RETRY,
  parameters: {
    method: "GET",
    url:
      "=https://sheets.googleapis.com/v4/spreadsheets/{{ $env.GOOGLE_SHEETS_ID }}/values:batchGet?" +
      abas.map((a) => `ranges=${encodeURIComponent(a)}`).join("&") +
      "&valueRenderOption=UNFORMATTED_VALUE",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleApi",
    options: {},
  },
  credentials: CRED_SHEETS,
});

const SRC_PARA_OBJETOS = [
  "const vr = ($json.valueRanges || []);",
  "const paraObjetos = (idx) => {",
  "  const v = (vr[idx] && vr[idx].values) || [];",
  "  if (v.length < 2) return [];",
  "  const h = v[0].map(String);",
  "  return v.slice(1).map((linha) => {",
  "    const o = {};",
  "    h.forEach((c, j) => { o[c] = linha[j] !== undefined ? linha[j] : ''; });",
  "    return o;",
  "  });",
  "};",
  // mês vigente / anterior a partir de 'YYYY-MM-DD' → 'MM/YYYY'
  "const mesVigente = (iso) => { const [y, m] = iso.split('-'); return m + '/' + y; };",
  "const mesAnterior = (iso) => { let [y, m] = iso.split('-').map(Number); m -= 1;",
  "  if (m === 0) { m = 12; y -= 1; } return String(m).padStart(2, '0') + '/' + y; };",
  "const cfgDict = (rows) => { const o = {}; for (const r of rows) o[r.chave] = r.valor; return o; };",
  "const urlPlanilha = 'https://docs.google.com/spreadsheets/d/' + $env.GOOGLE_SHEETS_ID + '/edit';",
].join("\n");

const codeNode = (nome, jsCode, pos) => ({
  name: nome,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
  parameters: { jsCode },
});

const sheetsAppend = (nome, aba, pos) => ({
  name: nome,
  type: "n8n-nodes-base.googleSheets",
  typeVersion: 4.5,
  position: pos,
  ...RETRY,
  parameters: {
    authentication: "serviceAccount",
    operation: "append",
    documentId: { __rl: true, mode: "id", value: "={{ $env.GOOGLE_SHEETS_ID }}" },
    sheetName: { __rl: true, mode: "name", value: aba },
    columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [] },
    options: {},
  },
  credentials: CRED_SHEETS,
});

// HTTP cru (em vez do nó Telegram nativo) para passar parse_mode HTML +
// disable_web_page_preview no body — mesmo padrão do httpTelegram dos irmãos.
// onError=continueRegularOutput: no cron, um envio que falha após os retries NÃO
// pode derrubar o fluxo — o "Linha Log" seguinte filtra o item com json.error e
// não grava relatorio_enviado, então o próximo disparo reenvia (falha-seguro).
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
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $json.texto," +
      " parse_mode: 'HTML', disable_web_page_preview: true }) }}",
    options: {},
  },
});

const RANGES_BASE = ["'Lançamentos'!A:J", "'Contas Fixas'!A:D", "'Salários'!A:B", "'Config'!A:B"];
const LANC_FIX_SAL_CFG =
  "const lanc = paraObjetos(0), fixas = paraObjetos(1), sal = paraObjetos(2), cfg = cfgDict(paraObjetos(3));";

// ════════════════════════════════════════════════════════════════════
// Workflow 1: relatorio-mensal (cron dia 1, 09:00) — idempotente via Log
// valueRanges: 0=Lançamentos 1=Contas Fixas 2=Salários 3=Config 4=Log
// ════════════════════════════════════════════════════════════════════
const codigoMontarCron = baseSrc + "\n" + [
  "",
  "// ── Glue (cron): fecha o mês anterior; contas fixas do mês vigente ──",
  SRC_PARA_OBJETOS,
  "const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  LANC_FIX_SAL_CFG,
  "const logs = paraObjetos(4);",
  "const mesGastos = mesAnterior(hoje), mesFixos = mesVigente(hoje);",
  "if (!deveEnviarCron(logs, mesGastos)) return []; // já enviou este mês → no-op",
  "const { texto } = montarRelatorio({ lancamentos: lanc, contasFixas: fixas, salarios: sal, config: cfg },",
  "  { mesGastos, mesFixos, urlPlanilha });",
  "return [{ json: { texto, log: { timestamp: new Date().toISOString(),",
  "  acao: 'relatorio_enviado', entidade: 'Relatorio', valor_anterior: mesGastos,",
  "  valor_novo: '', origem: 'relatorio-mensal' } } }];",
].join("\n");

const wfMensal = {
  id: "FinRelatMensal01",
  name: "relatorio-mensal",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Cron Mensal",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 9 1 * *" }] } },
    },
    lerDados([...RANGES_BASE, "'Log'!A:F"], [200, 0]),
    codeNode("Montar", codigoMontarCron, [400, 0]),
    { ...enviarRelatorio("Enviar Relatório", [600, 0]) },
    {
      name: "Linha Log",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [800, 0],
      // loga só se o envio não retornou erro (índices pareados com Montar)
      parameters: {
        jsCode: [
          "const envios = $input.all();",
          "return $('Montar').all()",
          "  .filter((i, idx) => !(envios[idx] && envios[idx].json && envios[idx].json.error))",
          "  .map((i) => ({ json: i.json.log }));",
        ].join("\n"),
      },
    },
    sheetsAppend("Gravar Log", "Log", [1000, 0]),
  ],
  connections: {
    "Cron Mensal": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Montar", type: "main", index: 0 }]] },
    "Montar": { main: [[{ node: "Enviar Relatório", type: "main", index: 0 }]] },
    "Enviar Relatório": { main: [[{ node: "Linha Log", type: "main", index: 0 }]] },
    "Linha Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 2: relatorio-sob-demanda (/relatorio via roteador) — read-only
// valueRanges: 0=Lançamentos 1=Contas Fixas 2=Salários 3=Config
// ════════════════════════════════════════════════════════════════════
const codigoMontarComando = baseSrc + "\n" + [
  "",
  "// ── Glue (comando): mês vigente p/ gastos E fixas; nunca grava no Log ──",
  SRC_PARA_OBJETOS,
  "let hoje = '';",
  "try { const h = String($('Início').first().json.hoje || '');",
  "  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(h)) hoje = h; } catch (e) {}",
  "if (!hoje) hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  LANC_FIX_SAL_CFG,
  "const mes = mesVigente(hoje);",
  "const { texto } = montarRelatorio({ lancamentos: lanc, contasFixas: fixas, salarios: sal, config: cfg },",
  "  { mesGastos: mes, mesFixos: mes, urlPlanilha });",
  "return [{ json: { texto } }];",
].join("\n");

const wfSobDemanda = {
  id: "FinRelatSobDem01",
  name: "relatorio-sob-demanda",
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Início",
      type: "n8n-nodes-base.executeWorkflowTrigger",
      typeVersion: 1.1,
      position: [0, 0],
      parameters: {
        inputSource: "workflowInputs",
        workflowInputs: { values: [{ name: "hoje", type: "string" }] },
      },
    },
    lerDados(RANGES_BASE, [200, 0]),
    codeNode("Montar", codigoMontarComando, [400, 0]),
    enviarRelatorio("Enviar Relatório", [600, 0]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Montar", type: "main", index: 0 }]] },
    "Montar": { main: [[{ node: "Enviar Relatório", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 3: teste-relatorio (harness — SÓ o caminho comando/read-only)
// ════════════════════════════════════════════════════════════════════
const wfTeste = {
  id: "FinTesteRelat001",
  name: "teste-relatorio",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook Teste",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0008-4000-8000-financeiro08",
      parameters: { httpMethod: "POST", path: "teste-relatorio", options: {} },
    },
    {
      name: "Chamar Relatório",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [200, 0],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinRelatSobDem01", cachedResultName: "relatorio-sob-demanda" },
        workflowInputs: {
          mappingMode: "defineBelow",
          value: { hoje: "={{ $json.body.hoje }}" },
          matchingColumns: [],
          schema: [
            { id: "hoje", displayName: "hoje", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
          ],
        },
        mode: "once",
        options: { waitForSubWorkflow: true },
      },
    },
  ],
  connections: {
    "Webhook Teste": { main: [[{ node: "Chamar Relatório", type: "main", index: 0 }]] },
  },
};

// ── grava os três ────────────────────────────────────────────────────
for (const wf of [wfMensal, wfSobDemanda, wfTeste]) {
  wf.nodes.forEach((n, i) => {
    n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`;
  });
  const destino = path.join(RAIZ, "workflows", `${wf.name}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
