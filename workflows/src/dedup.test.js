// Testes da dedup de importação (emenda itens 3 e 4).
// Critérios: gstack/plans/dedup-importacao.md
// Rodar: node workflows/src/dedup.test.js
const assert = require("node:assert");
const { normalizarData, faturaJaImportada } = require("./parser-cartao.js");
const { normalizarData: normConta, filtrarJaImportados } = require("./parser-conta.js");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

// ─── normalizarData: três formatos + lixo ───────────────────────────
teste("normalizarData: serial 46183 → 10/06/2026", () => {
  assert.strictEqual(normalizarData(46183), "10/06/2026");
  assert.strictEqual(normalizarData("46183"), "10/06/2026"); // serial como string
});

teste("normalizarData: ISO e DD/MM/YYYY → 10/06/2026", () => {
  assert.strictEqual(normalizarData("2026-06-10"), "10/06/2026");
  assert.strictEqual(normalizarData("10/06/2026"), "10/06/2026");
});

teste("normalizarData: lixo/vazio/null → null", () => {
  assert.strictEqual(normalizarData("não é data"), null);
  assert.strictEqual(normalizarData(""), null);
  assert.strictEqual(normalizarData(null), null);
  assert.strictEqual(normalizarData(undefined), null);
});

teste("parser-conta exporta a mesma normalizarData (autocontida)", () => {
  assert.strictEqual(normConta(46153), "11/05/2026");
  assert.strictEqual(normConta("2026-05-11"), "11/05/2026");
});

// ─── faturaJaImportada (cartão) ─────────────────────────────────────
const fatura = (data, origem = "cartao") => ({ origem, data_competencia: data });

teste("fatura repetida (vencimento já presente) → bloqueada com contagem", () => {
  const existentes = [fatura("10/06/2026"), fatura("10/06/2026"), fatura("10/05/2026")];
  assert.deepStrictEqual(faturaJaImportada(existentes, "10/06/2026"), {
    bloqueada: true, quantidade: 2,
  });
});

teste("formatos mistos nas existentes (serial/ISO) ainda batem com o vencimento", () => {
  const existentes = [fatura(46183), fatura("2026-06-10")]; // ambas = 10/06/2026
  assert.strictEqual(faturaJaImportada(existentes, "10/06/2026").quantidade, 2);
});

teste("planilha vazia → não bloqueia", () => {
  assert.deepStrictEqual(faturaJaImportada([], "10/06/2026"), { bloqueada: false, quantidade: 0 });
});

teste("vencimento ausente nas existentes → não bloqueia", () => {
  const existentes = [fatura("10/05/2026"), fatura("10/04/2026")];
  assert.strictEqual(faturaJaImportada(existentes, "10/06/2026").bloqueada, false);
});

teste("linhas de conta com mesma data NÃO contam como fatura", () => {
  const existentes = [fatura("10/06/2026", "conta"), fatura("10/06/2026", "cartao")];
  assert.strictEqual(faturaJaImportada(existentes, "10/06/2026").quantidade, 1);
});

teste("data ilegível em existentes não trava (é ignorada)", () => {
  const existentes = [fatura("???"), fatura("10/06/2026")];
  assert.strictEqual(faturaJaImportada(existentes, "10/06/2026").quantidade, 1);
});

// ─── filtrarJaImportados (conta) ────────────────────────────────────
const lanc = (data) => ({ data_original: data, origem: "conta" });
const existe = (data) => ({ origem: "conta", data_original: data });

teste("vazia: nenhuma linha conta existente → importa tudo", () => {
  const novos = [lanc("01/06/2026"), lanc("02/06/2026")];
  const r = filtrarJaImportados(novos, [], { inicio: "01/06/2026", fim: "02/06/2026" });
  assert.strictEqual(r.situacao, "vazia");
  assert.strictEqual(r.novos.length, 2);
  assert.strictEqual(r.marco, null);
});

