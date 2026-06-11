// Gera workflows/ingestao-csv-cartao.json a partir do parser testado
// (workflows/src/parser-cartao.js) + nós de Sheets/Telegram.
// Rodar: node scripts/gerar-workflow-cartao.js
// Após importar no n8n: re-vincular as credenciais "Google Sheets SA" e "Telegram Bot".
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const parserSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "parser-cartao.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const glue = [
  "",
  "// ── Glue do Code node (entradas vêm dos nós anteriores) ──",
  "const entrada = $('Início').first().json;",
  "const dicionario = $('Ler Dicionário').all()",
  "  .map((i) => i.json)",
  "  .filter((r) => String(r.origem || '').trim() === 'cartao')",
  "  .map((r) => ({ chave: String(r.descricao_original || ''), categoria: String(r.categoria_mapeada || '') }));",
  "const metas = $('Ler Metas').all()",
  "  .map((i) => i.json)",
  "  .filter((m) => String(m.status || '').trim() === 'ativa')",
  "  .map((m) => ({ nome: String(m.nome || '') }));",
  "try {",
  "  const r = processarFatura(String(entrada.csv || ''), String(entrada.nome_arquivo || ''), dicionario, metas);",
  "  return [{ json: { ok: true, ...r } }];",
  "} catch (e) {",
  "  return [{ json: { ok: false, erro: e.message } }];",
  "}",
].join("\n");

// IDs fixos: casam com credentials/n8n-credentials-local.json (dev) e devem
// existir com os mesmos nomes na instância de produção (re-vincular se IDs diferirem)
const CRED_SHEETS = { googleApi: { id: "FinSheetsSA00001", name: "Google Sheets SA" } };
const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };

const sheetsRead = (nome, aba, pos) => ({
  name: nome,
  type: "n8n-nodes-base.googleSheets",
  typeVersion: 4.5,
  position: pos,
  parameters: {
    authentication: "serviceAccount",
    operation: "read",
    documentId: { __rl: true, mode: "id", value: "={{ $env.GOOGLE_SHEETS_ID }}" },
    sheetName: { __rl: true, mode: "name", value: aba },
    options: {},
  },
  credentials: CRED_SHEETS,
});

const sheetsAppend = (nome, aba, pos) => ({
  name: nome,
  type: "n8n-nodes-base.googleSheets",
  typeVersion: 4.5,
  position: pos,
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

const workflow = {
  id: "FinIngestCartao1",
  name: "ingestao-csv-cartao",
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
    sheetsRead("Ler Dicionário", "Dicionário", [200, 0]),
    sheetsRead("Ler Metas", "Metas", [400, 0]),
    {
      name: "Parser Fatura",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [600, 0],
      parameters: { jsCode: parserSrc + glue },
    },
    {
      name: "Parse OK?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [800, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 2 },
          combinator: "and",
          conditions: [
            {
              leftValue: "={{ $json.ok }}",
              rightValue: "",
              operator: { type: "boolean", operation: "true", singleValue: true },
            },
          ],
        },
      },
    },
    telegramMsg(
      "Notificar Erro",
      "=⚠️ ingestao-csv-cartao falhou: {{ $json.erro }}",
      [1000, 200]
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
          values: {
            approvalType: "double",
            approveLabel: "✅ Confirmar",
            disapproveLabel: "❌ Cancelar",
          },
        },
        options: {},
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
            {
              leftValue: "={{ $json.data.approved }}",
              rightValue: "",
              operator: { type: "boolean", operation: "true", singleValue: true },
            },
          ],
        },
      },
    },
    {
      name: "Linhas Lançamentos",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1400, -200],
      parameters: {
        jsCode:
          "return $('Parser Fatura').first().json.lancamentos.map((l) => ({ json: l }));",
      },
    },
    sheetsAppend("Gravar Lançamentos", "Lançamentos", [1600, -200]),
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
          "  origem: 'ingestao-csv-cartao' } }];",
          "for (const c of p.cancelados) {",
          "  logs.push({ json: { timestamp: agora, acao: 'estorno_cancelado', entidade: 'Lançamentos',",
          "    valor_anterior: c.original.descricao + ' ' + c.original.data + ' R$ ' + c.original.valor,",
          "    valor_novo: c.estorno.descricao + ' ' + c.estorno.data + ' R$ ' + c.estorno.valor,",
          "    origem: 'ingestao-csv-cartao' } });",
          "}",
          "return logs;",
        ].join("\n"),
      },
    },
    sheetsAppend("Gravar Log", "Log", [2000, -200]),
    telegramMsg(
      "Avisar Sucesso",
      "=✅ Importação concluída: {{ $('Parser Fatura').first().json.resumo.quantidade }} lançamentos gravados.",
      [2200, -200]
    ),
    {
      name: "Chamar Categorização",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [2400, -200],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinCategoriza001", cachedResultName: "categorizacao-hibrida" },
        workflowInputs: { mappingMode: "defineBelow", value: {}, matchingColumns: [], schema: [] },
        mode: "once",
        options: { waitForSubWorkflow: false },
      },
    },
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
          "  valor_novo: p.resumo.quantidade + ' lançamentos descartados', origem: 'ingestao-csv-cartao' } }];",
        ].join("\n"),
      },
    },
    sheetsAppend("Gravar Log Cancelado", "Log", [1600, 0]),
    telegramMsg("Avisar Cancelado", "🚫 Importação cancelada. Nada foi gravado.", [1800, 0]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dicionário", type: "main", index: 0 }]] },
    "Ler Dicionário": { main: [[{ node: "Ler Metas", type: "main", index: 0 }]] },
    "Ler Metas": { main: [[{ node: "Parser Fatura", type: "main", index: 0 }]] },
    "Parser Fatura": { main: [[{ node: "Parse OK?", type: "main", index: 0 }]] },
    "Parse OK?": {
      main: [
        [{ node: "Confirmação", type: "main", index: 0 }],
        [{ node: "Notificar Erro", type: "main", index: 0 }],
      ],
    },
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
    "Avisar Sucesso": { main: [[{ node: "Chamar Categorização", type: "main", index: 0 }]] },
    "Linhas Log Cancelado": { main: [[{ node: "Gravar Log Cancelado", type: "main", index: 0 }]] },
    "Gravar Log Cancelado": { main: [[{ node: "Avisar Cancelado", type: "main", index: 0 }]] },
  },
};

workflow.nodes.forEach((n, i) => { n.id = `fin-cartao-${String(i + 1).padStart(2, "0")}`; });

const destino = path.join(RAIZ, "workflows", "ingestao-csv-cartao.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
