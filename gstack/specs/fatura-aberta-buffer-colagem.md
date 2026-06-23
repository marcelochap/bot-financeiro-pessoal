# Spec — fatura-aberta-buffer-colagem (colagem partida em N mensagens)

> Evolução da feature [`fatura-aberta-projecao`](fatura-aberta-projecao.md). Resolve a
> **limitação v1** (HANDOFF-2026-06-18 l.48-50): a fatura real passou de ~4096 chars, o Telegram
> **divide a colagem em mensagens sequenciais**, e a 2ª (sem `/faturaaberta`) cai no stub de
> linguagem natural ([roteador.js:85](../../workflows/src/roteador.js)). A colagem partida **não
> acumula** no v1.
>
> **Histórico:** a 1ª versão desta spec (buffer por debounce de 2s + Wait node no roteador) levou
> **NO-GO** do plan-reviewer (2026-06-22): Wait+re-leitura é race-prone no n8n (execuções
> concorrentes, read-after-write do Sheets não consistente em ms), sem precedente no projeto, e
> frágil a restart/reimport. **Decisão do Marcelo:** trocar para **acumular-até-o-checksum-fechar**
> (síncrono, determinístico, sem timer/poller/Wait). Esta versão reescreve o núcleo arquitetural.

## Objetivo
Permitir que uma fatura aberta dividida pelo Telegram em mensagens sequenciais seja **remontada**
e processada como uma só. A cada fragmento, o bot **acumula** o texto e **reparseia o
concatenado**: quando a soma dos lançamentos bate com o `Total dessa fatura` (checksum fecha), o
ciclo é fechado e processado pelo fluxo `/faturaaberta` já existente. Enquanto não fecha, o bot
responde o progresso e segue acumulando.

## Entradas
- **Mensagens do Telegram** (webhook do `roteador-central`):
  - **Msg 1:** `/faturaaberta` + 1º trecho (contém o cabeçalho `Total dessa fatura`).
  - **Msgs 2..N:** continuação **sem comando** (texto livre puro).
- **Estado do buffer** (aba nova `FaturaBuffer`, single-user, **uma** linha de dados):
  `texto_acumulado` (string, **sem** o prefixo `/faturaaberta` — ver Decisões), `aberto`
  ("sim"/"não"), `atualizado_em` (epoch ms — só para **expirar sessão velha**, NÃO para
  debounce de flush). Leitura via `valueRenderOption=UNFORMATTED_VALUE` (padrão do projeto); o
  `atualizado_em` é lido **defensivamente** (número ou string-com-dígitos — o append do Sheets
  coage tipos, mesma razão do `normalizarCiclo`), default "sessão expirada" se ilegível.
- **Janela de expiração de sessão:** `fatura_buffer_ttl_min` na aba `Config` (default 15 min).
  Texto livre que chega com sessão aberta **mais velha que o TTL** NÃO é tratado como
  continuação (vira stub de NL) — evita capturar texto não relacionado muito depois.

## Saídas
- **Checksum fecha** (`parseFaturaAberta(concat).checksum.bate`): o `fatura-buffer` chama o
  sub-workflow **`fatura-aberta` (intacto)** via Execute Workflow com o **mesmo texto exato sobre
  o qual rodou o checksum** (`texto_acumulado`, já sem o prefixo de comando), limpa o
  `FaturaBuffer` (`aberto=não`, `texto_acumulado=""`), e o `fatura-aberta` faz o **único**
  clear+write de `FaturaAberta` (`fechado`) + a confirmação ✅ no Telegram, como hoje. Como o
  parse é puro e determinístico sobre a string idêntica, o que fecha no buffer fecha no
  `fatura-aberta`.
- **Checksum não fecha** (ainda acumulando): grava o `texto_acumulado` no `FaturaBuffer`
  (`aberto=sim`), **não toca `FaturaAberta`**, e responde o progresso:
  *"📥 Recebi N lançamentos, somei R$ X de R$ Y. Faltam R$ Z — continue colando, ou
  /faturaaberta para recomeçar."*
- **Soma já passou do total** (estorno/duplicata): responde aviso específico, **mantém o buffer
  aberto** (`aberto=sim`, `texto_acumulado` preservado) e **não** fecha nem toca `FaturaAberta`
  (Marcelo decide recomeçar com `/faturaaberta`). Mesma semântica de aviso do `fatura-aberta`.
- **Texto livre sem sessão aberta** (ou sessão expirada): stub de NL, **emitido pelo
  `fatura-buffer`** com a string canônica idêntica à atual
  (`RESPOSTAS.emConstrucao("Entendimento de linguagem natural")`, [roteador.js:10](../../workflows/src/roteador.js)).
  Vale inclusive para texto livre que por acaso contenha `Total dessa fatura` mas sem sessão
  aberta (a sessão só abre via `/faturaaberta`).
- Nenhuma resposta por fragmento além do progresso; a confirmação de checksum (✅) é única, no
  fechamento.

