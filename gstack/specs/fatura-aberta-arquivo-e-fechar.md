# Spec — fatura-aberta: entrada por arquivo `.txt` + comando `/fecharfatura`

> Evolução das features [`fatura-aberta-projecao`](fatura-aberta-projecao.md) e
> [`fatura-aberta-buffer-colagem`](fatura-aberta-buffer-colagem.md). NÃO altera parser,
> checksum nem a escrita do `fatura-aberta` — só adiciona **dois caminhos de entrada/encerramento**.
>
> **Aprovação do plan-reviewer (2026-06-25): GO-com-correções.** As 4 premissas contra o código
> de produção foram validadas (rascunho já gravado; rascunho fora da regra 3 do dashboard;
> `executarFatura "fatura-aberta"` existe; `/faturaaberta` já passa pelo buffer). Correções
> dobradas no build: **C1** `fechar-fatura` sem sessão → `acao:"stub-nl"` (não regrava buffer);
> **C2** `fechar-fatura` com sessão → `acao:"flush"` (reusa "Limpar Buffer"); **C3** JSDoc
> `tipo_arquivo` inclui `"txt"`; **C4** alterar `classificarUpdate` (TDD) antes da fiação;
> **C5** decode `buf.toString("utf-8")`, BOM tolerado pelo parser; **C7** neutralizar a mensagem
> de "sem Total" (não citar "cole após /faturaaberta", pois pode vir como arquivo); **C8** ramo
> `.txt` em `classificarUpdate` depois de zip/csv, antes de pdf.

## Contexto (o problema real)

Ao rodar `/faturaaberta` ao vivo na VPS, o checksum não fechou: *"faltam R$ 733,97"*. Essa
mensagem vem de `respostaProgresso` ([fatura-buffer.js:52](../../workflows/src/fatura-buffer.js)):
`Total dessa fatura − soma dos lançamentos lidos`. Duas causas possíveis:

1. **Colagem cortada pelo Telegram** (fatura > 4096 chars dividida em N mensagens; um fragmento
   não entrou no buffer ou chegou fora de ordem). É a causa mais provável.
2. **Linha não parseada** (formato que o parser não reconhece).

Hoje, enquanto o checksum não fecha, o `fatura-buffer` **só acumula e responde "faltam"** — nunca
chama o `fatura-aberta`, então **nada é gravado** e o usuário fica preso. Não há saída honesta.

## Objetivo

1. **Entrada por arquivo `.txt`:** permitir mandar a fatura aberta como **documento `.txt`** no
   Telegram (texto selecionável do app web do C6 salvo em bloco de notas). Chega **inteiro**, sem
   o corte de 4096 chars — ataca a causa #1 na raiz.
2. **Comando `/fecharfatura`:** encerrar uma colagem em andamento que não fechou, **gravando o que
   foi capturado como rascunho** (status `rascunho`, fora do planejamento) com relatório honesto do
   que falta — em vez de ficar preso no "faltam R$ Z". Nunca finge que fechou.

## Entradas

- **Documento `.txt`** (webhook do `roteador-central`): `msg.document` com `file_name` terminando
  em `.txt`. Baixado via Telegram `resource:file` (mesmo nó `baixar` do ZIP/CSV), decodificado
  binário→texto e despachado ao **`fatura-aberta`** (acao `fatura-aberta`) — não ao buffer: um
  arquivo é completo por natureza, processado atomicamente.
- **Comando `/fecharfatura`** (texto): despachado ao **`fatura-buffer`** com acao `fechar-fatura`.

## Saídas

- **`.txt` que fecha o checksum:** `fatura-aberta` grava `FaturaAberta` como hoje (status
  `fechado`) + ✅ no Telegram. Caminho idêntico ao da colagem que fecha.
- **`.txt` que NÃO fecha:** `fatura-aberta` grava como `rascunho` com a mensagem já existente
  (*"Capturei N lançamentos (R$ X), mas faltam R$ Z para o Total… Gravado como rascunho (fora do
  planejamento até fechar)"* — [gerar-workflow-fatura-aberta.js:163](../../scripts/gerar-workflow-fatura-aberta.js)).
  Nenhum código novo de gravação: o `fatura-aberta` **já** trata os três casos (fecha / falta /
  estoura).
