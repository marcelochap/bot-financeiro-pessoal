// Gera workflows/ingestao-csv-conta.json a partir do parser testado
// (workflows/src/parser-conta.js) + nós de Sheets/Telegram.
// Rodar: node scripts/gerar-workflow-conta.js
// Estrutura espelha gerar-workflow-cartao.js (unificar após primeira versão funcional).
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const parserSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "parser-conta.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

// Converte cada valueRange do batchGet (linhas com header) em objetos.
// Datas voltam como serial (UNFORMATTED_VALUE) — normalizarData trata.
const SRC_PARA_OBJETOS = [
  "const vr = ($json.valueRanges || []);",
  "const paraObjetos = (idx) => {",
  "  const v = (vr[idx] && vr[idx].values) || [];",
  "  if (v.length < 2) return [];",
  "  const h = v[0].map(String);",
  "  return v.slice(1).map((linha) => {",
  "    const o = {};",
  "    h.forEach((c, j) => { o[c] = linha[j] !== undefined ? linha[j] : ''; });",
  "    return o;",
  "  });",
  "};",
].join("\n");

const glue = [
  "",
  "// ── Glue do Code node (Dicionário/Metas/Lançamentos vêm de 'Ler Dados') ──",
  SRC_PARA_OBJETOS,
  "const entrada = $('Início').first().json;",
  "const dicionario = paraObjetos(0)",
  "  .filter((r) => String(r.origem || '').trim() === 'conta')",
  "  .map((r) => ({ chave: String(r.descricao_original || ''), categoria: String(r.categoria_mapeada || '') }));",
  "const metas = paraObjetos(1)",
  "  .filter((m) => String(m.status || '').trim() === 'ativa')",
  "  .map((m) => ({ nome: String(m.nome || '') }));",
  "const existentes = paraObjetos(2);",
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

const CRED_SHEETS = { googleApi: { id: "FinSheetsSA00001", name: "Google Sheets SA" } };
const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBot01", name: "Telegram Bot" } };

const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// Uma única leitura via values:batchGet (Dicionário+Metas+Lançamentos num só
// request) — evita a cota "Read requests per minute" que 3 reads separados
// estouravam. Mesmo padrão do cron de lembretes. Datas voltam como serial.
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
    // USER_ENTERED: o Sheets interpreta "DD/MM/YYYY" (locale pt_BR) como data
    // real, e não como texto — assim relatório/filtros enxergam a data. valor
    // já sai como número do parser, então não sofre reinterpretação de locale.
    options: { cellFormat: "USER_ENTERED" },
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
    // Remove o rodapé "sent automatically with n8n" de toda mensagem do bot.
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
        {
          leftValue: expressao,
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
    },
  },
});

const workflow = {
  id: "FinIngestConta01",
  name: "ingestao-csv-conta",
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
    lerDados(["'Dicionário'!A:D", "'Metas'!A:F", "'Lançamentos'!A:J"], [300, 0]),
    {
      name: "Parser Extrato",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [800, 0],
      parameters: { jsCode: parserSrc + glue },
    },
    ifBool("Parse OK?", "={{ $json.ok }}", [1000, 0]),
    telegramMsg(
      "Notificar Erro",
      "=⚠️ ingestao-csv-conta falhou: {{ $json.erro }}",
      [1200, 200]
    ),
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
          "  ' — nenhum lancamento novo', origem: 'ingestao-csv-conta' } }];",
        ].join("\n"),
      },
    },
    sheetsAppend("Gravar Log Bloqueado", "Log", [1600, 120]),
    telegramMsg(
      "Avisar Bloqueado",
      "={{ $('Parser Extrato').first().json.mensagem_bloqueio }}",
      [1800, 120]
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
          "=🏦 Extrato de {{ $json.resumo.periodo_inicio }} a {{ $json.resumo.periodo_fim }}\n" +
          "{{ $json.resumo_novos.quantidade }} novos lançamentos" +
          "{{ $json.ignorados_n ? ' (' + $json.ignorados_n + ' ignorados — anteriores ao último lançamento importado, ' + $json.marco + ')' : '' }}: " +
          "{{ $json.resumo_novos.entradas.n }} entradas (R$ {{ $json.resumo_novos.entradas.total }}) e " +
          "{{ $json.resumo_novos.saidas.n }} saídas (R$ {{ $json.resumo_novos.saidas.total }})." +
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
      parameters: {
        jsCode:
          "return $('Parser Extrato').first().json.novos.map((l) => ({ json: l }));",
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
          "const p = $('Parser Extrato').first().json;",
          "const agora = new Date().toISOString();",
          "const logs = [{ json: { timestamp: agora, acao: 'importacao_confirmada', entidade: 'Lançamentos',",
          "  valor_anterior: p.ignorados_n ? p.ignorados_n + ' ignorados (anteriores a ' + p.marco + ')' : '',",
          "  valor_novo: p.resumo_novos.quantidade + ' lançamentos (extrato ' +",
          "  p.resumo.periodo_inicio + ' a ' + p.resumo.periodo_fim + ')',",
          "  origem: 'ingestao-csv-conta' } }];",
          "for (const a of p.avisos) {",
          "  logs.push({ json: { timestamp: agora, acao: 'aviso_importacao', entidade: 'Lançamentos',",
          "    valor_anterior: '', valor_novo: a, origem: 'ingestao-csv-conta' } });",
          "}",
          "return logs;",
        ].join("\n"),
      },
    },
    sheetsAppend("Gravar Log", "Log", [2000, -200]),
    telegramMsg(
      "Avisar Sucesso",
      "=✅ Importação concluída: {{ $('Parser Extrato').first().json.resumo_novos.quantidade }} lançamentos gravados.",
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
          "const p = $('Parser Extrato').first().json;",
          "return [{ json: { timestamp: new Date().toISOString(), acao: 'importacao_cancelada',",
          "  entidade: 'Lançamentos', valor_anterior: '',",
          "  valor_novo: p.resumo_novos.quantidade + ' lançamentos descartados', origem: 'ingestao-csv-conta' } }];",
        ].join("\n"),
      },
    },
    sheetsAppend("Gravar Log Cancelado", "Log", [1600, 0]),
    telegramMsg("Avisar Cancelado", "🚫 Importação cancelada. Nada foi gravado.", [1800, 0]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Parser Extrato", type: "main", index: 0 }]] },
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
    "Avisar Sucesso": { main: [[{ node: "Chamar Categorização", type: "main", index: 0 }]] },
    "Linhas Log Cancelado": { main: [[{ node: "Gravar Log Cancelado", type: "main", index: 0 }]] },
    "Gravar Log Cancelado": { main: [[{ node: "Avisar Cancelado", type: "main", index: 0 }]] },
  },
};

workflow.nodes.forEach((n, i) => { n.id = `fin-conta-${String(i + 1).padStart(2, "0")}`; });

const destino = path.join(RAIZ, "workflows", "ingestao-csv-conta.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
