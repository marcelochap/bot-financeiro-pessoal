// Gera workflows-harumi/fatura-aberta.json — variante Notion (Fase E) do gerador
// original (scripts/gerar-workflow-fatura-aberta.js). Reaproveita workflows/src/
// fatura-aberta.js integralmente (parseFaturaAberta/montarProvisorios/parseSeedParcelas/
// montarEstadoParcelas são agnósticos de Sheets/Notion). Trata /faturaaberta (colagem
// direta OU arquivo .txt — ambos despacham aqui com acao='fatura-aberta') e
// /seedparcelas. Sem o harness de dry-run nem o fatura-buffer (colagem partida em N
// mensagens pelo Telegram > 4096 chars) — escopo cortado nesta rodada; ver nota no
// commit. FaturaAberta/Parcelas são snapshots (clear+write) — substituto Notion:
// arquiva TODAS as pages existentes, grava as novas (codigoArquivarTudo).
// Rodar: node scripts/gerar-workflow-fatura-aberta-notion.js
const fs = require("node:fs");
const path = require("node:path");
const { notionMapSrc, notionHttpSrc, codigoGravarPages, codigoArquivarTudo } = require("./notion-glue.js");

const RAIZ = path.resolve(__dirname, "..");
const faturaSrc = fs
  .readFileSync(path.join(RAIZ, "workflows", "src", "fatura-aberta.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

const CRED_TELEGRAM = { telegramApi: { id: "FinTelegramBotHarumi01", name: "Telegram Bot (Harumi)" } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const codeNode = (nome, jsCode, pos, extra = {}) => ({
  name: nome, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode }, ...extra,
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
      conditions: [{ leftValue: esquerda, rightValue: valor, operator: { type: "string", operation: "equals" } }],
    },
  },
});

const telegramMsg = (nome, texto, pos) => ({
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  parameters: { chatId: "={{ $env.TELEGRAM_CHAT_ID_HARUMI }}", text: texto, additionalFields: { appendAttribution: false } },
  credentials: CRED_TELEGRAM,
});

// ════════════════════════════════════════════════════════════════════
const codigoLerDados = [
  notionHttpSrc,
  "",
  "// ── Glue: lê FaturaAberta + Parcelas (estado atual, pra casar o seed) ──",
  "const [faturaAberta, parcelas] = await Promise.all([",
  "  notionQueryAll($env.NOTION_DB_FATURA_ABERTA),",
  "  notionQueryAll($env.NOTION_DB_PARCELAS),",
  "]);",
  "return [{ json: { faturaAberta, parcelas } }];",
].join("\n");

const codigoDecidir = faturaSrc + notionMapSrc + "\n" + [
  "",
  "// ── Glue: roteia acao (fatura-aberta | seed-parcelas) ──",
  "const e = $('Início').first().json;",
  "const acao = String(e.acao || '');",
  "const brutos = $('Ler Dados (Notion)').first().json;",
  "const faObjs = brutos.faturaAberta.map(paraObjetoFaturaAberta);",
  "const stripCmd = (t) => String(t || '').replace(/^\\/\\S+[ \\t]*/, '');",
  "const brl = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });",
  "let saida = [];",
  "",
  "if (acao === 'fatura-aberta') {",
  "  const parse = parseFaturaAberta(stripCmd(e.texto));",
  "  if (parse.total === null) {",
  "    saida.push({ json: { fase: 'avisar', texto: '⚠️ Não achei \"Total dessa fatura\" no texto. Envie a fatura aberta do app web do C6 — colando após /faturaaberta ou como arquivo .txt.' } });",
  "  } else {",
  "    const venc = mesAnoParaVencimento(parse.competencia_label);",
  "    if (!venc) {",
  "      saida.push({ json: { fase: 'avisar', texto: '⚠️ Não identifiquei o mês/ano da fatura (linha tipo \"julho de 2026\").' } });",
  "    } else {",
  "      const rows = montarProvisorios(parse, venc);",
  "      const ck = parse.checksum;",
  "      let txt;",
  "      if (ck.bate) txt = '✅ Fatura aberta de ' + venc + ' capturada.\\n' + rows.length + ' lançamentos · total ' + brl(ck.somado) + ' (confere com o C6).';",
  "      else if (ck.diferenca > 0) txt = '⚠️ Capturei ' + rows.length + ' lançamentos (' + brl(ck.somado) + '), mas faltam ' + brl(ck.diferenca) + ' para o Total (' + brl(ck.total) + ').\\nProvável captura incompleta — role a fatura inteira e cole de novo (ou mande como .txt). Gravado como rascunho (fora do planejamento até fechar).';",
  "      else txt = '⚠️ A soma (' + brl(ck.somado) + ') passou do Total (' + brl(ck.total) + ') em ' + brl(-ck.diferenca) + ' — possível estorno/duplicata. Gravado como rascunho.';",
  "      if (parse.avisos.length) txt += '\\nObs: ' + parse.avisos.join('; ');",
  "      saida.push({ json: { fase: 'gravar-fatura', rows, texto: txt } });",
  "    }",
  "  }",
  "} else if (acao === 'seed-parcelas') {",
  "  const { entradas, avisos } = parseSeedParcelas(stripCmd(e.texto));",
  "  const cicloRef = faObjs.length ? normalizarCiclo(faObjs[0].ciclo) : '';",
  "  if (!cicloRef) {",
  "    saida.push({ json: { fase: 'avisar', texto: '⚠️ Capture a fatura aberta primeiro (/faturaaberta) — preciso dela para casar as parcelas.' } });",
  "  } else if (!entradas.length) {",
  "    saida.push({ json: { fase: 'avisar', texto: '⚠️ Nenhuma parcela válida. Uma por linha: \"ESTABELECIMENTO;N/M\" (ex.: CLUBEW;1/12).' + (avisos.length ? '\\n' + avisos.join('; ') : '') } });",
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
  "return saida.map((s) => ({ json: s.json }));",
].join("\n");

