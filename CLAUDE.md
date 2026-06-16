# CLAUDE.md — Bot Financeiro Doméstico

Bot de controle financeiro via Telegram + n8n + Google Sheets + Gemini Flash.
**Fonte de verdade das decisões de design: [HANDOFF.md](HANDOFF.md)** — leia antes de implementar qualquer workflow.

## Stack

- **Orquestração:** n8n self-hosted (Docker Compose parametrizado) + ngrok
- **Interface:** Telegram Bot (usuário único)
- **Dados:** Google Sheets (prever migração futura para SQLite)
- **LLM:** Gemini Flash (`gemini-2.0-flash-preview`) — extração de PDF e categorização
- **Segredos:** sempre via `.env` / variáveis de ambiente — nunca hardcoded

## Ciclo de trabalho (gstack adaptado)

**Think → Plan → Build → Review → Test → Ship → Reflect**

1. **Think/Plan:** escrever spec em `gstack/specs/` (use o TEMPLATE.md) antes de construir qualquer sub-workflow
2. **Review do plano:** despachar o subagente `plan-reviewer` para travar arquitetura antes de codar
3. **Build:** construir o workflow no n8n (um sub-workflow por responsabilidade — ver AGENTS.md)
4. **Review:** subagente `code-reviewer` revisa o JSON exportado / scripts
5. **Test:** subagente `workflow-qa` valida contra os CSVs reais em `Dados CSV/` e os casos especiais do HANDOFF
6. **Ship:** exportar workflow para `workflows/` (`scripts/export-workflows.ps1`) e commitar
7. **Reflect:** ao encerrar sessão, usar a skill `handoff` para gerar `gstack/context/HANDOFF-<data>.md`

Agentes e roteamento: ver [AGENTS.md](AGENTS.md).

## Estrutura de pastas

```
docker-compose.yml      # n8n + ngrok parametrizados
.env / .env.example     # segredos (.env nunca commitado)
workflows/              # JSONs dos workflows n8n exportados (versionados)
scripts/                # export/import de workflows
gstack/specs/           # uma spec por sub-workflow, antes de construir
gstack/plans/           # planos aprovados pelo plan-reviewer
gstack/retros/          # retrospectivas
gstack/context/         # handoffs e checkpoints de sessão
Dados CSV/              # amostras reais C6 (NUNCA commitar — está no .gitignore)
.claude/agents/         # subagentes (plan-reviewer, workflow-qa, code-reviewer, security-officer)
.claude/skills/         # skills instaladas (superpowers, handoff, caveman, etc.)
```

## Regras críticas de negócio (resumo — detalhes no HANDOFF.md)

- **Regime de caixa:** lançamentos de cartão têm data reescrita para dia 10 do mês seguinte à fatura
- **Cartão:** estorno + par idêntico se cancelam (registrar no Log); `Inclusao de Pagamento` é ignorado
- **Conta corrente:** transferências entre contas próprias NÃO são ignoradas; CSV tem 8 linhas de metadata + BOM UTF-8
- **Categorização híbrida:** Dicionário → Gemini Flash → manual via Telegram → nova regra salva no Dicionário
- **Aprovação humana:** toda importação exige confirmação via Telegram antes de salvar
- **Auditoria:** toda alteração de dados registrada na aba Log

## O que NÃO fazer

- Não hardcodar tokens, senhas (inclusive a senha do ZIP do C6) ou chat IDs
- Não migrar para SQLite/banco ainda — Google Sheets é o banco atual
- Não construir um workflow sem spec aprovada em `gstack/specs/`
- Não pular a confirmação humana via Telegram nas importações
- Parser nunca pode travar o workflow — formato inesperado notifica via Telegram e segue

## Convenções

- Workflows nomeados em kebab-case conforme HANDOFF (`ingestao-csv-cartao`, `roteador-central`, ...)
- Um sub-workflow por responsabilidade; o Roteador Central só roteia
- Exportar workflows após cada mudança relevante: `scripts/export-workflows.ps1`
