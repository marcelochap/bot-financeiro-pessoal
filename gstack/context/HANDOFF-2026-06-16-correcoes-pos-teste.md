# Handoff — Correções pós-teste (2026-06-16)

Para o próximo agente. Continua `HANDOFF-2026-06-16-item9.md`.
Estado: modelo trocado para claude-sonnet-4-6 durante a sessão.

## O que foi feito nesta sessão

### Contexto de onde veio
Deploy realizado e testado manualmente pelo Marcelo. Feedback: 4 bugs encontrados.

### Correção: webhook mudo (concluída antes desta sessão, documentada aqui)
O `setWebhook` estava apontando para o path de um Telegram Trigger antigo (`/webhook/<uuid>/webhook`).
Corrigido: `scripts/registrar-webhook-telegram.ps1` criado (ASCII-safe para PS 5.1).
Encadeado no fim de `scripts/atualizar-webhook-ngrok.ps1` para reapontar sempre que a URL muda.

### Correção: datas sumiam no relatório/dashboard (concluída antes desta sessão)
- `mesDe` (rateio.js) passou a aceitar serial/ISO/DD-MM-YYYY (TDD, ancorado em seriais reais).
- Ingestões: `cellFormat: USER_ENTERED` para datas entrarem como Data real (provado seguro para valores decimais).
- JSONs de ingestão/dashboard/relatorio regenerados.

### Deploy: import-workflows.ps1 (concluído antes desta sessão)
Contornou a pegadinha do n8n 2.x (import desativa tudo): reativa os 10 workflows de produção + restart.
Problema de encoding resolvido: arquivo em ASCII-only (PS 5.1 lê .ps1 sem BOM como cp1252; em-dash causa parse error).

### Fix #1 — rodapé "This message was sent automatically with n8n" (CONCLUÍDO)
`appendAttribution: false` adicionado em **todos os 18 nós Telegram nativos** e nos 2 nós `sendAndWait`:
- `gerar-workflow-roteador.js`
- `gerar-workflow-cartao.js` (telegramMsg + sendAndWait Confirmação)
- `gerar-workflow-conta.js` (telegramMsg + sendAndWait Confirmação)
- `gerar-workflow-categorizacao.js`
- `gerar-workflow-lembretes.js`

JSONs regenerados: roteador-central, ingestao-csv-cartao, ingestao-csv-conta, categorizacao-hibrida, aplicar-categoria, lembretes-agendados, responder-lembrete. **Aplica no próximo import.**

### Fix #2 — pagamento da fatura duplicava gasto (CONCLUÍDO no código, pendente na planilha)
**Diagnóstico:** a fatura do cartão lança cada compra como `origem=cartao`; o extrato da conta tem uma
linha "PGTO FAT CARTAO C6" como saída `origem=conta`. As agregações somavam os dois — gasto duplicado.

**Código (26 testes verdes):**
- `rateio.js`: nova função `ehTransferencia` + constante `CATEGORIAS_TRANSFERENCIA = {"pagamento","retirada"}`.
  `rateioMes` e `totalDespesas` excluem essas categorias.
- `dashboard.js`: `gastosPorCategoria` e `totaisMes` excluem transferências.
- `relatorio-mensal.json` e `relatorio-sob-demanda.json` regenerados (os três módulos são concatenados inline).
- `gerar-planilha-inicial.py`: nova regra no seed `["PGTO FAT CARTAO C6", "Pagamento/Retirada", "conta", ...]`.
- Suítes: rateio 14, dashboard 6, relatorio 6 — todos passando.

**Pendente na planilha (2 escritas, ainda não feitas):**
1. Adicionar regra `PGTO FAT CARTAO C6 → Pagamento/Retirada` na aba Dicionário (origem=conta).
2. Reclassificar a linha já importada do pagamento da fatura: trocar categoria de `""` ou errada para `Retirada`
   (uma vez manual, ou via script — a linha está em Lançamentos, origem=conta, valor 9363.91, 11/06/2026).

### Diagnóstico do blocker de import do extrato atual
- Extrato 17/05–16/06/2026 foi recusado como "retroativo": marco da conta estava em 10/09/2026.
- Causa: linhas origem=conta datadas no dia 10 de meses futuros (07/08/09/2026) com status `confirmado`
  (deveriam ser `previsto`). São compras do cartão seed com datas deslocadas.
- Diagnóstico completo em `scripts/_diag_marco.py` (read-only, throwaway — pode deletar).
- **Decisão do Marcelo:** ele corrige as datas manualmente na planilha; deploy pode esperar isso.

### Fix #3 e #4 — pendentes (próximos nesta sessão ou na seguinte)
- **#3** "🤔 Como categorizar? R$ · · 46188": valor não aparece + final do cartão sem vírgula.
- **#4** Dashboard dá link inválido `{{ $env.DASHBOARDURL || 'http://localhost:5173' }}`.

## Estado dos workflows e JSONs

Workflows regenerados mas **ainda não importados no n8n** (fazê-lo após todos os fixes da sessão):
- roteador-central.json ← appendAttribution
- ingestao-csv-cartao.json ← appendAttribution + USER_ENTERED
- ingestao-csv-conta.json ← appendAttribution + USER_ENTERED
- categorizacao-hibrida.json ← appendAttribution
- aplicar-categoria.json ← appendAttribution
- lembretes-agendados.json ← appendAttribution
- responder-lembrete.json ← appendAttribution
- relatorio-mensal.json ← ehTransferencia (src concatenado)
- relatorio-sob-demanda.json ← ehTransferencia (src concatenado)
- dashboard.json ← USER_ENTERED (gerado antes desta sessão)

Workflows ainda NÃO regenerados:
- dashboard.json não precisa (dashboard.js é chamado pelo runner Python, não Code node n8n).

## Estado do git

- Último commit: `d991d21` (master, antes do item 8/9 e destas correções)
- Todos os itens 8/9 + correções desta sessão estão **uncommitted**.
- Push ao GitHub ainda bloqueado (sem remote `origin`). Para destravar: ver log.md [2026-06-16].
- Para fazer um commit único desta sessão: `git add -A` (exceto .env / Dados CSV / credentials) e commit.

## Pegadinhas operacionais (acumuladas)

1. **n8n `import:workflow` desativa tudo** → sempre rodar `.\scripts\import-workflows.ps1` (que reativa).
2. **Sub-workflows precisam estar ativos** → o script já cuida disso.
3. **`docker compose restart` não recarrega `.env`** → usar `docker compose up -d` para mudanças de env.
4. **PS 5.1 encoding** → arquivos `.ps1` devem ser ASCII-only (ou UTF-8 com BOM).
5. **ngrok domínio estável** = `echo-greasily-unclad.ngrok-free.dev` (dev local, não o clawdinho).
6. **Webhook do Telegram** NÃO é auto-registrado (nó Webhook genérico, não Telegram Trigger) → sempre registrar via `registrar-webhook-telegram.ps1` após mudar a URL.

## Próximo passo imediato

1. Marcelo corrige as datas deslocadas na planilha (data_original das linhas futuras incorretas).
2. Adicionar regra PGTO FAT CARTAO C6 na aba Dicionário (ou via `scripts/popular-google-sheet.py` --re-seed do dicionário).
3. Fix #3 (valor vazio na pergunta de categorização) — rápido, no gerador de categorizacao.
4. Fix #4 (link do dashboard inválido) — rápido, no gerador de roteador.
5. Import único com `.\scripts\import-workflows.ps1`.
6. Re-testar os 4 pontos do feedback.
7. Commit.
8. Item 10 (gerenciar-metas) — spec → plan-reviewer → build.
