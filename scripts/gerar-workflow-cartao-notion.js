// Gera workflows-harumi/ingestao-csv-cartao.json — variante Notion (Fase A) do gerador
// original (scripts/gerar-workflow-cartao.js). Reaproveita o parser puro tal como é
// (workflows/src/parser-cartao.js); só a camada de I/O (Sheets → Notion) muda.
// Rodar: node scripts/gerar-workflow-cartao-notion.js
// Após importar no n8n: configurar env vars NOTION_TOKEN/NOTION_VERSION/NOTION_DB_* e
// vincular a credencial "Telegram Bot" (bot da Harumi, token separado do de Marcelo).
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const parserSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "parser-cartao.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// Uma leitura combinada (Dicionário + Lançamentos existentes, ambos filtrados por
// Origem=cartao) num só Code node — mantém o espírito do "Ler Dados" único do
// original, mas via Query Database do Notion (sem batchGet multi-range equivalente).
// Metas fica de fora por ora (Fase C ainda não criou a database Metas no Notion);
// id_meta simplesmente fica "" com aviso — mesmo comportamento do parser p/ meta ausente.
const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: lê Dicionário (origem=cartao) e Lançamentos (origem=cartao, p/ dedup) ──",
  "const filtroCartao = { property: 'Origem', select: { equals: 'cartao' } };",
  "const [dicionario, lancamentosExistentes] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_DICIONARIO, filtroCartao),",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS, filtroCartao),",
  "]);",
  "return [{ json: { dicionario, lancamentos_existentes: lancamentosExistentes } }];",
].join("\n");

const glueParser = [
  "",
  "// ── Glue: Dicionário/Lançamentos existentes vêm de 'Ler Dados (Notion)' ──",
  "const entrada = $('Início').first().json;",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const dicionario = paraDicionarioChaveCategoria(brutos.dicionario.map(paraObjetoDicionario));",
  "const metas = []; // Fase C adiciona a database Metas no Notion",
  "const existentes = brutos.lancamentos_existentes.map(paraObjetoLancamento);",
  "try {",
  "  const r = processarFatura(String(entrada.csv || ''), String(entrada.nome_arquivo || ''), dicionario, metas);",
  "  const dedup = faturaJaImportada(existentes, r.resumo.vencimento);",
  "  return [{ json: { ok: true, bloqueada: dedup.bloqueada, ja_importadas: dedup.quantidade, ...r } }];",
  "} catch (e) {",
  "  return [{ json: { ok: false, erro: e.message } }];",
  "}",
].join("\n");

// Grava N pages sequencialmente (Notion não tem bulk-insert). Sequencial de propósito:
// evita estourar o rate limit (~3 req/s) quando a fatura tem muitos lançamentos.
const codigoGravar = (origemVar, dbEnvVar, propsFn) => [
  notionHttpSrc,
  notionMapSrc,
  "",
  `// ── Glue: cria uma page por item de '${origemVar}' na database ${dbEnvVar} ──`,
  "const itens = $input.all();",
  "const criadas = [];",
  "for (const item of itens) {",
  `  const page = await notionCreatePage($env.${dbEnvVar}, ${propsFn}(item.json));`,
  "  criadas.push(page);",
  "}",
  "return criadas.map((p) => ({ json: { notion_page_id: p.id } }));",
].join("\n");

const telegramMsg = (nome, texto, pos) => ({
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  parameters: {
    chatId: "={{ $env.TELEGRAM_CHAT_ID }}",
    text: texto,
    additionalFields: { appendAttribution: false },
  },
  credentials: CRED_TELEGRAM,
});

