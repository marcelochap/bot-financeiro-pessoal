// Testes do parser da fatura C6 cartão — fixtures sintéticas.
// No esqueleto público a integração contra a fatura real foi removida; rode-a
// localmente com suas próprias faturas em `Dados CSV/` (gitignored).
// Rodar: node workflows/src/parser-cartao.test.js
const assert = require("node:assert");
const { processarFatura, vencimentoDoNome } = require("./parser-cartao.js");

const DICIONARIO = [{ chave: "LOJA EXEMPLO", categoria: "Compras" }];
const METAS = [{ nome: "Meta Exemplo" }];
const HEADER = "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)";

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

teste("estorno SEM par é mantido como crédito (tipo entrada)", () => {
  const csv = [HEADER, `05/05/2026;TITULAR EXEMPLO;1455;Compras;LOJA QUALQUER;Única;0;0;-50.00`].join("\n");
  const s = processarFatura(csv, "Fatura_2026-06-10.csv", DICIONARIO, METAS);
  assert.strictEqual(s.lancamentos.length, 1);
  assert.strictEqual(s.lancamentos[0].tipo, "entrada");
  assert.strictEqual(s.lancamentos[0].valor, 50); // convenção: valor sempre positivo
  assert.strictEqual(s.resumo.total, -50); // total líquido: crédito reduz a fatura
  assert.strictEqual(s.cancelados.length, 0);
});

teste("par compra +X / estorno -X é descartado e logado", () => {
  const csv = [
    HEADER,
    `05/05/2026;TITULAR EXEMPLO;1455;Serviços;Anuidade Diferenciada;Única;0;0;98.00`,
    `06/05/2026;TITULAR EXEMPLO;1455;Serviços;Estorno Tarifa;Única;0;0;-98.00`,
  ].join("\n");
  const s = processarFatura(csv, "Fatura_2026-06-10.csv", [], []);
  assert.strictEqual(s.lancamentos.length, 0);
  assert.strictEqual(s.cancelados.length, 1);
});

teste("data_competencia = vencimento do nome do arquivo (dia 10)", () => {
  const csv = [HEADER, `05/05/2026;TITULAR EXEMPLO;1455;Compras;LOJA EXEMPLO;Única;0;0;10.00`].join("\n");
  const s = processarFatura(csv, "Fatura_2026-06-10.csv", DICIONARIO, METAS);
  assert.strictEqual(s.lancamentos[0].data_competencia, "10/06/2026");
  assert.strictEqual(s.lancamentos[0].data_original, "05/05/2026");
  assert.strictEqual(s.lancamentos[0].categoria, "Compras"); // chave do Dicionário
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
