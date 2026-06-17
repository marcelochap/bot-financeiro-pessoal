// Testes das funções puras da gestão de metas (estado simulado).
// Critérios: gstack/plans/gerenciar-metas.md
// Rodar: node workflows/src/metas.test.js
const assert = require("node:assert");
const {
  calcularProgresso,
  montarMensagemMetas,
  montarTecladoMetas,
  montarTecladoConfirmarEncerrar,
  parsearNovaMeta,
  parsearCallbackMetaGestao,
  validarNomeMeta,
  nomeJaExisteAtiva,
  TEMPLATE_NOVAMETA,
} = require("./metas.js");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

// Estado simulado — datas SEMPRE no passado (2024), nunca poluir estado vivo.
const META = (nome, orc, status = "ativa", prazo = "2024-12") => ({
  nome,
  orcamento_total: orc,
  valor_acumulado: 0,
  prazo,
  status,
  criado_em: "2024-01-01",
});
const LANC = (id_meta, valor, status = "confirmado") => ({
  data: "2024-03-01",
  descricao: "x",
  valor,
  status,
  id_meta,
});

// ─── calcularProgresso ──────────────────────────────────────────────
teste("soma só confirmado + id_meta==nome; ignora pendente e outras metas", () => {
  const metas = [META("Viagem", 8000), META("Cama", 1800)];
  const lancs = [
    LANC("Viagem", 3000),
    LANC("Viagem", 200),
    LANC("Viagem", 500, "pendente"), // ignorado (não confirmado)
    LANC("Cama", 900),
    LANC("Outra", 999), // meta inexistente, ignorado
  ];
  const p = calcularProgresso(metas, lancs);
  assert.strictEqual(p.length, 2);
  assert.deepStrictEqual(
    p.find((x) => x.nome === "Viagem"),
    { nome: "Viagem", orcamento: 8000, acumulado: 3200, pct: 40, prazo: "2024-12" }
  );
  assert.strictEqual(p.find((x) => x.nome === "Cama").acumulado, 900);
});

teste("usa |valor| (lançamentos podem vir negativos) e arredonda pct", () => {
  const p = calcularProgresso([META("M", 300)], [LANC("M", -100), LANC("M", -101)]);
  assert.strictEqual(p[0].acumulado, 201);
  assert.strictEqual(p[0].pct, 67); // 201/300 = 0.67
});

teste("metas encerradas não entram no progresso", () => {
  const metas = [META("Ativa", 100), META("Velha", 100, "encerrada")];
  const p = calcularProgresso(metas, [LANC("Velha", 50)]);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].nome, "Ativa");
});

teste("orçamento 0/ausente → pct null, sem divisão por zero; meta sem lançamento → 0%", () => {
  const p = calcularProgresso([META("SemOrc", 0), META("ComOrc", 500)], []);
  assert.strictEqual(p.find((x) => x.nome === "SemOrc").pct, null);
  assert.strictEqual(p.find((x) => x.nome === "SemOrc").acumulado, 0);
  assert.strictEqual(p.find((x) => x.nome === "ComOrc").pct, 0); // 0/500
});

teste("match pós-trim: espaço de borda SOMA (decisão travada); capitalização diferente NÃO soma", () => {
  const metas = [META("Viagem Lua de Mel", 8000)];
  const lancs = [
    LANC(" Viagem Lua de Mel ", 1000), // espaço de borda → casa após trim → soma
    LANC("viagem lua de mel", 500), // case diferente → match exato falha → não soma
  ];
  const p = calcularProgresso(metas, lancs);
  assert.strictEqual(p[0].acumulado, 1000);
});

// ─── parsearNovaMeta ────────────────────────────────────────────────
teste("/novameta feliz → {ok, meta} com orçamento numérico e nome/prazo limpos", () => {
  const r = parsearNovaMeta("/novameta Cama Nova | 1800 | 2026-12");
  assert.deepStrictEqual(r, { ok: true, meta: { nome: "Cama Nova", orcamento: 1800, prazo: "2026-12" } });
});

teste("/novameta aceita formato BR de valor e @bot no comando", () => {
  assert.strictEqual(parsearNovaMeta("/novameta@Bot Viagem | 1.800,50 | 2026-12").meta.orcamento, 1800.5);
  assert.strictEqual(parsearNovaMeta("Viagem | 1.800 | 2026-12").meta.orcamento, 1800);
});

teste("/novameta erro: campos faltando → {ok:false, erro com template}", () => {
  const r = parsearNovaMeta("/novameta Cama Nova | 1800");
  assert.strictEqual(r.ok, false);
  assert.ok(r.erro.includes("/novameta"));
});

teste("/novameta erro: orçamento não numérico", () => {
  assert.strictEqual(parsearNovaMeta("/novameta Cama | barato | 2026-12").ok, false);
  assert.strictEqual(parsearNovaMeta("/novameta Cama | 0 | 2026-12").ok, false); // não positivo
});

