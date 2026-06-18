# Handoff — Feature nova `fatura-aberta-projecao` SPEC pronta (2026-06-18)

Para o próximo agente. Não duplica conteúdo: referencia a spec e os handoffs anteriores.
Continua a cadeia após `HANDOFF-2026-06-17-item10.md` (item 10 era o último de feature;
**esta é uma demanda nova** do Marcelo).

## Onde paramos

Sessão de **grill-me** (12 perguntas) → spec → **`plan-reviewer` JÁ RODADO (GO-com-correções,
2026-06-18)**. A spec foi **reescrita** incorporando as correções (ver seção abaixo) e está
**apta a virar plano**. **Nenhum código de produção ainda.** Próximo passo: promover a
`gstack/plans/` e iniciar o **TDD fatiado** (Fatia 1 = parser + checksum).

> ⚠️ **Leia a seção "Correções do plan-reviewer" antes de codar** — duas premissas da spec
> original estavam erradas contra o código já em produção (`faturaJaImportada` e a regra 3 do
> `dashboard-data`). Não reintroduza o desenho antigo.

## O problema (lacuna real)

O C6 **não exporta CSV da fatura aberta** (não fechada) → o Marcelo fica cego para o
comprometido do ciclo e para as parcelas futuras na reunião familiar.

## A solução travada (resumo — detalhe na spec)

`gstack/specs/fatura-aberta-projecao.md`.

- **Entrada:** Marcelo cola, no Telegram, o **texto real** (`Ctrl+C`, selecionável — **não
  OCR/print**) da fatura aberta do **app web do C6** no PC. **Parser determinístico, sem LLM.**
- **Confiabilidade:** **checksum** — soma dos lançamentos (excluindo `Inclusao de Pagamento`/
  negativos) vs `Total dessa fatura` lido do texto. Bate → grava + reporta; não bate → **não
  grava** e avisa (erro mais provável: captura incompleta).
- **Ciclo:** fecha **dia 03**, vence **dia 10**; transações 04→03 = ciclo que fecha no 03.
- **Snapshot por ciclo** via **merge-dedup idempotente** (stateless, como a decisão do item
  10 — sem sessão conversacional); recolar não duplica.
- **Reconciliação:** quando o CSV oficial do ciclo é importado (`ingestao-csv-cartao` +
  `dedup-importacao` existentes), os provisórios (`status=previsto`, rótulo `fatura-aberta`)
  daquele ciclo somem e entram `confirmado`. Zero dupla contagem.
- **Parcelas (o coração):** desktop dá só `Em Mx` (total), **não** `N de M`. **Inferir N por
  data é furado — PROVADO** nos dados reais (GOL compra 01/05 = "2 de 3"; CLUBEW compra 14/06
  = "1 de 12"; nenhuma regra de data única acerta os dois). Solução: bot **conta sozinho**
  (incrementa na virada de ciclo) + **seed único agora** das ~12 parcelas em andamento
  (Marcelo informa `N/M` uma vez, lendo "Parcela N de M" no **celular**).
- **Projeção:** `M − N` cobranças futuras por parcela, **derivada** (nunca gravada como
  confirmada), horizonte **6 meses**.
- **Saída:** bloco **"Comprometido futuro"** no **dashboard React** (`dashboard-web/`) — não
  no Telegram (Telegram = lançamento; planejamento = dashboard, reunião familiar).
- **Bônus:** o texto traz a **categoria do próprio C6** → reaproveitar no
  `categorizacao-hibrida` (menos Gemini).

## Caminhos descartados no grill (não reabrir sem motivo novo)

- Screen scraping/OCR de print (erro silencioso de dígito — a MESMA compra leu `211,43` via
  ChatGPT e `21,35` via Live Text).
