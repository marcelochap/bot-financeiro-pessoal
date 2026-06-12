// Testes da lógica pura dos lembretes agendados.
// Critérios: gstack/plans/lembretes-agendados.md
// Rodar: node workflows/src/lembretes.test.js
const assert = require("node:assert");
const {
  decidirLembretes,
  montarMensagemLembrete,
  montarTecladoLembrete,
  parsearCallbackLembrete,
} = require("./lembretes.js");

// Espelho do seed da aba Contas Fixas (valores como o batchGet devolve: strings)
const CONTAS = [
  { nome: "Claro", dia_vencimento: "8", valor_esperado: "159", ativo: "sim" },
  { nome: "Luz", dia_vencimento: "8", valor_esperado: "521", ativo: "sim" },
  { nome: "Condomínio", dia_vencimento: "5", valor_esperado: "1253", ativo: "sim" },
  { nome: "Empregada", dia_vencimento: "sexta-feira", valor_esperado: "2240", ativo: "sim" },
  { nome: "Gás", dia_vencimento: "11", valor_esperado: "90", ativo: "sim" },
  { nome: "Tênis", dia_vencimento: "5", valor_esperado: "750", ativo: "sim" },
  { nome: "Personal", dia_vencimento: "5", valor_esperado: "640", ativo: "sim" },
];

function logEnviado(conta, ref, tipo, dia) {
  return { acao: "lembrete_enviado", valor_anterior: `${conta}|${ref}`, valor_novo: `${tipo}|${dia}` };
}
function logConfirmado(conta, ref) {
  return { acao: "pagamento_confirmado", valor_anterior: `${conta}|${ref}`, valor_novo: "" };
}

const nomes = (r) => r.lembretes.map((l) => l.conta).sort();

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

// ─── decidirLembretes: D-1 ──────────────────────────────────────────
teste("2024-07-04 (qui) → 3 lembretes D-1 das contas do dia 5, referência 2024-07", () => {
  const r = decidirLembretes(CONTAS, [], "2024-07-04");
  assert.deepStrictEqual(nomes(r), ["Condomínio", "Personal", "Tênis"]);
  assert.ok(r.lembretes.every((l) => l.tipo === "D-1" && l.referencia === "2024-07"));
  assert.ok(r.lembretes.every((l) => l.data_vencimento === "2024-07-05"));
  assert.deepStrictEqual(r.invalidas, []);
});

teste("2024-07-07 → D-1 de Claro e Luz; 2024-07-10 → D-1 do Gás", () => {
  assert.deepStrictEqual(nomes(decidirLembretes(CONTAS, [], "2024-07-07")), ["Claro", "Luz"]);
  assert.deepStrictEqual(nomes(decidirLembretes(CONTAS, [], "2024-07-10")), ["Gás"]);
});

// ─── decidirLembretes: D0 + semanal ─────────────────────────────────
teste("2024-07-05 (sex) sem confirmação → 3 D0 + Empregada semanal", () => {
  const r = decidirLembretes(CONTAS, [], "2024-07-05");
  assert.deepStrictEqual(nomes(r), ["Condomínio", "Empregada", "Personal", "Tênis"]);
  const emp = r.lembretes.find((l) => l.conta === "Empregada");
  assert.strictEqual(emp.tipo, "semanal");
  assert.strictEqual(emp.referencia, "2024-07-05");
  assert.strictEqual(emp.pendencia_anterior, null);
  assert.ok(r.lembretes.filter((l) => l.tipo === "D0").every((l) => l.referencia === "2024-07"));
});

teste("pagamento_confirmado suprime o D0 (só da conta confirmada)", () => {
  const logs = [logConfirmado("Condomínio", "2024-07")];
  const r = decidirLembretes(CONTAS, logs, "2024-07-05");
  assert.deepStrictEqual(nomes(r), ["Empregada", "Personal", "Tênis"]);
});

teste("pagamento_confirmado suprime também o D-1 (confirmou antes do lembrete)", () => {
  const logs = [logConfirmado("Tênis", "2024-07")];
  const r = decidirLembretes(CONTAS, logs, "2024-07-04");
  assert.deepStrictEqual(nomes(r), ["Condomínio", "Personal"]);
});

teste("pagamento_adiado NÃO suprime o D0", () => {
  const logs = [
    { acao: "pagamento_adiado", valor_anterior: "Tênis|2024-07", valor_novo: "" },
  ];
  const r = decidirLembretes(CONTAS, logs, "2024-07-05");
  assert.ok(nomes(r).includes("Tênis"));
});

