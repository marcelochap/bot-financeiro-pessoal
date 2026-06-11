// Testes do parser da fatura C6 cartão contra o CSV REAL + fixtures sintéticas.
// Critérios de sucesso: gstack/plans/ingestao-csv-cartao.md
// Rodar: node workflows/src/parser-cartao.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { processarFatura, vencimentoDoNome } = require("./parser-cartao.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const CSV_REAL = fs.readFileSync(path.join(RAIZ, "Dados CSV", "Fatura_2026-06-10.csv"), "utf-8");

// Subconjunto cartão do Dicionário semeado na planilha (gerar-planilha-inicial.py)
const DICIONARIO = [
  { chave: "COMERCIAL DE ALIM BOM", categoria: "Supermercado" },
  { chave: "PANNABREADPAESE", categoria: "Supermercado" },
  { chave: "ATACADAO DIA A DIA", categoria: "Supermercado" },
  { chave: "IFD*", categoria: "Alimentação" },
  { chave: "RESTAURANTE", categoria: "Alimentação" },
  { chave: "BURGER KING", categoria: "Alimentação" },
  { chave: "GIRAFFAS", categoria: "Alimentação" },
  { chave: "OUTBACK", categoria: "Alimentação" },
  { chave: "DIVINO FOGAO", categoria: "Alimentação" },
  { chave: "COCO BAMBU", categoria: "Alimentação" },
  { chave: "SPOTIFY", categoria: "Streams" },
  { chave: "GOL LINHAS", categoria: "Meta: Viagem Lua de Mel" },
  { chave: "LATAM AIR", categoria: "Meta: Viagem Lua de Mel" },
  { chave: "ARAJET", categoria: "Meta: Viagem Lua de Mel" },
  { chave: "CLICKBUS", categoria: "Meta: Viagem Lua de Mel" },
  { chave: "MERCADOLIVRE", categoria: "Compras" },
  { chave: "AMAZON", categoria: "Compras" },
];
const METAS = [
  { nome: "Viagem Lua de Mel" }, { nome: "Cama de Casal BH" },
  { nome: "Ar Condicionado Portátil" }, { nome: "Plantas" },
  { nome: "IPTU" }, { nome: "Casamento" },
];

const HEADER = "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)";
let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

// ─── CSV real ───────────────────────────────────────────────────────
const r = processarFatura(CSV_REAL, "Fatura_2026-06-10.csv", DICIONARIO, METAS);

teste("Inclusao de Pagamento (-8135,44) não vira lançamento", () => {
  assert.ok(!r.lancamentos.some((l) => l.descricao.includes("Inclusao de Pagamento")));
  assert.ok(!r.cancelados.some((c) => c.estorno.descricao.includes("Inclusao")));
});

teste("par Anuidade Diferenciada +98 / Estorno Tarifa -98 descartado e logado", () => {
  assert.ok(!r.lancamentos.some((l) => l.descricao.includes("Anuidade") || l.descricao.includes("Estorno Tarifa")));
  assert.ok(r.cancelados.some((c) => c.estorno.descricao === "Estorno Tarifa" && c.original.descricao.startsWith("Anuidade")));
});

teste("estorno MERCADOLIVRE cancela exatamente UM positivo; o outro segue normal", () => {
  // O arquivo tem 6 linhas MERCADOLIVRE: 3 de valores distintos (ficam), 2 positivos
  // de 251,64 (27/05 e 31/05) e 1 estorno -251,64 (31/05) que cancela só UM deles.
  const ml251 = r.lancamentos.filter((l) => l.descricao.startsWith("MERCADOLIVRE") && l.valor === 251.64);
  assert.strictEqual(ml251.length, 1, `esperado 1 positivo de 251,64 mantido, veio ${ml251.length}`);
  assert.strictEqual(ml251[0].data_original, "27/05/2026"); // o de 31/05 pareou (mais próximo do estorno)
  assert.strictEqual(ml251[0].categoria, "Compras");
  assert.ok(!r.lancamentos.some((l) => l.valor === -251.64), "estorno não pode sobrar");
  const cancelML = r.cancelados.filter((c) => c.estorno.descricao.startsWith("MERCADOLIVRE"));
  assert.strictEqual(cancelML.length, 1);
  assert.strictEqual(cancelML[0].original.data, "31/05/2026");
  const mlTodos = r.lancamentos.filter((l) => l.descricao.includes("MERCADOL"));
  assert.strictEqual(mlTodos.length, 4); // 108,87 + 99,43 + 89,00 + 251,64
});

