# Bot Financeiro Doméstico

Bot de controle financeiro via Telegram, orquestrado pelo n8n, com Google Sheets como
banco de dados e Gemini Flash para extração/categorização. Processa extratos do C6 Bank,
categoriza lançamentos, dispara lembretes de contas fixas e gera relatórios.

Decisões de design: [HANDOFF.md](HANDOFF.md) · Fluxo de trabalho: [AGENTS.md](AGENTS.md) · Instruções para agentes: [CLAUDE.md](CLAUDE.md)

## Setup

1. Copie `.env.example` → `.env` e preencha (token do Telegram, chave Gemini, senha do ZIP do C6, etc.)
2. Suba o n8n:

   ```powershell
   docker compose up -d            # só n8n, local (http://localhost:5678)
   docker compose --profile tunnel up -d   # n8n + ngrok (webhooks do Telegram)
   ```

3. Acesse `http://localhost:5678` e crie a conta de owner do n8n
4. Importe os workflows versionados: `scripts\import-workflows.ps1`

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `workflows/` | Workflows n8n exportados em JSON (versionados) |
| `scripts/` | Export/import de workflows via CLI do n8n |
| `gstack/` | Specs, planos, retros e handoffs (estado do projeto) |
| `Dados CSV/` | Amostras reais de extrato/fatura C6 — fora do git |
| `.claude/` | Subagentes e skills do time multi-agente |
