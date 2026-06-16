// Gera workflows/roteador-central.json a partir da lógica testada
// (workflows/src/roteador.js). Rodar: node scripts/gerar-workflow-roteador.js
// Entrada: Webhook POST /webhook/telegram-bot (update do Telegram).
// ZIP do C6: descompactado em Code node via execFileSync('7z') — o nó Execute
// Command foi removido do n8n 2.x; requer NODE_FUNCTION_ALLOW_BUILTIN=child_process,fs,path.
// Produção: setWebhook manual + TELEGRAM_WEBHOOK_SECRET obrigatório.
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const roteadorSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "roteador.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };

const glueClassificar = [
  "",
  "// ── Glue: classifica o update recebido pelo webhook ──",
  "const r = classificarUpdate($json.body || {}, {",
  "  chatId: $env.TELEGRAM_CHAT_ID || '',",
  "  secret: $env.TELEGRAM_WEBHOOK_SECRET || '',",
  "  headerSecret: String(($json.headers || {})['x-telegram-bot-api-secret-token'] || ''),",
  "});",
  "return [{ json: r }];",
].join("\n");

const codigoExtrairZip = [
  "// Grava o ZIP baixado com nome FIXO, extrai com 7z (execFile, sem shell),",
  "// lê os CSVs e limpa o temporário no sucesso E no erro.",
  "const fs = require('fs');",
  "const path = require('path');",
  "const { execFileSync } = require('child_process');",
  "const dir = '/tmp/roteador/' + $execution.id;",
  "const out = path.join(dir, 'out');",
  "fs.mkdirSync(out, { recursive: true });",
  "const item = $input.first();",
  "if (!item.binary || !item.binary.data) {",
  "  return [{ json: { ok: false, erro: 'download sem conteúdo binário' } }];",
  "}",
  "// getBinaryDataBuffer resolve o binário independente do modo de storage (memória/filesystem)",
  "const buf = await this.helpers.getBinaryDataBuffer(0, 'data');",
  "fs.writeFileSync(path.join(dir, 'input.zip'), buf);",
  "let resultado;",
  "try {",
  "  execFileSync('7z', ['x', '-y', '-p' + ($env.C6_ZIP_PASSWORD || ''), '-o' + out, path.join(dir, 'input.zip')], { stdio: 'pipe' });",
  "  const arquivos = fs.readdirSync(out).filter((f) => f.toLowerCase().endsWith('.csv'));",
  "  resultado = arquivos.map((f) => ({",
  "    json: { ok: true, csv: fs.readFileSync(path.join(out, f), 'utf-8'), nome_arquivo: f },",
  "  }));",
  "  if (resultado.length === 0) resultado = [{ json: { ok: false, erro: 'ZIP não contém arquivos CSV' } }];",
  "} catch (e) {",
  "  const detalhe = [String((e && e.message) || e).slice(0, 200),",
  "    e && e.stderr ? String(e.stderr).slice(0, 200) : ''].filter(Boolean).join(' | ');",
  "  console.log('extrair-zip falhou:', detalhe, '| senha definida:', Boolean($env.C6_ZIP_PASSWORD));",
  "  resultado = [{ json: { ok: false, erro: 'falha ao extrair: ' + detalhe } }];",
  "}",
  "fs.rmSync(dir, { recursive: true, force: true });",
  "return resultado;",
].join("\n");

const codigoTextoCsv = [
  "// Decodifica o CSV baixado do Telegram (binário → texto)",
  "const item = $input.first();",
  "if (!item.binary || !item.binary.data) {",
  "  return [{ json: { csv: '', nome_arquivo: '' } }];",
  "}",
  "const buf = await this.helpers.getBinaryDataBuffer(0, 'data');",
  "return [{ json: {",
  "  csv: buf.toString('utf-8'),",
  "  nome_arquivo: $('Classificar').first().json.file_name || 'arquivo.csv',",
  "} }];",
].join("\n");

const glueDetectar = [
  "",
  "// ── Glue: adiciona o tipo detectado a cada CSV ──",
  "return $input.all().map((item) => ({ json: {",
  "  csv: item.json.csv,",
  "  nome_arquivo: item.json.nome_arquivo,",
  "  tipo: detectarTipoCsv(item.json.csv),",
  "} }));",
].join("\n");

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
        {
          leftValue: esquerda,
          rightValue: valor,
          operator: { type: "string", operation: "equals" },
        },
      ],
    },
  },
});

