// Testes do parser do seed (carga única do livro-razão da conta) — fixtures sintéticas.
// No esqueleto público a integração contra os CSVs reais foi removida; rode-a
// localmente com seus próprios arquivos em `Dados CSV/` (gitignored).
// Rodar: node workflows/src/seed-parser.test.js
const assert = require("node:assert");
const {
  parseValorBR,
  parseLinhaSeed,
  herdarCategorias,
  processarSeed,
} = require("./seed-parser.js");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

const HOJE = "15/06/2026";

// ─── parseValorBR: pt-BR com $ e milhar-ponto/decimal-vírgula ────────
teste("parseValorBR: milhar e decimal", () => {
  assert.strictEqual(parseValorBR("$1.011,87"), 1011.87);
  assert.strictEqual(parseValorBR("$10.216,00"), 10216);
  assert.strictEqual(parseValorBR("$0,90"), 0.9);
  assert.strictEqual(parseValorBR("$24,90"), 24.9);
  assert.strictEqual(parseValorBR("$560,00"), 560);
});

teste("parseValorBR: lixo → erro", () => {
  assert.throws(() => parseValorBR("abc"));
  assert.throws(() => parseValorBR(""));
});

// ─── parseLinhaSeed: parse por índice, status por data, tipo do parâmetro ───
teste("parseLinhaSeed: data passada → confirmado; valor positivo; tipo carimbado", () => {
  const r = parseLinhaSeed(["06/10/2025", "$6.300,00", "Pagamento", "Deposito Pessoa A"], "entrada", HOJE);
  assert.strictEqual(r.data_competencia, "06/10/2025");
  assert.strictEqual(r.data_original, "06/10/2025");
  assert.strictEqual(r.descricao, "Pagamento");
  assert.strictEqual(r.titulo, "Pagamento");
  assert.strictEqual(r.valor, 6300);
  assert.strictEqual(r.categoria, "Deposito Pessoa A");
  assert.strictEqual(r.tipo, "entrada");
  assert.strictEqual(r.origem, "conta");
  assert.strictEqual(r.status, "confirmado");
  assert.strictEqual(r.id_meta, "");
});

teste("parseLinhaSeed: data futura → previsto", () => {
  const r = parseLinhaSeed(["10/07/2026", "$1.000,00", "parcela 3/3", ""], "saída", HOJE);
  assert.strictEqual(r.status, "previsto");
  assert.strictEqual(r.tipo, "saída");
  assert.strictEqual(r.categoria, "");
});

teste("parseLinhaSeed: hoje exatamente → confirmado (≤ hoje)", () => {
  const r = parseLinhaSeed(["15/06/2026", "$10,00", "x", "Outros"], "saída", HOJE);
  assert.strictEqual(r.status, "confirmado");
});

teste("parseLinhaSeed: data inválida → erro", () => {
  assert.throws(() => parseLinhaSeed(["2026-07-10", "$1,00", "x", "y"], "saída", HOJE));
});

// ─── herdarCategorias: preenche categoria vazia pela irmã (descricao exata) ───
teste("herdarCategorias: parcela futura em branco herda da irmã", () => {
  const linhas = [
    { descricao: "parcela exemplo", categoria: "Categoria X" },
    { descricao: "parcela exemplo", categoria: "Categoria X" },
    { descricao: "parcela exemplo", categoria: "" },
  ];
  const { linhas: out, avisos } = herdarCategorias(linhas);
  assert.strictEqual(out[2].categoria, "Categoria X");
  assert.strictEqual(avisos.length, 0);
});

teste("herdarCategorias: sufixo de parcela divergente ainda herda da irmã idêntica", () => {
  const linhas = [
    { descricao: "item exemplo", categoria: "Categoria X" },
    { descricao: "item exemplo 2/4", categoria: "Categoria X" },
    { descricao: "item exemplo", categoria: "" }, // herda da 1ª (descricao idêntica)
  ];
  const { linhas: out } = herdarCategorias(linhas);
  assert.strictEqual(out[2].categoria, "Categoria X");
});

teste("herdarCategorias: sem irmã categorizada → Outros + aviso", () => {
  const linhas = [{ descricao: "item sem irmã", categoria: "" }];
  const { linhas: out, avisos } = herdarCategorias(linhas);
  assert.strictEqual(out[0].categoria, "Outros");
  assert.strictEqual(avisos.length, 1);
});

// ─── processarSeed: integração sobre fixtures sintéticas (2 "CSVs") ──────
const ENTRADA = "Data;Valor;Descricao;Categoria\n" +
  "06/10/2025;$6.300,00;Pagamento;Deposito Pessoa A\n" +
  "07/05/2026;$1.000,00;Pagamento;Deposito Pessoa B";
const SAIDA = "Data;Valor;Descricao;Categoria\n" +
  "08/06/2026;$300,00;conta exemplo;Categoria A\n" +
  "10/07/2026;$500,00;parcela exemplo;Categoria B\n" +
  "10/07/2026;$500,00;parcela exemplo;"; // categoria vazia → herda da irmã

teste("processarSeed: contagens, herança e previstos por data futura", () => {
  const { linhas, resumo } = processarSeed(ENTRADA, SAIDA, HOJE);
  assert.strictEqual(resumo.entradas.n, 2);
  assert.strictEqual(resumo.saidas.n, 3);
  assert.strictEqual(linhas.length, 5);
  const vazias = linhas.filter((l) => l.tipo === "saída" && (l.categoria || "") === "");
  assert.strictEqual(vazias.length, 0); // herança aplicada
  const previstos = linhas.filter((l) => l.status === "previsto");
  assert.strictEqual(previstos.length, 2); // as duas saídas 10/07/2026 > HOJE
  assert.strictEqual(resumo.previstos, previstos.length);
});

teste("processarSeed: resumo bate com soma independente dos valores", () => {
  const { linhas, resumo } = processarSeed(ENTRADA, SAIDA, HOJE);
  const soma = (t) => Math.round(linhas.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0) * 100) / 100;
  assert.strictEqual(resumo.entradas.total, soma("entrada"));
  assert.strictEqual(resumo.saidas.total, soma("saída"));
});

console.log(`\n${passou} testes passaram.`);
