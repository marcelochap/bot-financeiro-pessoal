// Testes do parser do extrato C6 conta corrente contra o arquivo REAL + fixtures.
// Critérios de sucesso: gstack/plans/ingestao-csv-conta.md
// Rodar: node workflows/src/parser-conta.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { processarExtrato, splitLinha } = require("./parser-conta.js");
const { ehTransferencia } = require("./rateio.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const CSV_REAL = fs.readFileSync(
  path.join(RAIZ, "Dados CSV", "01KTRWXKPTD3BJ86T8YNHJ0XK1.csv"), "utf-8"
);

// Subconjunto conta do Dicionário semeado (gerar-planilha-inicial.py)
const DICIONARIO = [
  { chave: "LILIAN ALVES PEIXOTO", categoria: "Empregada" },
  { chave: "CONDOMINIO PENINSULA", categoria: "Condomínio" },
  { chave: "SUPERGASBRAS", categoria: "Gás" },
  { chave: "CLARO", categoria: "Claro" },
  { chave: "SEFAZ DISTRITO FEDERAL", categoria: "Meta: IPTU" },
  { chave: "AIBR INSTITUICAO DE PAGAMENTO", categoria: "Compras" },
  { chave: "MARCELO SILVA LEITE", categoria: "Depósito Marcelo/Retirada" },
  { chave: "PGTO FAT CARTAO C6", categoria: "Pagamento/Retirada" },
];
const METAS = [{ nome: "Viagem Lua de Mel" }, { nome: "IPTU" }, { nome: "Casamento" }];

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

// ─── Extrato real ───────────────────────────────────────────────────
const r = processarExtrato(CSV_REAL, "01KTRWXKPTD3BJ86T8YNHJ0XK1.csv", DICIONARIO, METAS);

teste("BOM removido, 8 linhas de metadata puladas, 24 lançamentos parseados", () => {
  assert.strictEqual(r.lancamentos.length, 24);
  assert.strictEqual(r.resumo.descartados, 0);
});

teste("campo aspeado com vírgula interna parseado em 7 colunas", () => {
  assert.ok(r.lancamentos.some((l) => l.descricao === "1/2 de 9,906.65"));
});

teste("SEFAZ → Meta: IPTU, id_meta IPTU, saída 1981.55", () => {
  const sefaz = r.lancamentos.find((l) => l.titulo.includes("SEFAZ"));
  assert.strictEqual(sefaz.categoria, "Meta: IPTU");
  assert.strictEqual(sefaz.id_meta, "IPTU");
  assert.strictEqual(sefaz.tipo, "saída");
  assert.strictEqual(sefaz.valor, 1981.55);
});

teste("Marcelo: recebido → Depósito Marcelo (p/ a casa), enviado → Saída para o Marcelo (pessoal)", () => {
  const proprias = r.lancamentos.filter((l) => l.titulo.toUpperCase().includes("MARCELO SILVA LEITE"));
  assert.ok(proprias.length >= 2, `esperadas >=2 transferências próprias, vieram ${proprias.length}`);
  for (const t of proprias) {
    const esperada = t.tipo === "entrada" ? "Depósito Marcelo" : "Saída para o Marcelo";
    assert.strictEqual(t.categoria, esperada, `${t.titulo} (${t.tipo}) → ${t.categoria}`);
  }
  // nenhum pseudo-categoria chega à aba Lançamentos
  assert.ok(!r.lancamentos.some((l) => l.categoria === "Depósito Marcelo/Retirada"), "pseudo nunca gravada");
  assert.ok(!r.lancamentos.some((l) => l.categoria === "Pagamento/Retirada"), "pseudo nunca gravada");
});

// Cobre as DUAS pseudo-categorias com CSV mínimo (independe do extrato real).
teste("pseudos resolvem pela direção: Pagamento/Retirada e Depósito Marcelo/Retirada", () => {
  const dic = [
    { chave: "MARCELO SILVA LEITE", categoria: "Depósito Marcelo/Retirada" },
    { chave: "FULANO PIX", categoria: "Pagamento/Retirada" },
  ];
  const csv = META_HEADER + "\n" + [
    "06/06/2026,06/06/2026,Pix recebido de MARCELO SILVA LEITE,dep,10400.00,0.00,10400.00",
    "07/06/2026,07/06/2026,Pix enviado MARCELO SILVA LEITE,saque,0.00,300.00,10100.00",
    "08/06/2026,08/06/2026,Pix recebido de FULANO PIX,pgto,50.00,0.00,10150.00",
  ].join("\n");
  const res = processarExtrato(csv, "min.csv", dic, METAS);
  const dep = res.lancamentos.find((l) => l.tipo === "entrada" && l.titulo.includes("MARCELO"));
  const saq = res.lancamentos.find((l) => l.tipo === "saída" && l.titulo.includes("MARCELO"));
  const pag = res.lancamentos.find((l) => l.titulo.includes("FULANO"));
  assert.strictEqual(dep.categoria, "Depósito Marcelo");
  assert.strictEqual(saq.categoria, "Saída para o Marcelo"); // saída do Marcelo p/ ele mesmo (pessoal)
  assert.strictEqual(pag.categoria, "Pagamento");
});