const workflow = {
  id: "FinIngestCartNo1",
  name: "ingestao-csv-cartao (Notion)",
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
            { name: "csv", type: "string" },
            { name: "nome_arquivo", type: "string" },
          ],
        },
      },
    },
    {
      name: "Ler Dados (Notion)",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [300, 0],
      ...RETRY,
      parameters: { jsCode: codigoLerDados },
    },
    {
      name: "Parser Fatura",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [800, 0],
      parameters: { jsCode: parserSrc + notionMapSrc + glueParser },
    },
    {
      name: "Parse OK?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [1000, -200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          combinator: "and",
          conditions: [
            { leftValue: "={{ $json.ok }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } },
          ],
        },
      },
    },
    telegramMsg("Notificar Erro", "=⚠️ ingestao-csv-cartao (Notion) falhou: {{ $json.erro }}", [1000, 200]),
    {
      name: "Já Importada?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [1000, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          combinator: "and",
          conditions: [
            { leftValue: "={{ $json.bloqueada }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } },
          ],
        },
      },
    },
    {
      name: "Linhas Log Bloqueado",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1200, 120],
      parameters: {
        jsCode: [
          "const p = $('Parser Fatura').first().json;",
          "return [{ json: { timestamp: new Date().toISOString(), acao: 'importacao_bloqueada',",
          "  entidade: 'Lançamentos', valor_anterior: 'vencimento ' + p.resumo.vencimento,",
          "  valor_novo: 'fatura ja importada (' + p.ja_importadas + ' lancamentos)',",
          "  origem: 'cartão' } }];",
        ].join("\n"),
      },
    },
    {
      name: "Gravar Log Bloqueado",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1400, 120],
      parameters: { jsCode: codigoGravar("Linhas Log Bloqueado", "NOTION_DB_LOG", "propsDeLog") },
    },
    telegramMsg(
      "Avisar Bloqueado",
      "=⚠️ Fatura com vencimento {{ $('Parser Fatura').first().json.resumo.vencimento }} já importada " +
        "({{ $('Parser Fatura').first().json.ja_importadas }} lançamentos no Notion). Nada foi gravado.\n" +
        "Para reimportar, apague as páginas dessa fatura na database Lançamentos.",
      [1600, 120]
    ),
    {
      name: "Confirmação",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [1000, -100],
      parameters: {
        operation: "sendAndWait",
        chatId: "={{ $env.TELEGRAM_CHAT_ID }}",
        message:
          "=📄 Fatura com vencimento {{ $json.resumo.vencimento }}\n" +
          "Encontrei {{ $json.resumo.quantidade }} lançamentos, total R$ {{ $json.resumo.total }}, " +
          "período {{ $json.resumo.periodo_inicio }} a {{ $json.resumo.periodo_fim }}.\n" +
          "{{ $json.resumo.pares_cancelados }} par(es) cancelado(s) automaticamente." +
          "{{ $json.avisos.length ? '\\n⚠️ ' + $json.avisos.join('; ') : '' }}\n" +
          "Confirmar?",
        responseType: "approval",
        approvalOptions: {
          values: { approvalType: "double", approveLabel: "✅ Confirmar", disapproveLabel: "❌ Cancelar" },
        },
        options: { appendAttribution: false },
      },
      credentials: CRED_TELEGRAM,
    },
    {
      name: "Aprovado?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [1200, -100],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          combinator: "and",
          conditions: [
            { leftValue: "={{ $json.data.approved }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } },
          ],
        },
      },
    },
    {
      name: "Linhas Lançamentos",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1400, -200],
      parameters: { jsCode: "return $('Parser Fatura').first().json.lancamentos.map((l) => ({ json: l }));" },
    },
    {
      name: "Gravar Lançamentos",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1600, -200],
      parameters: { jsCode: codigoGravar("Linhas Lançamentos", "NOTION_DB_LANCAMENTOS", "propsDeLancamento") },
    },
    {
      name: "Linhas Log",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1800, -200],
      parameters: {
        jsCode: [
          "const p = $('Parser Fatura').first().json;",
          "const agora = new Date().toISOString();",
          "const logs = [{ json: { timestamp: agora, acao: 'importacao_confirmada', entidade: 'Lançamentos',",
          "  valor_anterior: '', valor_novo: p.resumo.quantidade + ' lançamentos / R$ ' + p.resumo.total,",
          "  origem: 'cartão' } }];",
          "for (const c of p.cancelados) {",
          "  logs.push({ json: { timestamp: agora, acao: 'estorno_cancelado', entidade: 'Lançamentos',",
          "    valor_anterior: c.original.descricao + ' ' + c.original.data + ' R$ ' + c.original.valor,",
          "    valor_novo: c.estorno.descricao + ' ' + c.estorno.data + ' R$ ' + c.estorno.valor,",
          "    origem: 'cartão' } });",
          "}",
          "return logs;",
        ].join("\n"),
      },
    },
    {
      name: "Gravar Log",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [2000, -200],
      parameters: { jsCode: codigoGravar("Linhas Log", "NOTION_DB_LOG", "propsDeLog") },
    },
    telegramMsg(
      "Avisar Sucesso",
      "=✅ Importação concluída: {{ $('Parser Fatura').first().json.resumo.quantidade }} lançamentos gravados no Notion.\n" +
        "(Categorização automática chega na Fase B — por ora, categorize manualmente na database.)",
      [2200, -200]
    ),
    {
      name: "Linhas Log Cancelado",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1400, 0],
      parameters: {
        jsCode: [
          "const p = $('Parser Fatura').first().json;",
          "return [{ json: { timestamp: new Date().toISOString(), acao: 'importacao_cancelada',",
          "  entidade: 'Lançamentos', valor_anterior: '',",
          "  valor_novo: p.resumo.quantidade + ' lançamentos descartados', origem: 'cartão' } }];",
        ].join("\n"),
      },
    },
    {
      name: "Gravar Log Cancelado",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1600, 0],
      parameters: { jsCode: codigoGravar("Linhas Log Cancelado", "NOTION_DB_LOG", "propsDeLog") },
    },
    telegramMsg("Avisar Cancelado", "🚫 Importação cancelada. Nada foi gravado.", [1800, 0]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Parser Fatura", type: "main", index: 0 }]] },
    "Parser Fatura": { main: [[{ node: "Parse OK?", type: "main", index: 0 }]] },
    "Parse OK?": {
      main: [
        [{ node: "Já Importada?", type: "main", index: 0 }],
        [{ node: "Notificar Erro", type: "main", index: 0 }],
      ],
    },
    "Já Importada?": {
      main: [
        [{ node: "Linhas Log Bloqueado", type: "main", index: 0 }],
        [{ node: "Confirmação", type: "main", index: 0 }],
      ],
    },
    "Linhas Log Bloqueado": { main: [[{ node: "Gravar Log Bloqueado", type: "main", index: 0 }]] },
    "Gravar Log Bloqueado": { main: [[{ node: "Avisar Bloqueado", type: "main", index: 0 }]] },
    "Confirmação": { main: [[{ node: "Aprovado?", type: "main", index: 0 }]] },
    "Aprovado?": {
      main: [
        [{ node: "Linhas Lançamentos", type: "main", index: 0 }],
        [{ node: "Linhas Log Cancelado", type: "main", index: 0 }],
      ],
    },
    "Linhas Lançamentos": { main: [[{ node: "Gravar Lançamentos", type: "main", index: 0 }]] },
    "Gravar Lançamentos": { main: [[{ node: "Linhas Log", type: "main", index: 0 }]] },
    "Linhas Log": { main: [[{ node: "Gravar Log", type: "main", index: 0 }]] },
    "Gravar Log": { main: [[{ node: "Avisar Sucesso", type: "main", index: 0 }]] },
    "Linhas Log Cancelado": { main: [[{ node: "Gravar Log Cancelado", type: "main", index: 0 }]] },
    "Gravar Log Cancelado": { main: [[{ node: "Avisar Cancelado", type: "main", index: 0 }]] },
  },
};

workflow.nodes.forEach((n, i) => { n.id = `fin-cartao-notion-${String(i + 1).padStart(2, "0")}`; });

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
const destino = path.join(destinoDir, "ingestao-csv-cartao.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
