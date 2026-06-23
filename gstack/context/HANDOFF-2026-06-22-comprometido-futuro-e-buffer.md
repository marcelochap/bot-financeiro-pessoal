# Handoff — Dashboard "Comprometido Futuro" (v2) + buffer de colagem da fatura (2026-06-22)

Para o próximo agente. Continua após `HANDOFF-2026-06-22-import-cdb-lembretes.md` (mesmo dia,
sessão seguinte). Branch `feat/dashboard-web`. **Duas features completas e no ar**; falta só uma
validação ao vivo (colagem da fatura) que depende do Marcelo.

## O que foi entregue (não duplico — ver specs/commits)

### 1. Dashboard "Comprometido Futuro" — v2 da fatura-aberta-projecao (commit `5695420`)
- Spec/plan: `gstack/specs/dashboard-comprometido-futuro.md` (plan-reviewer GO-com-correções;
  code-review + workflow-qa PASS).
- Backend: `comprometidoFuturo()` em `workflows/src/dashboard.js` (lógica pura, +7 testes) — o
  webhook `dashboard-data` agora expõe o campo `comprometido` (fatura aberta do ciclo + projeção
  das parcelas via `projetarComprometido`). Gerador `scripts/gerar-workflow-dashboard.js`
  concatena `fatura-aberta.js` e lê 7 ranges (incl. `FaturaAberta`/`Parcelas`/`Config`).
- Helper novo `vencimentoCicloAberto()` em `fatura-aberta.js` (+3 testes).
- Frontend: bloco "Comprometido Futuro" em `dashboard-web/src/components/Dashboard.jsx` (card
  Fatura Aberta + card Parcelas Futuras).
- **Snapshot Sheets descontinuado**: `scripts/montar-dashboard.py` removido; aba `Dashboard`
  não existia. `dashboard-web` é o único dashboard.
- **Verificado ao vivo**: webhook retorna `comprometido` (faturaAberta=null por rascunho,
  parcelas 6 meses, 1º 10/08 R$ 4.309,49); campos antigos intactos (sem regressão).

### 2. Buffer de colagem da fatura aberta (commit `724b2b1`)
- Spec/plan: `gstack/specs/fatura-aberta-buffer-colagem.md`. **Plan-reviewer deu NO-GO** na 1ª
  versão (debounce 2s + Wait node = race-prone no n8n) → trocado para **acumular-até-o-checksum-
  fechar** (síncrono, sem timer/Wait/poller) → GO. Code-review PASS.
- Lógica pura nova `workflows/src/fatura-buffer.js` (`montarTextoBuffer`, `decidirFluxoBuffer`,
  `STUB_NL`) +8 testes. Novo workflow `fatura-buffer` (`scripts/gerar-workflow-fatura-buffer.js`).
- `roteador.js`: texto livre agora devolve `{rota:"texto-livre"}` (era o stub de NL direto); o
  stub migrou para o `fatura-buffer`. `/faturaaberta` e texto-livre → `fatura-buffer`;
  `seed-parcelas` continua no `fatura-aberta` (que ficou **INTACTO** — só é chamado no flush).
- Aba nova `FaturaBuffer` (`texto_acumulado|aberto|atualizado_em`) criada via
  `scripts/criar-abas-fatura-aberta.py`. É estado efêmero, **isento de Log**.
- **Deployado e validado offline**: simulei o Code node real do `Decidir` (1ª parte → progresso;
  continuação → flush com remontagem byte-a-byte; sem sessão → stub; fatura completa → flush).

## Estado atual / o que falta

- **PENDENTE (Marcelo): teste ao vivo do buffer.** A última colagem dividiu em 2 mensagens; a 2ª
  caía no stub. Agora deve remontar. Marcelo vai colar a fatura completa após `/faturaaberta`:
  espera-se "📥 Recebi seu trecho... faltam R$ X" na 1ª parte e "✅ ... capturada (confere com o
  C6)" ao fechar. Se fechar, `FaturaAberta` vira `fechado` e o card do dashboard reflete o total.
- **FaturaAberta hoje = 44 linhas, todas `rascunho`** (checksum não fechou numa colagem anterior).
  Por isso o card "Fatura Aberta" do dashboard está vazio (R3: rascunho fora do dashboard). É o
  comportamento correto; some quando uma colagem fechar.
- **Dashboard dev server rodando** em `http://localhost:5173/` (background task — `npm run dev`
  em `dashboard-web/`). O card "Parcelas Futuras" já está populado (13 parcelas reais).

## Gotchas operacionais (novos/reforçados)

- **Deploy:** `scripts/import-workflows.ps1` — rodar **direto** (`& ".\scripts\import-workflows.ps1"`),
  NÃO via pipe `| Select-String`: no PowerShell 5.1 o stderr do PostHog (docker) vira
  `NativeCommandError` e aborta o pipe. Direto funciona (importa, reativa prod, reinicia n8n).
- **n8n:** `import:workflow` desativa tudo; o script reativa os 13 de produção (teste-* ficam
  inativos) e reinicia. Pós-restart, `healthz` responde antes do webhook registrar.
- **Service account / Python:** `py` (não `python`) tem as google libs. A 1ª chamada à Sheets API
  às vezes dá erro transiente — re-rodar.
- **Concatenação de Code node:** `fatura-aberta.js` é autocontido; `dashboard.js`/`fatura-buffer.js`
  fazem `require("./fatura-aberta.js")` que o gerador remove via `semRequireLocal`. Sem colisão de
  identificadores (verificado: `arred`/`arredonda`, `brl`/`stripCmd` só no escopo de cada glue).

## Follow-ups conhecidos (não-bloqueantes)

- De-para de categorias C6→projeto no card "Fatura Aberta" (hoje mostra `categoria_c6` cru) — v2.1.
- `Chamar Fatura` (flush) usa `waitForSubWorkflow:false`: se o `fatura-aberta` falhar após o buffer
  limpar, a colagem some sem aviso (single-user + retry interno mitigam; decisão consciente no
  code-review).
- Achado latente herdado: `categorizar`/`processarExtrato` comparam título com `includes` sem
  normalizar acento (ver handoff anterior).

## Skills sugeridas para o próximo agente
- `graphify` — mapa do repo antes de mexer (e registro de sessão no Vault).
- `test-driven-development` / `verification-before-completion` — manter o ciclo (suíte + conferência
  ao vivo) como nesta sessão.
- `plan-reviewer` / `code-reviewer` / `workflow-qa` — se mexer em workflow (o ciclo pegou um NO-GO
  importante nesta sessão; vale sempre).
- `handoff` — ao encerrar a próxima sessão.
</content>
