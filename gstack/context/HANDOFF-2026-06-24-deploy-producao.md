# HANDOFF — Deploy de Produção Completo
**Data:** 2026-06-24  
**Branch:** `deploy/hostinger-setup`  
**Último commit:** `db8bf74` feat(deploy): docker-compose VPS multi-projeto com caddy-docker-proxy labels

---

## Estado do sistema — O BOT ESTÁ EM PRODUÇÃO

### URLs ativas (todas HTTPS, certificado Let's Encrypt válido)
- `https://financeiro.minhaautomacao.cloud` — n8n prod, 13 workflows ativos
- `https://premoldado.minhaautomacao.cloud` — n8n premoldado (intacto)
- `https://n8n.187.127.0.35.sslip.io` — URL legada premoldado (intacta)

### O que foi concluído nesta sessão
1. **Infra multi-projeto na VPS:** `caddy-docker-proxy` em `/docker/proxy`; rede `web` compartilhada; DNS wildcard `*.minhaautomacao.cloud → 187.127.0.35`. Adicionar projeto futuro = labels Docker + rede `web` + `docker compose up -d`. Zero mudança de DNS, zero impacto nos projetos existentes.
2. **`/docker/README.md` criado na VPS** — runbook de operações multi-projeto.
3. **Credenciais migradas** do dev para prod via export/import com mesma `N8N_ENCRYPTION_KEY`. 3 credenciais: `googleSheetsOAuth2Api`, `googleApi` (SA), `telegramApi`.
4. **Webhook do Telegram** apontando para prod com `TELEGRAM_WEBHOOK_SECRET`.
5. **`docker-compose.vps-shared.yml`** commitado (commit `db8bf74`).
6. **Vault + graphify** atualizados (sessão registrada, 152 nós / 209 arestas / 12 comunidades).

---

## Pendências

### 1. Criar owner account do n8n (MANUAL)
Abrir `https://financeiro.minhaautomacao.cloud`, wizard de setup na 1ª vez.

### 2. Rotacionar token da API da Hostinger (URGENTE)
Token foi exposto em chat. Gerar novo no painel Hostinger → re-registrar MCP:
```
claude mcp remove hostinger -s user
$env:HOSTINGER_API_TOKEN = "NOVO_TOKEN"
claude mcp add hostinger -s user --env HOSTINGER_API_TOKEN npx hostinger-api-mcp
```

### 3. Push do branch para o GitHub
`git push origin deploy/hostinger-setup` — 1 commit à frente do remote.

---

## Topologia VPS

```
VPS 187.127.0.35 (Ubuntu 24.04, KVM4)
├── /docker/proxy/                    # caddy-docker-proxy — NUNCA PARAR
├── /root/bot-financeiro-pessoal/     # Bot Financeiro (docker-compose.vps-shared.yml)
└── /docker/premoldado-n8n-test/      # Premoldado (intacto)
```

Rede compartilhada `web`. SSH: `ssh botfinanceiro`.

---

## Próximos possíveis trabalhos

- Feature v2 fatura aberta (bloco React + de-para categorias) — spec em `gstack/specs/fatura-aberta-projecao.md`
- Normalizar acentos no parser (bug latente com `includes` sem NFC)
- Fix: confirmação da conta 3× = 3 execuções
- Rateio: acerto da Harumi (−R$ 5.231 acum.)

---

## Skills sugeridas

- `/handoff` ao encerrar sessão
- `/graphify` para atualizar o vault após novas sessões
- `plan-reviewer` antes de nova feature
- `workflow-qa` após build

## Referências

- `HANDOFF.md` — decisões de design
- `DEPLOY.md` — runbook de deploy
- `C:\Vault\01_Projetos\bot-financeiro\sessoes\2026-06-24-deploy-producao-completo.md` — nota desta sessão
- `/docker/README.md` (VPS) — runbook multi-projeto