teste("AIBR → Compras (chave Título contém)", () => {
  const aibr = r.lancamentos.find((l) => l.titulo.toUpperCase().includes("AIBR"));
  assert.strictEqual(aibr.categoria, "Compras");
});

teste("Pix recebido sem regra → categoria vazia, tipo entrada, confirmado", () => {
  const eduardo = r.lancamentos.find((l) => l.titulo.includes("EDUARDO CONY"));
  assert.strictEqual(eduardo.categoria, "");
  assert.strictEqual(eduardo.tipo, "entrada");
  assert.strictEqual(eduardo.status, "confirmado");
});

teste("RESGATE DE CDB → categoria vazia + aviso", () => {
  const cdb = r.lancamentos.find((l) => l.titulo.toUpperCase().includes("CDB"));
  assert.ok(cdb, "lançamento de CDB existe no extrato");
  assert.strictEqual(cdb.categoria, "");
  assert.ok(r.avisos.some((a) => a.includes("CDB")));
});

teste("período do metadata = 11/05/2026 a 10/06/2026", () => {
  assert.strictEqual(r.resumo.periodo_inicio, "11/05/2026");
  assert.strictEqual(r.resumo.periodo_fim, "10/06/2026");
});

teste("totais: 10 entradas R$ 46160.10 e 14 saídas R$ 37232.80", () => {
  assert.strictEqual(r.resumo.entradas.n, 10);
  assert.strictEqual(r.resumo.entradas.total, 46160.10);
  assert.strictEqual(r.resumo.saidas.n, 14);
  assert.strictEqual(r.resumo.saidas.total, 37232.80);
});

teste("datas: competencia = original = Data Lançamento; valor sempre positivo", () => {
  assert.ok(r.lancamentos.every((l) => l.data_competencia === l.data_original));
  assert.ok(r.lancamentos.every((l) => l.valor > 0));
});

// ─── Fixtures sintéticas ────────────────────────────────────────────
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

// ─── Pagamento da fatura do cartão (dupla contagem do bloco 6) ──────
teste("pagamento da fatura (PGTO FAT CARTAO C6, saída) → Retirada = transferência (fora dos gastos)", () => {
  const linha = "11/06/2026,11/06/2026,PGTO FAT CARTAO C6,Fatura de cartão,0.00,9363.91,4551.01";
  const s = processarExtrato(META_HEADER + "\n" + linha, "x.csv", DICIONARIO, METAS);
  assert.strictEqual(s.lancamentos.length, 1);
  const pag = s.lancamentos[0];
  assert.strictEqual(pag.categoria, "Retirada");     // pseudo-categoria resolvida pela direção
  assert.strictEqual(pag.tipo, "saída");
  assert.strictEqual(pag.valor, 9363.91);
  assert.ok(ehTransferencia(pag.categoria));          // logo, excluída dos totais (dashboard/rateio/relatório)
});

// ─── splitLinha: robustez a aspas (achado do reviewer) ──────────────
teste("splitLinha: campo totalmente aspeado com vírgulas internas → 1 campo só", () => {
  assert.deepStrictEqual(
    splitLinha('01/06/2026,01/06/2026,"FOO, BAR, BAZ",desc,0.00,10.00,1.00', ","),
    ["01/06/2026", "01/06/2026", "FOO, BAR, BAZ", "desc", "0.00", "10.00", "1.00"]
  );
});

// Quirk C6: a LINHA INTEIRA vem envolta em aspas, com aspas internas duplicadas
// (amostra real 01KV8SC8…csv linha 24). O parser deve desembrulhar, não travar.
teste("processarExtrato: linha inteira aspeada (quirk C6) desembrulha em 7 colunas", () => {
  const wrapped =
    '"09/06/2026,09/06/2026,""Pix recebido de FULANO DE TAL"",""Pix recebido de FULANO DE TAL"",3000.00,0.00,12914.92"';
  const out = processarExtrato(META_HEADER + "\n" + wrapped, "fix.csv", DICIONARIO, METAS);
  assert.strictEqual(out.lancamentos.length, 1, "linha aspeada deve virar 1 lançamento");
  const l = out.lancamentos[0];
  assert.strictEqual(l.titulo, "Pix recebido de FULANO DE TAL");
  assert.strictEqual(l.tipo, "entrada");
  assert.strictEqual(l.valor, 3000);
});

console.log(`\n${passou} testes passaram.`);
console.log(`Resumo do extrato real: ${JSON.stringify(r.resumo)}`);
console.log(`Avisos: ${JSON.stringify(r.avisos)}`);