- **`.txt` sem a assinatura `Total dessa fatura`** (não é fatura C6): `fatura-aberta` responde o
  aviso já existente, nada gravado.
- **`/fecharfatura` com sessão de buffer aberta:** o `fatura-buffer` **força o flush** do
  `texto_acumulado` atual chamando `fatura-aberta` (que grava `rascunho` + reporta o que falta) e
  **limpa o buffer** (`aberto=não`). Mesmo caminho de flush de hoje — só que disparado por comando,
  não por checksum.
- **`/fecharfatura` sem sessão aberta:** mensagem *"📭 Não há fatura aberta em andamento para fechar.
  Envie /faturaaberta e cole, ou mande o .txt."* — não toca `FaturaBuffer` nem `FaturaAberta`.

## Regras de negócio aplicáveis

- **Checksum continua juiz do `fechado`:** só fecha (entra no planejamento) quando a soma bate.
  `/fecharfatura` grava **`rascunho`**, que a regra 3 do dashboard já exclui (não-fechado) — **zero
  risco de total errado contado como certo** (regra crítica do HANDOFF: checksum não fecha → não
  grava como verdade).
- **Snapshot por ciclo inalterado:** o flush forçado é o mesmo clear+write de `FaturaAberta`.
- **`fatura-aberta` permanece INTACTO:** recebe `texto`, faz parse→checksum→clear+write→report.
  Toda a mudança é em quem o chama (roteador para `.txt`; buffer para `fechar-fatura`).
- **`FaturaBuffer` isento de Log** (estado efêmero); auditoria acontece no flush, dentro do
  `fatura-aberta`.
- **Parser nunca trava:** `.txt` estranho cai no aviso "não achei Total dessa fatura"; nada grava.

## Casos especiais e erros

- **`.txt` que não é fatura** (lista de compras qualquer): sem a assinatura → aviso, nada gravado.
- **`.txt` enorme (>4096):** irrelevante — arquivo não sofre o split do Telegram; chega inteiro.
- **`/fecharfatura` com buffer vazio/expirado:** trata como "nada para fechar" (mensagem 📭). O
  encerramento explícito **ignora o TTL** (é intenção do usuário), mas exige `aberto=sim` e
  `texto_acumulado` não-vazio.
- **`/fecharfatura` quando o buffer JÁ fecharia** (checksum bate): flush normal → grava `fechado`
  (o forçar-flush não rebaixa para rascunho; quem decide o status é o checksum no `fatura-aberta`).
- **`.txt` com sessão de buffer aberta em paralelo:** o `.txt` vai direto ao `fatura-aberta`
  (autoritativo) e sobrescreve `FaturaAberta`; a sessão de buffer velha expira pelo TTL ou é
  resetada no próximo `/faturaaberta`. Sem corrupção (clear+write é idempotente).
- **Outras extensões** (`.pdf`, `.docx`, …): inalteradas (pdf → "em construção"; resto → formato
  não suportado). Só `.txt` ganha rota nova.

## Decisões de arquitetura

- **`.txt` → `fatura-aberta` direto (não buffer):** arquivo é atômico e completo; deve sempre
  produzir um resultado gravado (fechado/rascunho) sem depender de `/fecharfatura`. Reusa o nó
  `executarFatura(…, "fatura-aberta")` já existente no gerador do roteador.
- **`/fecharfatura` → `fatura-buffer` (acao `fechar-fatura`):** o estado da colagem vive no buffer;
  só ele sabe o `texto_acumulado`. Nova ação no `decidirFluxoBuffer` devolve `flush`
  (`textoFlush = texto_acumulado`) quando há sessão, ou `stub-nl` (mensagem 📭) quando não há.
  Reusa o caminho de flush do glue do buffer (limpa buffer + chama `fatura-aberta`).
