// Gera workflows-harumi/lembretes-agendados.json, responder-lembrete.json e
// teste-lembretes.json — variante Notion (Fase C) do gerador original
// (scripts/gerar-workflow-lembretes.js). Reaproveita workflows/src/lembretes.js
// integralmente — callback_data já usa NOME da conta (não row number).
// Rodar: node scripts/gerar-workflow-lembretes-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc, codigoGravarPages } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const lembretesSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "lembretes.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

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

const codeNode = (nome, jsCode, pos, extra = {}) => ({
  name: nome, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode }, ...extra,
});

const telegramMsg = (nome, texto, pos) => ({
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  parameters: { chatId: "={{ $env.TELEGRAM_CHAT_ID }}", text: texto, additionalFields: { appendAttribution: false } },
  credentials: CRED_TELEGRAM,
});

const httpTelegram = (nome, metodo, jsonBody, pos) => ({
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  onError: "continueRegularOutput",
  parameters: {
    method: "POST",
    url: `=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/${metodo}`,
    sendBody: true, specifyBody: "json", jsonBody, options: {},
  },
});

// Ações que decidirLembretes/responder-lembrete realmente consultam — filtra no
// servidor pra não puxar o Log inteiro (que cresce sem limite).
const FILTRO_LOG_LEMBRETES = [
  "{ or: [",
  "  { property: 'Ação', rich_text: { equals: 'lembrete_enviado' } },",
  "  { property: 'Ação', rich_text: { equals: 'pagamento_confirmado' } },",
  "  { property: 'Ação', rich_text: { equals: 'pagamento_adiado' } },",
  "  { property: 'Ação', rich_text: { equals: 'lembrete_erro' } },",
  "] }",
].join("\n");

// ════════════════════════════════════════════════════════════════════
// Workflow 1: lembretes-agendados (Notion)
// ════════════════════════════════════════════════════════════════════
const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: Contas Fixas + Log (só as ações que decidirLembretes consulta) ──",
  "const [contasFixas, logs] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_CONTAS_FIXAS),",
  `  notionQueryAll($env.NOTION_DB_LOG, ${FILTRO_LOG_LEMBRETES}),`,
  "]);",
  "return [{ json: { contasFixas, logs } }];",
].join("\n");

const codigoDecidir = lembretesSrc + notionMapSrc + [
  "",
  "// ── Glue: decide os lembretes de hoje e prepara mensagens/logs (Notion) ──",
  "// 'hoje' vem do harness (Início Teste) ou do relógio em America/Sao_Paulo (cron).",
  "// Harness SÓ aceita datas de 2024 (o Log é estado vivo — uma data futura gravaria",
  "// lembrete_enviado real e suprimiria o cron daquele dia).",
  "let hoje = '';",
  "let veioDoTeste = false;",
  "try { hoje = String($('Início Teste').first().json.hoje || ''); veioDoTeste = true; } catch (e) {}",
  "if (veioDoTeste) {",
  "  if (!/^2024-\\d{2}-\\d{2}$/.test(hoje)) return [];",
  "} else {",
  "  hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });",
  "}",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const contas = brutos.contasFixas.map(paraObjetoContaFixa);",
  "const logs = brutos.logs.map(paraObjetoLog);",
  "const r = decidirLembretes(contas, logs, hoje);",
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
  "      '\\nCorrija na database Contas Fixas.',",
  "    log: { timestamp: agora, acao: 'lembrete_erro', entidade: 'Contas Fixas',",
  "      valor_anterior: inv.conta + '|invalida', valor_novo: inv.motivo,",
  "      origem: 'lembretes-agendados' } } });",
  "}",
  "return saida; // vazio → nada a enviar hoje (silêncio é o comportamento certo)",
].join("\n");

