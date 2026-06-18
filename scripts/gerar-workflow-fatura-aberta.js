// Gera workflows/fatura-aberta.json e workflows/teste-fatura-aberta.json a partir da
// lógica testada (workflows/src/fatura-aberta.js). Rodar: node scripts/gerar-workflow-fatura-aberta.js
// Spec: gstack/specs/fatura-aberta-projecao.md
//
// fatura-aberta trata /faturaaberta e /seedparcelas (despachados pelo roteador-central
// via Execute Workflow). Os provisórios vivem na aba PRÓPRIA `FaturaAberta` (snapshot =
// clear+write, não toca Lançamentos). O seed casa as parcelas coladas com a fatura aberta
// e grava a aba `Parcelas`. O harness teste-fatura-aberta roda em DRY-RUN: injeta o estado
// (faturaAberta) via `estado` e devolve a DECISÃO no corpo HTTP, sem tocar Sheets/Telegram.
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const faturaSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "fatura-aberta.js"), "utf-8")
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

// Limpa o corpo de uma aba (mantém o cabeçalho) via values:clear.
const httpSheetsClear = (nome, range, pos) => ({
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  ...RETRY,
  parameters: {
    method: "POST",
    url:
      "=https://sheets.googleapis.com/v4/spreadsheets/{{ $env.GOOGLE_SHEETS_ID }}/values/" +
      encodeURIComponent(range) +
      ":clear",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleApi",
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

const noOp = (nome, pos) => ({ name: nome, type: "n8n-nodes-base.noOp", typeVersion: 1, position: pos, parameters: {} });

// ════════════════════════════════════════════════════════════════════
// Decidir: roteia acao (fatura-aberta | seed-parcelas) e emite o item.
// valueRanges: 0=FaturaAberta 1=Parcelas
// ════════════════════════════════════════════════════════════════════
const codigoDecidir = faturaSrc + [
  "",
  "// ── Glue: roteia acao (fatura-aberta | seed-parcelas) ──",
  SRC_PARA_OBJETOS,
  "const e = $('Início').first().json;",
  "const acao = String(e.acao || '');",
  "let inj = null; try { if (e.estado) inj = JSON.parse(e.estado); } catch (x) {}",
  "const dry = !!inj; // harness: estado injetado → dry-run (devolve decisão, não escreve)",
  "const faObjs = dry ? (inj.faturaAberta || []) : paraObjetos(0);",
  "const stripCmd = (t) => String(t || '').replace(/^\\/\\S+[ \\t]*/, '');",
  "const brl = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });",
  "let saida = [];",
  "",
  "if (acao === 'fatura-aberta') {",
  "  const parse = parseFaturaAberta(stripCmd(e.texto));",
  "  if (parse.total === null) {",
  "    saida.push({ json: { fase: 'avisar', texto: '⚠️ Não achei \"Total dessa fatura\" no texto. Copie a fatura aberta do app web do C6 (Ctrl+C) e cole após /faturaaberta.' } });",
  "  } else {",
  "    const venc = mesAnoParaVencimento(parse.competencia_label);",
  "    if (!venc) {",
  "      saida.push({ json: { fase: 'avisar', texto: '⚠️ Não identifiquei o mês/ano da fatura (linha tipo \"julho de 2026\").' } });",
  "    } else {",
  "      const rows = montarProvisorios(parse, venc);",
  "      const ck = parse.checksum;",
  "      let txt;",
  "      if (ck.bate) txt = '✅ Fatura aberta de ' + venc + ' capturada.\\n' + rows.length + ' lançamentos · total ' + brl(ck.somado) + ' (confere com o C6).';",
  "      else if (ck.diferenca > 0) txt = '⚠️ Capturei ' + rows.length + ' lançamentos (' + brl(ck.somado) + '), mas faltam ' + brl(ck.diferenca) + ' para o Total (' + brl(ck.total) + ').\\nProvável captura incompleta — role a fatura inteira e cole de novo. Gravado como rascunho (fora do planejamento até fechar).';",
  "      else txt = '⚠️ A soma (' + brl(ck.somado) + ') passou do Total (' + brl(ck.total) + ') em ' + brl(-ck.diferenca) + ' — possível estorno/duplicata. Gravado como rascunho.';",
  "      if (parse.avisos.length) txt += '\\nObs: ' + parse.avisos.join('; ');",
  "      saida.push({ json: { fase: 'gravar-fatura', rows, texto: txt } });",
  "    }",
  "  }",
  "} else if (acao === 'seed-parcelas') {",
  "  const { entradas, avisos } = parseSeedParcelas(stripCmd(e.texto));",
  "  const cicloRef = faObjs.length ? String(faObjs[0].ciclo) : '';",
  "  if (!cicloRef) {",
  "    saida.push({ json: { fase: 'avisar', texto: '⚠️ Capture a fatura aberta primeiro (/faturaaberta) — preciso dela para casar as parcelas.' } });",
  "  } else if (!entradas.length) {",
  "    saida.push({ json: { fase: 'avisar', texto: '⚠️ Nenhuma parcela válida. Uma por linha: \"ESTABELECIMENTO | N/M\" (ex.: CLUBEW | 1/12).' + (avisos.length ? '\\n' + avisos.join('; ') : '') } });",
  "  } else {",
  "    const parcelados = faObjs.filter((r) => String(r.parcelas_total || '') !== '').map((r) => ({ estabelecimento: r.estabelecimento, valor: Number(r.valor), parcelas_total: Number(r.parcelas_total) }));",
  "    const est = montarEstadoParcelas(entradas, parcelados, cicloRef);",
  "    const rows = est.rows.map((r) => ({ estabelecimento: r.estabelecimento, valor: r.valor, M: r.M, N_no_seed: r.N_no_seed, ciclo_referencia: r.ciclo_referencia }));",
  "    const todos = avisos.concat(est.avisos);",
  "    let txt = rows.length ? ('🌱 Seed salvo: ' + rows.length + ' parcela(s) rastreada(s) no ciclo ' + cicloRef + '.') : '⚠️ Nenhuma parcela casou com a fatura aberta.';",
  "    if (todos.length) txt += '\\nObs: ' + todos.join('; ');",
  "    saida.push({ json: { fase: rows.length ? 'gravar-parcelas' : 'avisar', rows, texto: txt } });",
  "  }",
  "}",
  "",
  "const modo = dry ? 'teste' : 'real';",
  "return saida.map((s) => ({ json: { ...s.json, modo } }));",
].join("\n");

// ════════════════════════════════════════════════════════════════════
// Workflow 1: fatura-aberta
// ════════════════════════════════════════════════════════════════════
const wfFatura = {
  id: "FinFaturaAbert01",
  name: "fatura-aberta",
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
            { name: "estado", type: "string" },
          ],
        },
      },
    },
    lerDados(["'FaturaAberta'!A:G", "'Parcelas'!A:E"], [200, 0]),
    codeNode("Decidir", codigoDecidir, [400, 0]),
    ifString("Teste?", "={{ $json.modo }}", "teste", [600, 0]),
    noOp("Saída Teste", [800, -160]),

    // ── Produção: gravar fatura ──
    ifString("Gravar Fatura?", "={{ $json.fase }}", "gravar-fatura", [800, 120]),
    httpSheetsClear("Limpar FaturaAberta", "FaturaAberta!A2:G", [1000, 40]),
    codeNode("Linhas Fatura", "return $('Decidir').first().json.rows.map((r) => ({ json: r }));", [1200, 40]),
    sheetsAppend("Inserir Fatura", "FaturaAberta", [1400, 40]),
    // Colapsa os N itens inseridos em 1 → o report dispara UMA vez (não por linha).
    codeNode("Resumo Fatura", "return [{ json: { texto: $('Decidir').first().json.texto } }];", [1600, 40]),
    telegramMsg("Reportar Fatura", "={{ $json.texto }}", [1800, 40]),

    // ── Produção: gravar parcelas (seed) ──
    ifString("Gravar Parcelas?", "={{ $json.fase }}", "gravar-parcelas", [1000, 220]),
    httpSheetsClear("Limpar Parcelas", "Parcelas!A2:E", [1200, 220]),
    codeNode("Linhas Parcelas", "return $('Decidir').first().json.rows.map((r) => ({ json: r }));", [1400, 220]),
    sheetsAppend("Inserir Parcelas", "Parcelas", [1600, 220]),
    codeNode("Resumo Parcelas", "return [{ json: { texto: $('Decidir').first().json.texto } }];", [1800, 220]),
    telegramMsg("Reportar Parcelas", "={{ $json.texto }}", [2000, 220]),

    // ── Avisos ──
    ifString("Avisar?", "={{ $json.fase }}", "avisar", [1200, 400]),
    telegramMsg("Enviar Aviso", "={{ $json.texto }}", [1400, 400]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados", type: "main", index: 0 }]] },
    "Ler Dados": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    "Decidir": { main: [[{ node: "Teste?", type: "main", index: 0 }]] },
    "Teste?": {
      main: [
        [{ node: "Saída Teste", type: "main", index: 0 }],
        [{ node: "Gravar Fatura?", type: "main", index: 0 }],
      ],
    },
    "Gravar Fatura?": {
      main: [
        [{ node: "Limpar FaturaAberta", type: "main", index: 0 }],
        [{ node: "Gravar Parcelas?", type: "main", index: 0 }],
      ],
    },
    "Limpar FaturaAberta": { main: [[{ node: "Linhas Fatura", type: "main", index: 0 }]] },
    "Linhas Fatura": { main: [[{ node: "Inserir Fatura", type: "main", index: 0 }]] },
    "Inserir Fatura": { main: [[{ node: "Resumo Fatura", type: "main", index: 0 }]] },
    "Resumo Fatura": { main: [[{ node: "Reportar Fatura", type: "main", index: 0 }]] },
    "Gravar Parcelas?": {
      main: [
        [{ node: "Limpar Parcelas", type: "main", index: 0 }],
        [{ node: "Avisar?", type: "main", index: 0 }],
      ],
    },
    "Limpar Parcelas": { main: [[{ node: "Linhas Parcelas", type: "main", index: 0 }]] },
    "Linhas Parcelas": { main: [[{ node: "Inserir Parcelas", type: "main", index: 0 }]] },
    "Inserir Parcelas": { main: [[{ node: "Resumo Parcelas", type: "main", index: 0 }]] },
    "Resumo Parcelas": { main: [[{ node: "Reportar Parcelas", type: "main", index: 0 }]] },
    "Avisar?": { main: [[{ node: "Enviar Aviso", type: "main", index: 0 }]] },
  },
};

