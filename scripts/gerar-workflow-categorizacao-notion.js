// Gera workflows-harumi/categorizacao-hibrida.json e workflows-harumi/aplicar-categoria.json
// — variante Notion (Fase B) do gerador original (scripts/gerar-workflow-categorizacao.js).
// Reaproveita workflows/src/categorizador.js integralmente (montarPrompt,
// parsearRespostaGemini, chaveDicionario, ehResgateCdb) — só montarTeclado/parsearCallback
// mudam (ver workflows-harumi/src/categorizador-notion-extra.js: o motivo é o id da page do
// Notion não caber, junto com o nome da categoria, no limite de 64 bytes do callback_data
// do Telegram — a solução usa um ÍNDICE na lista de categorias/metas ativas em vez do nome).
// Metas fica de fora por ora (Fase C ainda não criou a database Metas no Notion).
// Rodar: node scripts/gerar-workflow-categorizacao-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc, codigoGravarPages, codigoAtualizarCategoriaEMeta } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const categorizadorSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "categorizador.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");
const categorizadorNotionExtraSrc = fs
  .readFileSync(path.join(RAIZ, "workflows-harumi", "src", "categorizador-notion-extra.js"), "utf-8")
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

// Chamada crua à API do Telegram (não o node nativo) — precisamos de reply_markup
// (teclado inline) e editMessageText/answerCallbackQuery, que o node nativo não cobre bem.
// Mesmo padrão do gerador Sheets original (não é uma mudança Notion-specific).
const httpTelegram = (nome, metodo, jsonBody, pos) => ({
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
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
// Workflow 1: categorizacao-hibrida (Notion)
// ════════════════════════════════════════════════════════════════════
const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: Lançamentos sem categoria + Categorias ativas (ordenadas por Nome — o índice",
  "// do callback_data depende dessa MESMA ordem sendo usada de novo em aplicar-categoria) +",
  "// Dicionário completo + Log (só 'categoria_perguntada', p/ não repetir pergunta) ──",
  "const [lancamentos, categoriasAtivas, dicionario, logPerguntados] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS, { property: 'Categoria', select: { is_empty: true } }),",
  "  notionQueryAll($env.NOTION_DB_CATEGORIAS, { property: 'Ativo', checkbox: { equals: true } },",
  "    [{ property: 'Nome', direction: 'ascending' }]),",
  "  notionQueryAll($env.NOTION_DB_DICIONARIO),",
  "  notionQueryAll($env.NOTION_DB_LOG, { property: 'Ação', rich_text: { equals: 'categoria_perguntada' } }),",
  "]);",
  "return [{ json: { lancamentos, categoriasAtivas, dicionario, logPerguntados } }];",
].join("\n");

const codigoResolver = categorizadorSrc + categorizadorNotionExtraSrc + notionMapSrc + [
  "",
  "// ── Glue: varre pendências e resolve Dicionário → Gemini → pergunta (Notion) ──",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const pendentes = brutos.lancamentos.map(paraObjetoLancamento); // já filtradas (Categoria vazia) na query",
  "const categorias = brutos.categoriasAtivas.map(paraObjetoCategoria).map((c) => c.nome);",
  "const metas = []; // Fase C adiciona a database Metas no Notion",
  "const dicionario = brutos.dicionario.map(paraObjetoDicionario);",
  "const perguntadas = new Set(brutos.logPerguntados.map(paraObjetoLog).map((l) => l.valor_anterior));",
  "",
  "const agora = new Date().toISOString();",
  "const saida = [];",
  "let aplicados = 0, perguntados = 0, puladas = 0;",
  "// Dedup intra-lote: regra criada neste lote vale para os próximos lançamentos",
  "// iguais (o re-lookup no Dicionário só enxerga regras de lotes anteriores)",
  "const regrasDoLote = new Map();",
  "",
  "for (const l of pendentes) {",
  "  const marca = 'page=' + l._id;",
  "  if (perguntadas.has(marca)) { puladas++; continue; } // pergunta já aberta — não repetir",
  "  const fmtValor = (v) => {",
  "    const n = Number(v);",
  "    if (isNaN(n)) return 'R$ ?';",
  "    const [int, dec] = n.toFixed(2).split('.');",
  "    return 'R$ ' + int.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.') + ',' + dec;",
  "  };",
  "  const lanc = { descricao: l.descricao, titulo: l.titulo, valor: l.valor, tipo: l.tipo, origem: l.origem };",
  "  const textoPergunta = '🤔 Como categorizar?\\n' + lanc.descricao +",
  "    (lanc.titulo && lanc.titulo !== lanc.descricao ? ' (' + lanc.titulo + ')' : '') +",
  "    '\\n' + fmtValor(lanc.valor) + ' · ' + lanc.tipo + ' · ' + (l.data_original || '');",
  "",
  "  if (ehResgateCdb(lanc)) {",
  "    saida.push({ json: { fase: 'perguntar', pageId: l._id, texto: '🎯 Resgate de CDB — associar a qual meta?\\n' + textoPergunta,",
  "      teclado: montarTecladoMetasNotion(l._id, metas),",
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
  "    saida.push({ json: { fase: 'aplicar', pageId: l._id, categoria, id_meta: idMeta, regra: null,",
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
  "    saida.push({ json: { fase: 'aplicar', pageId: l._id, categoria, id_meta: idMeta, regra: null,",
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
  "  } catch (e) { avaliacao = { valida: false, _erro: String((e && e.message) || e).slice(0, 140) }; }",
  "",
  "  if (avaliacao.valida && avaliacao.confiante) {",
  "    regrasDoLote.set(chaveLote, avaliacao.categoria);",
  "    saida.push({ json: { fase: 'aplicar', pageId: l._id, categoria: avaliacao.categoria, id_meta: '',",
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
  "    saida.push({ json: { fase: 'perguntar', pageId: l._id, texto: textoPergunta,",
  "      teclado: montarTecladoNotion(l._id, categorias, metas),",
  "      log: { timestamp: agora, acao: 'categoria_perguntada', entidade: 'Lançamentos',",
  "        valor_anterior: marca,",
  "        valor_novo: lanc.descricao + (avaliacao._erro ? ' [gemini: ' + avaliacao._erro + ']' : ''),",
  "        origem: 'categorizacao-hibrida' } } });",
  "    perguntados++;",
  "  }",
  "}",
  "",
  "if (aplicados + perguntados > 0) {",
  "  let t = '🏷️ Categorização: ' + aplicados + ' aplicada(s) automaticamente, ' + perguntados + ' aguardando sua escolha.';",
  "  if (puladas > 0) t += '\\n(' + puladas + ' já perguntada(s) antes — responda os botões anteriores.)';",
  "  saida.push({ json: { fase: 'resumo', texto: t } });",
  "} else {",
  "  const t = pendentes.length === 0",
  "    ? '✅ Nenhum lançamento sem categoria — está tudo categorizado.'",
  "    : '✅ Nada novo: ' + puladas + ' lançamento(s) já aguardam sua escolha nos botões enviados antes.';",
  "  saida.push({ json: { fase: 'resumo', texto: t } });",
  "}",
  "return saida;",
].join("\n");

const wfCategorizacao = {
  id: "FinCategNotion1",
  name: "categorizacao-hibrida (Notion)",
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    { name: "Início", type: "n8n-nodes-base.executeWorkflowTrigger", typeVersion: 1.1, position: [0, 0], parameters: { inputSource: "passthrough" } },
    { name: "Ler Dados (Notion)", type: "n8n-nodes-base.code", typeVersion: 2, position: [200, 0], ...RETRY, parameters: { jsCode: codigoLerDados } },
    codeNode("Resolver", codigoResolver, [400, 0]),
    ifString("Aplicar?", "={{ $json.fase }}", "aplicar", [600, 0]),
    codeNode("Atualizar Lançamento", codigoAtualizarCategoriaEMeta(), [800, -150]),
    codeNode("Linha Regra", "return $('Aplicar?').all().filter((i) => i.json.regra).map((i) => ({ json: i.json.regra }));", [1000, -250]),
    codeNode("Gravar Regra", codigoGravarPages("Linha Regra", "NOTION_DB_DICIONARIO", "propsDeDicionario"), [1200, -250]),
    codeNode("Logs Aplicar", "return $('Aplicar?').all().flatMap((i) => (i.json.logs || []).map((l) => ({ json: l })));", [1000, -100]),
    codeNode("Gravar Log Aplicar", codigoGravarPages("Logs Aplicar", "NOTION_DB_LOG", "propsDeLog"), [1200, -100]),
    ifString("Perguntar?", "={{ $json.fase }}", "perguntar", [800, 100]),
    httpTelegram("Enviar Pergunta", "sendMessage", "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: $json.texto, reply_markup: $json.teclado }) }}", [1000, 100]),
    codeNode("Log Pergunta", "return $('Perguntar?').all().map((i) => ({ json: i.json.log }));", [1200, 100]),
    codeNode("Gravar Log Pergunta", codigoGravarPages("Log Pergunta", "NOTION_DB_LOG", "propsDeLog"), [1400, 100]),
    ifString("Resumo?", "={{ $json.fase }}", "resumo", [1000, 250]),
    telegramMsg("Enviar Resumo", "={{ $json.texto }}", [1200, 250]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Resolver", type: "main", index: 0 }]] },
    "Resolver": { main: [[{ node: "Aplicar?", type: "main", index: 0 }]] },
    "Aplicar?": {
      main: [
        [{ node: "Atualizar Lançamento", type: "main", index: 0 }],
        [{ node: "Perguntar?", type: "main", index: 0 }],
      ],
    },
    "Atualizar Lançamento": { main: [[{ node: "Linha Regra", type: "main", index: 0 }, { node: "Logs Aplicar", type: "main", index: 0 }]] },
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
// Workflow 2: aplicar-categoria (Notion) — resposta do clique no teclado
// Diferente do original: um único Code node ("Processar") busca a page do
// Lançamento DIRETO pelo id (GET /v1/pages/{id}) em vez de escanear a aba
// inteira por row number — o id já vem no callback_data, então não precisamos
// buscar tudo antecipadamente como o batchGet do Sheets fazia.
// ════════════════════════════════════════════════════════════════════
const codigoProcessar = categorizadorSrc + categorizadorNotionExtraSrc + notionMapSrc + [
  "",
  "// ── Glue: valida o callback (id+índice), busca a page e prepara o update ──",
  "const entrada = $('Início').first().json;",
  "const cb = parsearCallbackNotion(entrada.data);",
  "if (!cb) return [{ json: { acao: 'recusar', aviso: 'Botão inválido ou expirado.' } }];",
  "",
  "let paginaLancamento;",
  "try {",
  "  paginaLancamento = await HELPERS.httpRequest({",
  "    method: 'GET', url: `https://api.notion.com/v1/pages/${cb.pageId}`, headers: notionHeaders(), json: true,",
  "  });",
  "} catch (e) {",
  "  return [{ json: { acao: 'recusar', aviso: 'Lançamento não encontrado.' } }];",
  "}",
  "const linha = paraObjetoLancamento(paginaLancamento);",
  "if (String(linha.categoria || '').trim() !== '') {",
  "  return [{ json: { acao: 'recusar', aviso: 'Já categorizado: ' + linha.categoria } }];",
  "}",
  "",
  "// MESMO filtro+ordenação de categorizacao-hibrida — o índice do callback_data",
  "// só aponta pro item certo se a lista aqui bater com a de quando o teclado foi montado.",
  "const categoriasAtivas = await notionQueryAll($env.NOTION_DB_CATEGORIAS,",
  "  { property: 'Ativo', checkbox: { equals: true } }, [{ property: 'Nome', direction: 'ascending' }]);",
  "const categorias = categoriasAtivas.map(paraObjetoCategoria).map((c) => c.nome);",
  "const metas = []; // Fase C adiciona a database Metas no Notion",
  "",
  "const agora = new Date().toISOString();",
  "let categoria, idMeta = '', regra = null;",
  "if (cb.tipo === 'meta') {",
  "  const nomeMeta = metas[cb.indice];",
  "  if (!nomeMeta) return [{ json: { acao: 'recusar', aviso: 'Meta não está mais ativa.' } }];",
  "  categoria = 'Meta: ' + nomeMeta;",
  "  idMeta = nomeMeta;",
  "} else {",
  "  const nomeCategoria = categorias[cb.indice];",
  "  if (!nomeCategoria) return [{ json: { acao: 'recusar', aviso: 'Categoria não está mais ativa — a lista pode ter mudado, tente categorizar de novo.' } }];",
  "  categoria = nomeCategoria;",
  "  regra = { descricao_original: chaveDicionario(linha), categoria_mapeada: categoria,",
  "    origem: linha.origem, criado_em: agora.slice(0, 10) };",
  "}",
  "const logs = [{ timestamp: agora, acao: 'categoria_aplicada_manual', entidade: 'Lançamentos',",
  "  valor_anterior: 'page=' + cb.pageId, valor_novo: categoria + ' ← ' + linha.descricao, origem: 'aplicar-categoria' }];",
  "if (regra) logs.push({ timestamp: agora, acao: 'regra_adicionada', entidade: 'dicionario',",
  "  valor_anterior: '', valor_novo: regra.descricao_original + ' → ' + categoria, origem: 'aplicar-categoria' });",
  "return [{ json: { acao: 'aplicar', pageId: cb.pageId, categoria, id_meta: idMeta, regra, logs,",
  "  texto_edit: '✅ ' + linha.descricao + ' → ' + categoria } }];",
].join("\n");

const wfAplicar = {
  id: "FinAplicarNoti1",
  name: "aplicar-categoria (Notion)",
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
    codeNode("Processar", codigoProcessar, [300, 0], RETRY),
    ifString("Aplicar?", "={{ $json.acao }}", "aplicar", [600, 0]),
    codeNode("Atualizar Lançamento", codigoAtualizarCategoriaEMeta(), [800, -150]),
    codeNode("Linha Regra", "const r = $('Processar').first().json.regra; return r ? [{ json: r }] : [];", [1000, -250]),
    codeNode("Gravar Regra", codigoGravarPages("Linha Regra", "NOTION_DB_DICIONARIO", "propsDeDicionario"), [1200, -250]),
    codeNode("Linhas Log", "return $('Processar').first().json.logs.map((l) => ({ json: l }));", [1000, -100]),
    codeNode("Gravar Log", codigoGravarPages("Linhas Log", "NOTION_DB_LOG", "propsDeLog"), [1200, -100]),
    httpTelegram(
      "Confirmar Callback", "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: '✅ Aplicado' }) }}",
      [1400, -100]
    ),
    httpTelegram(
      "Editar Mensagem", "editMessageText",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Processar').first().json.texto_edit }) }}",
      [1600, -100]
    ),
    httpTelegram(
      "Recusar Callback", "answerCallbackQuery",
      "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: $json.aviso, show_alert: true }) }}",
      [800, 150]
    ),
  ],
  connections: {
    "Início": { main: [[{ node: "Processar", type: "main", index: 0 }]] },
    "Processar": { main: [[{ node: "Aplicar?", type: "main", index: 0 }]] },
    "Aplicar?": {
      main: [
        [{ node: "Atualizar Lançamento", type: "main", index: 0 }],
        [{ node: "Recusar Callback", type: "main", index: 0 }],
      ],
    },
    "Atualizar Lançamento": { main: [[{ node: "Linha Regra", type: "main", index: 0 }, { node: "Linhas Log", type: "main", index: 0 }]] },
    "Linha Regra": { main: [[{ node: "Gravar Regra", type: "main", index: 0 }]] },
    "Linhas Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
    "Gravar Log": { main: [[{ node: "Confirmar Callback", type: "main", index: 0 }]] },
    "Confirmar Callback": { main: [[{ node: "Editar Mensagem", type: "main", index: 0 }]] },
  },
};

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
for (const wf of [wfCategorizacao, wfAplicar]) {
  wf.nodes.forEach((n, i) => {
    n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`;
  });
  const destino = path.join(destinoDir, `${wf.name.replace(" (Notion)", "")}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