teste("12 lançamentos parcelados mantidos com sufixo (n/m)", () => {
  const parcelados = r.lancamentos.filter((l) => / \(\d+\/\d+\)$/.test(l.descricao));
  assert.strictEqual(parcelados.length, 12, `esperado 12, veio ${parcelados.length}`);
});

teste("100% dos lançamentos com data_competencia = 10/06/2026", () => {
  assert.ok(r.lancamentos.every((l) => l.data_competencia === "10/06/2026"));
});

teste("GOL LINHAS → Meta: Viagem Lua de Mel com id_meta resolvido", () => {
  const gol = r.lancamentos.filter((l) => l.descricao.startsWith("GOL LINHAS"));
  assert.ok(gol.length > 0);
  assert.ok(gol.every((l) => l.categoria === "Meta: Viagem Lua de Mel" && l.id_meta === "Viagem Lua de Mel"));
  assert.strictEqual(r.avisos.length, 0);
});

teste("resumo: contagem/total/período consistentes (57 - 1 pagamento - 4 cancelados = 52)", () => {
  assert.strictEqual(r.resumo.quantidade, 52);
  assert.strictEqual(r.lancamentos.length, 52);
  assert.strictEqual(r.resumo.pares_cancelados, 2);
  assert.ok(r.lancamentos.every((l) => l.valor > 0), "valor sempre positivo");
  const liquido = Math.round(
    r.lancamentos.reduce((s, l) => s + (l.tipo === "saída" ? l.valor : -l.valor), 0) * 100
  ) / 100;
  assert.strictEqual(r.resumo.total, liquido);
  assert.ok(r.resumo.periodo_inicio && r.resumo.periodo_fim);
  assert.strictEqual(r.resumo.vencimento, "10/06/2026");
});

// ─── Fixtures sintéticas ────────────────────────────────────────────
teste("estorno SEM par é mantido como crédito (tipo entrada)", () => {
  const csv = [HEADER, `05/05/2026;MARCELO E HARUMI;1455;Compras;LOJA QUALQUER;Única;0;0;-50.00`].join("\n");
  const s = processarFatura(csv, "Fatura_2026-06-10.csv", DICIONARIO, METAS);
  assert.strictEqual(s.lancamentos.length, 1);
  assert.strictEqual(s.lancamentos[0].tipo, "entrada");
  assert.strictEqual(s.lancamentos[0].valor, 50); // convenção: valor sempre positivo
  assert.strictEqual(s.resumo.total, -50); // total líquido: crédito reduz a fatura
  assert.strictEqual(s.cancelados.length, 0);
});

teste("nome de arquivo fora do padrão → erro (notificável via Telegram)", () => {
  assert.throws(() => vencimentoDoNome("extrato-maio.csv"), /fora do padrão/);
});

teste("colunas inesperadas → erro", () => {
  assert.throws(() => processarFatura("a;b;c\n1;2;3", "Fatura_2026-06-10.csv", [], []), /colunas inesperadas/);
});

teste("valor não numérico → erro com número da linha", () => {
  const csv = [HEADER, `05/05/2026;X;1455;C;DESC;Única;0;0;abc`].join("\n");
  assert.throws(() => processarFatura(csv, "Fatura_2026-06-10.csv", [], []), /linha 2: valor inválido/);
});

teste("CSV só com header → zero lançamentos sem erro", () => {
  const s = processarFatura(HEADER, "Fatura_2026-06-10.csv", [], []);
  assert.strictEqual(s.lancamentos.length, 0);
  assert.strictEqual(s.resumo.quantidade, 0);
});

teste("sem match no Dicionário → categoria vazia, status confirmado", () => {
  const csv = [HEADER, `05/05/2026;X;1455;C;ESTABELECIMENTO DESCONHECIDO XYZ;Única;0;0;10.00`].join("\n");
  const s = processarFatura(csv, "Fatura_2026-06-10.csv", DICIONARIO, METAS);
  assert.strictEqual(s.lancamentos[0].categoria, "");
  assert.strictEqual(s.lancamentos[0].status, "confirmado");
});

console.log(`\n${passou} testes passaram.`);
console.log(`Resumo do CSV real: ${JSON.stringify(r.resumo)}`);
