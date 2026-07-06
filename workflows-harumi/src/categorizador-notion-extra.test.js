// Testes de workflows-harumi/src/categorizador-notion-extra.js.
// Rodar: node workflows-harumi/src/categorizador-notion-extra.test.js
const assert = require("node:assert");
const { semHifen, montarTecladoNotion, montarTecladoMetasNotion, parsearCallbackNotion } = require("./categorizador-notion-extra.js");

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

const ID_COM_HIFEN = "3955c72b-7ba7-81e0-ba68-d4198dcc6b4c";
const ID_SEM_HIFEN = "3955c72b7ba781e0ba68d4198dcc6b4c";

teste("semHifen remove os hífens do UUID", () => {
  assert.strictEqual(semHifen(ID_COM_HIFEN), ID_SEM_HIFEN);
  assert.strictEqual(semHifen(ID_SEM_HIFEN), ID_SEM_HIFEN);
});

teste("montarTecladoNotion usa índice (não o nome) no callback_data, sob o limite de 64 bytes", () => {
  const categorias = ["Supermercado", "Alimentação", "Ar Condicionado Portátil e Ventilador"];
  const teclado = montarTecladoNotion(ID_COM_HIFEN, categorias, []);
  const botoes = teclado.inline_keyboard.flat();
  assert.strictEqual(botoes.length, 3);
  assert.strictEqual(botoes[0].callback_data, `cat|${ID_SEM_HIFEN}|0`);
  assert.strictEqual(botoes[0].text, "Supermercado");
  assert.strictEqual(botoes[2].callback_data, `cat|${ID_SEM_HIFEN}|2`);
  assert.strictEqual(botoes[2].text, "Ar Condicionado Portátil e Ventilador"); // texto do botão pode ser longo — só o callback_data tem limite
  for (const b of botoes) assert.ok(Buffer.byteLength(b.callback_data, "utf-8") <= 64);
});

teste("montarTecladoNotion mistura categorias e metas com prefixos distintos", () => {
  const teclado = montarTecladoNotion(ID_COM_HIFEN, ["Supermercado"], ["Viagem Lua de Mel"]);
  const botoes = teclado.inline_keyboard.flat();
  assert.strictEqual(botoes[0].callback_data, `cat|${ID_SEM_HIFEN}|0`);
  assert.strictEqual(botoes[1].callback_data, `meta|${ID_SEM_HIFEN}|0`);
  assert.strictEqual(botoes[1].text, "🎯 Viagem Lua de Mel");
});

teste("montarTecladoMetasNotion só gera botões de meta (categorias vazio)", () => {
  const teclado = montarTecladoMetasNotion(ID_COM_HIFEN, ["Viagem Lua de Mel", "Casamento"]);
  const botoes = teclado.inline_keyboard.flat();
  assert.strictEqual(botoes.length, 2);
  assert.ok(botoes.every((b) => b.callback_data.startsWith("meta|")));
});

teste("parsearCallbackNotion faz o round-trip do callback_data gerado", () => {
  const teclado = montarTecladoNotion(ID_COM_HIFEN, ["Supermercado", "Compras"], ["Casamento"]);
  const botoes = teclado.inline_keyboard.flat();
  const cb0 = parsearCallbackNotion(botoes[0].callback_data);
  assert.deepStrictEqual(cb0, { tipo: "cat", pageId: ID_SEM_HIFEN, indice: 0 });
  const cbMeta = parsearCallbackNotion(botoes[2].callback_data);
  assert.deepStrictEqual(cbMeta, { tipo: "meta", pageId: ID_SEM_HIFEN, indice: 0 });
});

teste("parsearCallbackNotion: entrada inválida/formato antigo (com hífen ou nome) → null", () => {
  assert.strictEqual(parsearCallbackNotion(""), null);
  assert.strictEqual(parsearCallbackNotion("lixo"), null);
  assert.strictEqual(parsearCallbackNotion(`cat|${ID_COM_HIFEN}|0`), null); // com hífen não bate a regex (32 hex exatos)
  assert.strictEqual(parsearCallbackNotion(`cat|5|Supermercado`), null); // formato antigo (Sheets)
});

teste("montarTecladoNotion lança erro se ultrapassar 64 bytes mesmo assim (guarda-corpo preservado)", () => {
  const idMuitoGrande = "a".repeat(60); // não é um UUID real, só pra forçar o estouro
  assert.throws(() => montarTecladoNotion(idMuitoGrande, ["X"], []), /excede 64 bytes/);
});

console.log(`\n${passou} teste(s) passaram.`);