teste("tudo_novo: período inteiro após o marco → importa tudo, sem ignorados", () => {
  const existentes = [existe("10/06/2026")];
  const novos = [lanc("11/06/2026"), lanc("12/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "11/06/2026", fim: "12/06/2026" });
  assert.strictEqual(r.situacao, "tudo_novo");
  assert.strictEqual(r.novos.length, 2);
  assert.strictEqual(r.ignorados.length, 0);
  assert.strictEqual(r.marco, "10/06/2026");
});

teste("extensao: extrato estendido → importa só os > marco, conta os ignorados", () => {
  const existentes = [existe("05/06/2026"), existe("10/06/2026")];
  const novos = [lanc("08/06/2026"), lanc("10/06/2026"), lanc("11/06/2026"), lanc("13/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "01/06/2026", fim: "13/06/2026" });
  assert.strictEqual(r.situacao, "extensao");
  assert.deepStrictEqual(r.novos.map((l) => l.data_original), ["11/06/2026", "13/06/2026"]);
  assert.strictEqual(r.ignorados.length, 2); // 08 e 10 (= marco) ignorados
});

teste("ja_importado: extrato idêntico (fim = marco) → 0 novos, situacao ja_importado", () => {
  const existentes = [existe("01/06/2026"), existe("10/06/2026")];
  const novos = [lanc("01/06/2026"), lanc("10/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "01/06/2026", fim: "10/06/2026" });
  assert.strictEqual(r.situacao, "ja_importado");
  assert.strictEqual(r.novos.length, 0);
  assert.strictEqual(r.marco, "10/06/2026");
});

teste("retroativo: mês antigo após mês novo → 0 novos mas situacao retroativo (NÃO ja_importado)", () => {
  const existentes = [existe("01/06/2026"), existe("10/06/2026")]; // junho importado
  const novos = [lanc("01/05/2026"), lanc("31/05/2026")]; // maio chega depois
  const r = filtrarJaImportados(novos, existentes, { inicio: "01/05/2026", fim: "31/05/2026" });
  assert.strictEqual(r.situacao, "retroativo");
  assert.strictEqual(r.novos.length, 0); // nada entra silenciosamente...
  assert.strictEqual(r.ignorados.length, 2); // ...mas o glue bloqueia com mensagem honesta
});

teste("período ilegível + tudo ≤ marco → ja_importado (NÃO falso retroativo)", () => {
  const existentes = [existe("01/06/2026"), existe("10/06/2026")];
  const novos = [lanc("01/06/2026"), lanc("10/06/2026")]; // último = marco
  const r = filtrarJaImportados(novos, existentes, { inicio: "", fim: "" });
  assert.strictEqual(r.situacao, "ja_importado");
  assert.strictEqual(r.novos.length, 0);
});

teste("período ilegível + extrato inteiro < marco → retroativo (fallback nas linhas)", () => {
  const existentes = [existe("01/06/2026"), existe("10/06/2026")];
  const novos = [lanc("01/05/2026"), lanc("31/05/2026")]; // maio, todo anterior ao marco
  const r = filtrarJaImportados(novos, existentes, { inicio: "", fim: "" });
  assert.strictEqual(r.situacao, "retroativo");
  assert.strictEqual(r.novos.length, 0);
});

teste("data ilegível em existentes é ignorada no cálculo do marco", () => {
  const existentes = [existe("???"), existe("10/06/2026")];
  const novos = [lanc("11/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "11/06/2026", fim: "11/06/2026" });
  assert.strictEqual(r.marco, "10/06/2026");
  assert.strictEqual(r.novos.length, 1);
});

teste("formatos mistos: existentes em serial, lançamentos em DD/MM/YYYY", () => {
  const existentes = [existe(46183)]; // serial 10/06/2026
  const novos = [lanc("11/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "11/06/2026", fim: "11/06/2026" });
  assert.strictEqual(r.situacao, "tudo_novo");
  assert.strictEqual(r.marco, "10/06/2026");
});

// ─── emenda 15/06: marco ignora status=previsto (dep. do seed-conta-pessoal) ───
const existePrevisto = (data) => ({ origem: "conta", data_original: data, status: "previsto" });

teste("previsto NÃO envenena o marco: parcela futura 10/09 é ignorada", () => {
  const existentes = [existe("09/06/2026"), existePrevisto("10/09/2026")];
  const novos = [lanc("10/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "10/06/2026", fim: "10/06/2026" });
  assert.strictEqual(r.marco, "09/06/2026"); // o previsto 10/09 não entra no marco
  assert.strictEqual(r.situacao, "tudo_novo");
  assert.strictEqual(r.novos.length, 1);
});

teste("só linhas previstas existentes → marco vazio → vazia (importa tudo)", () => {
  const existentes = [existePrevisto("10/07/2026"), existePrevisto("10/08/2026")];
  const novos = [lanc("01/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "01/06/2026", fim: "01/06/2026" });
  assert.strictEqual(r.situacao, "vazia");
  assert.strictEqual(r.novos.length, 1);
  assert.strictEqual(r.marco, null);
});

teste("confirmado conta normalmente no marco (status presente, != previsto)", () => {
  const existentes = [{ origem: "conta", data_original: "10/06/2026", status: "confirmado" }];
  const novos = [lanc("11/06/2026")];
  const r = filtrarJaImportados(novos, existentes, { inicio: "11/06/2026", fim: "11/06/2026" });
  assert.strictEqual(r.marco, "10/06/2026");
  assert.strictEqual(r.situacao, "tudo_novo");
});

console.log(`\n${passou} testes passaram.`);
