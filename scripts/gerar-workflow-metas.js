// Gera workflows/gerenciar-metas.json e workflows/teste-metas.json a partir da
// lógica testada (workflows/src/metas.js). Rodar: node scripts/gerar-workflow-metas.js
// Plano: gstack/plans/gerenciar-metas.md
//
// gerenciar-metas trata /metas, /novameta e os callbacks gmnova|/gmenc|/gmok|,
// chamado pelo roteador-central via Execute Workflow. O progresso é SEMPRE
// derivado dos Lançamentos; a coluna C (valor_acumulado) é só cache reescrito
// no /metas (values:batchUpdate). O harness teste-metas roda em DRY-RUN: injeta
// metas/lancamentos via `estado` e devolve a DECISÃO no corpo HTTP, sem tocar no
// Sheets nem no Telegram — seguro para exercitar criação/encerramento.
//
// LIMITAÇÃO CONHECIDA (aceita — bot de usuário único): a proteção contra duplo
// clique em gmok|/novameta homônimo é por leitura-antes-de-escrita do snapshot do
// Ler Dados. O roteador chama com waitForSubWorkflow:false, então dois cliques na
// janela de ~1–2 s (antes da 1ª escrita persistir no Sheets) podem gravar 2 linhas
// de Log / criar 2 metas homônimas. Não serializado no n8n; risco prático mínimo
// com um só usuário. Endurecer (lock via answerCallbackQuery ou releitura) só se
// virar multi-usuário (fase 3+).
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const metasSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "metas.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_SHEETS = { googleApi: { id: "FinSheetsSA00001", name: "Google Sheets SA" } };
const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// ── helpers de nós (mesmo padrão dos demais geradores) ───────────────
const lerDados = (abas, pos) => {
  const ranges = abas.map((a) => `ranges=${encodeURIComponent(a)}`).join("&");
  return {
    name: "Ler Dados",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: pos,
    ...RETRY,
    parameters: {
      method: "GET",
      url:
        "=https://sheets.googleapis.com/v4/spreadsheets/{{ $env.GOOGLE_SHEETS_ID }}/values:batchGet?" +
        ranges +
        "&valueRenderOption=UNFORMATTED_VALUE",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleApi",
      options: {},
    },
    credentials: CRED_SHEETS,
  };
};

const SRC_PARA_OBJETOS = [
  "const vr = ($json.valueRanges || []);",
  "const paraObjetos = (idx) => {",
  "  const v = (vr[idx] && vr[idx].values) || [];",
  "  if (v.length < 2) return [];",
  "  const h = v[0].map(String);",
  "  return v.slice(1).map((linha, i) => {",
  "    const o = {};",
  "    h.forEach((c, j) => { o[c] = linha[j] !== undefined ? linha[j] : ''; });",
  "    o._row = i + 2;",
  "    return o;",
  "  });",
  "};",
].join("\n");

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

// Encerrar meta: update por número de linha (status → encerrada). Devolve só a linha.
const sheetsUpdateMeta = (nome, pos) => ({
  name: nome,
  type: "n8n-nodes-base.googleSheets",
  typeVersion: 4.5,
  position: pos,
  ...RETRY,
  parameters: {
    authentication: "serviceAccount",
    operation: "update",
    documentId: { __rl: true, mode: "id", value: "={{ $env.GOOGLE_SHEETS_ID }}" },
    sheetName: { __rl: true, mode: "name", value: "Metas" },
    columns: {
      mappingMode: "defineBelow",
      value: { row_number: "={{ $json.row }}", status: "encerrada" },
      matchingColumns: ["row_number"],
      schema: [
        { id: "row_number", displayName: "row_number", required: false, defaultMatch: true, display: true, type: "number", canBeUsedToMatch: true, removed: false, readOnly: true },
        { id: "status", displayName: "status", required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true, removed: false },
      ],
    },
    options: {},
  },
  credentials: CRED_SHEETS,
});

// Reescreve a coluna C (cache valor_acumulado) de todas as metas ativas de uma vez.
// onError continua: o cache é cosmético (coluna C nunca é fonte) — uma falha aqui
// não pode marcar como falha um /metas cuja lista já foi enviada ao usuário.
const httpSheetsBatchUpdate = (nome, pos) => ({
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  ...RETRY,
  onError: "continueRegularOutput",
  parameters: {
    method: "POST",
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $env.GOOGLE_SHEETS_ID }}/values:batchUpdate",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleApi",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json.body) }}",
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

