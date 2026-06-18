# Handoff — Item 10 `gerenciar-metas` CONCLUÍDO + shipado (2026-06-17)

Para o próximo agente. Não duplica conteúdo: referencia spec/plano/handoffs anteriores.
Continua `HANDOFF-2026-06-16-item9.md` e a cadeia anterior.

## Onde paramos

**Item 10 encerrado — era o ÚLTIMO de feature. Todos os 11 workflows de produção construídos.**
Resta só o backlog de produção (deploy clawdinho + rotação de segredos + planilha → Restrito).

## O que foi feito (item 10 — gerenciar-metas)

### Spec e plano
- `gstack/specs/gerenciar-metas.md` — plan-reviewer: APROVAR COM AJUSTES → 6 correções aplicadas.
- `gstack/plans/gerenciar-metas.md` — aprovado; tem seção **"Limitações conhecidas"** (corrida de duplo-clique).

### Lógica pura (TDD) — `workflows/src/metas.js` (19 testes)
- `calcularProgresso` — **derivado** dos Lançamentos: Σ |valor| dos `confirmado` com
  `id_meta == nome`, **match exato após TRIM dos dois lados** (espaço de borda soma;
  capitalização diferente NÃO soma). `pct` null se orçamento 0.
- `montarMensagemMetas` / `montarTecladoMetas` / `montarTecladoConfirmarEncerrar`.
- `parsearNovaMeta` (`/novameta <nome> | <orçamento> | <prazo>`, valor BR), `validarNomeMeta`
  (sem `|`, ≤64 bytes), `nomeJaExisteAtiva`, `parsearCallbackMetaGestao` (`gmnova|/gmenc|/gmok|`).

### Roteador — `workflows/src/roteador.js` (20 testes)
- `/metas` → `{rota:"metas"}`; `/novameta` → `{rota:"nova-meta", texto}`; callbacks
  `gmnova|gmenc|gmok` → `destino:"gerenciar-metas"`. **`meta|` (associação da categorização)
  preservado** — teste explícito de não-regressão. `RESPOSTAS.boasVindas` atualizada.

### Workflows — `scripts/gerar-workflow-metas.js`
| Workflow | Id | Papel |
|----------|-----|-------|
| `gerenciar-metas` (31 nós) | `FinGerirMetas001` | trata /metas, /novameta e os 3 callbacks |
| `teste-metas` (2 nós) | `FinTesteMetas001` | harness DRY-RUN (POST `/webhook/teste-metas`) |

- Node **Decidir**: roteia por `acao` (metas|nova-meta|callback) e emite itens marcados por
  `fase` (listar/cache/criar/avisar/template/confirmar/encerrar/recusar) → cadeia de IFs.
- `valor_acumulado` = **cache** reescrito no /metas via `values:batchUpdate` (RAW,
  `onError:continueRegularOutput`). A coluna C **nunca é fonte** — zero acoplamento ao item 9.
- Encerrar = update por linha (`status=encerrada`) + Log; **invariante**: não toca em Lançamentos.
- `scripts/gerar-workflow-roteador.js` → `roteador-central.json` (37 nós) com dispatch
  `É Metas?` / `É Nova Meta?` / `Gestão Metas?`.

### Decisão de spec resolvida (registre se mexer no progresso)
A spec tinha conflito interno: critério (linha 129) diz que `id_meta` com espaço de borda
NÃO soma; decisão de arquitetura travada (linha 107) diz trim dos dois lados → borda SOMA.
**Seguimos a decisão travada** (financeiramente correta). Ambos os revisores concordaram.

## Verificação
- Unitários: 19 (metas) + 20 (roteador); suíte completa (11 arquivos) verde.
- **Glue real do node Decidir** extraído do JSON e rodado contra estado simulado: 8 cenários OK.
- code-reviewer: apto, 0 bloqueantes (2 fixes aplicados). workflow-qa: **APROVADO PARA SHIP**.

## Estado do git
- Branch: `feat/dashboard-web`. **HEAD = `c773bd8`** "feat(metas): gerenciar metas via Telegram"
  (11 arquivos, só item 10). `.graphifyignore` e `graphify-out/` ficaram **fora** do commit (untracked).
- **Push ao GitHub NÃO feito** (não solicitado) — remote `origin`
  (`https://github.com/marcelochap/bot-financeiro-pessoal.git`) já configurado de antes.

## Estado do n8n
- `import-workflows.ps1` rodado no **n8n local (dev)**: 16 workflows importados, 11 de
  produção reativados (incl. `gerenciar-metas`). `teste-metas` **inativo** por design
  (webhook sem auth) — p/ smoke testar: `docker compose exec n8n n8n update:workflow
  --id=FinTesteMetas001 --active=true ; docker compose restart n8n`, depois
  `POST /webhook/teste-metas` com `{acao, texto|data, estado:{metas,lancamentos}}`.

## Próximo passo imediato

Não há mais feature. **Backlog de produção** (não bloqueante, sem ETA — depende do clawdinho voltar):
- Importar todos os workflows no n8n de **produção (clawdinho)** + re-vincular credenciais
  "Google Sheets SA" e "Telegram Bot" + garantir envs (`GOOGLE_SHEETS_ID`, `TELEGRAM_CHAT_ID`,
  `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `C6_ZIP_PASSWORD` real) + `setWebhook`.
- Smoke test real do item 10 via Telegram (/metas, /novameta, encerrar).
- Push do `c773bd8` quando o Marcelo quiser.
- Itens herdados: rotação de segredos; planilha → Restrito; desativar `teste-*` antes de expor URL.

## Limitação conhecida (aceita)
Corrida de duplo-clique em `gmok|` / `/novameta` homônimo: roteador despacha com
`waitForSubWorkflow:false` e a proteção é por leitura-antes-de-escrita do snapshot → janela
~1–2 s pode gravar 2 logs / criar 2 metas homônimas. Risco mínimo em bot de usuário único;
endurecer (lock via `answerCallbackQuery` ou releitura) só na fase multi-usuário (fase 3+).
O harness dry-run é sequencial e não exercita essa corrida.

## Pegadinhas operacionais herdadas
Ver `HANDOFF-2026-06-16-item8.md` / `item9.md`: `n8n import:workflow` desativa tudo
(sub-workflows via Execute Workflow precisam reativar + restart); `docker compose up -d`
recarrega `.env` (não `restart`); leitura única via `values:batchGet`; nós Telegram com
`appendAttribution:false`. Todas continuam válidas.
