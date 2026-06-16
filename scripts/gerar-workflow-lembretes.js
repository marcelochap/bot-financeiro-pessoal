// Gera workflows/lembretes-agendados.json, workflows/responder-lembrete.json e
// workflows/teste-lembretes.json a partir da lógica testada (workflows/src/lembretes.js).
// Rodar: node scripts/gerar-workflow-lembretes.js
// Plano: gstack/plans/lembretes-agendados.md
//
// lembretes-agendados tem DOIS gatilhos: o cron diário (09:00) e um Execute
// Workflow Trigger usado pelo harness teste-lembretes para simular qualquer
// data via {"hoje": "YYYY-MM-DD"} (datas de teste sempre em 2024 — o Log é
// estado vivo e referências futuras suprimiriam lembretes reais).
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const lembretesSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "lembretes.js"), "utf-8")
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
  parameters: { chatId: "={{ $env.TELEGRAM_CHAT_ID }}", text: texto, additionalFields: {} },
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

// ════════════════════════════════════════════════════════════════════
// Workflow 1: lembretes-agendados (cron + gatilho do harness)
// valueRanges: 0=Contas Fixas 1=Log
// ════════════════════════════════════════════════════════════════════
const codigoDecidir = lembretesSrc + [
  "",
  "// ── Glue: decide os lembretes de hoje e prepara mensagens/logs ──",
  SRC_PARA_OBJETOS,
  "// 'hoje' vem do harness (Início Teste) ou do relógio em America/Sao_Paulo (cron).",
  "// Harness SÓ aceita datas de 2024 (plano: o Log é estado vivo — uma data futura",
  "// gravaria lembrete_enviado real e suprimiria o cron daquele dia). Data fora do",
  "// padrão vinda do teste → no-op, NUNCA fallback para a data real.",
  "let hoje = '';",
  "let veioDoTeste = false;",
  "try { hoje = String($('Início Teste').first().json.hoje || ''); veioDoTeste = true; } catch (e) {}",
  "if (veioDoTeste) {",
  "  if (!/^2024-\\d{2}-\\d{2}$/.test(hoje)) return [];",
  "} else {",
  "  hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  "}",
  "const r = decidirLembretes(paraObjetos(0), paraObjetos(1), hoje);",
  "const agora = new Date().toISOString();",
  "const saida = [];",
  "for (const l of r.lembretes) {",
  "  saida.push({ json: { fase: 'lembrar',",
  "    texto: montarMensagemLembrete(l),",
  "    teclado: montarTecladoLembrete(l),",
  "    log: { timestamp: agora, acao: 'lembrete_enviado', entidade: 'Contas Fixas',",
  "      valor_anterior: l.conta + '|' + l.referencia, valor_novo: l.tipo + '|' + hoje,",
  "      origem: 'lembretes-agendados' } } });",
  "}",
  "for (const inv of r.invalidas) {",
  "  saida.push({ json: { fase: 'invalida',",
  "    texto: '⚠️ Conta fixa \"' + inv.conta + '\" sem lembrete: ' + inv.motivo +",
  "      '\\nCorrija na aba Contas Fixas.',",
  "    log: { timestamp: agora, acao: 'lembrete_erro', entidade: 'Contas Fixas',",
  "      valor_anterior: inv.conta + '|invalida', valor_novo: inv.motivo,",
  "      origem: 'lembretes-agendados' } } });",
  "}",
  "return saida; // vazio → nada a enviar hoje (silêncio é o comportamento certo)",
].join("\n");