- **Lógica pura nova/alterada (TDD primeiro):**
  - `roteador.js / classificarUpdate`: `.txt` → `{ rota:"documento", tipo_arquivo:"txt", file_id,
    file_name }`; `/fecharfatura` → `{ rota:"fechar-fatura", texto }`.
  - `fatura-buffer.js / decidirFluxoBuffer`: ramo `rota === "fechar-fatura"` (ignora TTL; exige
    `aberto` + texto) → `flush` | `stub-nl`.
- **Mensagens:** `respostaProgresso` passa a citar `/fecharfatura` como saída ("…ou /fecharfatura
  para encerrar como rascunho"); `RESPOSTAS.boasVindas` e a lista de comandos incluem
  `/fecharfatura` e a dica de mandar `.txt`.
- **Fiação do roteador (gerador):**
  - Ramo `.txt`: `É Documento?`→`É ZIP?`(não)→**`É Fatura TXT?`**(tipo_arquivo==="txt")→
    `Baixar Fatura TXT`→`Texto Fatura`(binário→`{texto}`)→`Executar Fatura Arquivo`
    (`executarFatura "fatura-aberta"`). O ramo falso de `É Fatura TXT?` segue para `Baixar CSV`
    (fluxo CSV/ZIP intacto).
  - Ramo `/fecharfatura`: novo `É Fechar Fatura?` na cascata de texto (entre `É Seed Parcelas?` e
    `É Texto Livre?`) → `executarBuffer(…, "fechar-fatura")`.

## Critérios de sucesso (verificáveis)

- [ ] `classificarUpdate`: documento `.txt` → `{ rota:"documento", tipo_arquivo:"txt", file_id,
      file_name }`; `.pdf`/`.docx`/`.zip`/`.csv` inalterados (`roteador.test.js`).
- [ ] `classificarUpdate`: `/fecharfatura` → `{ rota:"fechar-fatura", texto }`; demais comandos,
      callbacks, documentos e texto-livre inalterados.
- [ ] `decidirFluxoBuffer` (TDD): `fechar-fatura` com sessão aberta e `texto_acumulado` → `flush`
      com `textoFlush` === `texto_acumulado`; `fechar-fatura` sem sessão (ou texto vazio) →
      `stub-nl` com a mensagem 📭; `fechar-fatura` ignora TTL (sessão "velha" mas aberta → flush).
- [ ] **Flush forçado grava rascunho:** texto parcial (amostra truncada) via `fatura-aberta`
      produz `fase:"gravar-fatura"`, rows com `status:"rascunho"`, e a mensagem cita "faltam R$ Z"
      e "rascunho" (reusa teste/lógica existente do `fatura-aberta`).
- [ ] **`.txt` completo:** o conteúdo da amostra `fatura-aberta-exemplo.txt` despachado como
      `texto` ao `fatura-aberta` fecha (status `fechado`, total R$ 7.873,89) — paridade com a
      colagem inteira.
- [ ] Geradores produzem `roteador-central.json` e `fatura-buffer.json` válidos; `import-workflows.ps1`
      roda sem erro; sub-workflows reativados (pegadinha herdada do n8n).
- [ ] **Conferência ao vivo:** (a) mandar a fatura como `.txt` → bot responde ✅ (ou rascunho com o
      que falta); (b) colar parcial e mandar `/fecharfatura` → bot grava rascunho e reporta o que
      falta; o card do dashboard NÃO conta o rascunho.

## Fora de escopo

- **Mudar parser/checksum/escrita do `fatura-aberta`** — esta entrega só adiciona entrada/saída.
- **Descobrir QUAL linha some no R$ 733,97 real** — o `.txt` torna o diagnóstico trivial (inspeção
  direta do arquivo / leitura dos rows do rascunho); fica como passo operacional, não de código.
- **OCR de print/imagem e PDF** — descartados (HANDOFF: erro silencioso de dígito; C6 não exporta
  fatura aberta em PDF). Só `.txt`.
- **Promover rascunho a fechado manualmente** (ex.: `/confirmarfatura`) — se necessário, vira spec
  futura; por ora o caminho de fechar é recolar completo ou mandar o `.txt`.
