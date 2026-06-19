# Handoff — Teste manual ponta a ponta + correções (blocos 3–8) e Fase A/B do saneamento (2026-06-19)

Para o próximo agente. Continua após `HANDOFF-2026-06-18-fatura-aberta.md`. Não duplica:
referencia a spec `gstack/specs/saneamento-dados-e-pagamento-cartao.md` e a nota da sessão no
Vault (`C:\Vault\01_Projetos\bot-financeiro\sessoes\2026-06-19-teste-manual-correcoes-e-saneamento.md`).

## Onde paramos
O Marcelo testou o bot **manualmente, bloco a bloco, via Telegram real** (antes de partir pro
dashboard v2). 6 achados. Esta sessão corrigiu o que dava sem tocar em produção, e travou o
plano do achado mais pesado (relatório). **Falta a Fase C (migração) — é o próximo passo.**

## Estado por bloco

| # | Funcionalidade | Estado |
|---|---|---|
| 3 | Confirmação da conta **3×** | 🐛 **bug conhecido não-crítico**. Workflow interno OK (Parser colapsa p/ 1 item, Confirmação 1×/exec). 3 confirmações = **3 execuções** do sub-workflow. Falta evidência (contagem de execuções + se o `update_id` se repete) p/ decidir o fix: idempotência por `update_id` (re-entrega Telegram) **ou** colapso de CSVs (fan-out de ZIP `mode:each`). |
| 4 | `/categorizar` | ✅ **corrigido**. `Resolver` devolvia `[]` sem pendência → silêncio. Agora sempre emite resumo. `gerar-workflow-categorizacao.js` + `categorizacao-hibrida.json` regerado. |
| 5 | Lembretes (`Decidir` "sem saída") | ✅ **não é bug** — trava do harness (só aceita `hoje=2024-MM-DD`, p/ não poluir o Log vivo de 2026). Testar com `hoje=2024-07-05` (sex+dia05 → Condomínio/Tênis/Personal D0 + Empregada). Re-teste: trocar de mês. |
| 6 | `/relatorio` não bate | ✅ **Fase A/B feitas** (ver abaixo). 🔲 **Fase C pendente**. |
| 7 | `/dashboard` mudo | ✅ **corrigido**. Faltava `DASHBOARD_URL` na lista `environment` do `docker-compose.yml`. Falta `docker compose up -d`. |
| 8 | Separador `\|` do `/seedparcelas` | ✅ **corrigido**. Aceita `;` (canônico) + `\|` (retrocompat). `fatura-aberta.js` + `fatura-aberta.json` regerado. |

## Bloco 6 — saneamento do relatório (o trabalho principal)

**Decisões do Marcelo (travadas na spec):** corrigir na raiz + **descartar o legado** (wipe
total, sem re-seed do razão) + **reusar `Pagamento/Retirada`** como rótulo do pagamento da
fatura (sem categoria nova).

**plan-reviewer: GO-com-correções.** Pegou 3 erros do diagnóstico inicial (todos verificados):
1. Causa do "texto": `seed-parser` emite **valor numérico**; o defeito do seed é a **data**
   (`valueInputOption=RAW`). Valor-texto vem dos **imports n8n** (`USER_ENTERED`+locale pt_BR).
2. **Não criar categoria nova** — `ehTransferencia`/`CATEGORIAS_TRANSFERENCIA` já existem em
   `rateio.js` e `dashboard.js` já exclui. Reusar via Dicionário.
3. Bug extra no escopo: `relatorio.js:contasFixasDoMes` somava `origem=cartao` sem filtrar
   transferência/status e contava estorno (entrada) como **positivo** → inflava.

**Descritor real do pagamento** (amostra `Dados CSV/01KV8S…csv`): Título `PGTO FAT CARTAO C6`,
Descrição `Fatura de cartão`. A regra **já está** no seed (`gerar-planilha-inicial.py:51`).

### Fase A (TDD) — correção do relatório — FEITA
- **`valorNum`** novo em `rateio.js` (parseia `1.011,56`/`1011.87`/`R$ …` sem `NaN`), aplicado
  em `rateio.js`, `dashboard.js`, `relatorio.js`.
- **`relatorio.js:contasFixasDoMes`** corrigido: fatura **líquida** (saídas − créditos/estornos),
  exclui `ehTransferencia`. Espelha `resumo.total` do parser-cartao.

### Fase B (TDD) — pagamento da fatura + robustez — FEITA
- Teste travando: `PGTO FAT CARTAO C6` (saída) → `Retirada` → `ehTransferencia` exclui dos totais
  (`parser-conta.test.js`).
- Teste unitário do `splitLinha` p/ linha totalmente aspeada com vírgulas internas.

**Suíte: 196 → 205 testes verdes, 0 falhas.** Arquivos tocados: `rateio.js`, `dashboard.js`,
`relatorio.js`, `parser-conta.test.js`, `rateio.test.js`, `relatorio.test.js`. Workflows
regerados: `relatorio-mensal`, `relatorio-sob-demanda`, `dashboard`, `fatura-aberta`,
`categorizacao-hibrida`.

### Fase C — PENDENTE (runtime, com o Marcelo) — próximo passo
1. **Gate de locale ANTES do wipe:** 1 append numa aba scratch (mesmo nó googleSheets,
   `USER_ENTERED`, mesma SA) com valor+data conhecidos; ler de volta com `ISNUMBER()`/`ISTEXT()`.
   Se `1011.87` virar texto → corrigir o caminho de escrita (enviar valor numérico) antes de migrar.
2. **Confirmar a regra `PGTO FAT CARTAO C6` no Dicionário ao vivo** (a planilha pode ter sido
   populada antes da regra existir no seed).
3. **Wipe** `Lançamentos!A2:J` → **reimportar** extrato(s)+fatura via n8n (uma vez cada),
   conferindo contagem + checksum.
4. **`/relatorio`** confere com a conferência manual na planilha.
5. (se 497/502 reaparecerem) endurecer `faturaJaImportada` — anexar as 2 linhas reais antes.

## Operação — o que reimportar/recriar no n8n
- `docker compose up -d` (recarrega `.env` com `DASHBOARD_URL`).
- Reimportar e **reativar**: `categorizacao-hibrida`, `fatura-aberta` (import desativa tudo —
  conferir que sub-workflows via Execute Workflow e o `roteador-central` voltam ativos).

## Git
- Branch `feat/dashboard-web`. Mudanças desta sessão **commitadas** ao final (blocos 4, 6-A/B,
  7, 8 + spec + este handoff + nota do Vault). PR #1 segue aberto contra `master`.

## Fora de escopo desta sessão (continuam pendentes)
- v2 da fatura-aberta: bloco React "Comprometido futuro" + de-para de categorias C6→projeto.
- Fix do bloco 3 (aguarda evidência de execuções/`update_id`).
