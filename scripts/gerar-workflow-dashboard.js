// Gera workflows/dashboard.json a partir da lógica testada (workflows/src/dashboard.js,
// rateio.js) e do template HTML (workflows/src/dashboard-template.html).
// Rodar: node scripts/gerar-workflow-dashboard.js
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const lerSrc = (arq) => fs.readFileSync(path.join(RAIZ, "workflows", "src", arq), "utf-8");
const semExports = (s) => s.replace(/module\.exports[\s\S]*$/, "");
const semRequireLocal = (s) => s.replace(/^\s*const .*require\("\.\/.*\.js"\);\s*$/gm, "");

// Concatenando rateio.js + dashboard.js
const baseSrc = [
  semExports(lerSrc("rateio.js")),
  semRequireLocal(semExports(lerSrc("dashboard.js"))),
].join("\n");

const CRED_SHEETS = { googleApi: { id: "FinSheetsSA00001", name: "Google Sheets SA" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const lerDados = (pos) => ({
  name: "Ler Dados",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  ...RETRY,
  parameters: {
    method: "GET",
    url:
      "=https://sheets.googleapis.com/v4/spreadsheets/{{ $env.GOOGLE_SHEETS_ID }}/values:batchGet?" +
      ["Lançamentos!A:J", "Contas Fixas!A:D", "Salários!A:B", "Metas!A:F"]
        .map((a) => `ranges=${encodeURIComponent(a)}`).join("&") +
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
  "const mesVigente = (iso) => { const [y, m] = iso.split('-'); return m + '/' + y; };",
  "const mesAnterior = (iso) => { let [y, m] = iso.split('-').map(Number); m -= 1;",
  "  if (m === 0) { m = 12; y -= 1; } return String(m).padStart(2, '0') + '/' + y; };",
  "const mesSeguinte = (mesStr) => { let [m, y] = mesStr.split('/').map(Number); m += 1;",
  "  if (m === 13) { m = 1; y += 1; } return String(m).padStart(2, '0') + '/' + y; };",
].join("\n");

const codeNode = (nome, jsCode, pos) => ({
  name: nome,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
  parameters: { jsCode },
});

const responderWebhook = (pos) => ({
  name: "Responder Webhook",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: pos,
  parameters: {
    options: {
      responseBody: "={{ $json.html }}",
      responseHeaders: {
        entries: [
          { name: "Content-Type", value: "text/html; charset=utf-8" }
        ]
      }
    }
  }
});

const codigoProcessarERenderizar = baseSrc + "\n" + [
  "",
  "// ── Glue (dashboard): processa inputs e injeta no template HTML ──",
  SRC_PARA_OBJETOS,
  "const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  "let mesReq = '';",
  "try { mesReq = $('Webhook').first().json.query.mes || ''; } catch (e) {}",
  "const mesPassado = mesReq || mesAnterior(hoje);",
  "const mesPrevisao = mesSeguinte(mesPassado);",
  "",
  "const lancamentos = paraObjetos(0);",
  "const contasFixas = paraObjetos(1);",
  "const salarios = paraObjetos(2);",
  "const metas = paraObjetos(3);",
  "",
  "// Mapeia meses disponíveis a partir de Lançamentos",
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
  "// Valida salários",
  "const avisos = [];",
  "let salariosConfig = salarios;",
  "const somaSalarios = (salarios || []).reduce((s, r) => s + Number(r.salario || 0), 0);",
  "if (somaSalarios === 0) {",
  "  avisos.push('salarios_zerados');",
  "  salariosConfig = { Marcelo: 10000, Harumi: 10000 };",
  "}",
  "",
  "// Efetua cálculos",
  "const totais = totaisMes(lancamentos, mesPassado);",
  "const gastos = gastosPorCategoria(lancamentos, mesPassado);",
  "const rateio = rateioMes(lancamentos, salariosConfig, mesPassado);",
  "const previsao = previsaoProximoMes(lancamentos, contasFixas, salariosConfig, mesPrevisao);",
  "",
  "// Metas ativas",
  "const metasAtivas = (metas || []).filter(m => normalizar(m.status) === 'ativa' || normalizar(m.status) === 'ativo');",
  "",
  "// Injeta no template HTML",
  "const fs = require('fs');",
  "let html = '';",
  "try {",
  "  const template = fs.readFileSync('/workflows/src/dashboard-template.html', 'utf-8');",
  "  const payload = {",
  "    mesPassado,",
  "    mesPrevisao,",
  "    totais,",
  "    gastos,",
  "    rateio,",
  "    previsao,",
  "    metas: metasAtivas,",
  "    mesesDisponiveis,",
  "    avisos",
  "  };",
  "  html = template.replace('/*DATA_PLACEHOLDER*/', JSON.stringify(payload));",
  "} catch (err) {",
  "  html = '<h1>Erro ao carregar o template do dashboard</h1><p>' + err.message + '</p>';",
  "}",
  "",
  "return [{ json: { html } }];",
].join("\n");

const wfDashboard = {
  id: "FinDashboardWeb01",
  name: "dashboard",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0009-4000-8000-financeiro09",
      parameters: { httpMethod: "GET", path: "dashboard", responseMode: "responseNode", options: {} },
    },
    lerDados([200, 0]),
    codeNode("Processar e Renderizar", codigoProcessarERenderizar, [400, 0]),
    responderWebhook([600, 0]),
  ],
  connections: {
    "Webhook": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Processar e Renderizar", type: "main", index: 0 }]] },
    "Processar e Renderizar": { main: [[{ node: "Responder Webhook", type: "main", index: 0 }]] },
  },
};

// Grava o workflow
wfDashboard.nodes.forEach((n, i) => {
  n.id = `${wfDashboard.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`;
});
const destino = path.join(RAIZ, "workflows", "dashboard.json");
fs.writeFileSync(destino, JSON.stringify(wfDashboard, null, 2) + "\n");
console.log(`OK: ${destino} (${wfDashboard.nodes.length} nós)`);