const wfLembretes = {
  id: "FinLembretes0001",
  name: "lembretes-agendados",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Cron 09h",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, -100],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] } },
    },
    {
      name: "Início Teste",
      type: "n8n-nodes-base.executeWorkflowTrigger",
      typeVersion: 1.1,
      position: [0, 100],
      parameters: {
        inputSource: "workflowInputs",
        workflowInputs: { values: [{ name: "hoje", type: "string" }] },
      },
    },
    lerDados(["'Contas Fixas'!A:D", "'Log'!A:F"], [200, 0]),
    codeNode("Decidir", codigoDecidir, [400, 0]),
    ifString("Lembrar?", "={{ $json.fase }}", "lembrar", [600, 0]),
    {
      // Diferente do fluxo de clique (escrita ANTES do Telegram), aqui o envio
      // vem antes do Log: retry obrigatório — um sendMessage perdido com
      // lembrete_enviado gravado suprimiria o D0 do mês inteiro.
      ...httpTelegram(
        "Enviar Lembrete",
        "sendMessage",
        "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $json.texto, reply_markup: $json.teclado }) }}",
        [800, -100]
      ),
      ...RETRY,
    },
    {
      name: "Linhas Log",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1000, -100],
      parameters: {
        // Loga APENAS os itens cujo envio não retornou erro (onError continua
        // o fluxo com json.error no item correspondente, índices pareados)
        jsCode: [
          "const envios = $input.all();",
          "return $('Lembrar?').all()",
          "  .filter((i, idx) => !(envios[idx] && envios[idx].json && envios[idx].json.error))",
          "  .map((i) => ({ json: i.json.log }));",
        ].join("\n"),
      },
    },
    sheetsAppend("Gravar Log", "Log", [1200, -100]),
    ifString("Inválida?", "={{ $json.fase }}", "invalida", [800, 150]),
    { ...telegramMsg("Avisar Inválida", "={{ $json.texto }}", [1000, 150]), ...RETRY },
    {
      name: "Linhas Log Erro",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1200, 150],
      parameters: {
        jsCode: "return $('Inválida?').all().map((i) => ({ json: i.json.log }));",
      },
    },
    sheetsAppend("Gravar Log Erro", "Log", [1400, 150]),
  ],
  connections: {
    "Cron 09h": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Início Teste": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    "Decidir": { main: [[{ node: "Lembrar?", type: "main", index: 0 }]] },
    "Lembrar?": {
      main: [
        [{ node: "Enviar Lembrete", type: "main", index: 0 }],
        [{ node: "Inválida?", type: "main", index: 0 }],
      ],
    },
    "Enviar Lembrete": { main: [[{ node: "Linhas Log", type: "main", index: 0 }]] },
    "Linhas Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
    "Inválida?": { main: [[{ node: "Avisar Inválida", type: "main", index: 0 }]] },
    "Avisar Inválida": { main: [[{ node: "Linhas Log Erro", type: "main", index: 0 }]] },
    "Linhas Log Erro": { main: [[{ node: "Gravar Log Erro", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 2: responder-lembrete (clique ✅/⏰ — chamado pelo roteador)
// valueRanges: 0=Log
// ════════════════════════════════════════════════════════════════════
const codigoProcessar = lembretesSrc + [
  "",
  "// ── Glue: valida o callback e decide gravar/recusar ──",
  SRC_PARA_OBJETOS,
  "const entrada = $('Início').first().json;",
  "const cb = parsearCallbackLembrete(entrada.data);",
  "if (!cb) return [{ json: { acao: 'recusar', aviso: 'Botão inválido ou expirado.' } }];",
  "const logs = paraObjetos(0);",
  "const chave = cb.conta + '|' + cb.referencia;",
  "const tem = (acao) => logs.some((l) => l.acao === acao && String(l.valor_anterior) === chave);",
  "// pagamento_confirmado é terminal; ⏰ repetido também recusa. ✅ depois de ⏰ é",
  "// progressão legítima (adiou e pagou depois) e passa.",
  "if (tem('pagamento_confirmado')) return [{ json: { acao: 'recusar', aviso: 'Já registrado: pagamento confirmado.' } }];",
  "if (cb.acao === 'np' && tem('pagamento_adiado')) return [{ json: { acao: 'recusar', aviso: 'Já registrado: fica para depois.' } }];",
  "const pg = cb.acao === 'pg';",
  "return [{ json: { acao: 'gravar',",
  "  log: { timestamp: new Date().toISOString(),",
  "    acao: pg ? 'pagamento_confirmado' : 'pagamento_adiado', entidade: 'Contas Fixas',",
  "    valor_anterior: chave, valor_novo: '', origem: 'responder-lembrete' },",
  "  ack: pg ? '✅ Pagamento registrado' : '⏰ Anotado',",
  "  texto_edit: pg",
  "    ? '✅ ' + cb.conta + ' (' + cb.referencia + ') — pagamento confirmado. O CSV reconcilia o valor real depois.'",
  "    : '⏰ ' + cb.conta + ' (' + cb.referencia + ') — fica para depois. Lembro de novo no vencimento.' } }];",
].join("\n");

const wfResponder = {
  id: "FinRespLembre001",
  name: "responder-lembrete",
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
            { name: "callback_id", type: "string" },
            { name: "data", type: "string" },
            { name: "chat_id", type: "string" },
            { name: "message_id", type: "string" },
          ],
        },
      },
    },
    lerDados(["'Log'!A:F"], [200, 0]),
    codeNode("Processar", codigoProcessar, [400, 0]),
    ifString("Gravar?", "={{ $json.acao }}", "gravar", [600, 0]),
    {
      name: "Linha Log",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [800, -100],
      parameters: { jsCode: "return [{ json: $('Processar').first().json.log }];" },
    },
    sheetsAppend("Gravar Log", "Log", [1000, -100]),
    httpTelegram(
      "Confirmar Callback",
      "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: $('Processar').first().json.ack }) }}",
      [1200, -100]
    ),
    httpTelegram(
      "Editar Mensagem",
      "editMessageText",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Processar').first().json.texto_edit }) }}",
      [1400, -100]
    ),
    httpTelegram(
      "Recusar Callback",
      "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: $json.aviso, show_alert: true }) }}",
      [800, 150]
    ),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Processar", type: "main", index: 0 }]] },
    "Processar": { main: [[{ node: "Gravar?", type: "main", index: 0 }]] },
    "Gravar?": {
      main: [
        [{ node: "Linha Log", type: "main", index: 0 }],
        [{ node: "Recusar Callback", type: "main", index: 0 }],
      ],
    },
    "Linha Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
    "Gravar Log": { main: [[{ node: "Confirmar Callback", type: "main", index: 0 }]] },
    "Confirmar Callback": { main: [[{ node: "Editar Mensagem", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 3: teste-lembretes (harness — simula o cron em qualquer data)
// ════════════════════════════════════════════════════════════════════
const wfTeste = {
  id: "FinTesteLembre01",
  name: "teste-lembretes",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook Teste",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0005-4000-8000-financeiro05",
      parameters: { httpMethod: "POST", path: "teste-lembretes", options: {} },
    },
    {
      name: "Chamar Lembretes",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [200, 0],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinLembretes0001", cachedResultName: "lembretes-agendados" },
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
    "Webhook Teste": { main: [[{ node: "Chamar Lembretes", type: "main", index: 0 }]] },
  },
};

// ── grava os três ────────────────────────────────────────────────────
for (const wf of [wfLembretes, wfResponder, wfTeste]) {
  wf.nodes.forEach((n, i) => {
    n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`;
  });
  const destino = path.join(RAIZ, "workflows", `${wf.name}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
