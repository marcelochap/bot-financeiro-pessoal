// Testes da lógica pura do fatura-buffer (remontagem da fatura aberta colada em N mensagens).
// Critérios: gstack/specs/fatura-aberta-buffer-colagem.md
// Rodar: node workflows/src/fatura-buffer.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseFaturaAberta } = require("./fatura-aberta.js");
const { montarTextoBuffer, decidirFluxoBuffer, pareceFatura, STUB_NL, ORIENTACAO_FATURA } = require("./fatura-buffer.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const AMOSTRA = fs.readFileSync(path.join(RAIZ, "Dados CSV", "fatura-aberta-exemplo.txt"), "utf-8");

// Divide a amostra em duas metades por linha (simula o auto-split do Telegram).
const LINHAS = AMOSTRA.split("\n");
const META = Math.floor(LINHAS.length / 2);
const PARTE1 = LINHAS.slice(0, META).join("\n");
const PARTE2 = LINHAS.slice(META).join("\n");
const AGORA = 1_000_000_000_000;
const TTL = 15 * 60 * 1000;

let passou = 0;
function teste(nome, fn) { fn(); passou++; console.log(`PASSOU: ${nome}`); }

// ─── montarTextoBuffer ──────────────────────────────────────────────
teste("montarTextoBuffer: acumulado vazio → fragmento; reconstrói a amostra", () => {
  assert.strictEqual(montarTextoBuffer("", "abc"), "abc");
  assert.strictEqual(montarTextoBuffer("   ", "abc"), "abc");
  assert.strictEqual(montarTextoBuffer(PARTE1, PARTE2), AMOSTRA); // remontagem byte-a-byte
});

// ─── decidirFluxoBuffer ─────────────────────────────────────────────
teste("/faturaaberta com fatura completa numa mensagem → flush imediato", () => {
  const r = decidirFluxoBuffer({}, "fatura-aberta-cmd", "/faturaaberta\n" + AMOSTRA, AGORA, TTL);
  assert.strictEqual(r.acao, "flush");
  // o texto do flush é idêntico ao que o checksum validou (sem o /faturaaberta)
  const pFlush = parseFaturaAberta(r.textoFlush);
  const pAmostra = parseFaturaAberta(AMOSTRA);
  assert.deepStrictEqual(pFlush.checksum, pAmostra.checksum);
  assert.strictEqual(pFlush.lancamentos.length, pAmostra.lancamentos.length);
});

teste("/faturaaberta com 1ª parte só → aguardar (reseta sessão, acumulando)", () => {
  const r = decidirFluxoBuffer({}, "fatura-aberta-cmd", "/faturaaberta\n" + PARTE1, AGORA, TTL);
  assert.strictEqual(r.acao, "aguardar");
  assert.strictEqual(r.aberto, true);
  assert.strictEqual(r.novoTexto, PARTE1); // sem o /faturaaberta
});

teste("texto-livre com sessão aberta completando a fatura → flush", () => {
  const estado = { aberto: "sim", texto_acumulado: PARTE1, atualizado_em: AGORA - 500 };
  const r = decidirFluxoBuffer(estado, "texto-livre", PARTE2, AGORA, TTL);
  assert.strictEqual(r.acao, "flush");
  assert.strictEqual(r.textoFlush, AMOSTRA);
  assert.ok(parseFaturaAberta(r.textoFlush).checksum.bate);
});

teste("texto-livre sem sessão → stub de NL", () => {
  const r = decidirFluxoBuffer({ aberto: "não" }, "texto-livre", "quanto gastei em maio?", AGORA, TTL);
  assert.strictEqual(r.acao, "stub-nl");
  assert.ok(r.resposta.includes("linguagem natural"));
  assert.strictEqual(r.resposta, STUB_NL);
});

teste("texto-livre sem sessão contendo 'Total dessa fatura' → stub (sessão só abre via comando)", () => {
  const r = decidirFluxoBuffer({ aberto: "não" }, "texto-livre", AMOSTRA, AGORA, TTL);
  assert.strictEqual(r.acao, "stub-nl");
});

// ─── mitigação do race: orientação quando parece fatura sem sessão (rev #9) ──
teste("pareceFatura: ≥2 'R$' ou ≥3 linhas com centavos → true; texto curto de NL → false", () => {
  assert.ok(pareceFatura(AMOSTRA));                               // fatura real
  assert.ok(pareceFatura("Uber\nR$ 12,90\nIfood\nR$ 45,00\nFarmácia\nR$ 8,50")); // ≥3 linhas c/ valor
  assert.ok(!pareceFatura("quanto gastei em maio?"));             // sem valor
  assert.ok(!pareceFatura("gastei R$ 50 com pizza"));             // 1 R$, sem centavos
});

teste("texto-livre sem sessão que PARECE fatura → orienta a recolar (não stub de NL)", () => {
  // 2ª parte da colagem chega sem /faturaaberta (race) → orientação, não o stub genérico
  const r = decidirFluxoBuffer({ aberto: "não" }, "texto-livre", PARTE2, AGORA, TTL);
  assert.strictEqual(r.acao, "stub-nl");
  assert.strictEqual(r.resposta, ORIENTACAO_FATURA);
  assert.ok(r.resposta.includes("/faturaaberta"));
});

teste("texto-livre sem sessão que NÃO parece fatura → stub de NL normal", () => {
  const r = decidirFluxoBuffer({ aberto: "não" }, "texto-livre", "gastei R$ 50 com pizza", AGORA, TTL);
  assert.strictEqual(r.resposta, STUB_NL);
});

teste("texto-livre com sessão EXPIRADA (TTL) → stub, não anexa", () => {
  const estado = { aberto: "sim", texto_acumulado: PARTE1, atualizado_em: AGORA - (TTL + 1) };
  const r = decidirFluxoBuffer(estado, "texto-livre", PARTE2, AGORA, TTL);
  assert.strictEqual(r.acao, "stub-nl");
});

teste("estouro: soma > total → estouro, buffer preservado, sem flush", () => {
  // duplica um lançamento para a soma passar do Total
  const linhaDup = "Supermercado\nEXTRA DUPLICADO\nR$ 1.000,00\nR$ 1.000,00";
  const r = decidirFluxoBuffer({}, "fatura-aberta-cmd", "/faturaaberta\n" + AMOSTRA + "\n" + linhaDup, AGORA, TTL);
  assert.strictEqual(r.acao, "estouro");
  assert.strictEqual(r.aberto, true);
  assert.ok(r.resposta.includes("passou do Total"));
});

console.log(`\n${passou} testes passaram.`);