// ─── idempotência ───────────────────────────────────────────────────
teste("re-execução no mesmo dia → 0 reenvios; D0 no dia seguinte reenvia", () => {
  const logs = ["Condomínio", "Tênis", "Personal"].map((c) =>
    logEnviado(c, "2024-07", "D-1", "2024-07-04")
  );
  assert.deepStrictEqual(nomes(decidirLembretes(CONTAS, logs, "2024-07-04")), []);
  // mesmo já tendo D-1 gravado, o D0 do dia 5 sai (dia difere)
  const r = decidirLembretes(CONTAS, logs, "2024-07-05");
  assert.deepStrictEqual(nomes(r), ["Condomínio", "Empregada", "Personal", "Tênis"]);
});

teste("semanal também é idempotente no mesmo dia", () => {
  const logs = [logEnviado("Empregada", "2024-07-05", "semanal", "2024-07-05")];
  const r = decidirLembretes(CONTAS, logs, "2024-07-05");
  assert.ok(!nomes(r).includes("Empregada"));
});

// ─── pós-D0: não insiste ────────────────────────────────────────────
teste("2024-07-06 (sáb, pós-D0) → nenhum lembrete", () => {
  const r = decidirLembretes(CONTAS, [], "2024-07-06");
  assert.deepStrictEqual(nomes(r), []);
});

// ─── pendência da sexta anterior ────────────────────────────────────
teste("sexta seguinte sem confirmação → pendência da sexta anterior", () => {
  const logs = [logEnviado("Empregada", "2024-07-05", "semanal", "2024-07-05")];
  const r = decidirLembretes(CONTAS, logs, "2024-07-12");
  const emp = r.lembretes.find((l) => l.conta === "Empregada");
  assert.strictEqual(emp.referencia, "2024-07-12");
  assert.strictEqual(emp.pendencia_anterior, "2024-07-05");
});

teste("sexta anterior confirmada → sem pendência", () => {
  const logs = [
    logEnviado("Empregada", "2024-07-05", "semanal", "2024-07-05"),
    logConfirmado("Empregada", "2024-07-05"),
  ];
  const r = decidirLembretes(CONTAS, logs, "2024-07-12");
  assert.strictEqual(r.lembretes.find((l) => l.conta === "Empregada").pendencia_anterior, null);
});

teste("sexta anterior sem lembrete enviado (bot desligado) → sem pendência", () => {
  const r = decidirLembretes(CONTAS, [], "2024-07-12");
  assert.strictEqual(r.lembretes.find((l) => l.conta === "Empregada").pendencia_anterior, null);
});

// ─── meses curtos e virada de mês ───────────────────────────────────
teste("dia_vencimento 30 em fevereiro bissexto → vence 29/02 (D-1 dia 28, D0 dia 29)", () => {
  const contas = [{ nome: "Sintética", dia_vencimento: "30", valor_esperado: "10", ativo: "sim" }];
  const d1 = decidirLembretes(contas, [], "2024-02-28");
  assert.deepStrictEqual(nomes(d1), ["Sintética"]);
  assert.strictEqual(d1.lembretes[0].tipo, "D-1");
  assert.strictEqual(d1.lembretes[0].data_vencimento, "2024-02-29");
  assert.strictEqual(d1.lembretes[0].referencia, "2024-02");
  const d0 = decidirLembretes(contas, [], "2024-02-29");
  assert.strictEqual(d0.lembretes[0].tipo, "D0");
});

teste("vencimento dia 1º → D-1 no último dia do mês anterior, referência do mês do VENCIMENTO", () => {
  const contas = [{ nome: "Sintética", dia_vencimento: "1", valor_esperado: "10", ativo: "sim" }];
  const r = decidirLembretes(contas, [], "2024-06-30");
  assert.deepStrictEqual(nomes(r), ["Sintética"]);
  assert.strictEqual(r.lembretes[0].tipo, "D-1");
  assert.strictEqual(r.lembretes[0].referencia, "2024-07");
});

// ─── contas inativas e inválidas ────────────────────────────────────
teste("conta inativa → ignorada em silêncio", () => {
  const contas = [{ nome: "Velha", dia_vencimento: "5", valor_esperado: "10", ativo: "não" }];
  const r = decidirLembretes(contas, [], "2024-07-04");
  assert.deepStrictEqual(r.lembretes, []);
  assert.deepStrictEqual(r.invalidas, []);
});

