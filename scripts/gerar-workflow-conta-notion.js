// Gera workflows-harumi/ingestao-csv-conta.json — variante Notion (Fase A) do gerador
// original (scripts/gerar-workflow-conta.js). Reaproveita o parser puro tal como é
// (workflows/src/parser-conta.js); só a camada de I/O (Sheets → Notion) muda.
// Rodar: node scripts/gerar-workflow-conta-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const parserSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "parser-conta.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// filtrarJaImportados precisa do histórico origem=conta inteiro (marco d'água por
// data_original) — filtra por Origem=conta no servidor, igual à variante cartão.
const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: lê Dicionário (origem=conta) e Lançamentos (origem=conta, p/ marco d'água) ──",
  "const filtroConta = { property: 'Origem', select: { equals: 'conta' } };",
  "const [dicionario, lancamentosExistentes] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_DICIONARIO, filtroConta),",
  "  notionQueryAll($env.NOTION_DB_LANCAMENTOS, filtroConta),",
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
  "  const r = processarExtrato(String(entrada.csv || ''), String(entrada.nome_arquivo || ''), dicionario, metas);",
  "  const dedup = filtrarJaImportados(r.lancamentos, existentes, { inicio: r.resumo.periodo_inicio, fim: r.resumo.periodo_fim });",
  "  const novos = dedup.novos;",
  "  const round2 = (x) => Math.round(x * 100) / 100;",
  "  const ent = novos.filter((l) => l.tipo === 'entrada');",
  "  const sai = novos.filter((l) => l.tipo === 'saída');",
  "  const resumo_novos = { quantidade: novos.length,",
  "    entradas: { n: ent.length, total: round2(ent.reduce((s, l) => s + l.valor, 0)) },",
  "    saidas: { n: sai.length, total: round2(sai.reduce((s, l) => s + l.valor, 0)) } };",
  "  const bloqueada = dedup.situacao === 'ja_importado' || dedup.situacao === 'retroativo';",
  "  let mensagem_bloqueio = '';",
  "  if (dedup.situacao === 'ja_importado') {",
  "    mensagem_bloqueio = '✅ Nenhum lançamento novo (extrato já importado até ' + dedup.marco + ').';",
  "  } else if (dedup.situacao === 'retroativo') {",
  "    mensagem_bloqueio = '⚠️ Este extrato (' + r.resumo.periodo_inicio + ' a ' + r.resumo.periodo_fim +",
  "      ') é anterior ao último lançamento já importado (' + dedup.marco +",
  "      '). Nada foi gravado — para reconciliar um período antigo, importe manualmente.';",
  "  }",
  "  return [{ json: { ok: true, bloqueada, mensagem_bloqueio, situacao: dedup.situacao,",
  "    marco: dedup.marco, ignorados_n: dedup.ignorados.length, novos, resumo_novos, ...r } }];",
  "} catch (e) {",
  "  return [{ json: { ok: false, erro: e.message } }];",
  "}",
].join("\n");

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
        { leftValue: expressao, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } },
      ],
    },
  },
});

