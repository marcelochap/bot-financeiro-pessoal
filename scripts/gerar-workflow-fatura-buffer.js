// Gera workflows/fatura-buffer.json a partir da lógica testada (workflows/src/fatura-buffer.js
// + fatura-aberta.js). Rodar: node scripts/gerar-workflow-fatura-buffer.js
// Spec: gstack/specs/fatura-aberta-buffer-colagem.md
//
// O fatura-buffer remonta a fatura aberta colada em N mensagens (o Telegram divide colagens
// > 4096 chars). Acumula fragmentos na aba `FaturaBuffer` e FECHA quando o checksum bate —
// aí chama o `fatura-aberta` (intacto) com o texto completo. Despachado pelo roteador-central
// para /faturaaberta (acao=fatura-aberta-cmd, reseta) e texto livre (acao=texto-livre, anexa/stub).
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const lerSrc = (arq) => fs.readFileSync(path.join(RAIZ, "workflows", "src", arq), "utf-8");
const semExports = (s) => s.replace(/module\.exports[\s\S]*$/, "");
const semRequireLocal = (s) => s.replace(/^\s*const .*require\("\.\/.*\.js"\);\s*$/gm, "");

// fatura-aberta.js (parseFaturaAberta) + fatura-buffer.js (decidirFluxoBuffer). Sem colisão:
// fatura-aberta usa arredonda/normalizar*; fatura-buffer usa stripCmd/montarTextoBuffer/brl.
const bufferSrc = [
  semExports(lerSrc("fatura-aberta.js")),
  semRequireLocal(semExports(lerSrc("fatura-buffer.js"))),
].join("\n");

