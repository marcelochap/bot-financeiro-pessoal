// Testes da lógica pura da categorização híbrida.
// Critérios: gstack/plans/categorizacao-hibrida.md
// Rodar: node workflows/src/categorizador.test.js
const assert = require("node:assert");
const {
  montarPrompt,
  parsearRespostaGemini,
  chaveDicionario,
  ehResgateCdb,
  montarTeclado,
  montarTecladoMetas,
  parsearCallback,
} = require("./categorizador.js");

const CATEGORIAS = ["Supermercado", "Alimentação", "Streams", "Compras", "Outros"];
const METAS = ["Meta Viagem", "Meta Casa", "Meta Eletrodoméstico Portátil", "Meta Plantas", "Meta IPTU", "Meta Evento"];

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

// ─── montarPrompt ───────────────────────────────────────────────────
teste("prompt inclui categorias válidas e dados do lançamento", () => {
  const p = montarPrompt(
    { descricao: "PADARIA PAO QUENTE", titulo: "", valor: 35.5, tipo: "saída", origem: "cartao" },
    CATEGORIAS
  );
  assert.ok(p.includes("Supermercado, Alimentação"));
  assert.ok(p.includes("PADARIA PAO QUENTE"));
  assert.ok(p.includes("cartão de crédito"));
  assert.ok(p.includes("APENAS JSON"));
});

// ─── parsearRespostaGemini ──────────────────────────────────────────
teste("resposta válida e confiante", () => {
  const r = parsearRespostaGemini('{"categoria": "Alimentação", "confianca": 0.95}', CATEGORIAS);
  assert.deepStrictEqual(r, { valida: true, categoria: "Alimentação", confianca: 0.95, confiante: true });
});

teste("confiança abaixo do limiar → valida mas não confiante", () => {
  const r = parsearRespostaGemini('{"categoria": "Compras", "confianca": 0.5}', CATEGORIAS);
  assert.strictEqual(r.valida, true);
  assert.strictEqual(r.confiante, false);
});

teste("não-JSON, categoria inválida e confiança fora do range → invalida", () => {
  assert.strictEqual(parsearRespostaGemini("desculpe, não sei", CATEGORIAS).valida, false);
  assert.strictEqual(parsearRespostaGemini('{"categoria": "Inexistente", "confianca": 0.9}', CATEGORIAS).valida, false);
  assert.strictEqual(parsearRespostaGemini('{"categoria": "Compras", "confianca": 1.7}', CATEGORIAS).valida, false);
  assert.strictEqual(parsearRespostaGemini("", CATEGORIAS).valida, false);
});

// ─── chaveDicionario ────────────────────────────────────────────────
teste("cartão: descrição sem sufixo de parcela; conta: título", () => {
  assert.strictEqual(
    chaveDicionario({ origem: "cartao", descricao: "LIBERDADE COMERCIO DE (2/3)" }),
    "LIBERDADE COMERCIO DE"
  );
  assert.strictEqual(
    chaveDicionario({ origem: "cartao", descricao: "SPOTIFY" }),
    "SPOTIFY"
  );
  assert.strictEqual(
    chaveDicionario({ origem: "conta", titulo: "Pix enviado para FULANO", descricao: "TRANSF" }),
    "Pix enviado para FULANO"
  );
});

// ─── ehResgateCdb ───────────────────────────────────────────────────
teste("detecta RESGATE DE CDB pelo título (case-insensitive)", () => {
  assert.strictEqual(ehResgateCdb({ titulo: "RESGATE DE CDB" }), true);
  assert.strictEqual(ehResgateCdb({ titulo: "Resgate Cdb Pos" }), true);
  assert.strictEqual(ehResgateCdb({ titulo: "Pix recebido de FULANO" }), false);
  assert.strictEqual(ehResgateCdb({ titulo: "" }), false);
});

// ─── montarTeclado / parsearCallback ────────────────────────────────
teste("teclado: categorias + metas, callback_data ≤ 64 bytes, 2 botões por linha", () => {
  const t = montarTeclado(123, CATEGORIAS, METAS);
  const botoes = t.inline_keyboard.flat();
  assert.strictEqual(botoes.length, CATEGORIAS.length + METAS.length);
  assert.ok(botoes.every((b) => Buffer.byteLength(b.callback_data, "utf-8") <= 64));
  assert.ok(t.inline_keyboard.every((linha) => linha.length <= 2));
  assert.ok(botoes.some((b) => b.callback_data === "cat|123|Alimentação"));
  assert.ok(botoes.some((b) => b.callback_data === "meta|123|Meta Viagem" && b.text.includes("🎯")));
});

teste("teclado de metas (CDB) só tem metas", () => {
  const t = montarTecladoMetas(7, METAS);
  const botoes = t.inline_keyboard.flat();
  assert.strictEqual(botoes.length, METAS.length);
  assert.ok(botoes.every((b) => b.callback_data.startsWith("meta|7|")));
});

teste("row de 4+ dígitos continua ≤ 64 bytes com a maior meta", () => {
  const t = montarTeclado(99999, [], ["Meta Eletrodoméstico Portátil"]);
  assert.ok(t.inline_keyboard.flat().every((b) => Buffer.byteLength(b.callback_data, "utf-8") <= 64));
});

teste("parsearCallback: cat e meta válidos; lixo → null", () => {
  assert.deepStrictEqual(parsearCallback("cat|55|Compras"), { tipo: "cat", row: 55, nome: "Compras" });
  assert.deepStrictEqual(parsearCallback("meta|8|Meta Viagem"), { tipo: "meta", row: 8, nome: "Meta Viagem" });
  assert.strictEqual(parsearCallback("xyz|1|a"), null);
  assert.strictEqual(parsearCallback("cat|abc|x"), null);
  assert.strictEqual(parsearCallback(""), null);
  assert.strictEqual(parsearCallback(null), null);
});

console.log(`\n${passou} testes passaram.`);
