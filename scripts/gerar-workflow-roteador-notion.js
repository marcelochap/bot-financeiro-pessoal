// Gera workflows-harumi/roteador-central.json — reaproveita workflows/src/roteador.js
// integralmente (é agnóstico de Sheets/Notion — classificação de update e detecção de
// tipo de CSV não tocam a base de dados; o prefixo do callback_data — "cat|"/"meta|" —
// é o suficiente pro roteamento, então o formato Notion do callback_data — ver
// categorizador-notion-extra.js — não exige nenhuma mudança aqui).
// Fase A: ingestão (ZIP/CSV → cartao/conta). Fases B/C/D: categorização, metas,
// lembretes, relatório e dashboard. Fase E (fatura-aberta/seedparcelas/texto-livre)
// ainda não tem conexão de saída — n8n encerra ali, sem erro, nada é enviado.
// Rodar: node scripts/gerar-workflow-roteador-notion.js
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const roteadorSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "roteador.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBotHarumi01", name: "Telegram Bot (Harumi)" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };
const NA_FALHA_AVISAR = { ...RETRY, onError: "continueErrorOutput" };

const glueClassificar = [
  "",
  "// ── Glue: classifica o update recebido pelo webhook ──",
  "const r = classificarUpdate($json.body || {}, {",
  "  chatId: $env.TELEGRAM_CHAT_ID_HARUMI || '',",
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
  "const dir = '/tmp/roteador-harumi/' + $execution.id;",
  "const out = path.join(dir, 'out');",
  "fs.mkdirSync(out, { recursive: true });",
  "const item = $input.first();",
  "if (!item.binary || !item.binary.data) {",
  "  return [{ json: { ok: false, erro: 'download sem conteúdo binário' } }];",
  "}",
  "const buf = await this.helpers.getBinaryDataBuffer(0, 'data');",
  "fs.writeFileSync(path.join(dir, 'input.zip'), buf);",
  "let resultado;",
  "try {",
  "  execFileSync('7z', ['x', '-y', '-p' + ($env.C6_ZIP_PASSWORD_HARUMI || ''), '-o' + out, path.join(dir, 'input.zip')], { stdio: 'pipe' });",
  "  const arquivos = fs.readdirSync(out).filter((f) => f.toLowerCase().endsWith('.csv'));",
  "  resultado = arquivos.map((f) => ({",
  "    json: { ok: true, csv: fs.readFileSync(path.join(out, f), 'utf-8'), nome_arquivo: f },",
  "  }));",
  "  if (resultado.length === 0) resultado = [{ json: { ok: false, erro: 'ZIP não contém arquivos CSV' } }];",
  "} catch (e) {",
  "  const detalhe = [String((e && e.message) || e).slice(0, 200),",
  "    e && e.stderr ? String(e.stderr).slice(0, 200) : ''].filter(Boolean).join(' | ');",
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
      conditions: [{ leftValue: esquerda, rightValue: valor, operator: { type: "string", operation: "equals" } }],
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
      conditions: [{ leftValue: expressao, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
    },
  },
});

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

const baixar = (nome, pos) => ({
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  ...NA_FALHA_AVISAR,
  parameters: { resource: "file", fileId: "={{ $('Classificar').first().json.file_id }}", download: true },
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

const CB_SCHEMA = ["callback_id", "data", "chat_id", "message_id"].map((id) => ({
  id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string",
}));

const executarComCallback = (nome, workflowId, nomeWorkflow, pos) => ({
  name: nome,
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: workflowId, cachedResultName: nomeWorkflow },
    workflowInputs: {
      mappingMode: "defineBelow",
      value: {
        callback_id: "={{ $json.callback_id }}", data: "={{ $json.data }}",
        chat_id: "={{ $json.chat_id }}", message_id: "={{ $json.message_id }}",
      },
      matchingColumns: [], schema: CB_SCHEMA,
    },
    mode: "each",
    options: { waitForSubWorkflow: false },
  },
});