// ════════════════════════════════════════════════════════════════════
// Workflow 2: teste-fatura-aberta (harness dry-run)
// ════════════════════════════════════════════════════════════════════
const wfTeste = {
  id: "FinTesteFatura01",
  name: "teste-fatura-aberta",
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  nodes: [
    {
      name: "Webhook Teste",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "f1aacea1-0007-4000-8000-financeiro07",
      parameters: { httpMethod: "POST", path: "teste-fatura-aberta", responseMode: "lastNode", options: {} },
    },
    {
      name: "Chamar Fatura",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [200, 0],
      parameters: {
        workflowId: { __rl: true, mode: "id", value: "FinFaturaAbert01", cachedResultName: "fatura-aberta" },
        workflowInputs: {
          mappingMode: "defineBelow",
          value: {
            acao: "={{ $json.body.acao }}",
            texto: "={{ $json.body.texto || '' }}",
            estado: "={{ $json.body.estado ? JSON.stringify($json.body.estado) : '' }}",
          },
          matchingColumns: [],
          schema: [
            { id: "acao", displayName: "acao", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "texto", displayName: "texto", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
            { id: "estado", displayName: "estado", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string" },
          ],
        },
        mode: "once",
        options: { waitForSubWorkflow: true },
      },
    },
  ],
  connections: {
    "Webhook Teste": { main: [[{ node: "Chamar Fatura", type: "main", index: 0 }]] },
  },
};

// ── grava os dois ────────────────────────────────────────────────────
for (const wf of [wfFatura, wfTeste]) {
  wf.nodes.forEach((n, i) => {
    n.id = `${wf.id.toLowerCase().slice(0, 10)}-${String(i + 1).padStart(2, "0")}`;
  });
  const destino = path.join(RAIZ, "workflows", `${wf.name}.json`);
  fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + "\n");
  console.log(`OK: ${destino} (${wf.nodes.length} nós)`);
}
