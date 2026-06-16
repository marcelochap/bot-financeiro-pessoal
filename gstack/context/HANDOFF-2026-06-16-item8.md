# Handoff — Item 8 relatorio-mensal CONCLUÍDO (2026-06-16)

Para o próximo agente. Não duplica conteúdo: referencia plano/Vault por caminho.
Continua `HANDOFF-2026-06-15.md` (seed + dashboard) e `HANDOFF-2026-06-11.md` (infra 1–6).

## Onde paramos
**Item 8 (relatorio-mensal) buildado, revisado e validado E2E ao vivo.** Falta só
**commitar** (e o push ao GitHub segue bloqueado — ver `HANDOFF-2026-06-15.md`).

Restam de feature: **item 10 (`gerenciar-metas`)**. Backlog de produção:
deploy clawdinho + rotação de segredos + planilha a Restrito.

## O que foi feito
- Lógica pura `workflows/src/relatorio.js` (+6 testes) reusando `dashboard.js`/`rateio.js`.
- `roteador.js`: `/relatorio` → `rota: "relatorio"` (+1 teste); `boasVindas` atualizada.
- `scripts/gerar-workflow-relatorio.js` → 3 workflows: `relatorio-mensal` (cron dia 1
  09:00, idempotente via Log), `relatorio-sob-demanda` (chamado pelo roteador, read-only),
  `teste-relatorio` (harness, só modo comando).
- `scripts/gerar-workflow-roteador.js`: despacha `/relatorio` → relatorio-sob-demanda.
- **131 testes verdes** (124 → +7).

## Fonte de verdade
- Plano: `gstack/plans/relatorio-mensal.md` (decisões travadas + critérios).
- Nota de sessão: `C:\Vault\01_Projetos\bot-financeiro\sessoes\2026-06-16-item8-relatorio-mensal.md`.

## Decisões travadas (NÃO reabrir)
Compacto: gastos do mês + rateio + contas fixas do mês vigente (datas + fatura cartão,
empregada agrupada "sextas") + link da planilha • sem imagem de gráfico • cron = mês
anterior, /relatorio = mês vigente, contas fixas = sempre mês vigente • só o chat do
Marcelo (Harumi audita no Sheets) • previsão FORA da v1.

## Pegadinhas operacionais (n8n 2.x) — CRÍTICO para re-deploy
1. `n8n import:workflow` **desativa TODOS** os workflows. Após importar, reativar os 13
   ids com `n8n update:workflow --id=<ID> --active=true` e **reiniciar** o container
   (a CLI avisa: "changes will not take effect if n8n is running").
2. Sub-workflows chamados via **Execute Workflow precisam estar ATIVOS** ("Workflow is
   not active and cannot be executed"). Os 6 sub-workflows (aplicar-categoria,
   categorizacao-hibrida, ingestao-csv-cartao/conta, responder-lembrete,
   relatorio-sob-demanda) têm `active:false` no JSON mas DEVEM ser ativados no n8n.
3. Re-rodar testes: `node workflows/src/<nome>.test.js`. NUNCA editar JSON à mão —
   regenerar com `node scripts/gerar-workflow-relatorio.js` (+ roteador).

## Achados de segurança a lembrar (não bloqueante)
- O webhook `teste-relatorio` (e os outros `teste-*`) não têm auth — **desativá-los antes
  de expor o n8n publicamente** (entra no checklist de deploy). Read-only e chat fixo no
  dono mitigam, mas não deve ir à URL pública assim.

## E2E verificado
`POST /webhook/teste-relatorio {"hoje":"2026-05-31"}` → relatório de maio/2026 ao Telegram;
render sobre os 443 lançamentos reais bate ao centavo com o Dashboard (Saídas R$ 15.981,37;
acerto Marcelo 2.018,81 / Harumi 1.163,56).

## Suggested skills
- `subagent-driven-development` (item 10: plan-reviewer → build → code-reviewer → QA → cso).
- `verification-before-completion` (rodar testes + E2E read-only antes de marcar ✅).
- `handoff` (ao encerrar, atualizar este doc + `log.md` do Vault).