const workflow = {
  id: "FinIngestContNo1",
  name: "ingestao-csv-conta (Notion)",
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
      name: "Parser Extrato",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [800, 0],
      parameters: { jsCode: parserSrc + notionMapSrc + glueParser },
    },
    ifBool("Parse OK?", "={{ $json.ok }}", [1000, 0]),
    telegramMsg("Notificar Erro", "=⚠️ ingestao-csv-conta (Notion) falhou: {{ $json.erro }}", [1200, 200]),
    ifBool("Já Importado?", "={{ $json.bloqueada }}", [1200, 0]),
    {
      name: "Linhas Log Bloqueado",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1400, 120],
      parameters: {
        jsCode: [
          "const p = $('Parser Extrato').first().json;",
          "return [{ json: { timestamp: new Date().toISOString(), acao: 'importacao_bloqueada',",
          "  entidade: 'Lançamentos', valor_anterior: p.situacao + ' (marco ' + (p.marco || '-') + ')',",
          "  valor_novo: 'extrato ' + p.resumo.periodo_inicio + ' a ' + p.resumo.periodo_fim +",
          "  ' — nenhum lancamento novo', origem: 'conta' } }];",
        ].join("\n"),
      },
    },
    {
      name: "Gravar Log Bloqueado",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1600, 120],
      parameters: { jsCode: codigoGravar("Linhas Log Bloqueado", "NOTION_DB_LOG", "propsDeLog") },
    },
    telegramMsg("Avisar Bloqueado", "={{ $('Parser Extrato').first().json.mensagem_bloqueio }}", [1800, 120]),
    {
      name: "Confirmação",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [1000, -100],
      parameters: {
        operation: "sendAndWait",
        chatId: "={{ $env.TELEGRAM_CHAT_ID }}",
        message:
          "=🏦 Extrato de {{ $json.resumo.periodo_inicio }} a {{ $json.resumo.periodo_fim }}\n" +
          "{{ $json.resumo_novos.quantidade }} novos lançamentos" +
          "{{ $json.ignorados_n ? ' (' + $json.ignorados_n + ' ignorados — anteriores ao último lançamento importado, ' + $json.marco + ')' : '' }}: " +
          "{{ $json.resumo_novos.entradas.n }} entradas (R$ {{ $json.resumo_novos.entradas.total }}) e " +
          "{{ $json.resumo_novos.saidas.n }} saídas (R$ {{ $json.resumo_novos.saidas.total }})." +
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
    ifBool("Aprovado?", "={{ $json.data.approved }}", [1200, -100]),
    {
      name: "Linhas Lançamentos",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1400, -200],
      parameters: { jsCode: "return $('Parser Extrato').first().json.novos.map((l) => ({ json: l }));" },
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
          "const p = $('Parser Extrato').first().json;",
          "const agora = new Date().toISOString();",
          "const logs = [{ json: { timestamp: agora, acao: 'importacao_confirmada', entidade: 'Lançamentos',",
          "  valor_anterior: p.ignorados_n ? p.ignorados_n + ' ignorados (anteriores a ' + p.marco + ')' : '',",
          "  valor_novo: p.resumo_novos.quantidade + ' lançamentos (extrato ' +",
          "  p.resumo.periodo_inicio + ' a ' + p.resumo.periodo_fim + ')',",
          "  origem: 'conta' } }];",
          "for (const a of p.avisos) {",
          "  logs.push({ json: { timestamp: agora, acao: 'aviso_importacao', entidade: 'Lançamentos',",
          "    valor_anterior: '', valor_novo: a, origem: 'conta' } });",
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
      "=✅ Importação concluída: {{ $('Parser Extrato').first().json.resumo_novos.quantidade }} lançamentos gravados no Notion.\n" +
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
          "const p = $('Parser Extrato').first().json;",
          "return [{ json: { timestamp: new Date().toISOString(), acao: 'importacao_cancelada',",
          "  entidade: 'Lançamentos', valor_anterior: '',",
          "  valor_novo: p.resumo_novos.quantidade + ' lançamentos descartados', origem: 'conta' } }];",
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
    "Ler Dados (Notion)": { main: [[{ node: "Parser Extrato", type: "main", index: 0 }]] },
    "Parser Extrato": { main: [[{ node: "Parse OK?", type: "main", index: 0 }]] },
    "Parse OK?": {
      main: [
        [{ node: "Já Importado?", type: "main", index: 0 }],
        [{ node: "Notificar Erro", type: "main", index: 0 }],
      ],
    },
    "Já Importado?": {
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

workflow.nodes.forEach((n, i) => { n.id = `fin-conta-notion-${String(i + 1).padStart(2, "0")}`; });

const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
const destino = path.join(destinoDir, "ingestao-csv-conta.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
