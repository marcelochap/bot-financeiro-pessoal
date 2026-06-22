# Handoff — Teste de importação completa (CDB) + teste do fluxo de lembretes (2026-06-22)

Para o próximo agente. Continua após `HANDOFF-2026-06-22-fase-c-saneamento.md` (mesmo dia,
sessão seguinte). Não duplica: ver o commit desta sessão e a nota no Vault
(`C:\Vault\01_Projetos\bot-financeiro\sessoes\2026-06-22-import-cdb-lembretes.md`).

## Onde paramos
Branch `feat/dashboard-web`. Duas frentes concluídas e uma pendência de decisão do Marcelo.

## 1. Importação completa do extrato (E2E via Telegram, modo append)
- **Extrato `01KVQRFBSS…` (24/12/2025→22/06/2026, 118 lançamentos)** importado pelo bot. Em
  **append** ele batia na **marca d'água** (dedup da conta é high-water mark: ignora tudo ≤ maior
  `data_original` já gravada — as 21 linhas de mai/jun davam marco 19/06 → **0 novos**). Resolvido
  **resetando só a conta**: backup da aba + `deleteDimension` das 21 linhas `origem=conta`
  (cartão 233 intacto) → reimport pelo bot → **118 conta**. Total atual: **351** (233 cartão + 118 conta).
- 🐛 **Bug do CDB (corrigido):** aplicação/resgate de CDB **contavam nos totais**. Tinham sido
  gravados como `Meta: Casamento` (e `Meta:` não é transferência). **Causa-raiz:** a regra
  `APLICAÇÃO DE CDB` que eu inserira no Dicionário **não casava** — *mismatch de normalização
  Unicode de acento* (o `categorizar` do parser usa `includes` sem normalizar). 
  **Fix (dados, não código):** troquei por regra **à prova de acento `CDB → Pagamento/Retirada`**;
  corrigi as 4 linhas (aplicação→`Retirada`, resgate→`Pagamento`, `id_meta` limpo); registrei no Log.
  Validado: **0 CDB nos totais**. Impacto removido: abril −5.881 saídas, maio −4.533, abril −375,41
  e junho −1.750,15 entradas.

## 2. Fluxo de lembretes (testado + 1 bug corrigido)
- **Conferência datas Contas Fixas × extrato:** os dias cadastrados **raramente batem** (Condomínio
  cad. 5 paga 6–9; **Gás errático 6–27**; Tênis 6–19). Valores destoam: **Personal 640 (real 490–560)**,
  Luz 521 (real 376–521, oscila). Detalhe: NEOENERGIA de janeiro ficou sem categoria.
- **Teste E2E** via harness `teste-lembretes` (POST `/webhook/teste-lembretes`, body `{hoje}`):
  D0 (2024-08-05), D-1 (2024-08-07), semanal (2024-08-02/09). Todos enviaram, gravaram e o **inbound**
  (toque → roteador-central → `responder-lembrete` → Log + edição) funcionou. Marcelo tocou `np`
  (→ `pagamento_adiado`). **O ramo `pg` não passou pelo Telegram** (mesmos nós, tem teste unitário).
- 🐛 **Bug Empregada (corrigido, TDD):** lembrete **semanal** mostrava **R$ 2.240** (orçamento MENSAL).
  Fix em `workflows/src/lembretes.js`: no tipo semanal, `valor / 4` (≈ 560), **sem mexer no relatório**
  (que continua mensal). +assert em `lembretes.test.js` (22/22 + suíte completa verde). Workflows
  regenerados (`node scripts/gerar-workflow-lembretes.js`), redeployados e **confirmado ao vivo** (560 +
  aviso de pendência da sexta anterior).

## 3. Faxina (feita)
- Abas removidas: `Lançamentos_backup_2026-06-19`, `Lançamentos_backup_2026-06-22-pre-extrato`,
  **Contas Variáveis** (estava vazia; **nenhum workflow a lê**). Restam 10 abas, todas em uso.
- `Contas Variáveis` removida também do `scripts/gerar-planilha-inicial.py` (e contagem "8→7 abas"
  ajustada lá e no `popular-google-sheet.py`).
- 20 linhas de log de teste (2024-07/2024-08) apagadas do Log. Harness `teste-lembretes` **desativado**.
- Scripts temporários `scripts/_*.py|js` removidos.

## Pendência (decisão do Marcelo — NÃO aplicada)
- **Ajustes em Contas Fixas** (escrita via SA quando ele decidir): Personal 640→560; Gás 90→100;
  Condomínio dia 5→8; Tênis dia 5→8. Ele não respondeu ao prompt — está **em aberto**.

## Itens residuais / gotchas
- **Órfão no n8n:** `FinTesteLembr01` (`teste-lembrete`, meu duplicado do harness canônico
  `teste-lembretes`/`FinTesteLembre01`) ficou **desativado** — a CLI do n8n não tem `delete:workflow`,
  apagar pela **UI**. O arquivo do repo já foi removido.
- **Dedup da conta = marca d'água** (não hash por linha): append nunca faz backfill retroativo —
  pra histórico, resetar a conta antes (ver `parser-conta.js:180` `filtrarJaImportados`).
- **Harness `teste-lembretes` só aceita `hoje` de 2024** (datas reais gravariam Log vivo e
  suprimiriam o cron). Logs 2024 são inertes.
- **n8n ops:** `import:workflow` desativa → reativar (`update:workflow --active=true`) + `restart`;
  Git Bash precisa `MSYS_NO_PATHCONV=1`; após restart, `healthz` responde 200 **antes** do webhook
  registrar (re-tentar o curl).
- ⚠️ **Achado latente (follow-up):** `categorizar`/`processarExtrato` comparam título com `includes`
  **sem normalizar acento** — qualquer regra acentuada inserida fora do fluxo do bot pode falhar
  silenciosamente (foi o que deu no CDB). Vale normalizar (NFC/strip de acento) com TDD.
- Follow-up antigo ainda aberto: espelhar o desembrulho de linha aspeada em `parser-cartao.js`.

## Commit desta sessão
`feat/dashboard-web`: fix do valor semanal da Empregada (`lembretes.js` + teste + 2 workflows
regenerados) + remoção de Contas Variáveis do gerador. As correções de CDB/abas/logs foram **dados
na planilha** (sem commit).

## Skills sugeridas para o próximo agente
- `graphify` — mapa do repo antes de mexer.
- `test-driven-development` / `verification-before-completion` — manter o ciclo (rodar a suíte +
  conferir ao vivo) como nesta sessão.
- `plan-reviewer` / `code-reviewer` / `workflow-qa` — se for mexer em workflow.
- `handoff` — ao encerrar a próxima sessão.
