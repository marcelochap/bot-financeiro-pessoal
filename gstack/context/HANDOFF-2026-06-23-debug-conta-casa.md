# Handoff — Debug da conta da casa + previsão por vencimento + gastos exclusivos (2026-06-23)

Para o próximo agente. Continua após `HANDOFF-2026-06-23-rateio-cumulativo-pessoal.md` e
`HANDOFF-2026-06-23-detalhamento-e-previsao.md` (mesmo dia). Branch `master`. **Tudo no ar,
testado (253 testes) e validado ao vivo.** Sessão de debug do dashboard com 3 frentes + um ajuste
pontual de categoria.

## Contexto
O Marcelo conferiu o dashboard e o "Saldo com a Casa" não zerava (meta: cada mês as despesas
rateadas batem com os depósitos → saldo zero). Debug mês a mês a partir do `rateio.historico`
ao vivo revelou a causa, e surgiram 2 features + 1 reclassificação.

## O que foi entregue (ver commits; não duplico)

### 1. Debug da conta da casa → Metas fora do rateio + mês de início (commit `5bb390c`)
- **Causa do déficit (~R$ 10k):** as **Metas** (`Meta: Viagem Lua de Mel`, `Meta: IPTU` ≈ R$ 8.724)
  eram divididas como despesa da casa, inflando a cota (sobretudo do Marcelo, 83%).
- **Decisões do Marcelo:** Metas = poupança à parte → **fora do rateio e do treemap** (predicado
  `ehMeta` em `rateio.js`; excluído em `calcularRateio` e `gastosPorCategoria`; segue no fluxo de
  caixa `totaisMes`). A conta da casa **começa em 01/2026** (`Config.rateio_mes_inicio`); 12/2025
  (pré-rastreio, só empregada sem depósito) fica de fora. `rateioAcumulado` ganhou param `mesInicio`.
- **Gotcha:** o Sheets coage `"01/2026"` (USER_ENTERED) para **serial de data** — o webhook
  normaliza `/^\d+$/ → mesDe(serial) → "MM/YYYY"`.
- **Resultado real:** Metas fora, Marcelo **+crédito**, Harumi **−déficit** (ela deposita abaixo da
  cota quase todo mês — achado legítimo, não erro de categoria). Personal e Tênis ficaram
  compartilhados (decisão do Marcelo).

### 2. Coluna "Previsão" em Gastos por Categoria + 3. Fatura por vencimento (commit `0a8731d`)
- **Item 2:** `gastosPorCategoria(lancamentos, mes, contasFixas)` → `{categoria, previsto, confirmado}`.
  `previsto` vem das Contas Fixas ativas; conta fixa não-paga aparece com `confirmado=0` (front mostra
  **"a pagar"** em âmbar). Treemap e `relatorio.js` migraram para `confirmado`.
- **Item 3:** `previsaoProximoMes` só soma a fatura aberta cujo **vencimento (ciclo `10/MM`) cai no
  mês previsto** (`mesDe(normalizarCiclo(r.ciclo)) === mes`). Antes somava qualquer fatura `fechado`.

### 4. Gastos exclusivos da Harumi (LIBERDADE COMERCIO) — dado + Dicionário
- As parcelas `LIBERDADE COMERCIO DE (1/3)` e `(2/3)` reclassificadas de `Compras` → `Gastos Harumi`
  (Log `manual-harumi`). A `(3/3)` ainda não foi importada (fatura futura).
- Regra de Dicionário `LIBERDADE COMERCIO DE → Gastos Harumi` (cartao) já existe → a `(3/3)`
  auto-categoriza quando entrar.
- **Pendente (Marcelo):** revisar com a Harumi as OUTRAS despesas exclusivas dela e me passar p/
  reclassificar em lote.

## Estado / validado ao vivo
- Webhook (06/2026): card Marcelo +4.876 / Harumi −5.231 (após LIBERDADE); Metas fora; previsão
  07/2026 = fixas 5.653 + fatura que vence 10/07 (8.381,90). Gastos com Previsão|Confirmado (Luz 521/0 "a pagar").
- 13 workflows reimportados; frontend rebuildado e dev server em `http://localhost:5173/`.
- **Reclassificações de dado são auditadas na aba Log; não são mudança de repositório.**

## Gotchas reforçados
- **Deploy:** `& "<abs>\scripts\import-workflows.ps1"` direto (nunca via pipe). O cwd do PowerShell
  pode resetar — use caminho absoluto se `.\scripts\...` falhar.
- **Lógica pura concatenada:** mudou `rateio.js`/`dashboard.js`/`relatorio.js` → regerar dashboard +
  relatorio (e conta se mexer no parser) e reimportar.
- **Sheets coage texto tipo data/numero** (USER_ENTERED) — `rateio_mes_inicio` virou serial; normalizar na leitura.
- **gastosPorCategoria** agora é `{previsto, confirmado}` (não `total`) — qualquer consumidor novo deve usar `confirmado`.

## Follow-ups
- Harumi −5.231 acumulado: acerto pendente (validar com ela; pode rever proporção ou depósitos faltantes).
- Branch `recuperar-sessao-2026-06-23` ainda existe (rede de segurança do merge `ac36d4f`) — pode apagar.
- Push ao GitHub bloqueado pelo classificador (Data Exfiltration) — `master` só local.
- `dashboard-template.html` morto (remover). Contas Fixas (Personal 640, Gás, etc.) — conferir valores esperados vs reais.

## Skills sugeridas
- `graphify` (registro no Vault); `code-reviewer`/`plan-reviewer`/`workflow-qa` ao mexer em workflow;
  `test-driven-development`/`verification-before-completion`; `handoff` ao encerrar.
