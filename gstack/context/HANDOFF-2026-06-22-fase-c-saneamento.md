# Handoff — Fase C do saneamento executada e validada em runtime (2026-06-22)

Para o próximo agente. Continua após `HANDOFF-2026-06-19-teste-manual-correcoes.md`.
Não duplica: ver a spec `gstack/specs/saneamento-dados-e-pagamento-cartao.md`, o commit
`4827ef8` e a nota da sessão no Vault
(`C:\Vault\01_Projetos\bot-financeiro\sessoes\2026-06-22-fase-c-saneamento-runtime.md`).

## Onde paramos
**Fase C do bloco 6 (saneamento do relatório) CONCLUÍDA e validada com o Marcelo.** Os 5 passos
do plano passaram; um bug não previsto apareceu no meio (parser travava na linha aspeada do C6)
e foi corrigido com TDD. Commit `4827ef8` em `feat/dashboard-web`. Árvore limpa.

## O que foi feito (em ordem)
1. **Gate de locale — PASSOU.** Workflow scratch (Set→googleSheets append, clone fiel do nó de
   produção: v4.5, `serviceAccount`, `USER_ENTERED`) gravou numa aba `_gate_locale` e a leitura
   `UNFORMATTED_VALUE` provou: **número JS `1011.87` grava como número nativo** e
   **`"10/06/2026"` como data nativa** pelo caminho real do n8n (locale pt_BR). **Não há coerção
   a texto** — o medo da spec (causa-raiz #1) era infundado para o caminho n8n. Reimport seguro.
   (Confirmado também que os parsers emitem `valor` numérico: `parser-conta.js:86`,
   `parser-cartao.js:141`.)
2. **Regra do Dicionário — confirmada ao vivo.** `PGTO FAT CARTAO C6 → Pagamento/Retirada`
   (origem=conta, criada 16/06) **já existia** na planilha. Nada a inserir.
3. **Backup + wipe + reimport.** Backup `Lançamentos_backup_2026-06-19` (aba duplicada via SA) →
   `clear Lançamentos!A2:J` → reimport de **1 extrato (`01KV8SC8…csv`) + 1 fatura
   (`Fatura_2026-06-10.csv`)** via os harnesses `teste-conta`/`teste-cartao` (cada um lê 1 CSV
   local e chama o sub-workflow real; **a confirmação humana via Telegram é preservada**).
   Resultado: **72 lançamentos** (52 cartão + 20 conta), checksum cartão = 9363.91 (= parser),
   **0 duplicatas**, datas serial nativas e valores numéricos (verificado célula a célula).
4. **/relatorio — bate.** A saída ao vivo é **idêntica** à computada com os módulos reais sobre a
   planilha saneada (junho/2026): Cartão C6 = **R$ 9.363,91** (fatura líquida), `PGTO FAT CARTAO`
   fora dos totais (transferência), Saídas R$ 13.330,22. Sem `NaN`, sem dupla contagem.
5. **Duplicatas 497/502 — não reapareceram.** A contingência não foi necessária;
   `faturaJaImportada` **não** precisou ser endurecido.

## Bug-surpresa corrigido (TDD) — o achado real desta sessão
- **A linha INTEIRA do extrato C6 pode vir envolta em aspas** com aspas internas duplicadas
  (amostra real `01KV8SC8…csv`, **linha 24** = Pix de MARCOS, R$ 3000). `splitLinha` (RFC 4180)
  colapsava `""→"` e devolvia a linha como **1 campo** → `esperadas 7 colunas, vieram 1` →
  workflow travava na ingestão.
- **A Fase B cobriu o caso ERRADO:** o teste "campo totalmente aspeado" (`parser-conta.test.js`)
  era um *campo* com vírgulas internas (RFC 4180 normal), não a *linha inteira* aspeada. O
  handoff de 19/06 rotulou mal. Lição: o CSV com o quirk (`01KV8SC8`) nunca esteve nos fixtures —
  o de teste era `01KTRWXKPT…csv`.
- **Fix:** `processarExtrato` re-splita o conteúdo desembrulhado quando vem 1 campo e esperam-se 7
  (`workflows/src/parser-conta.js`). +1 teste com a forma real (**206 verdes**). Workflow
  `ingestao-csv-conta.json` regenerado e reimportado. **`parser-cartao` NÃO foi espelhado** (a
  fatura atual não tem o quirk) — follow-up defensivo em aberto.

## Itens residuais (não bloqueiam nada)
- **Backup `Lançamentos_backup_2026-06-19`** mantido na planilha (rede de segurança) — apagar
  quando o Marcelo estiver confiante.
- **Workflow `teste-gate-locale`** ainda no n8n, **desativado** (a CLI do n8n 2.x **não tem
  `delete:workflow`**) — apagar pela UI se quiser sumir de vez. A aba scratch `_gate_locale` já
  foi removida.
- **`_tmp-diag-lanc`** continua no n8n (de sessão anterior) — limpar quando for conveniente.
- **Harness `teste-ingestao-conta`** ficou apontado para `01KV8SC8…csv` (era `01KTRWXKPT…`) — por
  decisão do Marcelo, mantido (é o CSV com o caso aspeado).

## Operação (n8n) — pegadinhas reconfirmadas
- CLI via `docker compose exec -T n8n n8n ...`; imports vêm de `/workflows` (montado). No **Git
  Bash, usar `MSYS_NO_PATHCONV=1`** senão `/workflows/...` vira `C:/Program Files/Git/...`.
- `import:workflow` **desativa** o que importa → reativar prod/sub-workflows/`roteador-central`
  (`update:workflow --id=… --active=true`) + `docker compose restart n8n`.
- **Os harnesses `teste-*` têm webhook GET** — um simples GET de "ping" no endpoint **dispara o
  workflow**. Não usar GET no endpoint real como health-check.
- Confirmação de importação = `sendAndWait` (approval) → **exige `WEBHOOK_URL` público (ngrok)** e
  o **toque do Marcelo** no Telegram. Túnel estava no ar (`echo-greasily-unclad.ngrok-free.dev`).
- Ops de Sheets via SA local `credentials/bot-financeiro-sa.json` + `py` (launcher 3.13).

## Fora de escopo (continuam pendentes)
- v2 da fatura-aberta: bloco React "Comprometido futuro" + de-para de categorias C6→projeto.
- Fix do bloco 3 (confirmação 3×) — aguarda evidência de execuções/`update_id`.
- Follow-up: espelhar o desembrulho de linha aspeada no `parser-cartao.js` (defensivo).

## Skills sugeridas para o próximo agente
- `graphify` — explorar o repo/relacionamentos (mapa em `graphify-out/`) antes de mexer.
- `plan-reviewer` / `code-reviewer` / `workflow-qa` — se for tocar workflows de novo (ciclo gstack).
- `verification-before-completion` — rodar a suíte e conferir ao vivo antes de declarar pronto.
- `handoff` — ao encerrar a próxima sessão.
