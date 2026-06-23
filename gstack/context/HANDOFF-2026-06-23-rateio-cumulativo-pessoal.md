# Handoff — Rateio cumulativo, depósito do Marcelo, gastos exclusivos e movimentação pessoal (2026-06-23)

Para o próximo agente. Continua após `HANDOFF-2026-06-22-comprometido-futuro-e-buffer.md`. Branch
`feat/dashboard-web`. **Tudo entregue, testado (243 testes), deployado e validado ao vivo.** Spec
única (fonte de verdade, com 2 iterações): `gstack/plans/rateio-cumulativo-e-gastos-exclusivos.md`
— leia inteira, incluindo o **Adendo de movimentação pessoal**.

## O que motivou (conferência do dashboard ao vivo)
O Marcelo achou que o depósito de R$ 10.400 sumia, o saldo com a casa era só do mês (não detectava
dívida acumulada), faltavam categorias de gasto exclusivo, e havia um pass-through pessoal pela conta
sendo tratado errado. Quatro frentes nesta sessão (decisões travadas via AskUserQuestion + 1 correção).

## O que foi entregue (não duplico — ver spec/diff)

1. **Depósito do Marcelo (bug):** Dicionário `MARCELO SILVA LEITE → Depósito Marcelo/Retirada` (pseudo
   novo no `parser-conta.js`: entrada→`Depósito Marcelo`, saída→`Saída para o Marcelo`). 6 entradas
   dele estavam em "Pagamento" (transferência, descartadas) ≈ R$ 57k → reclassificadas p/ contribuição.
2. **Saldo cumulativo:** `rateioAcumulado` em `rateio.js` (soma meses `mesDe ≤ mesAte`; descarta
   `mesDe===null`). Webhook `dashboard-data` expõe `rateio` cumulativo (`acumulado:true`); cards do
   React rotulam "(acum. até MM/YYYY)". Mudar o mês move o teto.
3. **Gastos exclusivos:** categorias `Gastos Marcelo`/`Gastos Harumi` — saem da base dividida e são
   cobradas 100% do dono (`cota[p] = base×prop[p] + exclusivo[p]`). Conservação `Σcotas = totalDespesas`
   garantida (última pessoa absorve o resíduo de arredondamento — evita dívida-fantasma de R$ 0,01).
4. **Buffer (mitigação leve):** `fatura-buffer.js` — texto livre sem sessão que **parece fatura**
   (`pareceFatura`: ≥2 "R$" OU ≥3 linhas com centavos) responde orientação p/ recolar via `/faturaaberta`,
   em vez do stub de NL. Arquitetura do race NÃO tocada (decisão do Marcelo).
5. **Movimentação PESSOAL (adendo/correção):** pass-through pela conta (R$ de terceiros que eram do
   Marcelo + Pix de volta p/ ele). Categorias `Depósito para o/a {pessoa}` e `Saída para o/a {pessoa}`.
   `ehMovimentacaoPessoal` (prefixos `deposito para `/`saida para `). **Neutra ao rateio**; **aparece**
   no fluxo de caixa (`totaisMes`) mas **não** no treemap de gastos da casa (`gastosPorCategoria`).
   ⚠️ Substituiu uma 1ª tentativa errada ("Saque que abate contribuição") — o saque casava com depósitos
   de terceiros, não com a contribuição do Marcelo. Categorias órfãs `Saque ...` foram removidas.

## Estado / validado ao vivo
- Webhook (mês 05/2026): fluxo de caixa entradas R$ 47.743,43 / saídas R$ 46.251,84 (tudo aparece);
  rateio `Σcotas = totalDespesas = R$ 60.384,89` (conservação ok); pessoal fora do treemap.
- Migração `scripts/migrar-deposito-marcelo-e-gastos-exclusivos.py` **idempotente, já executada**
  (converge ao estado final; auditoria na aba Log). Toca só a coluna `categoria`.
- Dashboard dev server em `http://localhost:5173/` (background `npm run dev`).
- 13 workflows reimportados e ativos; `dashboard`, `ingestao-csv-conta`, `relatorio-*` regenerados.

## Pendências / follow-ups (não-bloqueantes)
- **Conferir (Marcelo):** os 6 Pix recebidos de "MARCELO SILVA LEITE" (≈R$ 57k) seguem como
  `Depósito Marcelo` (contribuição). Dado o pass-through, ver se algum era pessoal → `Depósito para o Marcelo`.
- Futuros depósitos pessoais de terceiros não se auto-categorizam (sem regra) — categorizar manual.
- `workflows/src/dashboard-template.html` é arquivo morto (nenhum workflow o serve) — candidato a remoção.
- Herdada: ajustes em Contas Fixas (Personal/Gás/Condomínio/Tênis) — em aberto.
- Herdada: `categorizar`/`processarExtrato` comparam título com `includes` sem normalizar acento.

## Gotchas (reforçados nesta sessão)
- **Deploy:** `& ".\scripts\import-workflows.ps1"` direto (nunca via pipe `| Select-String` no PS 5.1 —
  stderr do PostHog vira NativeCommandError). Pós-restart, esperar `healthz` antes de bater no webhook.
- **Lógica pura concatenada:** mudou `rateio.js`/`dashboard.js`/`parser-conta.js`/`fatura-buffer.js` →
  regerar TODOS os workflows que os embarcam (dashboard, relatorio, conta, fatura-buffer) e reimportar.
- **Python:** `py` (não `python`). Scripts read-only de diagnóstico: criar `.consulta-temp.py`, rodar, apagar.
- **Conservação contábil:** dividir base entre N pessoas exige a última absorver o resíduo (senão R$ 0,01 órfão).

## Skills sugeridas
- `graphify` — registro de sessão no Vault (feito) + mapa do repo antes de mexer.
- `plan-reviewer`/`code-reviewer`/`workflow-qa` — manter os gates ao mexer em workflow.
- `test-driven-development`/`verification-before-completion` — suíte + conferência ao vivo.
- `handoff` — ao encerrar a próxima sessão.
