# Handoff — Item 9 dashboard CONCLUÍDO (2026-06-16)

Para o próximo agente. Não duplica conteúdo: referencia spec/plano/handoffs anteriores.
Continua `HANDOFF-2026-06-16-item8.md` (relatorio-mensal) e a cadeia anterior.

## Onde paramos

**Itens 8 e 9 encerrados nesta sessão.** Falta o **item 10 (`gerenciar-metas`)** e o backlog
de produção (deploy VPS + rotação de segredos + planilha → Restrito).

## O que foi feito (item 9 — dashboard)

### Spec e plano
- `gstack/specs/dashboard-reuniao-familiar.md` — locked.
- `gstack/plans/dashboard-reuniao-familiar.md` — aprovado pelo plan-reviewer.

### Backend n8n
- Workflow `dashboard-data` (gerador `scripts/gerar-workflow-dashboard.js`) reformulado para
  servir **JSON puro** via `GET /webhook/dashboard-data`:
  - Query param `mes` (MM/YYYY); omitido → último mês fechado.
  - Header `Authorization: Bearer <DASHBOARD_PASSWORD>` — 401 se inválido.
  - CORS habilitado (`N8N_CORS_ALLOWED_ORIGINS=*` adicionado ao `docker-compose.yml`).
  - Retorna: KPIs, gastos por categoria, previsão próximo mês, metas ativas, meses disponíveis,
    rateio Marcelo/Harumi, saldos individuais.
- Roteador: `/dashboard` envia link para o frontend React (URL via `VITE_API_URL` reversa).

### Frontend React
Novo projeto em `dashboard-web/` (Vite + React + TailwindCSS v4 + ApexCharts):

| Arquivo | Conteúdo |
|---------|----------|
| `src/App.jsx` | Estado global: token, data, selectedMonth; fetch com auth; logout |
| `src/components/Login.jsx` | Tela de login com validação via API; salva token em sessionStorage |
| `src/components/Dashboard.jsx` | Header com dropdown de meses; KPIs; tabela categorias; Treemap ApexCharts; tabela previsão; cards de metas com barra de progresso |
| `src/index.css` | Design system: dark glassmorphism (slate-950, purple-500/cyan-400); classes glass-panel, glass-btn |

**Critérios de sucesso verificados:**
- ✅ 401 se senha errada/ausente.
- ✅ JSON correto com senha válida.
- ✅ Login bloqueia acesso e exibe erro adequado.
- ✅ Dashboard renderiza KPIs, Treemap e Metas.
- ✅ Seletor de meses atualiza sem recarregar.
- ✅ Mensagem "sem lançamentos" exibida corretamente.

### docker-compose.yml
Duas variáveis novas no serviço `n8n`:
```diff
+ - N8N_CORS_ALLOWED_ORIGINS=*
+ - DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
```

## Estado do git

Branch: `feat/dashboard-web`
Último commit antes deste handoff: `705f3ae feat(dashboard): point telegram command to react frontend url`
Pendente de commit: `docker-compose.yml` (diff acima) + `AGENTS.md` (itens 8 e 9 → ✅).

## Próximo passo imediato

**Item 10 — `gerenciar-metas`** (CRUD de metas temporárias via Telegram):
- Spec: ainda não existe — criar `gstack/specs/gerenciar-metas.md` (copiar TEMPLATE.md).
- Fluxo gstack: plan-reviewer → build → code-reviewer → workflow-qa → cso → ship.
- Referência: `HANDOFF.md` seção "Categorias → Temporárias" e aba `Metas` do Sheets.

## Backlog de produção (não bloqueante para item 10)

- Deploy no Cloudflare / VPS: ver `HANDOFF-2026-06-15.md`.
- Rotação de segredos: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `DASHBOARD_PASSWORD`.
- Planilha → modo Restrito (Harumi só leitura nas abas críticas).
- Desativar webhooks `teste-*` antes de expor URL pública.

## Pegadinhas operacionais herdadas

Ver `HANDOFF-2026-06-16-item8.md` seção "Pegadinhas operacionais" — as 3 regras sobre
`n8n import:workflow`, sub-workflows ativos e regeneração de JSON continuam válidas.

## Configuração local para rodar o frontend

```bash
# 1. Preencher .env na raiz (DASHBOARD_PASSWORD obrigatório)
# 2. Subir n8n
docker compose up -d

# 3. Rodar frontend
cd dashboard-web
cp .env.example .env.local  # ajustar VITE_API_URL se necessário
npm run dev  # http://localhost:5173
```

## Suggested skills

- `writing-plans` → spec gerenciar-metas antes de tocar código.
- `subagent-driven-development` → plan-reviewer + code-reviewer + workflow-qa em paralelo.
- `verification-before-completion` → testes + E2E antes de marcar ✅.
- `handoff` → ao encerrar, atualizar `gstack/context/` + `AGENTS.md`.
