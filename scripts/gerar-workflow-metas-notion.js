// Gera workflows-harumi/gerenciar-metas.json — variante Notion (Fase C) do gerador
// original (scripts/gerar-workflow-metas.js). Reaproveita workflows/src/metas.js
// integralmente — o callback_data já usa o NOME da meta (não row number), então não
// precisou de um módulo -notion-extra como categorizador precisou.
// Rodar: node scripts/gerar-workflow-metas-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc, codigoGravarPages } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const metasSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "metas.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBotHarumi01", name: "Telegram Bot (Harumi)" } };
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
  ...RETRY,
  parameters: { chatId: "={{ $env.TELEGRAM_CHAT_ID_HARUMI }}", text: texto, additionalFields: { appendAttribution: false } },
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
    url: `=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN_HARUMI }}/${metodo}`,
    sendBody: true, specifyBody: "json", jsonBody, options: {},
  },
});

const noOp = (nome, pos) => ({ name: nome, type: "n8n-nodes-base.noOp", typeVersion: 1, position: pos, parameters: {} });

// ════════════════════════════════════════════════════════════════════
// gerenciar-metas (Notion)
// ════════════════════════════════════════════════════════════════════
const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: Metas (todas — status importa pro filtro em JS) + Lançamentos com meta ──",
  "const [metasRows, lancamentosComMeta] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_METAS),",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS, { and: [",
  "    { property: 'Status', select: { equals: 'confirmado' } },",
  "    { property: 'Meta', rich_text: { is_not_empty: true } },",
  "  ] }),",
  "]);",
  "return [{ json: { metasRows, lancamentosComMeta } }];",
].join("\n");

const codigoDecidir = metasSrc + notionMapSrc + [
  "",
  "// ── Glue: roteia acao (metas | nova-meta | callback) — Notion ──",
  "const e = $('Início').first().json;",
  "const acao = String(e.acao || '');",
  "let inj = null;",
  "try { if (e.estado) inj = JSON.parse(e.estado); } catch (x) {}",
  "const dry = !!inj; // harness: estado injetado → dry-run (retorna decisão, não escreve)",
  "const brutos = dry ? null : $('Ler Dados (Notion)').first().json;",
  "const metas = dry ? (inj.metas || []) : brutos.metasRows.map(paraObjetoMeta);",
  "const lancs = dry ? (inj.lancamentos || []) : brutos.lancamentosComMeta.map(paraObjetoLancamento);",
  "const agora = new Date().toISOString();",
  "const hoje = agora.slice(0, 10);",
  "let saida = [];",
  "",
  "if (acao === 'metas') {",
  "  const prog = calcularProgresso(metas, lancs);",
  "  saida.push({ json: { fase: 'listar', texto: montarMensagemMetas(prog), teclado: montarTecladoMetas(prog) } });",
  "  // Cache: reescreve Valor Acumulado de cada meta ativa pelo derivado (patch parcial por page).",
  "  const ativas = metas.filter((m) => String(m.status || '').trim().toLowerCase() === 'ativa');",
  "  const atualizacoes = ativas.map((m) => {",
  "    const p = prog.find((x) => x.nome === String(m.nome || '').trim());",
  "    return { pageId: m._id, valor: p ? p.acumulado : 0 };",
  "  });",
  "  if (atualizacoes.length) saida.push({ json: { fase: 'cache', atualizacoes } });",
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
  "      log: { timestamp: agora, acao: 'meta_criada', entidade: m.nome, valor_anterior: '', valor_novo: 'orçamento ' + m.orcamento + ' · prazo ' + m.prazo, origem: 'gerenciar-metas' },",
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
  "    const metaAlvo = metas.find((m) => String(m.nome || '').trim() === alvo && String(m.status || '').trim().toLowerCase() === 'ativa');",
  "    if (!metaAlvo) {",
  "      saida.push({ json: { fase: 'recusar', aviso: 'Meta não está mais ativa.' } });",
  "    } else if (cb.acao === 'encerrar-confirmar') {",
  "      saida.push({ json: { fase: 'confirmar', nome: alvo, teclado: montarTecladoConfirmarEncerrar(alvo),",
  "        texto_edit: '🏁 Encerrar a meta \"' + alvo + '\"?\\nOs lançamentos já associados continuam registrados.' } });",
  "    } else {",
  "      saida.push({ json: { fase: 'encerrar', pageId: metaAlvo._id, nome: alvo,",
  "        log: { timestamp: agora, acao: 'meta_encerrada', entidade: alvo, valor_anterior: 'ativa', valor_novo: 'encerrada', origem: 'gerenciar-metas' },",
  "        texto_edit: '🏁 Meta \"' + alvo + '\" encerrada. Sai da lista; o histórico permanece.' } });",
  "    }",
  "  }",
  "}",
  "",
  "const modo = dry ? 'teste' : 'real';",
  "return saida.map((s) => ({ json: { ...s.json, modo } }));",
].join("\n");

// Cache é cosmético (nunca fonte da verdade — ver metas.js) — segue mesmo se falhar.
const codigoAtualizarCache = [
  notionHttpSrc,
  "",
  "// ── Glue: reescreve Valor Acumulado de cada meta ativa (patch parcial, best-effort) ──",
  "const propsValorAcumulado = (valor) => ({ 'Valor Acumulado': { number: Number(valor) || 0 } });",
  "const atualizacoes = $json.atualizacoes || [];",
  "for (const a of atualizacoes) {",
  "  try { await notionUpdatePage(a.pageId, propsValorAcumulado(a.valor)); } catch (e) { /* cache é cosmético — não falha o fluxo */ }",
  "}",
  "return [{ json: { ok: true } }];",
].join("\n");

const codigoEncerrarMeta = [
  notionHttpSrc,
  "",
  "// ── Glue: Status → encerrada (patch parcial) ──",
  "const propsStatus = (status) => ({ 'Status': status ? { select: { name: String(status) } } : { select: null } });",
  "const itens = $input.all();",
  "for (const item of itens) { await notionUpdatePage(item.json.pageId, propsStatus('encerrada')); }",
  "return itens;",
].join("\n");

const wfMetas = {
  id: "FinMetasNotion1",
  name: "gerenciar-metas (Notion — Harumi)",
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
    codeNode("Ler Dados (Notion)", codigoLerDados, [200, 0], RETRY),
    codeNode("Decidir", codigoDecidir, [400, 0]),
    ifString("Teste?", "={{ $json.modo }}", "teste", [600, 0]),
    noOp("Saída Teste", [800, -160]),

    ifString("Listar?", "={{ $json.fase }}", "listar", [800, 120]),
    httpTelegram("Enviar Lista", "sendMessage", "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID_HARUMI, text: $json.texto, reply_markup: $json.teclado }) }}", [1000, 40]),
    ifString("Cache?", "={{ $json.fase }}", "cache", [1000, 200]),
    codeNode("Atualizar Cache", codigoAtualizarCache, [1200, 120]),

    ifString("Criar?", "={{ $json.fase }}", "criar", [1200, 300]),
    codeNode("Linha Meta", "return $input.all().map((i) => ({ json: i.json.meta }));", [1400, 220]),
    codeNode("Inserir Meta", codigoGravarPages("Linha Meta", "NOTION_DB_METAS", "propsDeMeta"), [1600, 220]),
    codeNode("Linha Log Criar", "return $('Criar?').all().map((i) => ({ json: i.json.log }));", [1800, 160]),
    codeNode("Gravar Log Criar", codigoGravarPages("Linha Log Criar", "NOTION_DB_LOG", "propsDeLog"), [2000, 160]),
    httpTelegram("Confirmar Criação", "sendMessage", "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID_HARUMI, text: $('Criar?').first().json.texto }) }}", [1800, 300]),

    ifString("Avisar?", "={{ $json.fase }}", "avisar", [1400, 400]),
    telegramMsg("Enviar Aviso", "={{ $json.texto }}", [1600, 400]),

    ifString("Template?", "={{ $json.fase }}", "template", [1600, 500]),
    httpTelegram("Ack Template", "answerCallbackQuery", "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id }) }}", [1800, 460]),
    httpTelegram("Enviar Template", "sendMessage", "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, text: $('Template?').first().json.texto }) }}", [2000, 460]),

    ifString("Confirmar?", "={{ $json.fase }}", "confirmar", [1800, 600]),
    httpTelegram("Ack Confirmar", "answerCallbackQuery", "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id }) }}", [2000, 560]),
    httpTelegram(
      "Pedir Confirmação", "editMessageText",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Confirmar?').first().json.texto_edit, reply_markup: $('Confirmar?').first().json.teclado }) }}",
      [2200, 560]
    ),

    ifString("Encerrar?", "={{ $json.fase }}", "encerrar", [2000, 700]),
    codeNode("Encerrar Meta", codigoEncerrarMeta, [2200, 660]),
    codeNode("Linha Log Encerrar", "return $('Encerrar?').all().map((i) => ({ json: i.json.log }));", [2400, 600]),
    codeNode("Gravar Log Encerrar", codigoGravarPages("Linha Log Encerrar", "NOTION_DB_LOG", "propsDeLog"), [2600, 600]),
    httpTelegram("Ack Encerrar", "answerCallbackQuery", "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: '🏁 Encerrada' }) }}", [2400, 740]),
    httpTelegram(
      "Editar Encerrada", "editMessageText",
      "={{ JSON.stringify({ chat_id: $('Início').first().json.chat_id, message_id: Number($('Início').first().json.message_id), text: $('Encerrar?').first().json.texto_edit }) }}",
      [2600, 740]
    ),

    ifString("Recusar?", "={{ $json.fase }}", "recusar", [2200, 820]),
    httpTelegram("Recusar Callback", "answerCallbackQuery", "={{ JSON.stringify({ callback_query_id: $('Início').first().json.callback_id, text: $json.aviso, show_alert: true }) }}", [2400, 820]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    "Decidir": { main: [[{ node: "Teste?", type: "main", index: 0 }]] },
    "Teste?": { main: [[{ node: "Saída Teste", type: "main", index: 0 }], [{ node: "Listar?", type: "main", index: 0 }]] },
    "Listar?": { main: [[{ node: "Enviar Lista", type: "main", index: 0 }], [{ node: "Cache?", type: "main", index: 0 }]] },
    "Cache?": { main: [[{ node: "Atualizar Cache", type: "main", index: 0 }], [{ node: "Criar?", type: "main", index: 0 }]] },
    "Criar?": { main: [[{ node: "Linha Meta", type: "main", index: 0 }], [{ node: "Avisar?", type: "main", index: 0 }]] },
    "Linha Meta": { main: [[{ node: "Inserir Meta", type: "main", index: 0 }]] },
    "Inserir Meta": { main: [[{ node: "Linha Log Criar", type: "main", index: 0 }, { node: "Confirmar Criação", type: "main", index: 0 }]] },
    "Linha Log Criar": { main: [[{ node: "Gravar Log Criar", type: "main", index: 0 }]] },
    "Avisar?": { main: [[{ node: "Enviar Aviso", type: "main", index: 0 }], [{ node: "Template?", type: "main", index: 0 }]] },
    "Template?": { main: [[{ node: "Ack Template", type: "main", index: 0 }], [{ node: "Confirmar?", type: "main", index: 0 }]] },
    "Ack Template": { main: [[{ node: "Enviar Template", type: "main", index: 0 }]] },
    "Confirmar?": { main: [[{ node: "Ack Confirmar", type: "main", index: 0 }], [{ node: "Encerrar?", type: "main", index: 0 }]] },
    "Ack Confirmar": { main: [[{ node: "Pedir Confirmação", type: "main", index: 0 }]] },
    "Encerrar?": { main: [[{ node: "Encerrar Meta", type: "main", index: 0 }], [{ node: "Recusar?", type: "main", index: 0 }]] },
    "Encerrar Meta": { main: [[{ node: "Linha Log Encerrar", type: "main", index: 0 }, { node: "Ack Encerrar", type: "main", index: 0 }]] },
    "Linha Log Encerrar": { main: [[{ node: "Gravar Log Encerrar", type: "main", index: 0 }]] },
    "Ack Encerrar": { main: [[{ node: "Editar Encerrada", type: "main", index: 0 }]] },
    "Recusar?": { main: [[{ node: "Recusar Callback", type: "main", index: 0 }]] },
  },
};

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
wfMetas.nodes.forEach((n, i) => { n.id = `fin-metas-notion-${String(i + 1).padStart(2, "0")}`; });
const destino = path.join(destinoDir, "gerenciar-metas.json");
fs.writeFileSync(destino, JSON.stringify(wfMetas, null, 2) + "\n");
console.log(`OK: ${destino} (${wfMetas.nodes.length} nós)`);
