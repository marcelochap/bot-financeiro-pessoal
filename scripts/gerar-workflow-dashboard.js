// Gera workflows/dashboard.json a partir da lógica testada (workflows/src/dashboard.js,
// rateio.js). Ele retorna uma API JSON protegida por senha com suporte a CORS.
// Rodar: node scripts/gerar-workflow-dashboard.js
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const lerSrc = (arq) => fs.readFileSync(path.join(RAIZ, "workflows", "src", arq), "utf-8");
const semExports = (s) => s.replace(/module\.exports[\s\S]*$/, "");
const semRequireLocal = (s) => s.replace(/^\s*const .*require\("\.\/.*\.js"\);\s*$/gm, "");

// Concatenando rateio.js + dashboard.js + fatura-aberta.js (lógica do comprometido, v2).
// Sem colisão de identificadores: rateio usa arred/normalizar/mesDe; fatura-aberta usa
// arredonda/normalizarChave/normalizarCiclo/MESES.
const baseSrc = [
  semExports(lerSrc("rateio.js")),
  semRequireLocal(semExports(lerSrc("dashboard.js"))),
  semRequireLocal(semExports(lerSrc("fatura-aberta.js"))),
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
      ["Lançamentos!A:J", "Contas Fixas!A:D", "Salários!A:B", "Metas!A:F",
       "FaturaAberta!A:G", "Parcelas!A:E", "Config!A:B"]
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
    responseDataSource: "custom",
    responseCode: "={{ $json.error ? 401 : 200 }}",
    responseBody: "={{ $json }}",
    options: {
      responseHeaders: {
        entries: [
          { name: "Content-Type", value: "application/json; charset=utf-8" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
          { name: "Access-Control-Allow-Methods", value: "GET, OPTIONS" }
        ]
      }
    }
  }
});

const codigoProcessarERenderizar = baseSrc + "\n" + [
  "",
  "// ── Glue (dashboard): processa inputs e valida autenticação ──",
  "const headers = $('Webhook').first().json.headers || {};",
  "const authHeader = headers['authorization'] || '';",
  "const token = authHeader.replace(/^Bearer\\s+/i, '').trim();",
  "const expectedPassword = ($env.DASHBOARD_PASSWORD || '').trim();",
  "",
  "if (!expectedPassword || token !== expectedPassword) {",
  "  return [{ json: { error: 'Senha inválida' } }];",
  "}",
  "",
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
  "const faturaAbertaRows = paraObjetos(4);",
  "const parcelasRows = paraObjetos(5);",
  "const configRows = paraObjetos(6);",
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
  // Saldo com a casa CUMULATIVO (até o mês selecionado) — detecta dívida de meses anteriores.",
  "const rateio = rateioAcumulado(lancamentos, salariosConfig, mesPassado);",
  "const previsao = previsaoProximoMes(lancamentos, contasFixas, salariosConfig, mesPrevisao, faturaAbertaRows);",
  "",
  "// Metas ativas",
  "const metasAtivas = (metas || []).filter(m => normalizar(m.status) === 'ativa' || normalizar(m.status) === 'ativo');",
  "",
  "// Comprometido futuro (v2): fatura aberta do ciclo corrente + projeção de parcelas.",
  "// Prospectivo a partir de HOJE (ignora o seletor de mês). Lógica pura em dashboard.js.",
  "const comprometido = comprometidoFuturo(faturaAbertaRows, parcelasRows, configRows, hoje);",
  "",
  "const payload = {",
  "  mesPassado,",
  "  mesPrevisao,",
  "  totais,",
  "  gastos,",
  "  rateio,",
  "  previsao,",
  "  metas: metasAtivas,",
  "  mesesDisponiveis,",
  "  comprometido,",
  "  avisos",
  "};",
  "",
  "return [{ json: payload }];",
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
      parameters: { httpMethod: "GET", path: "dashboard-data", responseMode: "responseNode", options: {} },
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