teste("dia_vencimento inválido e nome com | → invalidas (qualquer dia)", () => {
  const contas = [
    { nome: "Quebrada", dia_vencimento: "quarta", valor_esperado: "10", ativo: "sim" },
    { nome: "Com|Pipe", dia_vencimento: "5", valor_esperado: "10", ativo: "sim" },
  ];
  const r = decidirLembretes(contas, [], "2024-07-22");
  assert.deepStrictEqual(r.invalidas.map((i) => i.conta).sort(), ["Com|Pipe", "Quebrada"]);
  assert.ok(r.invalidas.every((i) => i.motivo));
  assert.deepStrictEqual(r.lembretes, []);
});

teste("lembrete_erro existente suprime nova notificação da inválida", () => {
  const contas = [{ nome: "Quebrada", dia_vencimento: "quarta", valor_esperado: "10", ativo: "sim" }];
  const logs = [{ acao: "lembrete_erro", valor_anterior: "Quebrada|invalida", valor_novo: "" }];
  const r = decidirLembretes(contas, logs, "2024-07-22");
  assert.deepStrictEqual(r.invalidas, []);
});

teste("dia_vencimento fora de 1..31 → inválida", () => {
  const contas = [{ nome: "Zero", dia_vencimento: "0", valor_esperado: "10", ativo: "sim" }];
  assert.strictEqual(decidirLembretes(contas, [], "2024-07-22").invalidas.length, 1);
});

teste("nome longo demais para o teclado → inválida (não derruba a execução)", () => {
  const contas = [
    { nome: "C".repeat(60), dia_vencimento: "5", valor_esperado: "10", ativo: "sim" },
  ];
  const r = decidirLembretes(contas, [], "2024-07-04");
  assert.deepStrictEqual(r.lembretes, []);
  assert.strictEqual(r.invalidas.length, 1);
  assert.ok(r.invalidas[0].motivo.includes("64 bytes"));
});

// ─── mensagem ───────────────────────────────────────────────────────
teste("mensagens: D-1 'amanhã', D0 'HOJE', semanal com valor; pendência mencionada", () => {
  const d1 = montarMensagemLembrete({ conta: "Condomínio", tipo: "D-1", valor: 1253, data_vencimento: "2024-07-05", pendencia_anterior: null });
  assert.ok(d1.includes("Condomínio") && d1.includes("R$ 1.253,00") && d1.includes("amanhã") && d1.includes("05/07"));
  const d0 = montarMensagemLembrete({ conta: "Gás", tipo: "D0", valor: 90, data_vencimento: "2024-07-11", pendencia_anterior: null });
  assert.ok(d0.includes("HOJE") && d0.includes("R$ 90,00"));
  const sem = montarMensagemLembrete({ conta: "Empregada", tipo: "semanal", valor: 2240, data_vencimento: "2024-07-12", pendencia_anterior: "2024-07-05" });
  assert.ok(sem.includes("R$ 2.240,00") && sem.includes("sexta"));
  assert.ok(sem.includes("05/07") && sem.toLowerCase().includes("pendente"));
  const semSem = montarMensagemLembrete({ conta: "Empregada", tipo: "semanal", valor: 2240, data_vencimento: "2024-07-12", pendencia_anterior: null });
  assert.ok(!semSem.toLowerCase().includes("pendente"));
});

// ─── teclado e callback ─────────────────────────────────────────────
teste("teclado: ✅/⏰ com pg|/np|, ≤ 64 bytes com nomes reais (acentos)", () => {
  for (const conta of CONTAS) {
    const ref = conta.nome === "Empregada" ? "2024-07-05" : "2024-07";
    const t = montarTecladoLembrete({ conta: conta.nome, referencia: ref });
    const botoes = t.inline_keyboard.flat();
    assert.strictEqual(botoes.length, 2);
    assert.strictEqual(botoes[0].callback_data, `pg|${conta.nome}|${ref}`);
    assert.strictEqual(botoes[1].callback_data, `np|${conta.nome}|${ref}`);
    assert.ok(botoes.every((b) => Buffer.byteLength(b.callback_data, "utf-8") <= 64));
  }
});

teste("parsearCallbackLembrete: pg/np válidos; lixo → null", () => {
  assert.deepStrictEqual(parsearCallbackLembrete("pg|Condomínio|2024-07"), { acao: "pg", conta: "Condomínio", referencia: "2024-07" });
  assert.deepStrictEqual(parsearCallbackLembrete("np|Empregada|2024-07-05"), { acao: "np", conta: "Empregada", referencia: "2024-07-05" });
  assert.strictEqual(parsearCallbackLembrete("cat|3|Compras"), null);
  assert.strictEqual(parsearCallbackLembrete("pg|SemReferencia"), null);
  assert.strictEqual(parsearCallbackLembrete(""), null);
  assert.strictEqual(parsearCallbackLembrete(null), null);
});

console.log(`\n${passou} testes passaram.`);