teste("/novameta erro: prazo inválido", () => {
  assert.strictEqual(parsearNovaMeta("/novameta Cama | 1800 | dezembro").ok, false);
  assert.strictEqual(parsearNovaMeta("/novameta Cama | 1800 | 2026-13").ok, false); // mês > 12
});

teste("/novameta erro: nome vazio (campo em branco entre barras)", () => {
  assert.strictEqual(parsearNovaMeta("/novameta  | 1800 | 2026-12").ok, false);
});

// ─── validarNomeMeta / nomeJaExisteAtiva ────────────────────────────
teste("validarNomeMeta: trim, rejeita vazio, '|' e nome longo demais p/ callback", () => {
  assert.deepStrictEqual(validarNomeMeta("  Viagem  "), { ok: true, nome: "Viagem" });
  assert.strictEqual(validarNomeMeta("").ok, false);
  assert.strictEqual(validarNomeMeta("a|b").ok, false);
  assert.strictEqual(validarNomeMeta("x".repeat(60)).ok, false); // gmok|<60> > 64 bytes
});

teste("nomeJaExisteAtiva: duplicado entre ativas recusa; homônimo de encerrada permite", () => {
  const metas = [META("Viagem", 8000, "ativa"), META("Cama", 1800, "encerrada")];
  assert.strictEqual(nomeJaExisteAtiva("Viagem", metas), true);
  assert.strictEqual(nomeJaExisteAtiva(" Viagem ", metas), true); // trim dos dois lados
  assert.strictEqual(nomeJaExisteAtiva("Cama", metas), false); // só encerrada → libera reabrir
  assert.strictEqual(nomeJaExisteAtiva("Nova", metas), false);
});

// ─── parsearCallbackMetaGestao ──────────────────────────────────────
teste("parse dos 3 prefixos gm* + lixo → null", () => {
  assert.deepStrictEqual(parsearCallbackMetaGestao("gmnova|"), { acao: "nova" });
  assert.deepStrictEqual(parsearCallbackMetaGestao("gmenc|Viagem"), {
    acao: "encerrar-confirmar",
    nome: "Viagem",
  });
  assert.deepStrictEqual(parsearCallbackMetaGestao("gmok|Viagem Lua de Mel"), {
    acao: "encerrar-ok",
    nome: "Viagem Lua de Mel",
  });
  assert.strictEqual(parsearCallbackMetaGestao("cat|3|x"), null);
  assert.strictEqual(parsearCallbackMetaGestao("gmenc|"), null); // sem nome
  assert.strictEqual(parsearCallbackMetaGestao("lixo"), null);
});

// ─── montarMensagemMetas / teclados ─────────────────────────────────
teste("mensagem vazia → texto amigável + template de criação", () => {
  const m = montarMensagemMetas([]);
  assert.ok(m.includes("não tem metas ativas"));
  assert.ok(m.includes(TEMPLATE_NOVAMETA));
});

teste("mensagem com metas → acumulado/orçamento, pct e prazo de cada uma", () => {
  const p = calcularProgresso(
    [META("Viagem Lua de Mel", 8000, "ativa", "2024-12"), META("Cama Nova", 1800)],
    [LANC("Viagem Lua de Mel", 3200)]
  );
  const m = montarMensagemMetas(p);
  assert.ok(m.includes("Viagem Lua de Mel"));
  assert.ok(m.includes("40%"));
  assert.ok(m.includes("R$ 3.200,00"));
  assert.ok(m.includes("Cama Nova"));
  assert.ok(m.includes("0%")); // Cama sem lançamento
});

teste("teclado /metas: um gmenc| por meta + linha final gmnova|; ≤64 bytes com nomes reais", () => {
  const p = calcularProgresso(
    [META("Viagem Lua de Mel", 8000), META("Ar Condicionado Portátil", 2500)],
    []
  );
  const kb = montarTecladoMetas(p);
  assert.strictEqual(kb.inline_keyboard.length, 3); // 2 metas + nova
  assert.strictEqual(kb.inline_keyboard[0][0].callback_data, "gmenc|Viagem Lua de Mel");
  assert.strictEqual(kb.inline_keyboard[2][0].callback_data, "gmnova|");
  for (const linha of kb.inline_keyboard) {
    for (const b of linha) {
      assert.ok(Buffer.byteLength(b.callback_data, "utf-8") <= 64, b.callback_data);
    }
  }
});

teste("teclado vazio → só o botão Nova meta", () => {
  const kb = montarTecladoMetas([]);
  assert.strictEqual(kb.inline_keyboard.length, 1);
  assert.strictEqual(kb.inline_keyboard[0][0].callback_data, "gmnova|");
});

teste("teclado de confirmação de encerramento → gmok|<nome> ≤64 bytes", () => {
  const kb = montarTecladoConfirmarEncerrar("Ar Condicionado Portátil");
  assert.strictEqual(kb.inline_keyboard[0][0].callback_data, "gmok|Ar Condicionado Portátil");
  assert.ok(Buffer.byteLength(kb.inline_keyboard[0][0].callback_data, "utf-8") <= 64);
});

console.log(`\n${passou} testes passaram.`);
