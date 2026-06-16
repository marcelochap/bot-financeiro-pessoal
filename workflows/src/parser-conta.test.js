// Testes do parser do extrato C6 conta corrente — fixtures sintéticas.
// No esqueleto público a integração contra CSV real foi removida; rode-a localmente
// com seus próprios extratos em `Dados CSV/` (gitignored).
// Rodar: node workflows/src/parser-conta.test.js
const assert = require("node:assert");
const { processarExtrato } = require("./parser-conta.js");

const META_HEADER = [
  "EXTRATO DE CONTA CORRENTE C6 BANK", "", "Agência: 1 / Conta: 1",
  "Extrato gerado em 10/06/2026 - as 10:00:00", "",
  "Extrato de 01/06/2026 a 10/06/2026", "", "",
  "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
].join("\n");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

teste("linha com Entrada e Saída zeradas → descartada com aviso", () => {
  const csv = META_HEADER + "\n01/06/2026,01/06/2026,TARIFA,TARIFA,0.00,0.00,100.00";
  const s = processarExtrato(csv, "x.csv", [], []);
  assert.strictEqual(s.lancamentos.length, 0);
  assert.strictEqual(s.resumo.descartados, 1);
  assert.ok(s.avisos[0].includes("zeradas"));
});

teste("Entrada e Saída preenchidas simultaneamente → erro", () => {
  const csv = META_HEADER + "\n01/06/2026,01/06/2026,X,X,10.00,20.00,100.00";
  assert.throws(() => processarExtrato(csv, "x.csv", [], []), /simultaneamente/);
});

teste("header inesperado na linha 9 → erro", () => {
  const csv = META_HEADER.replace("Data Lançamento", "Data Errada") + "\n01/06/2026,01/06/2026,X,X,10.00,0.00,1.00";
  assert.throws(() => processarExtrato(csv, "x.csv", [], []), /header inesperado/);
});

teste("arquivo truncado (sem header) → erro", () => {
  assert.throws(() => processarExtrato("linha unica", "x.csv", [], []), /linhas/);
});

teste("valor não numérico → erro com número da linha", () => {
  const csv = META_HEADER + "\n01/06/2026,01/06/2026,X,X,abc,0.00,1.00";
  assert.throws(() => processarExtrato(csv, "x.csv", [], []), /linha 10: valor inválido/);
});

teste("classificação via Dicionário (chave genérica no Título)", () => {
  const csv = META_HEADER + "\n02/06/2026,02/06/2026,FORNECEDOR EXEMPLO LTDA,Pagamento,0.00,150.00,50.00";
  const s = processarExtrato(csv, "x.csv", [{ chave: "FORNECEDOR EXEMPLO", categoria: "Serviços" }], []);
  assert.strictEqual(s.lancamentos.length, 1);
  assert.strictEqual(s.lancamentos[0].categoria, "Serviços");
  assert.strictEqual(s.lancamentos[0].tipo, "saída");
  assert.ok(s.lancamentos[0].valor > 0);
});

console.log(`\n${passou} testes passaram.`);