const executarSemArgs = (nome, workflowId, nomeWorkflow, pos, mode = "once") => ({
  name: nome,
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: workflowId, cachedResultName: nomeWorkflow },
    workflowInputs: { mappingMode: "defineBelow", value: {}, matchingColumns: [], schema: [] },
    mode,
    options: { waitForSubWorkflow: false },
  },
});

const METAS_SCHEMA = ["acao", "texto", "data", "callback_id", "chat_id", "message_id"].map((id) => ({
  id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string",
}));

const executarMetas = (nome, valores, pos) => ({
  name: nome,
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: "FinMetasNotion1", cachedResultName: "gerenciar-metas (Notion)" },
    workflowInputs: { mappingMode: "defineBelow", value: valores, matchingColumns: [], schema: METAS_SCHEMA },
    mode: "once",
    options: { waitForSubWorkflow: false },
  },
});

const workflow = {
  id: "FinRoteadorHar01",
  name: "roteador-central (Notion — Harumi)",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook Telegram",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0003-4000-8000-harumi0000001",
      parameters: { httpMethod: "POST", path: "telegram-bot-harumi", options: {} },
    },
    codeNode("Classificar", roteadorSrc + glueClassificar, [200, 0]),
    ifString("É Documento?", "={{ $json.rota }}", "documento", [400, 0]),

    // ── Callback (clique em teclado inline): destino já vem decidido na lógica pura ──
    ifString("É Callback?", "={{ $json.rota }}", "callback", [400, 350]),
    ifString("Lembrete?", "={{ $json.destino }}", "responder-lembrete", [600, 450]),
    executarComCallback("Responder Lembrete", "FinRespLembNoti1", "responder-lembrete (Notion)", [800, 380]),
    executarComCallback("Aplicar Categoria", "FinAplicarNoti1", "aplicar-categoria (Notion)", [800, 520]),
    ifString("Gestão Metas?", "={{ $json.destino }}", "gerenciar-metas", [600, 350]),
    executarMetas("Executar Gestão Metas", {
      acao: "callback", data: "={{ $json.data }}", callback_id: "={{ $json.callback_id }}",
      chat_id: "={{ $json.chat_id }}", message_id: "={{ $json.message_id }}",
    }, [800, 300]),

    // ── Comandos ──
    ifString("É Categorizar?", "={{ $json.rota }}", "categorizar", [400, 550]),
    telegramMsg("Ack Categorizar", "🔎 Procurando lançamentos sem categoria…", [600, 650]),
    executarSemArgs("Rodar Categorização", "FinCategNotion1", "categorizacao-hibrida (Notion)", [800, 650]),

    ifString("É Relatório?", "={{ $json.rota }}", "relatorio", [400, 750]),
    telegramMsg("Ack Relatório", "📊 Gerando o relatório…", [600, 850]),
    executarSemArgs("Rodar Relatório", "FinRelatSobNoti1", "relatorio-sob-demanda (Notion)", [800, 850]),

    ifString("É Dashboard?", "={{ $json.rota }}", "dashboard", [400, 955]),
    executarSemArgs("Rodar Dashboard", "FinDashNotion01", "dashboard (Notion)", [600, 955]),

    ifString("É Metas?", "={{ $json.rota }}", "metas", [400, 1060]),
    executarMetas("Executar Metas", { acao: "metas" }, [600, 1060]),
    ifString("É Nova Meta?", "={{ $json.rota }}", "nova-meta", [400, 1160]),
    executarMetas("Executar Nova Meta", { acao: "nova-meta", texto: "={{ $json.texto }}" }, [600, 1160]),

    ifString("Deve Responder?", "={{ $json.rota }}", "responder", [400, 200]),
    telegramMsg("Responder", "={{ $json.resposta }}", [600, 200]),
    { name: "Ignorar", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [600, 320], parameters: {} },

    ifString("É ZIP?", "={{ $json.tipo_arquivo }}", "zip", [600, -100]),
    baixar("Baixar ZIP", [800, -200]),
    codeNode("Extrair ZIP", codigoExtrairZip, [1000, -200]),
    ifBool("ZIP OK?", "={{ $json.ok }}", [1200, -200]),
    telegramMsg("Avisar Erro ZIP", "=❌ Não consegui processar o ZIP: {{ $json.erro }}", [1400, -100]),
    telegramMsg("Avisar Erro Download", "❌ Não consegui baixar o arquivo. Tente reenviar.", [1200, -380]),

    baixar("Baixar CSV", [800, 0]),
    codeNode("Texto CSV", codigoTextoCsv, [1000, 0], { onError: "continueErrorOutput" }),

    codeNode("Detectar Tipo", roteadorSrc + glueDetectar, [1600, -200]),
    ifString("Cartão?", "={{ $json.tipo }}", "cartao", [1800, -200]),
    ifString("Conta?", "={{ $json.tipo }}", "conta", [2000, -100]),
    executarIngestao("Ingestão Cartão", "FinIngestCartNo1", "ingestao-csv-cartao (Notion)", [2000, -300]),
    executarIngestao("Ingestão Conta", "FinIngestContNo1", "ingestao-csv-conta (Notion)", [2200, -150]),
    telegramMsg("Não Reconhecido", "🤔 CSV não reconhecido — não parece fatura nem extrato do C6.", [2200, 0]),
  ],
  connections: {
    "Webhook Telegram": { main: [[{ node: "Classificar", type: "main", index: 0 }]] },
    "Classificar": { main: [[{ node: "É Documento?", type: "main", index: 0 }]] },
    "É Documento?": {
      main: [
        [{ node: "É ZIP?", type: "main", index: 0 }],
        [{ node: "É Callback?", type: "main", index: 0 }],
      ],
    },
    "É Callback?": {
      main: [
        [{ node: "Gestão Metas?", type: "main", index: 0 }],
        [{ node: "É Categorizar?", type: "main", index: 0 }],
      ],
    },
    "Gestão Metas?": {
      main: [
        [{ node: "Executar Gestão Metas", type: "main", index: 0 }],
        [{ node: "Lembrete?", type: "main", index: 0 }],
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
        [{ node: "Rodar Dashboard", type: "main", index: 0 }],
        [{ node: "É Metas?", type: "main", index: 0 }],
      ],
    },
    "É Metas?": {
      main: [
        [{ node: "Executar Metas", type: "main", index: 0 }],
        [{ node: "É Nova Meta?", type: "main", index: 0 }],
      ],
    },
    "É Nova Meta?": {
      main: [
        [{ node: "Executar Nova Meta", type: "main", index: 0 }],
        [{ node: "Deve Responder?", type: "main", index: 0 }],
      ],
    },
    "Deve Responder?": {
      main: [
        [{ node: "Responder", type: "main", index: 0 }],
        [{ node: "Ignorar", type: "main", index: 0 }],
      ],
    },
    "É ZIP?": {
      main: [
        [{ node: "Baixar ZIP", type: "main", index: 0 }],
        [{ node: "Baixar CSV", type: "main", index: 0 }],
      ],
    },
    "Baixar ZIP": {
      main: [
        [{ node: "Extrair ZIP", type: "main", index: 0 }],
        [{ node: "Avisar Erro Download", type: "main", index: 0 }],
      ],
    },
    "Extrair ZIP": { main: [[{ node: "ZIP OK?", type: "main", index: 0 }]] },
    "ZIP OK?": {
      main: [
        [{ node: "Detectar Tipo", type: "main", index: 0 }],
        [{ node: "Avisar Erro ZIP", type: "main", index: 0 }],
      ],
    },
    "Baixar CSV": {
      main: [
        [{ node: "Texto CSV", type: "main", index: 0 }],
        [{ node: "Avisar Erro Download", type: "main", index: 0 }],
      ],
    },
    "Texto CSV": {
      main: [
        [{ node: "Detectar Tipo", type: "main", index: 0 }],
        [{ node: "Avisar Erro Download", type: "main", index: 0 }],
      ],
    },
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

workflow.nodes.forEach((n, i) => { n.id = `fin-rot-harumi-${String(i + 1).padStart(2, "0")}`; });

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
const destino = path.join(destinoDir, "roteador-central.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