- Push de compra (iPhone não deixa app de terceiro ler notificação de outro app).
- Agregador Open Finance pago (Pluggy/Belvo) — Marcelo recusou custo/CNPJ ("não faz sentido
  aumentar gasto para controlar gasto").
- Inferência de índice de parcela por data (furada).

## Correções do plan-reviewer (2026-06-18) — JÁ APLICADAS na spec

Veredito **GO-com-correções**. A spec foi reescrita; abaixo o que mudou e por quê.

**Premissas erradas contra código em produção (bloqueantes):**
1. **C1 — Reconciliação:** o `dedup-importacao` real é o `faturaJaImportada`
   (`workflows/src/parser-cartao.js`), que **BLOQUEIA** a importação se já houver lançamento
   `origem='cartao'` na competência — **não** remove provisórios. Como os provisórios também
   são de cartão, eles **travariam a importação do CSV oficial**. → Spec agora: apagar os
   `previsto`+`fatura-aberta` do ciclo **antes** de importar, e o `faturaJaImportada` deve
   **ignorar** linhas `rótulo=fatura-aberta` na contagem de bloqueio.
2. **C2 — Dashboard:** a regra 3 do `dashboard-data` ("Previsão do Próximo Mês") **já soma**
   `tipo='saída' AND status='previsto'` do próximo mês → provisórios entrariam nela
   (dupla contagem) e as parcelas derivadas não. → **v1 inclui correção de backend**: regra 3
   exclui `rótulo=fatura-aberta` e ciclos `não-fechado`. Bloco React = v2.

**5 pontos em aberto — decididos:**
1. **Gatilho:** comando `/faturaaberta` + bloco (SEM autodetecção — o roteador não tem
   classificação de texto livre). Assinatura `Total dessa fatura` = validação interna.
2. **Snapshot:** **regravação por ciclo** (delete-by-cycle-then-insert dos `previsto`+
   `fatura-aberta` do ciclo), stateless. NÃO um comando `substituir` explícito.
3. **Seed:** `/seedparcelas` **reexecutável** (= reseed), input multilinha
   `estabelecimento | N/M`, casamento por chave **`(estabelecimento_norm, M)`** (nunca por
   valor). Estado mora na **aba nova `Parcelas`** (`estabelecimento_norm`, `descricao`,
   `valor`, `M`, `N_no_seed`, `ciclo_referencia`).
4. **Categorias C6→projeto:** de-para completo adiado para **v2**; v1 grava a categoria C6 como
   metadado e cai no `categorizacao-hibrida` normal (fallback, não inventa).
5. **4096 chars:** colagem partida em N msgs → fragmentos gravados `não-fechado`; o ciclo só
   **fecha** (e só conta no dashboard) quando o checksum bate.

**Ponto mais frágil — corrigido na raiz (R1):** o índice de parcela NÃO é contador `+1 por
colagem` (dessincroniza se Marcelo pular um envio — erro silencioso e otimista). É
**derivado do calendário**: `N_atual = N_no_seed + (viradas de ciclo decorridas desde
ciclo_referencia)`. Pular uma semana não quebra. Reseed via `/seedparcelas`.

**Edge cases adicionados** (em "Casos especiais"): parcela terminando `N==M` (contada 1×,
projeção 0), estorno (regravação reflete), gêmeo real (aviso específico, não "captura
incompleta"), ano `DD/MM/AA`→`YYYY` na fronteira do parser.

## Estado do git

- Branch `feat/dashboard-web`. **PR #1 aberto** hoje (2026-06-18) contra `master`:
  https://github.com/marcelochap/bot-financeiro-pessoal/pull/1 (merge `--allow-unrelated-histories`
  do skeleton para conectar históricos; conflitos resolvidos mantendo o branch).
- Spec (revisada) + este handoff commitados na `feat/dashboard-web` em 2026-06-18 (após o
  plan-reviewer). Registro da revisão no Vault (`log.md` + nota da sessão).

## Próximo passo imediato

Spec revisada e aprovada (GO-com-correções). Build **fatiado**, sempre TDD primeiro:

1. Promover a spec a `gstack/plans/`.
2. **TDD de `workflows/src/fatura-aberta.js`** em fatias:
   - **Fatia 1:** parser + checksum contra a amostra real do grill (testes primeiro).
   - **Fatia 2:** parcelas (índice derivável do calendário + seed/reseed) + projeção.
   - **Fatia 3:** reconciliação (delete-by-cycle, ajuste no `faturaJaImportada`) + correção
     de backend da regra 3 do `dashboard-data`.
3. Gerador do(s) workflow(s) + roteador (`/faturaaberta`, `/seedparcelas`).
4. **v2:** bloco React "Comprometido futuro" + de-para de categorias C6→projeto.
5. **Seed/reseed** das parcelas em andamento com o Marcelo (`/seedparcelas`).

> Desambiguação (S4): já existe `seed-parser.js` (seed do razão da conta) — o seed de
> **parcelas** é outra coisa; não estender aquele arquivo.

## Pegadinhas operacionais herdadas (continuam válidas)

Ver `HANDOFF-2026-06-17-item10.md` / `item9.md` / `item8.md`: `n8n import:workflow` desativa
tudo (sub-workflows via Execute Workflow precisam reativar + restart); `docker compose up -d`
recarrega `.env` (não `restart`); leitura única via `values:batchGet` (cota Sheets); nós
Telegram com `appendAttribution:false`; harness `teste-*` inativo por design (webhook sem auth).