## Regras de negócio aplicáveis
- **Fragmentos vivem SÓ no `FaturaBuffer`** (texto). `FaturaAberta` recebe **um** clear+write,
  **só no flush** (checksum fechado). NUNCA gravar fragmento individual em `FaturaAberta` nem em
  `Lançamentos` (corrige o eco do modelo antigo da spec-mãe l.105-109, abandonado).
- **`fatura-aberta` permanece INTACTO:** recebe um `texto` completo (como sempre) e faz
  parse→checksum→clear+write→report. Toda a remontagem é externa a ele.
- **`/faturaaberta` sempre RESETA a sessão** (novo ciclo de colagem): `texto_acumulado` vira só o
  1º trecho. Permite recomeçar uma colagem estragada.
- **Snapshot por ciclo inalterado:** quando fecha, é o mesmo clear+write de `FaturaAberta` de hoje.
- **Checksum como juiz único do flush:** decisão determinística e síncrona por mensagem — sem
  timer, sem reler estado de outra execução. Mata os riscos do desenho de debounce.
- **Roteador só roteia:** `classificarUpdate` continua puro; o estado/decisão de buffer mora no
  sub-workflow `fatura-buffer`.
- **`FaturaBuffer` é isento de Log:** é estado **efêmero de remontagem**, não dado de negócio.
  A auditoria na aba `Log` acontece no flush, dentro do `fatura-aberta` (que grava `FaturaAberta`).
  Por isso o clear+append por fragmento no `FaturaBuffer` não registra no Log.

## Casos especiais e erros
- **Mensagem única (cabe em 1):** `/faturaaberta`+fatura completa → concat = 1 trecho → checksum
  fecha na hora → flush imediato. **Sem atraso** (vantagem sobre o debounce de 2s).
- **Texto livre genuíno (sem sessão / sessão expirada):** stub de NL, como hoje.
- **Race read-modify-write do buffer** (2 msgs quase simultâneas sobrescrevem o `texto_acumulado`,
  perdendo um fragmento): o checksum **não fecha** → o bot pede "faltam R$ Z" → Marcelo recola o
  trecho ou recomeça com `/faturaaberta`. **Degradação graciosa, não silenciosa** (single-user,
  sem lock — o checksum é a rede). Auto-split chega em ordem; risco marginal.
- **Sessão aberta esquecida + texto não relacionado depois:** o TTL (15 min) faz o texto velho
  cair no stub em vez de poluir o buffer. `/faturaaberta` também reseta.
- **Restart/reimport do n8n com sessão aberta:** o estado está no Sheets (não em execução
  suspensa), então **sobrevive** — diferente do Wait node. No pior caso o TTL expira a sessão.
- **`FaturaBuffer` inexistente/serial/`atualizado_em` vazio:** leitura defensiva (aba criada no
  setup; ausência → buffer vazio; nunca trava o roteador/buffer).
- **Flush idempotente:** o flush seta `aberto=não` ao limpar; reentrada sobre buffer fechado não
  refaz flush.
- **Parser nunca trava:** linha estranha vira aviso; sem assinatura `Total dessa fatura` no
  acumulado → não fecha (segue pedindo) ou, se nem o 1º trecho tem, avisa como hoje.

## Decisões de arquitetura
- **Sub-workflow dedicado `fatura-buffer`** (decisão do plan-reviewer C-ARQ-2): **ambos**
  `/faturaaberta` E texto-livre passam a ser despachados ao `fatura-buffer` via Execute Workflow
  (o ramo `É Fatura Aberta?` em `gerar-workflow-roteador.js:345` deixa de apontar para
  `fatura-aberta` e passa a apontar para `fatura-buffer` — pois `/faturaaberta` precisa **resetar
  a sessão**). O `fatura-buffer` detém o estado (`FaturaBuffer`), decide reset/anexar/flush/stub
  e chama o `fatura-aberta` só no flush. Mantém o roteador puro e o `fatura-aberta` intacto.
- **Schema de despacho ao `fatura-buffer`:** distingue origem — `acao ∈ {"fatura-aberta-cmd"
  (reset, veio de `/faturaaberta`), "texto-livre" (anexar/stub)}` + `texto`. (NÃO reusar o
  `FATURA_SCHEMA` `["acao","texto"]` do `fatura-aberta`, cujo `acao` significa outra coisa.)
- **Prefixo de comando:** o `fatura-buffer` **remove `/faturaaberta`** do 1º fragmento ao
  iniciar (via o mesmo `stripCmd` `/^\/\S+[ \t]*/`), de modo que `texto_acumulado` é sempre texto
  puro. O checksum no buffer e o parse no `fatura-aberta` rodam sobre a **mesma** string pura.
- **`classificarUpdate` (puro, TDD em `roteador.test.js`):** texto livre passa a devolver
  `{ rota: "texto-livre", texto }` (em vez de já responder o stub); `/faturaaberta` →
  `{ rota: "fatura-aberta", texto }` (inalterado). O **stub de NL passa a ser emitido pelo
  `fatura-buffer`** quando não há sessão — não se perde (decisão C-REG-1).