const ifBool = (nome, expressao, pos) => ({
  name: nome,
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: pos,
  parameters: {
    conditions: {
      options: { caseSensitive: true, typeValidation: "strict", version: 2 },
      combinator: "and",
      conditions: [
        {
          leftValue: expressao,
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
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
  parameters: {
    chatId: "={{ $env.TELEGRAM_CHAT_ID }}",
    text: texto,
    additionalFields: {},
  },
  credentials: CRED_TELEGRAM,
});

const baixar = (nome, pos) => ({
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    resource: "file",
    fileId: "={{ $('Classificar').first().json.file_id }}",
    download: true,
  },
  credentials: CRED_TELEGRAM,
});

const executarIngestao = (nome, workflowId, nomeWorkflow, pos) => ({
  name: nome,
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: workflowId, cachedResultName: nomeWorkflow },
    workflowInputs: {
      mappingMode: "defineBelow",
      value: { csv: "={{ $json.csv }}", nome_arquivo: "={{ $json.nome_arquivo }}" },
      matchingColumns: [],
      schema: [
        { id: "csv", displayName: "csv", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
        { id: "nome_arquivo", displayName: "nome_arquivo", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
      ],
    },
    mode: "each",
    options: { waitForSubWorkflow: false },
  },
});

const workflow = {
  id: "FinRoteador00001",
  name: "roteador-central",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook Telegram",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0003-4000-8000-financeiro03",
      parameters: { httpMethod: "POST", path: "telegram-bot", options: {} },
    },
    codeNode("Classificar", roteadorSrc + glueClassificar, [200, 0]),
    ifString("É Documento?", "={{ $json.rota }}", "documento", [400, 0]),
    ifString("Deve Responder?", "={{ $json.rota }}", "responder", [400, 200]),
    telegramMsg("Responder", "={{ $json.resposta }}", [600, 200]),
    { name: "Ignorar", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [600, 320], parameters: {} },

    ifString("É ZIP?", "={{ $json.tipo_arquivo }}", "zip", [600, -100]),
    baixar("Baixar ZIP", [800, -200]),
    codeNode("Extrair ZIP", codigoExtrairZip, [1000, -200]),
    ifBool("ZIP OK?", "={{ $json.ok }}", [1200, -200]),
    telegramMsg("Avisar Erro ZIP", "=❌ Não consegui processar o ZIP: {{ $json.erro }}", [1400, -100]),

    baixar("Baixar CSV", [800, 0]),
    codeNode("Texto CSV", codigoTextoCsv, [1000, 0]),

    // Itens 6/7: callback de teclado inline → destino decidido na lógica pura
    // (cat|/meta| → aplicar-categoria; pg|/np| → responder-lembrete)
    ifString("É Callback?", "={{ $json.rota }}", "callback", [400, 350]),
    ifString("Lembrete?", "={{ $json.destino }}", "responder-lembrete", [600, 450]),
    {
      name: "Responder Lembrete",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [800, 380],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinRespLembre001", cachedResultName: "responder-lembrete" },
        workflowInputs: {
          mappingMode: "defineBelow",
          value: {
            callback_id: "={{ $json.callback_id }}",
            data: "={{ $json.data }}",
            chat_id: "={{ $json.chat_id }}",
            message_id: "={{ $json.message_id }}",
          },
          matchingColumns: [],
          schema: [
            { id: "callback_id", displayName: "callback_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "data", displayName: "data", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "chat_id", displayName: "chat_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "message_id", displayName: "message_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
          ],
        },
        mode: "each",
        options: { waitForSubWorkflow: false },
      },
    },
    {
      name: "Aplicar Categoria",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [800, 520],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinAplicarCat001", cachedResultName: "aplicar-categoria" },
        workflowInputs: {
          mappingMode: "defineBelow",
          value: {
            callback_id: "={{ $json.callback_id }}",
            data: "={{ $json.data }}",
            chat_id: "={{ $json.chat_id }}",
            message_id: "={{ $json.message_id }}",
          },
          matchingColumns: [],
          schema: [
            { id: "callback_id", displayName: "callback_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "data", displayName: "data", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "chat_id", displayName: "chat_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "message_id", displayName: "message_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
          ],
        },
        mode: "each",
        options: { waitForSubWorkflow: false },
      },
    },
    ifString("É Categorizar?", "={{ $json.rota }}", "categorizar", [400, 550]),
    telegramMsg("Ack Categorizar", "🔎 Procurando lançamentos sem categoria…", [600, 650]),
    {
      name: "Rodar Categorização",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [800, 650],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinCategoriza001", cachedResultName: "categorizacao-hibrida" },
        workflowInputs: { mappingMode: "defineBelow", value: {}, matchingColumns: [], schema: [] },
        mode: "once",
        options: { waitForSubWorkflow: false },
      },
    },

    // Item 8: /relatorio → sub-workflow relatorio-sob-demanda (modo comando, read-only)
    ifString("É Relatório?", "={{ $json.rota }}", "relatorio", [400, 750]),
    telegramMsg("Ack Relatório", "📊 Gerando o relatório…", [600, 850]),
    {
      name: "Rodar Relatório",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [800, 850],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinRelatSobDem01", cachedResultName: "relatorio-sob-demanda" },
        workflowInputs: { mappingMode: "defineBelow", value: {}, matchingColumns: [], schema: [] },
        mode: "once",
        options: { waitForSubWorkflow: false },
      },
    },

    // /dashboard command
    ifString("É Dashboard?", "={{ $json.rota }}", "dashboard", [400, 955]),
    telegramMsg("Responder Dashboard", "📊 Acesse o Dashboard Web aqui: {{ $env.WEBHOOK_URL.replace('/webhook-test/', '/webhook/') }}dashboard", [600, 955]),

    codeNode("Detectar Tipo", roteadorSrc + glueDetectar, [1600, -200]),
    ifString("Cartão?", "={{ $json.tipo }}", "cartao", [1800, -200]),
    ifString("Conta?", "={{ $json.tipo }}", "conta", [2000, -100]),
    executarIngestao("Ingestão Cartão", "FinIngestCartao1", "ingestao-csv-cartao", [2000, -300]),
    executarIngestao("Ingestão Conta", "FinIngestConta01", "ingestao-csv-conta", [2200, -150]),
    telegramMsg("Não Reconhecido", "🤔 CSV não reconhecido — não parece fatura nem extrato do C6.", [2200, 0]),
  ],
  connections: {
    "Webhook Telegram": { main: [[{ node: "Classificar", type: "main", index: 0 }]] },
    "Classificar": { main: [[{ node: "É Documento?", type: "main", index: 0 }]] },
    "É Documento?": {
      main: [
        [{ node: "É ZIP?", type: "main", index: 0 }],
        [{ node: "Deve Responder?", type: "main", index: 0 }],
      ],
    },
    "Deve Responder?": {
      main: [
        [{ node: "Responder", type: "main", index: 0 }],
        [{ node: "É Callback?", type: "main", index: 0 }],
      ],
    },
    "É Callback?": {
      main: [
        [{ node: "Lembrete?", type: "main", index: 0 }],
        [{ node: "É Categorizar?", type: "main", index: 0 }],
      ],
    },
    "Lembrete?": {
      main: [
        [{ node: "Responder Lembrete", type: "main", index: 0 }],
        [{ node: "Aplicar Categoria", type: "main", index: 0 }],
      ],
    },
    "É Categorizar?": {
      main: [
        [{ node: "Ack Categorizar", type: "main", index: 0 }],
        [{ node: "É Relatório?", type: "main", index: 0 }],
      ],
    },
    "Ack Categorizar": { main: [[{ node: "Rodar Categorização", type: "main", index: 0 }]] },
    "É Relatório?": {
      main: [
        [{ node: "Ack Relatório", type: "main", index: 0 }],
        [{ node: "É Dashboard?", type: "main", index: 0 }],
      ],
    },
    "Ack Relatório": { main: [[{ node: "Rodar Relatório", type: "main", index: 0 }]] },
    "É Dashboard?": {
      main: [
        [{ node: "Responder Dashboard", type: "main", index: 0 }],
        [{ node: "Ignorar", type: "main", index: 0 }],
      ],
    },
    "É ZIP?": {
      main: [
        [{ node: "Baixar ZIP", type: "main", index: 0 }],
        [{ node: "Baixar CSV", type: "main", index: 0 }],
      ],
    },
    "Baixar ZIP": { main: [[{ node: "Extrair ZIP", type: "main", index: 0 }]] },
    "Extrair ZIP": { main: [[{ node: "ZIP OK?", type: "main", index: 0 }]] },
    "ZIP OK?": {
      main: [
        [{ node: "Detectar Tipo", type: "main", index: 0 }],
        [{ node: "Avisar Erro ZIP", type: "main", index: 0 }],
      ],
    },
    "Baixar CSV": { main: [[{ node: "Texto CSV", type: "main", index: 0 }]] },
    "Texto CSV": { main: [[{ node: "Detectar Tipo", type: "main", index: 0 }]] },
    "Detectar Tipo": { main: [[{ node: "Cartão?", type: "main", index: 0 }]] },
    "Cartão?": {
      main: [
        [{ node: "Ingestão Cartão", type: "main", index: 0 }],
        [{ node: "Conta?", type: "main", index: 0 }],
      ],
    },
    "Conta?": {
      main: [
        [{ node: "Ingestão Conta", type: "main", index: 0 }],
        [{ node: "Não Reconhecido", type: "main", index: 0 }],
      ],
    },
  },
};

workflow.nodes.forEach((n, i) => { n.id = `fin-rot-${String(i + 1).padStart(2, "0")}`; });

const destino = path.join(RAIZ, "workflows", "roteador-central.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