const wfLembretes = {
  id: "FinLembreNotio1",
  name: "lembretes-agendados (Notion)",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    { name: "Cron 09h", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, -100], parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] } } },
    { name: "Início Teste", type: "n8n-nodes-base.executeWorkflowTrigger", typeVersion: 1.1, position: [0, 100], parameters: { inputSource: "workflowInputs", workflowInputs: { values: [{ name: "hoje", type: "string" }] } } },
    codeNode("Ler Dados (Notion)", codigoLerDados, [200, 0], RETRY),
    codeNode("Decidir", codigoDecidir, [400, 0]),
    ifString("Lembrar?", "={{ $json.fase }}", "lembrar", [600, 0]),
    {
      ...httpTelegram("Enviar Lembrete", "sendMessage", "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $json.texto, reply_markup: $json.teclado }) }}", [800, -100]),
      ...RETRY,
    },
    codeNode("Linhas Log", [
      "const envios = $input.all();",
      "return $('Lembrar?').all()",
      "  .filter((i, idx) => !(envios[idx] && envios[idx].json && envios[idx].json.error))",
      "  .map((i) => ({ json: i.json.log }));",
    ].join("\n"), [1000, -100]),
    codeNode("Gravar Log", codigoGravarPages("Linhas Log", "NOTION_DB_LOG", "propsDeLog"), [1200, -100]),
    ifString("Inválida?", "={{ $json.fase }}", "invalida", [800, 150]),
    { ...telegramMsg("Avisar Inválida", "={{ $json.texto }}", [1000, 150]), ...RETRY },
    codeNode("Linhas Log Erro", "return $('Inválida?').all().map((i) => ({ json: i.json.log }));", [1200, 150]),
    codeNode("Gravar Log Erro", codigoGravarPages("Linhas Log Erro", "NOTION_DB_LOG", "propsDeLog"), [1400, 150]),
  ],
  connections: {
    "Cron 09h": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Início Teste": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    "Decidir": { main: [[{ node: "Lembrar?", type: "main", index: 0 }]] },
    "Lembrar?": { main: [[{ node: "Enviar Lembrete", type: "main", index: 0 }], [{ node: "Inválida?", type: "main", index: 0 }]] },
    "Enviar Lembrete": { main: [[{ node: "Linhas Log", type: "main", index: 0 }]] },
    "Linhas Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
    "Inválida?": { main: [[{ node: "Avisar Inválida", type: "main", index: 0 }]] },
    "Avisar Inválida": { main: [[{ node: "Linhas Log Erro", type: "main", index: 0 }]] },
    "Linhas Log Erro": { main: [[{ node: "Gravar Log Erro", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 2: responder-lembrete (Notion) — clique ✅/⏰
// ════════════════════════════════════════════════════════════════════
const codigoLerLog = [
  notionHttpSrc,
  "",
  "// ── Glue: só as ações que responder-lembrete consulta (pagamento_confirmado/adiado) ──",
  "const logs = await notionQueryAll($env.NOTION_DB_LOG, { or: [",
  "  { property: 'Ação', rich_text: { equals: 'pagamento_confirmado' } },",
  "  { property: 'Ação', rich_text: { equals: 'pagamento_adiado' } },",
  "] });",
  "return [{ json: { logs } }];",
].join("\n");

const codigoProcessar = lembretesSrc + notionMapSrc + [
  "",
  "// ── Glue: valida o callback e decide gravar/recusar (Notion) ──",
  "const entrada = $('Início').first().json;",
  "const cb = parsearCallbackLembrete(entrada.data);",
  "if (!cb) return [{ json: { acao: 'recusar', aviso: 'Botão inválido ou expirado.' } }];",
  "const logs = $('Ler Dados (Notion)').first().json.logs.map(paraObjetoLog);",
  "const chave = cb.conta + '|' + cb.referencia;",
  "const tem = (acao) => logs.some((l) => l.acao === acao && String(l.valor_anterior) === chave);",
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
  id: "FinRespLembNoti1",
  name: "responder-lembrete (Notion)",
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
        workflowInputs: { values: [
          { name: "callback_id", type: "string" }, { name: "data", type: "string" },
          { name: "chat_id", type: "string" }, { name: "message_id", type: "string" },
        ] },
      },
    },
    codeNode("Ler Dados (Notion)", codigoLerLog, [200, 0], RETRY),
    codeNode("Processar", codigoProcessar, [400, 0]),
    ifString("Gravar?", "={{ $json.acao }}", "gravar", [600, 0]),
    codeNode("Linha Log", "return [{ json: $('Processar').first().json.log }];", [800, -100]),
    codeNode("Gravar Log", codigoGravarPages("Linha Log", "NOTION_DB_LOG", "propsDeLog"), [1000, -100]),
    httpTelegram("Confirmar Callback", "answerCallbackQuery", "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: $('Processar').first().json.ack }) }}", [1200, -100]),
    httpTelegram("Editar Mensagem", "editMessageText", "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Processar').first().json.texto_edit }) }}", [1400, -100]),
    httpTelegram("Recusar Callback", "answerCallbackQuery", "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: $json.aviso, show_alert: true }) }}", [800, 150]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Processar", type: "main", index: 0 }]] },
    "Processar": { main: [[{ node: "Gravar?", type: "main", index: 0 }]] },
    "Gravar?": { main: [[{ node: "Linha Log", type: "main", index: 0 }], [{ node: "Recusar Callback", type: "main", index: 0 }]] },
    "Linha Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
    "Gravar Log": { main: [[{ node: "Confirmar Callback", type: "main", index: 0 }]] },
    "Confirmar Callback": { main: [[{ node: "Editar Mensagem", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 3: teste-lembretes (Notion) — harness (simula o cron em qualquer data)
// ════════════════════════════════════════════════════════════════════
const wfTeste = {
  id: "FinTLembreNoti1",
  name: "teste-lembretes (Notion)",
  active: true,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    { name: "Webhook Teste", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: "f1aacea1-0105-4000-8000-harumi0000005", parameters: { httpMethod: "POST", path: "teste-lembretes-harumi", options: {} } },
    {
      name: "Chamar Lembretes",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [200, 0],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinLembreNotio1", cachedResultName: "lembretes-agendados (Notion)" },
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
  connections: { "Webhook Teste": { main: [[{ node: "Chamar Lembretes", type: "main", index: 0 }]] } },
};

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
for (const wf of [wfLembretes, wfResponder, wfTeste]) {
  wf.nodes.forEach((n, i) => { n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`; });
  const destino = path.join(destinoDir, `${wf.name.replace(" (Notion)", "")}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