const httpTelegram = (nome, metodo, jsonBody, pos) => ({
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  // Falha do Telegram (callback expirado etc.) não pode desfazer o que já foi gravado
  onError: "continueRegularOutput",
  parameters: {
    method: "POST",
    url: `=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/${metodo}`,
    sendBody: true,
    specifyBody: "json",
    jsonBody,
    options: {},
  },
});

const noOp = (nome, pos) => ({ name: nome, type: "n8n-nodes-base.noOp", typeVersion: 1, position: pos, parameters: {} });

// ════════════════════════════════════════════════════════════════════
// Decidir: roteia acao e emite itens marcados por `fase` (+ `modo`).
// valueRanges: 0=Metas 1=Lançamentos
// ════════════════════════════════════════════════════════════════════
const codigoDecidir = metasSrc + [
  "",
  "// ── Glue: roteia acao (metas | nova-meta | callback) ──",
  SRC_PARA_OBJETOS,
  "const e = $('Início').first().json;",
  "const acao = String(e.acao || '');",
  "let inj = null;",
  "try { if (e.estado) inj = JSON.parse(e.estado); } catch (x) {}",
  "const dry = !!inj; // harness: estado injetado → dry-run (retorna decisão, não escreve)",
  "const metas = (dry ? (inj.metas || []) : paraObjetos(0))",
  "  .map((m, i) => (m._row ? m : { ...m, _row: i + 2 }));",
  "const lancs = dry ? (inj.lancamentos || []) : paraObjetos(1);",
  "const agora = new Date().toISOString();",
  "const hoje = agora.slice(0, 10);",
  "let saida = [];",
  "",
  "if (acao === 'metas') {",
  "  const prog = calcularProgresso(metas, lancs);",
  "  saida.push({ json: { fase: 'listar', texto: montarMensagemMetas(prog), teclado: montarTecladoMetas(prog) } });",
  "  // Cache: reescreve a coluna C (valor_acumulado) de cada meta ativa pelo derivado.",
  "  const ativas = metas.filter((m) => String(m.status || '').trim().toLowerCase() === 'ativa');",
  "  const data = ativas.map((m) => {",
  "    const p = prog.find((x) => x.nome === String(m.nome || '').trim());",
  "    return { range: 'Metas!C' + m._row, values: [[p ? p.acumulado : 0]] };",
  "  });",
  "  if (data.length) saida.push({ json: { fase: 'cache', body: { valueInputOption: 'RAW', data } } });",
  "} else if (acao === 'nova-meta') {",
  "  const r = parsearNovaMeta(e.texto || '');",
  "  if (!r.ok) {",
  "    saida.push({ json: { fase: 'avisar', texto: r.erro } });",
  "  } else if (nomeJaExisteAtiva(r.meta.nome, metas)) {",
  "    saida.push({ json: { fase: 'avisar', texto: '⚠️ Já existe uma meta ativa \"' + r.meta.nome + '\". Encerre a atual ou escolha outro nome.' } });",
  "  } else {",
  "    const m = r.meta;",
  "    saida.push({ json: { fase: 'criar',",
  "      meta: { nome: m.nome, orcamento_total: m.orcamento, valor_acumulado: 0, prazo: m.prazo, status: 'ativa', criado_em: hoje },",
  "      log: { timestamp: agora, acao: 'meta_criada', entidade: m.nome, valor_anterior: '', valor_novo: 'orçamento ' + m.orcamento + ' · prazo ' + m.prazo, origem: 'telegram' },",
  "      texto: '🎯 Meta criada: ' + m.nome + '\\n📊 Orçamento ' + formatarReal(m.orcamento) + ' · prazo ' + m.prazo } });",
  "  }",
  "} else if (acao === 'callback') {",
  "  const cb = parsearCallbackMetaGestao(e.data || '');",
  "  if (!cb) {",
  "    saida.push({ json: { fase: 'recusar', aviso: 'Botão inválido ou expirado.' } });",
  "  } else if (cb.acao === 'nova') {",
  "    saida.push({ json: { fase: 'template', texto: TEMPLATE_NOVAMETA } });",
  "  } else {",
  "    const alvo = String(cb.nome || '').trim();",
  "    const metaRow = metas.find((m) => String(m.nome || '').trim() === alvo && String(m.status || '').trim().toLowerCase() === 'ativa');",
  "    if (!metaRow) {",
  "      saida.push({ json: { fase: 'recusar', aviso: 'Meta não está mais ativa.' } });",
  "    } else if (cb.acao === 'encerrar-confirmar') {",
  "      saida.push({ json: { fase: 'confirmar', nome: alvo, teclado: montarTecladoConfirmarEncerrar(alvo),",
  "        texto_edit: '🏁 Encerrar a meta \"' + alvo + '\"?\\nOs lançamentos já associados continuam registrados.' } });",
  "    } else {",
  "      saida.push({ json: { fase: 'encerrar', row: metaRow._row, nome: alvo,",
  "        log: { timestamp: agora, acao: 'meta_encerrada', entidade: alvo, valor_anterior: 'ativa', valor_novo: 'encerrada', origem: 'telegram' },",
  "        texto_edit: '🏁 Meta \"' + alvo + '\" encerrada. Sai da lista; o histórico permanece.' } });",
  "    }",
  "  }",
  "}",
  "",
  "const modo = dry ? 'teste' : 'real';",
  "return saida.map((s) => ({ json: { ...s.json, modo } }));",
].join("\n");

