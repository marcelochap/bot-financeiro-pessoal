// Testes do parser do seed (carga única do livro-razão real da conta).
// Critérios: gstack/specs/seed-conta-pessoal.md
// Rodar: node workflows/src/seed-parser.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
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
  const r = parseLinhaSeed(["06/10/2025", "$6.300,00", "Pagamento", "Deposito Marcelo"], "entrada", HOJE);
  assert.strictEqual(r.data_competencia, "06/10/2025");
  assert.strictEqual(r.data_original, "06/10/2025");
  assert.strictEqual(r.descricao, "Pagamento");
  assert.strictEqual(r.titulo, "Pagamento");
  assert.strictEqual(r.valor, 6300);
  assert.strictEqual(r.categoria, "Deposito Marcelo");
  assert.strictEqual(r.tipo, "entrada");
  assert.strictEqual(r.origem, "conta");
  assert.strictEqual(r.status, "confirmado");
  assert.strictEqual(r.id_meta, "");
});

teste("parseLinhaSeed: data futura → previsto", () => {
  const r = parseLinhaSeed(["10/07/2026", "$1.000,00", "BTS 3/3", ""], "saída", HOJE);
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
    { descricao: "passagem gol yukawas", categoria: "Casamento" },
    { descricao: "passagem gol yukawas", categoria: "Casamento" },
    { descricao: "passagem gol yukawas", categoria: "" },
  ];
  const { linhas: out, avisos } = herdarCategorias(linhas);
  assert.strictEqual(out[2].categoria, "Casamento");
  assert.strictEqual(avisos.length, 0);
});

teste("herdarCategorias: sufixo de parcela divergente (latam 2/4) ainda herda da irmã idêntica", () => {
  const linhas = [
    { descricao: "latam viagem natal", categoria: "Casamento" },
    { descricao: "latam viagem natal 2/4", categoria: "Casamento" },
    { descricao: "latam viagem natal", categoria: "" }, // herda da 1ª (descricao idêntica)
  ];
  const { linhas: out } = herdarCategorias(linhas);
  assert.strictEqual(out[2].categoria, "Casamento");
});

teste("herdarCategorias: sem irmã categorizada → Outros + aviso", () => {
  const linhas = [{ descricao: "calimed?", categoria: "" }];
  const { linhas: out, avisos } = herdarCategorias(linhas);
  assert.strictEqual(out[0].categoria, "Outros");
  assert.strictEqual(avisos.length, 1);
});

// ─── processarSeed: integração sobre os 2 CSVs reais (Latin-1) ───────
const RAIZ = path.resolve(__dirname, "..", "..");
const ENTRADA = fs.readFileSync(
  path.join(RAIZ, "Dados CSV", "lançamentos conta pessoal entrada.CSV"), "latin1"
);
const SAIDA = fs.readFileSync(
  path.join(RAIZ, "Dados CSV", "lançamentos conta pessoal saida.CSV"), "latin1"
);

teste("processarSeed: contagens reais 35 entradas + 408 saídas", () => {
  const { linhas, resumo } = processarSeed(ENTRADA, SAIDA, HOJE);
  assert.strictEqual(resumo.entradas.n, 35);
  assert.strictEqual(resumo.saidas.n, 408);
  assert.strictEqual(linhas.length, 443);
});

teste("processarSeed: NENHUMA categoria vazia na saída (herança aplicada)", () => {
  const { linhas } = processarSeed(ENTRADA, SAIDA, HOJE);
  const vazias = linhas.filter((l) => l.tipo === "saída" && (l.categoria || "") === "");
  assert.strictEqual(vazias.length, 0);
});

teste("processarSeed: resumo bate com soma independente dos valores", () => {
  const { linhas, resumo } = processarSeed(ENTRADA, SAIDA, HOJE);
  const soma = (t) => Math.round(linhas.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0) * 100) / 100;
  assert.strictEqual(resumo.entradas.total, soma("entrada"));
  assert.strictEqual(resumo.saidas.total, soma("saída"));
});

teste("processarSeed: encoding Latin-1 decodificado (Alimentação com cedilha/acento)", () => {
  const { linhas } = processarSeed(ENTRADA, SAIDA, HOJE);
  assert.ok(linhas.some((l) => l.categoria === "Alimentação"));
  assert.ok(!linhas.some((l) => /�/.test(l.categoria) || /�/.test(l.descricao)));
});

teste("processarSeed: previstos só com data futura; confirmados existem", () => {
  const { linhas, resumo } = processarSeed(ENTRADA, SAIDA, HOJE);
  const previstos = linhas.filter((l) => l.status === "previsto");
  assert.ok(previstos.length > 0);
  assert.strictEqual(resumo.previstos, previstos.length);
  // todo previsto tem data > hoje (15/06/2026)
  const ord = (d) => { const [dd, mm, aa] = d.split("/"); return Number(`${aa}${mm}${dd}`); };
  assert.ok(previstos.every((l) => ord(l.data_competencia) > ord(HOJE)));
  // existe pelo menos um confirmado (ex.: condominio 08/06)
  assert.ok(linhas.some((l) => l.status === "confirmado"));
});

console.log(`\n${passou} testes passaram.`);
