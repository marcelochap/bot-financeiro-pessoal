# Handoff — Fatura aberta: fix do "Hoje/Ontem" + entrada `.txt` + `/fecharfatura` (2026-06-25)

Para o próximo agente. Não duplica conteúdo — referencia spec, commits e PR.

## TL;DR

O `/faturaaberta` "não fechava" (faltava **R$ 733,97**). Diagnóstico ao vivo: **bug de parsing**,
não as features pedidas. O C6 rotula os dias recentes como **"Hoje, DD/MM/AA"** / **"Ontem, ..."**
em vez do dia da semana; o `RE_DIA` só aceitava dia da semana → lançamentos do dia atual eram
**descartados em silêncio** e o checksum nunca fechava. Os 3 lançamentos sob "Hoje, 25/06/26"
(595,58 + 48,19 + 90,20) somavam exatamente 733,97.

**Entregue, no ar e verificado em produção** (fatura real fecha: **53 lançamentos, R$ 9.320,43,
status `fechado`**):
1. **Fix `Hoje`/`Ontem`** no `RE_DIA` (causa raiz).
2. **Entrada por arquivo `.txt`** (fatura como documento, chega inteira — sem o corte de 4096).
3. **Comando `/fecharfatura`** (encerra colagem incompleta como rascunho, com relatório do que falta).

## Estado do código

- **Branch:** `feat/fatura-arquivo-e-fechar`. **[PR #4](https://github.com/marcelochap/bot-financeiro-pessoal/pull/4)** aberto contra `master`.
- **Commits:** `f0f8b0a` (features `.txt` + `/fecharfatura`) e `8846354` (fix `Hoje`/`Ontem`).
- **Spec (aprovada GO):** `gstack/specs/fatura-aberta-arquivo-e-fechar.md` (plan-reviewer → code-reviewer → workflow-qa, todos APTO).
- **Suíte:** 263 testes, 0 falhas (`node workflows/src/*.test.js`).
- **Arquivos-chave alterados:** `workflows/src/{roteador,fatura-buffer,fatura-aberta}.js` (+ testes);
  geradores `scripts/gerar-workflow-{roteador,fatura-aberta}.js`; JSONs regenerados.
  O fix do parser está em `fatura-aberta.js` (RE_DIA) e é embutido também no `fatura-buffer.json`.

## Estado do deploy (produção VPS)

- Bot **no ar** em `https://financeiro.minhaautomacao.cloud`. Tudo aplicado e verificado ao vivo
  (exec 47 = ✅ fechado, 53 lançamentos, R$ 9.320,43).
- ⚠️ **A VPS está rodando a branch `feat/fatura-arquivo-e-fechar`** (não a `deploy/hostinger-setup`).
  Ao **mergear o PR #4**, realinhar numa próxima janela: `ssh botfinanceiro` → `cd /root/bot-financeiro-pessoal`
  → `git checkout deploy/hostinger-setup && git pull` (ou a branch que virar produção) → reimportar.

## Pegadinhas operacionais desta sessão (importantes)

- **Compose de produção é `docker-compose.vps-shared.yml`**, container **`financeiro-n8n`**. O
  `scripts/import-workflows.sh` usa `docker-compose.prod.yml` (descasa) — **deploy foi feito direto
  via `docker exec financeiro-n8n n8n import:workflow --separate --input=/workflows`** + reativar os
  não-`teste-*` (`n8n update:workflow --id=<id> --active=true`) + `docker restart financeiro-n8n`.
  (n8n 2.x: `import` desativa tudo; sub-workflows via Execute Workflow PRECISAM ficar ativos.)
- **Mount:** `/root/bot-financeiro-pessoal/workflows → /workflows` (bind). `git pull` no host já
  reflete no container; daí o import.
- **Observar execuções ao vivo (sem sqlite3 no container):** ler o SQLite read-only do host:
  `file:/var/lib/docker/volumes/bot-financeiro-pessoal_n8n_data/_data/database.sqlite?mode=ro` via
  `python3`. Tabelas: `execution_entity` (id, workflowId, status, startedAt), `execution_data`
  (executionId, data — contém o texto colado e as mensagens). Útil para diagnóstico (foi assim que
  se achou o R$ 733,97).
- **Cuidado com baseline ao pollar execuções:** `WHERE id > N` pega execuções **pré-existentes**;
  rebaseline para o `max(id)` atual antes de pedir um envio novo (deu falso-positivo uma vez).

## WIP NÃO COMMITADO — não clobrar

`scripts/gerar-workflow-roteador.js` tem edição **não commitada** (usuário/linter): adiciona
`NA_FALHA_AVISAR = { ...RETRY, onError: "continueErrorOutput" }` ao nó `baixar`. É o começo da
tarefa de fundo **`task_a3ea7514`** (notificar erro de download via Telegram, vale p/ ramos CSV e
`.txt`). **Incompleto:** falta fiar a saída de erro (índice 1) a um nó Telegram de aviso, regenerar
`roteador-central.json` e redeployar. Não foi commitado nem deployado nesta sessão — **preservar**.

## Adendo — fix do `/dashboard` (mesma sessão)

O comando `/dashboard` enviava a URL errada (`…/webhook/dashboard-data`, a API JSON) em vez da
página. Causa: `DASHBOARD_URL` no `.env` da VPS apontava pro webhook de dados. Corrigido:
- **VPS (config, fora do git):** `.env` → `DASHBOARD_URL=https://financeiro.minhaautomacao.cloud/dashboard`;
  container recriado com `docker compose -f docker-compose.vps-shared.yml up -d n8n` (recarrega o
  `.env`; `restart` NÃO recarrega). Backup em `/root/bot-financeiro-pessoal/.env.bak-dashboardurl`.
- **Repo:** commit `87ffb2b` (na branch/PR #4) — `DEPLOY.md` corrigido + `DASHBOARD_URL` adicionado
  ao `.env.example` com nota (página `/dashboard` ≠ webhook `/webhook/dashboard-data`).

## Próximos passos sugeridos

1. Mergear o **PR #4** e realinhar a branch da VPS (ver "Estado do deploy").
2. Concluir `task_a3ea7514` (aviso de erro de download) a partir do WIP em `gerar-workflow-roteador.js`.
3. (Opcional) Sugestões não-bloqueantes do code-review: citar `/fecharfatura` no branch
   "total ausente" do `respostaProgresso`; ACK de recebimento no envio de `.txt`.

## Referências

- Spec: `gstack/specs/fatura-aberta-arquivo-e-fechar.md`
- Specs-mãe: `gstack/specs/fatura-aberta-projecao.md`, `gstack/specs/fatura-aberta-buffer-colagem.md`
- Handoff de deploy: `gstack/context/HANDOFF-2026-06-24-deploy-producao.md`
- PR: https://github.com/marcelochap/bot-financeiro-pessoal/pull/4
- `DEPLOY.md` (runbook), `HANDOFF.md` (decisões de design)

## Suggested skills

- **`/graphify`** — atualizar o vault/knowledge graph com esta sessão (memória: vault em `C:\Vault`,
  sessões em `01_Projetos\bot-financeiro\`).
- **`plan-reviewer`** — antes de qualquer feature nova (ciclo gstack).
- **`workflow-qa`** — após build, antes do ship.
- **`/handoff`** — ao encerrar a próxima sessão.