// ════════════════════════════════════════════════════════════════════
// Workflow 1: gerenciar-metas
// ════════════════════════════════════════════════════════════════════
const wfMetas = {
  id: "FinGerirMetas001",
  name: "gerenciar-metas",
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
        workflowInputs: {
          values: [
            { name: "acao", type: "string" },
            { name: "texto", type: "string" },
            { name: "data", type: "string" },
            { name: "callback_id", type: "string" },
            { name: "chat_id", type: "string" },
            { name: "message_id", type: "string" },
            { name: "estado", type: "string" },
          ],
        },
      },
    },
    lerDados(["'Metas'!A:F", "'Lançamentos'!A:J"], [200, 0]),
    codeNode("Decidir", codigoDecidir, [400, 0]),
    ifString("Teste?", "={{ $json.modo }}", "teste", [600, 0]),
    noOp("Saída Teste", [800, -160]),

    // ── Produção: cadeia de fases ──
    ifString("Listar?", "={{ $json.fase }}", "listar", [800, 120]),
    httpTelegram(
      "Enviar Lista",
      "sendMessage",
      "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $json.texto, reply_markup: $json.teclado }) }}",
      [1000, 40]
    ),
    ifString("Cache?", "={{ $json.fase }}", "cache", [1000, 200]),
    httpSheetsBatchUpdate("Atualizar Cache", [1200, 120]),

    ifString("Criar?", "={{ $json.fase }}", "criar", [1200, 300]),
    codeNode("Linha Meta", "return $input.all().map((i) => ({ json: i.json.meta }));", [1400, 220]),
    sheetsAppend("Inserir Meta", "Metas", [1600, 220]),
    codeNode("Linha Log Criar", "return $('Criar?').all().map((i) => ({ json: i.json.log }));", [1800, 160]),
    sheetsAppend("Gravar Log Criar", "Log", [2000, 160]),
    httpTelegram(
      "Confirmar Criação",
      "sendMessage",
      "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $('Criar?').first().json.texto }) }}",
      [1800, 300]
    ),

    ifString("Avisar?", "={{ $json.fase }}", "avisar", [1400, 400]),
    telegramMsg("Enviar Aviso", "={{ $json.texto }}", [1600, 400]),

    ifString("Template?", "={{ $json.fase }}", "template", [1600, 500]),
    httpTelegram(
      "Ack Template",
      "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id }) }}",
      [1800, 460]
    ),
    httpTelegram(
      "Enviar Template",
      "sendMessage",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, text: $('Template?').first().json.texto }) }}",
      [2000, 460]
    ),

    ifString("Confirmar?", "={{ $json.fase }}", "confirmar", [1800, 600]),
    httpTelegram(
      "Ack Confirmar",
      "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id }) }}",
      [2000, 560]
    ),
    httpTelegram(
      "Pedir Confirmação",
      "editMessageText",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Confirmar?').first().json.texto_edit, reply_markup: $('Confirmar?').first().json.teclado }) }}",
      [2200, 560]
    ),

    ifString("Encerrar?", "={{ $json.fase }}", "encerrar", [2000, 700]),
    sheetsUpdateMeta("Encerrar Meta", [2200, 660]),
    codeNode("Linha Log Encerrar", "return $('Encerrar?').all().map((i) => ({ json: i.json.log }));", [2400, 600]),
    sheetsAppend("Gravar Log Encerrar", "Log", [2600, 600]),
    httpTelegram(
      "Ack Encerrar",
      "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: '🏁 Encerrada' }) }}",
      [2400, 740]
    ),
    httpTelegram(
      "Editar Encerrada",
      "editMessageText",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Encerrar?').first().json.texto_edit }) }}",
      [2600, 740]
    ),

    ifString("Recusar?", "={{ $json.fase }}", "recusar", [2200, 820]),
    httpTelegram(
      "Recusar Callback",
      "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: $json.aviso, show_alert: true }) }}",
      [2400, 820]
    ),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    "Decidir": { main: [[{ node: "Teste?", type: "main", index: 0 }]] },
    "Teste?": {
      main: [
        [{ node: "Saída Teste", type: "main", index: 0 }],
        [{ node: "Listar?", type: "main", index: 0 }],
      ],
    },
    "Listar?": {
      main: [
        [{ node: "Enviar Lista", type: "main", index: 0 }],
        [{ node: "Cache?", type: "main", index: 0 }],
      ],
    },
    "Cache?": {
      main: [
        [{ node: "Atualizar Cache", type: "main", index: 0 }],
        [{ node: "Criar?", type: "main", index: 0 }],
      ],
    },
    "Criar?": {
      main: [
        [{ node: "Linha Meta", type: "main", index: 0 }],
        [{ node: "Avisar?", type: "main", index: 0 }],
      ],
    },
    "Linha Meta": { main: [[{ node: "Inserir Meta", type: "main", index: 0 }]] },
    "Inserir Meta": {
      main: [[
        { node: "Linha Log Criar", type: "main", index: 0 },
        { node: "Confirmar Criação", type: "main", index: 0 },
      ]],
    },
    "Linha Log Criar": { main: [[{ node: "Gravar Log Criar", type: "main", index: 0 }]] },
    "Avisar?": {
      main: [
        [{ node: "Enviar Aviso", type: "main", index: 0 }],
        [{ node: "Template?", type: "main", index: 0 }],
      ],
    },
    "Template?": {
      main: [
        [{ node: "Ack Template", type: "main", index: 0 }],
        [{ node: "Confirmar?", type: "main", index: 0 }],
      ],
    },
    "Ack Template": { main: [[{ node: "Enviar Template", type: "main", index: 0 }]] },
    "Confirmar?": {
      main: [
        [{ node: "Ack Confirmar", type: "main", index: 0 }],
        [{ node: "Encerrar?", type: "main", index: 0 }],
      ],
    },
    "Ack Confirmar": { main: [[{ node: "Pedir Confirmação", type: "main", index: 0 }]] },
    "Encerrar?": {
      main: [
        [{ node: "Encerrar Meta", type: "main", index: 0 }],
        [{ node: "Recusar?", type: "main", index: 0 }],
      ],
    },
    "Encerrar Meta": {
      main: [[
        { node: "Linha Log Encerrar", type: "main", index: 0 },
        { node: "Ack Encerrar", type: "main", index: 0 },
      ]],
    },
    "Linha Log Encerrar": { main: [[{ node: "Gravar Log Encerrar", type: "main", index: 0 }]] },
    "Ack Encerrar": { main: [[{ node: "Editar Encerrada", type: "main", index: 0 }]] },
    "Recusar?": { main: [[{ node: "Recusar Callback", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 2: teste-metas (harness dry-run — devolve a decisão no corpo HTTP)
// ════════════════════════════════════════════════════════════════════
const wfTeste = {
  id: "FinTesteMetas001",
  name: "teste-metas",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook Teste",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0006-4000-8000-financeiro06",
      parameters: { httpMethod: "POST", path: "teste-metas", responseMode: "lastNode", options: {} },
    },
    {
      name: "Chamar Metas",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [200, 0],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinGerirMetas001", cachedResultName: "gerenciar-metas" },
        workflowInputs: {
          mappingMode: "defineBelow",
          value: {
            acao: "={{ $json.body.acao }}",
            texto: "={{ $json.body.texto || '' }}",
            data: "={{ $json.body.data || '' }}",
            callback_id: "={{ $json.body.callback_id || '' }}",
            chat_id: "={{ $json.body.chat_id || '' }}",
            message_id: "={{ $json.body.message_id || '' }}",
            estado: "={{ $json.body.estado ? JSON.stringify($json.body.estado) : '' }}",
          },
          matchingColumns: [],
          schema: [
            { id: "acao", displayName: "acao", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "texto", displayName: "texto", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "data", displayName: "data", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "callback_id", displayName: "callback_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "chat_id", displayName: "chat_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "message_id", displayName: "message_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "estado", displayName: "estado", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
          ],
        },
        mode: "once",
        options: { waitForSubWorkflow: true },
      },
    },
  ],
  connections: {
    "Webhook Teste": { main: [[{ node: "Chamar Metas", type: "main", index: 0 }]] },
  },
};

// ── grava os dois ────────────────────────────────────────────────────
for (const wf of [wfMetas, wfTeste]) {
  wf.nodes.forEach((n, i) => {
    n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`;
  });
  const destino = path.join(RAIZ, "workflows", `${wf.name}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
