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

// Fatura aberta enviada como .txt: decodifica binário→texto (UTF-8). O Bloco de Notas do
// Windows salva com BOM; o parseFaturaAberta (no fatura-aberta) já o remove. Saída { texto }
// para casar com o schema do executarFatura (texto: $json.texto).
const codigoTextoFatura = [
  "// Decodifica o .txt da fatura aberta baixado do Telegram (binário → texto UTF-8).",
  "const item = $input.first();",
  "if (!item.binary || !item.binary.data) {",
  "  return [{ json: { texto: '' } }];",
  "}",
  "const buf = await this.helpers.getBinaryDataBuffer(0, 'data');",
  "return [{ json: { texto: buf.toString('utf-8') } }];",
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
    // Remove o rodapé "sent automatically with n8n" de toda mensagem do bot.
    additionalFields: { appendAttribution: false },
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

// Item 10: despacho para gerenciar-metas (comandos /metas, /novameta e callbacks gm*)
const METAS_SCHEMA = ["acao", "texto", "data", "callback_id", "chat_id", "message_id", "estado"].map((id) => ({
  id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string",
}));

const executarMetas = (nome, valores, pos) => ({
  name: nome,
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: "FinGerirMetas001", cachedResultName: "gerenciar-metas" },
    workflowInputs: { mappingMode: "defineBelow", value: valores, matchingColumns: [], schema: METAS_SCHEMA },
    mode: "once",
    options: { waitForSubWorkflow: false },
  },
});

// Feature fatura-aberta: /faturaaberta e /seedparcelas → fatura-aberta (texto = bloco colado)
const FATURA_SCHEMA = ["acao", "texto"].map((id) => ({
  id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string",
}));

const executarFatura = (nome, acao, pos) => ({
  name: nome,
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: "FinFaturaAbert01", cachedResultName: "fatura-aberta" },
    workflowInputs: { mappingMode: "defineBelow", value: { acao, texto: "={{ $json.texto }}" }, matchingColumns: [], schema: FATURA_SCHEMA },
    mode: "once",
    options: { waitForSubWorkflow: false },
  },
});

// Feature buffer-colagem: /faturaaberta (reset) e texto livre (anexa/stub) → fatura-buffer,
// que remonta a fatura dividida em N mensagens e só chama o fatura-aberta quando o checksum fecha.
const executarBuffer = (nome, acao, pos) => ({
  name: nome,
  type: "n8n-nodes-base.executeWorkflow",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    workflowId: { __rl: true, mode: "id", value: "FinFaturaBuf001", cachedResultName: "fatura-buffer" },
    workflowInputs: { mappingMode: "defineBelow", value: { acao, texto: "={{ $json.texto }}" }, matchingColumns: [], schema: FATURA_SCHEMA },
    mode: "once",
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

    // .txt = fatura aberta por arquivo → fatura-aberta direto (sempre grava: fechado/rascunho).
    ifString("É Fatura TXT?", "={{ $json.tipo_arquivo }}", "txt", [600, 60]),
    baixar("Baixar Fatura TXT", [800, 60]),
    codeNode("Texto Fatura", codigoTextoFatura, [1000, 60]),
    executarFatura("Executar Fatura Arquivo", "fatura-aberta", [1200, 60]),

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
    telegramMsg("Responder Dashboard", "=📊 Acesse o Dashboard Web aqui: {{ $env.DASHBOARD_URL || 'URL não configurada — defina DASHBOARD_URL no .env' }}", [600, 955]),

    // Item 10: /metas e /novameta → gerenciar-metas (callbacks gm* tratados no ramo de callback)
    ifString("É Metas?", "={{ $json.rota }}", "metas", [400, 1060]),
    executarMetas("Executar Metas", { acao: "metas" }, [600, 1060]),
    ifString("É Nova Meta?", "={{ $json.rota }}", "nova-meta", [400, 1160]),
    executarMetas("Executar Nova Meta", { acao: "nova-meta", texto: "={{ $json.texto }}" }, [600, 1160]),
    // /faturaaberta agora vai ao fatura-buffer (reseta a sessão) — não direto ao fatura-aberta.
    ifString("É Fatura Aberta?", "={{ $json.rota }}", "fatura-aberta", [400, 1260]),
    executarBuffer("Executar Fatura Aberta", "fatura-aberta-cmd", [600, 1260]),
    ifString("É Seed Parcelas?", "={{ $json.rota }}", "seed-parcelas", [400, 1360]),
    executarFatura("Executar Seed Parcelas", "seed-parcelas", [600, 1360]),
    // /fecharfatura: encerra a colagem em andamento → fatura-buffer força o flush (rascunho).
    ifString("É Fechar Fatura?", "={{ $json.rota }}", "fechar-fatura", [400, 1460]),
    executarBuffer("Executar Fechar Fatura", "fechar-fatura", [600, 1460]),
    // Texto livre: pode ser a continuação de uma colagem de fatura dividida → fatura-buffer decide.
    ifString("É Texto Livre?", "={{ $json.rota }}", "texto-livre", [400, 1560]),
    executarBuffer("Executar Texto Livre", "texto-livre", [600, 1560]),
    ifString("Gestão Metas?", "={{ $json.destino }}", "gerenciar-metas", [600, 350]),
    executarMetas(
      "Executar Gestão Metas",
      {
        acao: "callback",
        data: "={{ $json.data }}",
        callback_id: "={{ $json.callback_id }}",
        chat_id: "={{ $json.chat_id }}",
        message_id: "={{ $json.message_id }}",
      },
      [800, 300]
    ),

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
        [{ node: "Responder Dashboard", type: "main", index: 0 }],
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
        [{ node: "É Fatura Aberta?", type: "main", index: 0 }],
      ],
    },
    "É Fatura Aberta?": {
      main: [
        [{ node: "Executar Fatura Aberta", type: "main", index: 0 }],
        [{ node: "É Seed Parcelas?", type: "main", index: 0 }],
      ],
    },
    "É Seed Parcelas?": {
      main: [
        [{ node: "Executar Seed Parcelas", type: "main", index: 0 }],
        [{ node: "É Fechar Fatura?", type: "main", index: 0 }],
      ],
    },
    "É Fechar Fatura?": {
      main: [
        [{ node: "Executar Fechar Fatura", type: "main", index: 0 }],
        [{ node: "É Texto Livre?", type: "main", index: 0 }],
      ],
    },
    "É Texto Livre?": {
      main: [
        [{ node: "Executar Texto Livre", type: "main", index: 0 }],
        [{ node: "Ignorar", type: "main", index: 0 }],
      ],
    },
    "É ZIP?": {
      main: [
        [{ node: "Baixar ZIP", type: "main", index: 0 }],
        [{ node: "É Fatura TXT?", type: "main", index: 0 }],
      ],
    },
    "É Fatura TXT?": {
      main: [
        [{ node: "Baixar Fatura TXT", type: "main", index: 0 }],
        [{ node: "Baixar CSV", type: "main", index: 0 }],
      ],
    },
    "Baixar Fatura TXT": { main: [[{ node: "Texto Fatura", type: "main", index: 0 }]] },
    "Texto Fatura": { main: [[{ node: "Executar Fatura Arquivo", type: "main", index: 0 }]] },
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