const CRED_SHEETS = { googleApi: { id: "FinSheetsSA00001", name: "Google Sheets SA" } };
const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const lerDados = (abas, pos) => ({
  name: "Ler Buffer",
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

const httpSheetsClear = (nome, range, pos) => ({
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  ...RETRY,
  parameters: {
    method: "POST",
    url:
      "=https://sheets.googleapis.com/v4/spreadsheets/{{ $env.GOOGLE_SHEETS_ID }}/values/" +
      encodeURIComponent(range) + ":clear",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleApi",
    options: {},
  },
  credentials: CRED_SHEETS,
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

const ifString = (nome, esquerda, valor, pos) => ({
  name: nome,
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: pos,
  parameters: {
    conditions: {
      options: { caseSensitive: true, typeValidation: "strict", version: 2 },
      combinator: "and",
      conditions: [
        { leftValue: esquerda, rightValue: valor, operator: { type: "string", operation: "equals" } },
      ],
    },
  },
});

const codeNode = (nome, jsCode, pos) => ({
  name: nome,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
  parameters: { jsCode },
});

const telegramMsg = (nome, texto, pos) => ({
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  ...RETRY,
  parameters: { chatId: "={{ $env.TELEGRAM_CHAT_ID }}", text: texto, additionalFields: { appendAttribution: false } },
  credentials: CRED_TELEGRAM,
});

// ── Decidir: lê o estado do buffer e roda decidirFluxoBuffer ──────────
// valueRanges: 0=FaturaBuffer 1=Config
const codigoDecidir = bufferSrc + "\n" + [
  "",
  "// ── Glue: monta o estado do buffer e decide flush/responder/stub ──",
  "const vr = ($json.valueRanges || []);",
  "const paraObjetos = (idx) => {",
  "  const v = (vr[idx] && vr[idx].values) || [];",
  "  if (v.length < 2) return [];",
  "  const h = v[0].map(String);",
  "  return v.slice(1).map((linha) => {",
  "    const o = {}; h.forEach((c, j) => { o[c] = linha[j] !== undefined ? linha[j] : ''; }); return o;",
  "  });",
  "};",
  "const e = $('Início').first().json;",
  "const fb = paraObjetos(0);",
  "const estado = fb[0] || { aberto: 'não', texto_acumulado: '', atualizado_em: 0 };",
  "const cfg = paraObjetos(1);",
  "const ttlRow = cfg.find((r) => String(r.chave || '').trim().toLowerCase() === 'fatura_buffer_ttl_min');",
  "const ttlMin = ttlRow && Number(ttlRow.valor) > 0 ? Number(ttlRow.valor) : 15;",
  "const agoraMs = Date.now();", // epoch-ms; grande demais p/ virar serial-de-data do Sheets (≠ ciclo, não precisa de normalizarCiclo)
  "const d = decidirFluxoBuffer(estado, String(e.acao || ''), String(e.texto || ''), agoraMs, ttlMin * 60000);",
  "",
  "let fase, resposta = '', textoFlush = '', row = null;",
  "if (d.acao === 'flush') {",
  "  fase = 'flush'; textoFlush = d.textoFlush;",
  "  row = { texto_acumulado: '', aberto: 'não', atualizado_em: '' };",
  "} else if (d.acao === 'stub-nl') {",
  "  fase = 'stub'; resposta = d.resposta;",
  "} else {", // aguardar | estouro
  "  fase = 'responder'; resposta = d.resposta;",
  "  row = { texto_acumulado: d.novoTexto, aberto: 'sim', atualizado_em: String(agoraMs) };",
  "}",
  "return [{ json: { fase, resposta, textoFlush, row } }];",
].join("\n");

// Fronteira de confirmação: o fatura-aberta (intacto) é quem emite o ✅ no flush. retryOnFail
// para consistência com os demais nós de API; waitForSubWorkflow:false como nos despachos do
// roteador (single-user; o fatura-aberta tem retry interno na escrita do Sheets).
const chamarFatura = (pos) => ({
  name: "Chamar Fatura",
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  ...RETRY,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: "FinFaturaAbert01", cachedResultName: "fatura-aberta" },
    workflowInputs: {
      mappingMode: "defineBelow",
      value: { acao: "fatura-aberta", texto: "={{ $('Decidir').first().json.textoFlush }}" },
      matchingColumns: [],
      schema: ["acao", "texto"].map((id) => ({
        id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string",
      })),
    },
    mode: "once",
    options: { waitForSubWorkflow: false },
  },
});

const workflow = {
  id: "FinFaturaBuf001",
  name: "fatura-buffer",
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
        workflowInputs: { values: [{ name: "acao", type: "string" }, { name: "texto", type: "string" }] },
      },
    },
    lerDados(["'FaturaBuffer'!A:C", "'Config'!A:B"], [200, 0]),
    codeNode("Decidir", codigoDecidir, [400, 0]),
    ifString("É Stub?", "={{ $json.fase }}", "stub", [600, 0]),
    telegramMsg("Enviar Stub", "={{ $json.resposta }}", [800, -140]),

    // Não-stub: regrava o buffer (clear+append da única linha), depois flush ou progresso.
    httpSheetsClear("Limpar Buffer", "FaturaBuffer!A2:C", [800, 120]),
    codeNode("Linha Buffer", "return [{ json: $('Decidir').first().json.row }];", [1000, 120]),
    sheetsAppend("Gravar Buffer", "FaturaBuffer", [1200, 120]),
    ifString("É Flush?", "={{ $('Decidir').first().json.fase }}", "flush", [1400, 120]),
    chamarFatura([1600, 40]),
    telegramMsg("Reportar Progresso", "={{ $('Decidir').first().json.resposta }}", [1600, 220]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Buffer", type: "main", index: 0 }]] },
    "Ler Buffer": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    "Decidir": { main: [[{ node: "É Stub?", type: "main", index: 0 }]] },
    "É Stub?": {
      main: [
        [{ node: "Enviar Stub", type: "main", index: 0 }],
        [{ node: "Limpar Buffer", type: "main", index: 0 }],
      ],
    },
    "Limpar Buffer": { main: [[{ node: "Linha Buffer", type: "main", index: 0 }]] },
    "Linha Buffer": { main: [[{ node: "Gravar Buffer", type: "main", index: 0 }]] },
    "Gravar Buffer": { main: [[{ node: "É Flush?", type: "main", index: 0 }]] },
    "É Flush?": {
      main: [
        [{ node: "Chamar Fatura", type: "main", index: 0 }],
        [{ node: "Reportar Progresso", type: "main", index: 0 }],
      ],
    },
  },
};

workflow.nodes.forEach((n, i) => { n.id = `fin-buf-${String(i + 1).padStart(2, "0")}`; });
const destino = path.join(RAIZ, "workflows", "fatura-buffer.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
