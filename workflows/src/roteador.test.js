// Testes das funções puras do roteador-central (updates simulados + CSVs reais).
// Critérios: gstack/plans/roteador-central.md
// Rodar: node workflows/src/roteador.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { classificarUpdate, detectarTipoCsv } = require("./roteador.js");

const RAIZ = path.resolve(__dirname, "..", "..");
const CTX = { chatId: "111111", secret: "", headerSecret: "" };
const msg = (extra) => ({ message: { chat: { id: 111111 }, ...extra } });

let passou = 0;
function teste(nome, fn) {
  fn();
  passou++;
  console.log(`PASSOU: ${nome}`);
}

// ─── classificarUpdate: segurança ───────────────────────────────────
teste("chat_id estranho → ignorar", () => {
  const r = classificarUpdate({ message: { chat: { id: 999 }, text: "/start" } }, CTX);
  assert.strictEqual(r.rota, "ignorar");
});

teste("secret configurado e header errado → ignorar (mesmo com chat certo)", () => {
  const ctx = { ...CTX, secret: "s3gr3do", headerSecret: "errado" };
  assert.strictEqual(classificarUpdate(msg({ text: "/start" }), ctx).rota, "ignorar");
  const ctxOk = { ...CTX, secret: "s3gr3do", headerSecret: "s3gr3do" };
  assert.strictEqual(classificarUpdate(msg({ text: "/start" }), ctxOk).rota, "responder");
});

teste("callback_query sem prefixo conhecido ou update sem message → ignorar", () => {
  assert.strictEqual(
    classificarUpdate({ callback_query: { id: "1", from: { id: 111111 }, data: "outra|coisa" } }, CTX).rota,
    "ignorar"
  );
  assert.strictEqual(classificarUpdate({}, CTX).rota, "ignorar");
});

teste("callback_query cat|/meta| do dono → rota callback com destino aplicar-categoria", () => {
  const up = {
    callback_query: {
      id: "cb9", from: { id: 111111 }, data: "cat|12|Compras",
      message: { message_id: 77, chat: { id: 111111 } },
    },
  };
  assert.deepStrictEqual(classificarUpdate(up, CTX), {
    rota: "callback", destino: "aplicar-categoria", callback_id: "cb9",
    data: "cat|12|Compras", chat_id: 111111, message_id: 77,
  });
  up.callback_query.data = "meta|3|IPTU";
  assert.strictEqual(classificarUpdate(up, CTX).destino, "aplicar-categoria");
});

teste("callback_query pg|/np| do dono → rota callback com destino responder-lembrete", () => {
  const up = {
    callback_query: {
      id: "cb10", from: { id: 111111 }, data: "pg|Condomínio|2024-07",
      message: { message_id: 78, chat: { id: 111111 } },
    },
  };
  assert.deepStrictEqual(classificarUpdate(up, CTX), {
    rota: "callback", destino: "responder-lembrete", callback_id: "cb10",
    data: "pg|Condomínio|2024-07", chat_id: 111111, message_id: 78,
  });
  up.callback_query.data = "np|Empregada|2024-07-05";
  assert.strictEqual(classificarUpdate(up, CTX).destino, "responder-lembrete");
  up.callback_query.from.id = 666; // forjado → ignorar também nos prefixos novos
  assert.strictEqual(classificarUpdate(up, CTX).rota, "ignorar");
});

teste("callback_query forjado (from.id estranho) → ignorar", () => {
  const up = {
    callback_query: { id: "cb1", from: { id: 666 }, data: "cat|12|Compras",
      message: { message_id: 1, chat: { id: 111111 } } },
  };
  assert.strictEqual(classificarUpdate(up, CTX).rota, "ignorar");
});

teste("/categorizar → rota categorizar", () => {
  assert.strictEqual(classificarUpdate(msg({ text: "/categorizar" }), CTX).rota, "categorizar");
});

teste("/relatorio → rota relatorio", () => {
  assert.strictEqual(classificarUpdate(msg({ text: "/relatorio" }), CTX).rota, "relatorio");
});

teste("foto/sticker (sem text e sem document) → ignorar", () => {
  assert.strictEqual(classificarUpdate(msg({ photo: [{}] }), CTX).rota, "ignorar");
});

// ─── classificarUpdate: comandos e texto ────────────────────────────
teste("/start → boas-vindas; /dashboard,/metas → em construção", () => {
  assert.ok(classificarUpdate(msg({ text: "/start" }), CTX).resposta.includes("Bot Financeiro ativo"));
  for (const c of ["/dashboard", "/metas"]) {
    const r = classificarUpdate(msg({ text: c }), CTX);
    assert.strictEqual(r.rota, "responder");
    assert.ok(r.resposta.includes("em construção"), c);
  }
});

teste("comando com @bot e maiúsculas → reconhecido (/relatorio → rota relatorio)", () => {
  const r = classificarUpdate(msg({ text: "/Relatorio@AgenteFinanceiro_M_H_Bot" }), CTX);
  assert.strictEqual(r.rota, "relatorio");
});

teste("comando desconhecido → resposta própria; texto livre → em construção", () => {
  assert.ok(classificarUpdate(msg({ text: "/xyz" }), CTX).resposta.includes("não reconhecido"));
  const r = classificarUpdate(msg({ text: "quanto gastei em maio?" }), CTX);
  assert.ok(r.resposta.includes("linguagem natural"));
});

// ─── classificarUpdate: documentos ──────────────────────────────────
teste("documento .zip → rota documento com file_id/file_name/tipo", () => {
  const r = classificarUpdate(
    msg({ document: { file_id: "ABC123", file_name: "Fatura.zip" } }), CTX
  );
  assert.deepStrictEqual(r, {
    rota: "documento", file_id: "ABC123", file_name: "Fatura.zip", tipo_arquivo: "zip",
  });
});

teste("documento .CSV (maiúsculo) → tipo csv", () => {
  const r = classificarUpdate(msg({ document: { file_id: "X", file_name: "EXTRATO.CSV" } }), CTX);
  assert.strictEqual(r.tipo_arquivo, "csv");
});

teste("documento .pdf → responder em construção; .docx → não suportado", () => {
  assert.ok(classificarUpdate(msg({ document: { file_id: "X", file_name: "f.pdf" } }), CTX)
    .resposta.includes("PDF"));
  assert.ok(classificarUpdate(msg({ document: { file_id: "X", file_name: "f.docx" } }), CTX)
    .resposta.includes("não suportado"));
});

// ─── detectarTipoCsv: contra os arquivos REAIS ──────────────────────
teste("fatura real → cartao", () => {
  const t = fs.readFileSync(path.join(RAIZ, "Dados CSV", "Fatura_2026-06-10.csv"), "utf-8");
  assert.strictEqual(detectarTipoCsv(t), "cartao");
});

teste("extrato real (com BOM) → conta", () => {
  const t = fs.readFileSync(path.join(RAIZ, "Dados CSV", "01KTRWXKPTD3BJ86T8YNHJ0XK1.csv"), "utf-8");
  assert.ok(t.charCodeAt(0) === 0xfeff, "fixture deve manter o BOM");
  assert.strictEqual(detectarTipoCsv(t), "conta");
});

teste("conteúdo qualquer → desconhecido; vazio/null → desconhecido", () => {
  assert.strictEqual(detectarTipoCsv("a,b,c\n1,2,3"), "desconhecido");
  assert.strictEqual(detectarTipoCsv(""), "desconhecido");
  assert.strictEqual(detectarTipoCsv(null), "desconhecido");
});

console.log(`\n${passou} testes passaram.`);
