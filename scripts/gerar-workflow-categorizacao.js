// Gera workflows/categorizacao-hibrida.json e workflows/aplicar-categoria.json
// a partir da lógica testada (workflows/src/categorizador.js).
// Rodar: node scripts/gerar-workflow-categorizacao.js
// Plano: gstack/plans/categorizacao-hibrida.md
//
// Leituras do Sheets via UM values:batchGet (HTTP Request + credencial googleApi
// com httpNode/scopes) — a cota de leitura por usuário é apertada e 5 nós de
// leitura em sequência estouravam 429.
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const categorizadorSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "categorizador.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_SHEETS = { googleApi: { id: "FinSheetsSA00001", name: "Google Sheets SA" } };
const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };

// Retry: um 429 esporádico do Sheets não pode derrubar a execução
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// ── helpers de nós ───────────────────────────────────────────────────
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

// Converte um valueRange (header na 1ª linha) em objetos com _row real (linha da planilha)
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

const sheetsUpdateLancamento = (nome, pos) => ({
  name: nome,
  type: "n8n-nodes-base.googleSheets",
  typeVersion: 4.5,
  position: pos,
  ...RETRY,
  parameters: {
    authentication: "serviceAccount",
    operation: "update",
    documentId: { __rl: true, mode: "id", value: "={{ $env.GOOGLE_SHEETS_ID }}" },
    sheetName: { __rl: true, mode: "name", value: "Lançamentos" },
    columns: {
      mappingMode: "defineBelow",
      value: {
        row_number: "={{ $json.row }}",
        categoria: "={{ $json.categoria }}",
        id_meta: "={{ $json.id_meta }}",
      },
      matchingColumns: ["row_number"],
      schema: [
        { id: "row_number", displayName: "row_number", required: false, defaultMatch: true, display: true, type: "number", canBeUsedToMatch: true, removed: false, readOnly: true },
        { id: "categoria", displayName: "categoria", required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true, removed: false },
        { id: "id_meta", displayName: "id_meta", required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true, removed: false },
      ],
    },
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

// ════════════════════════════════════════════════════════════════════
// Workflow 1: categorizacao-hibrida
// valueRanges: 0=Lançamentos 1=Categorias 2=Metas 3=Dicionário 4=Log
// ════════════════════════════════════════════════════════════════════
const codigoResolver = categorizadorSrc + [
  "",
  "// ── Glue: varre pendências e resolve Dicionário → Gemini → pergunta ──",
  SRC_PARA_OBJETOS,
  "const linhas = paraObjetos(0);",
  "const categorias = paraObjetos(1)",
  "  .filter((c) => String(c.ativo).toLowerCase() === 'sim').map((c) => String(c.nome));",
  "const metas = paraObjetos(2)",
  "  .filter((m) => String(m.status) === 'ativa').map((m) => String(m.nome));",
  "const dicionario = paraObjetos(3);",
  "const logs = paraObjetos(4);",
  "const perguntadas = new Set(logs.filter((l) => l.acao === 'categoria_perguntada')",
  "  .map((l) => String(l.valor_anterior)));",
  "",
  "const pendentes = linhas.filter((l) => String(l.categoria || '').trim() === '');",
  "const agora = new Date().toISOString();",
  "const saida = [];",
  "let aplicados = 0, perguntados = 0;",
  "// Dedup intra-lote: regra criada neste lote vale para os próximos lançamentos",
  "// iguais (o re-lookup no Dicionário só enxerga regras de lotes anteriores)",
  "const regrasDoLote = new Map();",
  "",
  "for (const l of pendentes) {",
  "  const marca = 'row=' + l._row;",
  "  if (perguntadas.has(marca)) continue; // pergunta já aberta — não repetir",
  "  // Serial do Sheets (UNFORMATTED_VALUE p/ datas reais) → DD/MM/YYYY",
  "  const serialParaData = (v) => {",
  "    if (!v && v !== 0) return '';",
  "    if (typeof v === 'number' || (typeof v === 'string' && /^\\d+$/.test(String(v).trim()))) {",
  "      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);",
  "      return d.getUTCDate().toString().padStart(2,'0') + '/' +",
  "        (d.getUTCMonth()+1).toString().padStart(2,'0') + '/' + d.getUTCFullYear();",
  "    }",
  "    return String(v);",
  "  };",
  "  // Formata valor: número ou string numérica → 'R$ 1.234,56'; ausente → 'R$ ?'",
  "  const fmtValor = (v) => {",
  "    const n = Number(v);",
  "    if (isNaN(n) || v === '' || v == null) return 'R$ ?';",
  "    const [int, dec] = n.toFixed(2).split('.');",
  "    return 'R$ ' + int.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.') + ',' + dec;",
  "  };",
  "  const lanc = { descricao: String(l.descricao || ''), titulo: String(l.titulo || ''),",
  "    valor: l.valor, tipo: String(l.tipo || ''), origem: String(l.origem || '') };",
  "  const textoPergunta = '🤔 Como categorizar?\\n' + lanc.descricao +",
  "    (lanc.titulo && lanc.titulo !== lanc.descricao ? ' (' + lanc.titulo + ')' : '') +",
  "    '\\n' + fmtValor(lanc.valor) + ' · ' + lanc.tipo + ' · ' + serialParaData(l.data_original);",
  "",
  "  if (ehResgateCdb(lanc)) {",
  "    saida.push({ json: { fase: 'perguntar', row: l._row, texto: '🎯 Resgate de CDB — associar a qual meta?\\n' + textoPergunta,",
  "      teclado: montarTecladoMetas(l._row, metas),",
  "      log: { timestamp: agora, acao: 'categoria_perguntada', entidade: 'Lançamentos',",
  "        valor_anterior: marca, valor_novo: lanc.descricao, origem: 'categorizacao-hibrida' } } });",
  "    perguntados++;",
  "    continue;",
  "  }",
  "",
  "  // Re-lookup no Dicionário (regra pode ter surgido depois da importação)",
  "  const campo = (lanc.origem === 'conta' ? lanc.titulo : lanc.descricao).toUpperCase();",
  "  const regraExistente = dicionario.find((r) => String(r.origem).trim() === lanc.origem &&",
  "    campo.includes(String(r.descricao_original || '').toUpperCase()));",
  "  if (regraExistente) {",
  "    let categoria = String(regraExistente.categoria_mapeada);",
  "    if (categoria === 'Pagamento/Retirada') categoria = lanc.tipo === 'entrada' ? 'Pagamento' : 'Retirada';",
  "    const idMeta = categoria.startsWith('Meta: ') && metas.includes(categoria.slice(6)) ? categoria.slice(6) : '';",
  "    saida.push({ json: { fase: 'aplicar', row: l._row, categoria, id_meta: idMeta, regra: null,",
  "      logs: [{ timestamp: agora, acao: 'categoria_aplicada_dicionario', entidade: 'Lançamentos',",
  "        valor_anterior: marca, valor_novo: categoria + ' ← ' + lanc.descricao, origem: 'categorizacao-hibrida' }] } });",
  "    aplicados++;",
  "    continue;",
  "  }",
  "",
  "  const chave = chaveDicionario(lanc);",
  "  const chaveLote = lanc.origem + '|' + chave.toUpperCase();",
  "  if (regrasDoLote.has(chaveLote)) {",
  "    const categoria = regrasDoLote.get(chaveLote);",
  "    const idMeta = categoria.startsWith('Meta: ') && metas.includes(categoria.slice(6)) ? categoria.slice(6) : '';",
  "    saida.push({ json: { fase: 'aplicar', row: l._row, categoria, id_meta: idMeta, regra: null,",
  "      logs: [{ timestamp: agora, acao: 'categoria_aplicada_dicionario', entidade: 'Lançamentos',",
  "        valor_anterior: marca, valor_novo: categoria + ' ← ' + lanc.descricao + ' (regra do lote)', origem: 'categorizacao-hibrida' }] } });",
  "    aplicados++;",
  "    continue;",
  "  }",
  "",
  "  // Gemini Flash",
  "  let avaliacao = { valida: false };",
  "  try {",
  "    const resp = await this.helpers.httpRequest({",
  "      method: 'POST',",
  "      url: 'https://generativelanguage.googleapis.com/v1beta/models/' + $env.GEMINI_MODEL + ':generateContent',",
  "      headers: { 'x-goog-api-key': $env.GEMINI_API_KEY, 'Content-Type': 'application/json' },",
  "      body: { contents: [{ parts: [{ text: montarPrompt(lanc, categorias) }] }],",
  "        generationConfig: { responseMimeType: 'application/json' } },",
  "      json: true,",
  "    });",
  "    const texto = resp && resp.candidates && resp.candidates[0] &&",
  "      resp.candidates[0].content.parts[0].text;",
  "    avaliacao = parsearRespostaGemini(texto, categorias);",
  "  } catch (e) { avaliacao = { valida: false, _erro: String((e && e.message) || e).slice(0, 140) }; } // Gemini fora → pergunta manual",
  "",
  "  if (avaliacao.valida && avaliacao.confiante) {",
  "    regrasDoLote.set(chaveLote, avaliacao.categoria);",
  "    saida.push({ json: { fase: 'aplicar', row: l._row, categoria: avaliacao.categoria, id_meta: '',",
  "      regra: { descricao_original: chave, categoria_mapeada: avaliacao.categoria,",
  "        origem: lanc.origem, criado_em: agora.slice(0, 10) },",
  "      logs: [",
  "        { timestamp: agora, acao: 'categoria_aplicada_gemini', entidade: 'Lançamentos',",
  "          valor_anterior: marca, valor_novo: avaliacao.categoria + ' (conf ' + avaliacao.confianca + ') ← ' + lanc.descricao, origem: 'categorizacao-hibrida' },",
  "        { timestamp: agora, acao: 'regra_adicionada', entidade: 'dicionario',",
  "          valor_anterior: '', valor_novo: chave + ' → ' + avaliacao.categoria, origem: 'categorizacao-hibrida' },",
  "      ] } });",
  "    aplicados++;",
  "  } else {",
  "    saida.push({ json: { fase: 'perguntar', row: l._row, texto: textoPergunta,",
  "      teclado: montarTeclado(l._row, categorias, metas),",
  "      log: { timestamp: agora, acao: 'categoria_perguntada', entidade: 'Lançamentos',",
  "        valor_anterior: marca,",
  "        valor_novo: lanc.descricao + (avaliacao._erro ? ' [gemini: ' + avaliacao._erro + ']' : ''),",
  "        origem: 'categorizacao-hibrida' } } });",
  "    perguntados++;",
  "  }",
  "}",
  "",
  "if (aplicados + perguntados > 0) {",
  "  saida.push({ json: { fase: 'resumo',",
  "    texto: '🏷️ Categorização: ' + aplicados + ' aplicada(s) automaticamente, ' + perguntados + ' aguardando sua escolha.' } });",
  "}",
  "return saida;",
].join("\n");

const wfCategorizacao = {
  id: "FinCategoriza001",
  name: "categorizacao-hibrida",
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Início",
      type: "n8n-nodes-base.executeWorkflowTrigger",
      typeVersion: 1.1,
      position: [0, 0],
      // passthrough: chamado sem argumentos
      parameters: { inputSource: "passthrough" },
    },
    lerDados(
      ["'Lançamentos'!A:J", "'Categorias'!A:C", "'Metas'!A:F", "'Dicionário'!A:D", "'Log'!A:F"],
      [200, 0]
    ),
    codeNode("Resolver", codigoResolver, [400, 0]),
    ifString("Aplicar?", "={{ $json.fase }}", "aplicar", [600, 0]),
    sheetsUpdateLancamento("Atualizar Lançamento", [800, -150]),
    {
      name: "Linha Regra",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1000, -250],
      parameters: {
        // O Update do Sheets devolve só a linha atualizada — regra/logs vêm do IF anterior
        jsCode: "return $('Aplicar?').all().filter((i) => i.json.regra).map((i) => ({ json: i.json.regra }));",
      },
    },
    sheetsAppend("Gravar Regra", "Dicionário", [1200, -250]),
    {
      name: "Logs Aplicar",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1000, -100],
      parameters: {
        jsCode: "return $('Aplicar?').all().flatMap((i) => (i.json.logs || []).map((l) => ({ json: l })));",
      },
    },
    sheetsAppend("Gravar Log Aplicar", "Log", [1200, -100]),
    ifString("Perguntar?", "={{ $json.fase }}", "perguntar", [800, 100]),
    httpTelegram(
      "Enviar Pergunta",
      "sendMessage",
      "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $json.texto, reply_markup: $json.teclado }) }}",
      [1000, 100]
    ),
    {
      name: "Log Pergunta",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1200, 100],
      parameters: {
        jsCode: "return $('Perguntar?').all().map((i) => ({ json: i.json.log }));",
      },
    },
    sheetsAppend("Gravar Log Pergunta", "Log", [1400, 100]),
    ifString("Resumo?", "={{ $json.fase }}", "resumo", [1000, 250]),
    telegramMsg("Enviar Resumo", "={{ $json.texto }}", [1200, 250]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Resolver", type: "main", index: 0 }]] },
    "Resolver": { main: [[{ node: "Aplicar?", type: "main", index: 0 }]] },
    "Aplicar?": {
      main: [
        [{ node: "Atualizar Lançamento", type: "main", index: 0 }],
        [{ node: "Perguntar?", type: "main", index: 0 }],
      ],
    },
    "Atualizar Lançamento": {
      main: [[
        { node: "Linha Regra", type: "main", index: 0 },
        { node: "Logs Aplicar", type: "main", index: 0 },
      ]],
    },
    "Linha Regra": { main: [[{ node: "Gravar Regra", type: "main", index: 0 }]] },
    "Logs Aplicar": { main: [[{ node: "Gravar Log Aplicar", type: "main", index: 0 }]] },
    "Perguntar?": {
      main: [
        [{ node: "Enviar Pergunta", type: "main", index: 0 }],
        [{ node: "Resumo?", type: "main", index: 0 }],
      ],
    },
    "Enviar Pergunta": { main: [[{ node: "Log Pergunta", type: "main", index: 0 }]] },
    "Log Pergunta": { main: [[{ node: "Gravar Log Pergunta", type: "main", index: 0 }]] },
    "Resumo?": { main: [[{ node: "Enviar Resumo", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 2: aplicar-categoria (resposta do clique no teclado)
// valueRanges: 0=Lançamentos 1=Categorias 2=Metas
// ════════════════════════════════════════════════════════════════════
const codigoProcessar = categorizadorSrc + [
  "",
  "// ── Glue: valida o callback e prepara updates ──",
  SRC_PARA_OBJETOS,
  "const entrada = $('Início').first().json;",
  "const cb = parsearCallback(entrada.data);",
  "if (!cb) return [{ json: { acao: 'recusar', aviso: 'Botão inválido ou expirado.' } }];",
  "const linhas = paraObjetos(0);",
  "const linha = linhas.find((l) => l._row === cb.row);",
  "if (!linha) return [{ json: { acao: 'recusar', aviso: 'Lançamento não encontrado.' } }];",
  "if (String(linha.categoria || '').trim() !== '') {",
  "  return [{ json: { acao: 'recusar', aviso: 'Já categorizado: ' + linha.categoria } }];",
  "}",
  "const categorias = paraObjetos(1)",
  "  .filter((c) => String(c.ativo).toLowerCase() === 'sim').map((c) => String(c.nome));",
  "const metas = paraObjetos(2)",
  "  .filter((m) => String(m.status) === 'ativa').map((m) => String(m.nome));",
  "const agora = new Date().toISOString();",
  "let categoria, idMeta = '', regra = null;",
  "if (cb.tipo === 'meta') {",
  "  if (!metas.includes(cb.nome)) return [{ json: { acao: 'recusar', aviso: 'Meta não está mais ativa.' } }];",
  "  categoria = 'Meta: ' + cb.nome;",
  "  idMeta = cb.nome;",
  "} else {",
  "  if (!categorias.includes(cb.nome)) return [{ json: { acao: 'recusar', aviso: 'Categoria não está mais ativa.' } }];",
  "  categoria = cb.nome;",
  "  regra = { descricao_original: chaveDicionario(linha), categoria_mapeada: categoria,",
  "    origem: linha.origem, criado_em: agora.slice(0, 10) };",
  "}",
  "const logs = [{ timestamp: agora, acao: 'categoria_aplicada_manual', entidade: 'Lançamentos',",
  "  valor_anterior: 'row=' + cb.row, valor_novo: categoria + ' ← ' + linha.descricao, origem: 'aplicar-categoria' }];",
  "if (regra) logs.push({ timestamp: agora, acao: 'regra_adicionada', entidade: 'dicionario',",
  "  valor_anterior: '', valor_novo: regra.descricao_original + ' → ' + categoria, origem: 'aplicar-categoria' });",
  "return [{ json: { acao: 'aplicar', row: cb.row, categoria, id_meta: idMeta, regra, logs,",
  "  texto_edit: '✅ ' + linha.descricao + ' → ' + categoria } }];",
].join("\n");

const wfAplicar = {
  id: "FinAplicarCat001",
  name: "aplicar-categoria",
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
    lerDados(["'Lançamentos'!A:J", "'Categorias'!A:C", "'Metas'!A:F"], [200, 0]),
    codeNode("Processar", codigoProcessar, [400, 0]),
    ifString("Aplicar?", "={{ $json.acao }}", "aplicar", [600, 0]),
    sheetsUpdateLancamento("Atualizar Lançamento", [800, -150]),
    {
      name: "Linha Regra",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1000, -250],
      parameters: {
        // O Update do Sheets devolve só a linha atualizada — regra vem do Processar
        jsCode: "const r = $('Processar').first().json.regra; return r ? [{ json: r }] : [];",
      },
    },
    sheetsAppend("Gravar Regra", "Dicionário", [1200, -250]),
    {
      name: "Linhas Log",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1000, -100],
      parameters: {
        jsCode: "return $('Processar').first().json.logs.map((l) => ({ json: l }));",
      },
    },
    sheetsAppend("Gravar Log", "Log", [1200, -100]),
    httpTelegram(
      "Confirmar Callback",
      "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: '✅ Aplicado' }) }}",
      [1400, -100]
    ),
    httpTelegram(
      "Editar Mensagem",
      "editMessageText",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Processar').first().json.texto_edit }) }}",
      [1600, -100]
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
    "Processar": { main: [[{ node: "Aplicar?", type: "main", index: 0 }]] },
    "Aplicar?": {
      main: [
        [{ node: "Atualizar Lançamento", type: "main", index: 0 }],
        [{ node: "Recusar Callback", type: "main", index: 0 }],
      ],
    },
    "Atualizar Lançamento": {
      main: [[
        { node: "Linha Regra", type: "main", index: 0 },
        { node: "Linhas Log", type: "main", index: 0 },
      ]],
    },
    "Linha Regra": { main: [[{ node: "Gravar Regra", type: "main", index: 0 }]] },
    "Linhas Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
    "Gravar Log": { main: [[{ node: "Confirmar Callback", type: "main", index: 0 }]] },
    "Confirmar Callback": { main: [[{ node: "Editar Mensagem", type: "main", index: 0 }]] },
  },
};

// ── grava os dois ────────────────────────────────────────────────────
for (const wf of [wfCategorizacao, wfAplicar]) {
  wf.nodes.forEach((n, i) => {
    n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`;
  });
  const destino = path.join(RAIZ, "workflows", `${wf.name}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