- **Lógica pura nova (TDD):**
  - `montarTextoBuffer(acumulado, fragmento)` → concatenação normalizada (`acumulado + "\n" +
    fragmento`, trims).
  - `decidirFluxoBuffer({ aberto, expirado, rota, parse })` → `acao ∈ { "flush", "aguardar",
    "estouro", "stub-nl", "rotear" }` + texto a gravar. `parse` é o resultado de
    `parseFaturaAberta(concat)`; a decisão usa `parse.checksum.bate`/`diferenca`. Puro e testável.
- **Reuso:** `parseFaturaAberta` (de `fatura-aberta.js`) roda no `fatura-buffer` para o checksum;
  o `fatura-aberta` reparseia no flush para gravar. Duplo parse é barato e determinístico.
- **Estado mínimo no Sheets** (`FaturaBuffer`), lido+escrito por mensagem, síncrono — sem
  dependência de timing entre execuções.

## Não-regressão (decisão C-REG-1)
- **Teste a reescrever:** `roteador.test.js:144-148` (hoje afirma texto livre → resposta
  "linguagem natural"). Novo contrato: texto livre → `{ rota: "texto-livre", texto }` (sem
  `resposta`). Adicionar teste de que `/faturaaberta` e os demais comandos/callbacks/documentos
  roteiam inalterados.
- **Ramo novo no roteador:** texto-livre passa a despachar ao `fatura-buffer` (Execute Workflow),
  espelhando o ramo de `fatura-aberta`. Verificar a cascata de IFs
  (`gerar-workflow-roteador.js:369-475`) para o ramo novo não quebrar `/start`, `/categorizar`,
  `/relatorio`, `/dashboard`, `/metas`, `/novameta`, `/faturaaberta`, `/seedparcelas`, callbacks
  e documentos.

## Critérios de sucesso (verificáveis)
- [ ] `classificarUpdate`: texto livre → `{ rota: "texto-livre", texto }`; comandos/callbacks/
      documentos inalterados. `roteador.test.js:144-148` reescrito; suíte do roteador verde.
- [ ] `montarTextoBuffer`: concatena 2 fragmentos preservando quebras de linha.
- [ ] `decidirFluxoBuffer` (TDD): `/faturaaberta` com checksum que já fecha → `flush`;
      `/faturaaberta` incompleto → `aguardar` (reseta buffer); texto-livre com sessão aberta e
      concat que fecha → `flush`; texto-livre que ainda não fecha → `aguardar`; texto-livre sem
      sessão / sessão expirada → `stub-nl`; soma > total → `estouro`.
- [ ] **Remontagem real:** 2 fragmentos da fatura (amostra) concatenados por `montarTextoBuffer`
      → `parseFaturaAberta` reproduz resultado **byte-a-byte igual** ao da fatura inteira numa
      mensagem só (mesmos lançamentos E `checksum.somado`/`bate`, não só `bate`).
- [ ] **texto-livre sem sessão contendo a assinatura** (`Total dessa fatura`) → `stub-nl` (a
      sessão só abre via `/faturaaberta`); não inicia buffer.
- [ ] **estouro** (soma > total): `decidirFluxoBuffer` → `estouro` com `aberto=sim`, buffer
      preservado, sem flush, sem tocar `FaturaAberta`.
- [ ] **Fiação:** o ramo `É Fatura Aberta?` do roteador aponta para `fatura-buffer` (não mais
      `fatura-aberta`); o ramo novo `É Texto Livre?` entra antes de `Ignorar` na cascata.
- [ ] **Flush imediato 1-msg:** fatura completa em 1 mensagem fecha sem espera (não regride o caso comum).
- [ ] **Flush idempotente:** reentrada sobre buffer já fechado não refaz o flush.
- [ ] **TTL:** texto livre com sessão mais velha que o TTL → stub-nl, não anexa.
- [ ] **Um único clear+write:** ao fechar, `FaturaAberta` é reescrita uma vez; durante a
      acumulação, `FaturaAberta` não é tocada (fragmentos só no `FaturaBuffer`).
- [ ] Gerador produz `roteador-central.json` e `fatura-buffer.json` válidos; `import-workflows.ps1`
      roda sem erro; sub-workflows reativados.
- [ ] **Conferência ao vivo:** colar a fatura grande (que dividiu em 2) → o bot acumula, responde
      progresso na 1ª parte e ✅ checksum ao completar; `FaturaAberta` vira `fechado` e o card
      "Fatura Aberta" do dashboard reflete o total.

## Fora de escopo
- **Buffer por tempo / Wait node / Schedule Trigger** — descartado (NO-GO do reviewer + escolha do Marcelo).
- **Buffer multi-usuário / multi-chat** (bot é single-user).
- **Mudar parser/checksum/escrita do `fatura-aberta`** — esta entrega só remonta o texto antes.
- **Lock distribuído** — single-user; o checksum é a rede contra a race marginal.
</content>