const workflow = {
  id: "FinFaturaNoti01",
  name: "fatura-aberta (Notion — Harumi)",
  active: true,
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
        workflowInputs: { values: [{ name: "acao", type: "string" }, { name: "texto", type: "string" }] },
      },
    },
    codeNode("Ler Dados (Notion)", codigoLerDados, [200, 0], RETRY),
    codeNode("Decidir", codigoDecidir, [400, 0]),

    // ── Gravar fatura (FaturaAberta = snapshot do ciclo aberto) ──
    ifString("Gravar Fatura?", "={{ $json.fase }}", "gravar-fatura", [600, -120]),
    codeNode("Arquivar FaturaAberta", codigoArquivarTudo("NOTION_DB_FATURA_ABERTA"), [800, -200], RETRY),
    codeNode("Linhas Fatura", "return $('Decidir').first().json.rows.map((r) => ({ json: r }));", [1000, -200]),
    codeNode("Gravar Fatura", codigoGravarPages("Linhas Fatura", "NOTION_DB_FATURA_ABERTA", "propsDeFaturaAberta"), [1200, -200], RETRY),
    codeNode("Resumo Fatura", "return [{ json: { texto: $('Decidir').first().json.texto } }];", [1400, -200]),
    telegramMsg("Reportar Fatura", "={{ $json.texto }}", [1600, -200]),

    // ── Gravar parcelas (seed/reseed) ──
    ifString("Gravar Parcelas?", "={{ $json.fase }}", "gravar-parcelas", [600, 80]),
    codeNode("Arquivar Parcelas", codigoArquivarTudo("NOTION_DB_PARCELAS"), [800, 20], RETRY),
    codeNode("Linhas Parcelas", "return $('Decidir').first().json.rows.map((r) => ({ json: r }));", [1000, 20]),
    codeNode("Gravar Parcelas", codigoGravarPages("Linhas Parcelas", "NOTION_DB_PARCELAS", "propsDeParcela"), [1200, 20], RETRY),
    codeNode("Resumo Parcelas", "return [{ json: { texto: $('Decidir').first().json.texto } }];", [1400, 20]),
    telegramMsg("Reportar Parcelas", "={{ $json.texto }}", [1600, 20]),

    // ── Avisos (parse falhou, seed sem fatura, etc.) ──
    ifString("Avisar?", "={{ $json.fase }}", "avisar", [600, 260]),
    telegramMsg("Enviar Aviso", "={{ $json.texto }}", [800, 260]),
  ],
  connections: {
    "Início": { main: [[{ node: "Ler Dados (Notion)", type: "main", index: 0 }]] },
    "Ler Dados (Notion)": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    "Decidir": { main: [[{ node: "Gravar Fatura?", type: "main", index: 0 }]] },
    "Gravar Fatura?": {
      main: [
        [{ node: "Arquivar FaturaAberta", type: "main", index: 0 }],
        [{ node: "Gravar Parcelas?", type: "main", index: 0 }],
      ],
    },
    "Arquivar FaturaAberta": { main: [[{ node: "Linhas Fatura", type: "main", index: 0 }]] },
    "Linhas Fatura": { main: [[{ node: "Gravar Fatura", type: "main", index: 0 }]] },
    "Gravar Fatura": { main: [[{ node: "Resumo Fatura", type: "main", index: 0 }]] },
    "Resumo Fatura": { main: [[{ node: "Reportar Fatura", type: "main", index: 0 }]] },
    "Gravar Parcelas?": {
      main: [
        [{ node: "Arquivar Parcelas", type: "main", index: 0 }],
        [{ node: "Avisar?", type: "main", index: 0 }],
      ],
    },
    "Arquivar Parcelas": { main: [[{ node: "Linhas Parcelas", type: "main", index: 0 }]] },
    "Linhas Parcelas": { main: [[{ node: "Gravar Parcelas", type: "main", index: 0 }]] },
    "Gravar Parcelas": { main: [[{ node: "Resumo Parcelas", type: "main", index: 0 }]] },
    "Resumo Parcelas": { main: [[{ node: "Reportar Parcelas", type: "main", index: 0 }]] },
    "Avisar?": { main: [[{ node: "Enviar Aviso", type: "main", index: 0 }]] },
  },
};

workflow.nodes.forEach((n, i) => { n.id = `fin-fatura-notion-${String(i + 1).padStart(2, "0")}`; });
const destinoDir = path.join(RAIZ, "workflows-harumi");
fs.mkdirSync(destinoDir, { recursive: true });
const destino = path.join(destinoDir, "fatura-aberta.json");
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2) + "\n");
console.log(`OK: ${destino} (${workflow.nodes.length} nós)`);
