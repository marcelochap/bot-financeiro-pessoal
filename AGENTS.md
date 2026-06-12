# AGENTS.md — Time multi-agente (gstack adaptado)

Estrutura inspirada no [gstack](https://github.com/garrytan/gstack): papéis especializados
com responsabilidades claras, orquestrados ao longo do ciclo
**Think → Plan → Build → Review → Test → Ship → Reflect**.

## Papéis

| Agente (`.claude/agents/`) | Papel gstack equivalente | Quando despachar |
|---|---|---|
| `plan-reviewer` | `/plan-ceo-review` + `/plan-eng-review` | Após escrever uma spec em `gstack/specs/`, antes de construir. Desafia escopo e trava arquitetura. |
| `code-reviewer` | `/review` (staff engineer) | Após exportar workflow JSON ou escrever scripts. Revisa correção e simplicidade. |
| `workflow-qa` | `/qa` | Após o build. Valida parsers contra `Dados CSV/` e os casos especiais do HANDOFF. |
| `security-officer` | `/cso` | Antes de expor webhook via ngrok e a cada novo segredo/credencial. Auditoria de segredos e PII. |

## Skills instaladas (`.claude/skills/`)

| Skill | Origem | Uso neste projeto |
|---|---|---|
| `subagent-driven-development`, `dispatching-parallel-agents` | superpowers | Composição e despacho de subagentes |
| `brainstorming`, `writing-plans`, `executing-plans` | superpowers | Fases Think/Plan |
| `test-driven-development`, `verification-before-completion` | superpowers | Fases Build/Test |
| `requesting-code-review`, `receiving-code-review` | superpowers | Fase Review |
| `systematic-debugging` | superpowers | Debug estruturado de workflows n8n |
| `improve-codebase-architecture` | mattpocock | Usar APÓS a primeira versão funcional (não antes) |
| `caveman` | JuliusBrussee | Debugging verboso → conciso de workflows n8n |
| `handoff` | mattpocock | Fase Reflect — gerar handoff em `gstack/context/` ao encerrar sessão |

## Fluxo padrão para cada sub-workflow

```
1. Spec       → gstack/specs/<nome>.md (copiar TEMPLATE.md)
2. Plan lock  → despachar plan-reviewer → plano aprovado vai para gstack/plans/
3. Build      → construir no n8n
4. Review     → exportar JSON → despachar code-reviewer
5. QA         → despachar workflow-qa (CSVs reais + casos especiais)
6. Ship       → scripts/export-workflows.ps1 → commit
7. Reflect    → atualizar gstack/retros/ ou gerar handoff
```

## Ordem de implementação (do HANDOFF.md)

1. ✅ Setup Docker
2. ✅ Google Sheets (abas + dados iniciais)
3. ✅ `ingestao-csv-cartao` (E2E completo com confirmação real no Telegram; QA aprovado 12/06)
4. ✅ `ingestao-csv-conta` (idem; 76 lançamentos na planilha, valores conferidos ao centavo)
5. ✅ `roteador-central` (E2E local completo: ZIP cifrado, comandos, callbacks, segurança)
6. ✅ Categorização híbrida (E2E local completo: Gemini + Dicionário + teclados inline)
7. ✅ `lembretes-agendados` (cron 09h + responder-lembrete; E2E com datas 2024; QA e review aprovados 12/06)
8. `relatorio-mensal`
9. `dashboard`
10. `gerenciar-metas`
