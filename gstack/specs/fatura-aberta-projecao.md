# Spec — fatura-aberta-projecao

> Nova feature **pós-item-10** (o item 10 era o último da ordem original; esta é uma
> demanda nova do Marcelo). Gerada por **grill-me** (12 perguntas, 2026-06-18) e
> **revisada pelo `plan-reviewer` (2026-06-18): GO-com-correções**. Esta versão já
> incorpora as correções C1–C6, o reseed (R1) e os edge cases R2–R5/R7.
>
> Resolve a lacuna registrada no HANDOFF: o C6 **não exporta CSV da fatura aberta**
> (não fechada), o que cega o planejamento futuro (comprometido do ciclo + parcelas).

## Escopo em duas entregas (decisão do plan-reviewer, S1)
- **v1 (esta spec, construível e validável por TDD):** parser determinístico + provisórios
  + checksum + reconciliação + self-track/seed de parcelas + **correção mínima de backend**
  no `dashboard-data` (excluir os provisórios `fatura-aberta` da regra de previsão já
  existente — ver C2). Sem bloco novo no React.
- **v2 (entrega seguinte):** bloco **"Comprometido futuro"** no dashboard React
  (`dashboard-web/`) consumindo fatura aberta + projeção de parcelas, e o de-para completo
  de categorias C6→projeto. Isola o risco de regressão no React (que está em PR aberto).

## Objetivo
Permitir ao Marcelo **capturar a fatura aberta do C6** (que não tem CSV) colando, no
Telegram, o **texto real** copiado do app web do C6 no PC. O bot registra os lançamentos
como **provisórios reconciliáveis**, mantém o **estado das parcelas** e projeta as
**cobranças futuras**. Quando a fatura fecha e o CSV oficial é importado (fluxo já
existente), os provisórios do ciclo são substituídos pelos confirmados — sem dupla
contagem. O consumo visual (bloco "comprometido futuro") é a **v2** no dashboard React.

## Entradas
- **Comando `/faturaaberta` + bloco de texto colado** (decisão do plan-reviewer, ponto 1).
  Marcelo seleciona a lista da fatura aberta no **app web do C6** (texto **selecionável**,
  `Ctrl+C` — **não** é OCR, **não** é print) e cola. **Não** há autodetecção por conteúdo:
  o `roteador.js` não tem classificação de texto livre hoje, e o comando explícito segue o
  padrão do projeto (`/metas`, `/relatorio`). A assinatura `Total dessa fatura` é usada como
  **validação interna** do bloco (sem assinatura → aviso), não como gatilho.
- **Comando `/seedparcelas` + bloco** (decisão do plan-reviewer, ponto 3) —
  **reexecutável** (é também o caminho de **reseed**, ver R1). Uma linha por parcela:
  `estabelecimento | N/M` (ex.: `CLUBEW | 1/12`). Lido uma vez (e quando precisar corrigir),
  olhando o app do celular, que mostra "Parcela N de M".
- **Formato bruto do C6 web** (confirmado com amostra real, 2026-06-18):
  - Cabeçalho de totais no topo: `Lançamentos nacionais`, `... internacionais`,
    `Encargos e serviços`, **`Total dessa fatura\nR$ 7.873,89`**, `Pagamento mínimo`.
  - Cabeçalho de dia: `Domingo, 14/06/26` (dia-da-semana, `DD/MM/AA` — **ano de 2 dígitos**,
    ver R7).
  - Por lançamento, em linhas sucessivas: `categoria do C6` → `estabelecimento` →
    `R$ valor` (repetido 2× — original e convertido; nacional = iguais) → opcional
    `Em Mx` (total de parcelas; **NÃO** há "Parcela N de M" no desktop — ver Decisões).
  - Linhas de pagamento/crédito aparecem como negativas: `Inclusao de Pagamento\n-R$ 9.363,91`.
- **Aba Lançamentos** (`A:J`) e **Log** (append-only) — padrão do projeto, leitura única
  via `values:batchGet`.
- **Aba `Parcelas`** (nova — onde mora o estado do self-track, decisão do plan-reviewer C4):
  ver "Estado de parcelas" em Decisões.

## Saídas
- **Lançamentos provisórios** na aba Lançamentos com `status = previsto` e **rótulo
  `fatura-aberta`** (a coluna de rótulo/origem é o que permite a reconciliação e a exclusão
  da previsão antiga — ver C1/C2), carimbados com o **ciclo** (fecha dia 03) e a **categoria
  do C6**.
- **Estado `não-fechado`** enquanto o checksum do ciclo ainda não bate (colagem partida em
  andamento): os provisórios já entram na aba, mas marcados como não-fechados e **excluídos
  do dashboard** até o checksum fechar (resolve R3 — ver Casos especiais).
- **Confirmação no Telegram** com o **checksum**: total somado (excl. pagamentos) vs
  `Total dessa fatura` lido do texto. Bate → fecha o ciclo + mostra total. Não bate →
  mantém `não-fechado`, avisa a diferença e a pista (provável captura incompleta).
- **Projeção de parcelas** (derivada, recalculada — nunca gravada como confirmada): para
  cada parcela ativa, `M − N` cobranças futuras do mesmo valor, uma por ciclo.
- **Log** de cada captura (`acao=fatura_aberta_capturada`, ciclo, nº lançamentos, total) e
  de cada seed/reseed (`acao=parcelas_seed`).
- **(v2)** Bloco "Comprometido futuro" no dashboard React.

## Regras de negócio aplicáveis (HANDOFF — ciclo, dedup, transferências)
- **Ciclo:** fecha **dia 03**, vence **dia 10**. Transações de **04→03** pertencem ao ciclo
  que fecha no dia 03. Cada provisório é carimbado com o ciclo.
- **Snapshot por ciclo — regravação explícita (decisão do plan-reviewer C3):** recolar a
  fatura **regrava** o ciclo aberto: **apaga** os lançamentos `status=previsto` +
  `rótulo=fatura-aberta` **daquele ciclo** e **reinsere** o conjunto da colagem atual
  (delete-by-cycle-then-insert). É o que torna "recolar não duplica" verdadeiro e verificável
  — e também o que permite um **estorno** entre colagens (R4) ser refletido (o snapshot mais
  recente vira a verdade). Continua **stateless** (sem sessão conversacional): a chave é o
  ciclo, não uma conversa. Dedup intra-colagem por `(ciclo, data, estabelecimento, valor)`.
- **Reconciliação com o CSV oficial (decisão do plan-reviewer C1 — corrige premissa errada):**
  ⚠️ O `dedup-importacao` real é o `faturaJaImportada` (`parser-cartao.js`), que **bloqueia**
  a importação se já existir lançamento `origem='cartao'` naquela competência — ele **não**
  remove provisórios. Como os provisórios também são de cartão, sem tratamento o
  `faturaJaImportada` **travaria a importação do CSV oficial**. Logo, a reconciliação tem um
  passo explícito: **antes** de importar o CSV do ciclo, **apagar** os `previsto`+
  `fatura-aberta` daquele ciclo (o `faturaJaImportada` deve **ignorar** linhas com
  `rótulo=fatura-aberta` na sua contagem de bloqueio). Depois entram os `confirmado`. Zero
  dupla contagem e sem travar o fluxo já em produção.
- **Exclusão de pagamento/transferência:** linhas `Inclusao de Pagamento` / valores negativos
  são **excluídas** do gasto e do checksum — mesma lógica do `ehTransferencia`
  (`Pagamento`/`Retirada`) já aplicada em rateio/dashboard/relatorio.
- **Valor BR:** ponto de milhar, vírgula decimal (`R$ 1.000,00`). Reusar `parseValorBR`
  existente (S3). Ignorar o valor duplicado (pegar uma das duas ocorrências).
- **Data:** reusar `normalizarData` existente (S3), mas **converter `DD/MM/AA`→`DD/MM/YYYY`
  na fronteira** do parser (R7) — o resto do projeto usa ano de 4 dígitos.

## Casos especiais e erros
- **Captura incompleta** (erro mais provável — Marcelo não rolou/colou tudo): soma <
  `Total dessa fatura` → ciclo fica `não-fechado` (não conta no dashboard), avisa "faltam
  R$ X". (O checksum deixou de ser anti-duplicata e virou **detector de captura incompleta**.)
- **Sobra / estorno** (R4 — lançamento que sumiu da fatura entre colagens): a regravação por
  ciclo (delete-then-insert) já reflete a fatura mais recente. Se mesmo assim soma > total
  (ex.: parcela cancelada que o C6 ainda lista), avisa, mas **grava** o snapshot atual (a
  colagem é a fonte de verdade do ciclo) e marca a divergência no Log.
- **Colagem partida em N mensagens** (R3 — limite ~4096 chars do Telegram): cada fragmento é
  gravado como `previsto` + `não-fechado` daquele ciclo; o checksum só **fecha** o ciclo
  quando soma == `Total dessa fatura`. Enquanto não fecha, o ciclo **não alimenta o
  dashboard**. (Resolve a contradição "não grava" × "acumula": grava como buffer
  não-fechado, conta só quando fecha.)
- **Parcela terminando — `N==M`** (R2): no ciclo em que a parcela final (ex.: GOL 3/3) ainda
  aparece como lançamento real na fatura colada, ela é contabilizada **como lançamento**
  daquele ciclo e a **projeção** dela é **0** (não há `M−N` futuro). Teste de borda explícito
  para garantir que a 3/3 não seja contada duas vezes nem desapareça.
- **Gêmeo real** (R5 — mesma data/lugar/valor, compra dupla legítima): a dedup intra-colagem
  o removeria silenciosamente e o checksum daria soma < total (confundindo com captura
  incompleta). Tratamento: quando a diferença do checksum **coincide com o valor de uma linha
  deduplicada**, avisar especificamente "possível compra duplicada removida — confira" em vez
  do aviso genérico. Marcelo resolve na mão (decisão do grill).
- **Pagamento/crédito** (`-R$ ...`): ignorado no total e no checksum (não é gasto).
- **Parcela sem índice** (desktop só dá `Em Mx`): o índice atual `N` é **derivado** do estado
  de parcelas (ver Decisões + R1) — não do número de colagens.
- **Formato inesperado** (linha que não casa o padrão data/categoria/estabelecimento/valor):
  parser **não trava** — pula a linha, contabiliza no checksum como divergência e avisa
  (padrão do projeto: parser nunca falha em silêncio).
- **Texto que não é fatura C6** (sem assinatura `Total dessa fatura`): ignora com aviso.

## Decisões de arquitetura
- **Parser determinístico, sem LLM e sem OCR** — porque a entrada é **texto real
  selecionável** do app web (confirmado). Mata o Gemini Vision cogitado para print: mais
  confiável (sem erro silencioso de dígito), **de graça** e **sem mandar fatura para LLM
  nenhuma** (resolve o caveat de privacidade). Lógica pura em `workflows/src/fatura-aberta.js`
  (TDD antes do build), no par "lógica-pura + gerador" do projeto. Reusar `parseValorBR` e
  `normalizarData` (S3). **Atenção (S4):** já existe `seed-parser.js` (seed do razão da
  conta) — o seed de parcelas é coisa diferente; usar nome desambiguado (ex.: lógica de
  parcelas em `fatura-aberta.js` ou `parcela-tracker.js`), não estender `seed-parser.js`.
- **Caminhos descartados no grill (registrar p/ não reabrir):** screen scraping/OCR de
  print (erro silencioso de dígito — provado: a mesma compra leu `211,43` via ChatGPT e
  `21,35` via Live Text); push de compra (iPhone não deixa app ler notificação de outro);
  agregador Open Finance pago — Pluggy/Belvo (Marcelo recusou aumentar gasto para controlar
  gasto; e exigiria CNPJ/mensalidade). Tudo isso é **Fora de escopo**.
- **Snapshot via regravação por ciclo (delete-then-insert), não delete-all global nem sessão
  stateful** — ver Regras (C3). Cada colagem é auto-contida; a chave é o ciclo.
- **Índice de parcela: estado derivável + reseed, NÃO contador incremental cego
  (decisão do plan-reviewer R1 — corrige o ponto mais frágil do desenho original):**
  - O desktop dá só `Em Mx` (total), não `N de M`. **Inferir N pela data é furado — provado
    nos dados reais:** GOL (compra 01/05) é "2 de 3" e CLUBEW (compra 14/06) é "1 de 12";
    nenhuma regra de data única acerta os dois (nuance de corte do C6).
  - **Risco do desenho original (contador `+1` por virada de ciclo):** se Marcelo pular um
    ciclo de envio, o índice não incrementa e **toda** a projeção daquela parcela fica
    permanentemente adiantada — erro **silencioso e otimista** (infla a sensação de folga).
  - **Solução:** o índice **não** é um contador que soma a cada colagem. Ele é **derivado**:
    `N_atual = N_no_seed + (nº de viradas de ciclo de calendário decorridas desde o ciclo de
    referência do seed)`. Como ancora no **calendário** (ciclos do C6, deterministas), pular
    uma colagem **não** dessincroniza. Em cima disso, **`/seedparcelas` é reexecutável**
    (reseed): a qualquer momento Marcelo recarrega `estabelecimento | N/M` do celular e o
    estado é sobrescrito — fonte de verdade recarregável, não carga única frágil.
- **Estado de parcelas — aba `Parcelas` (nova) no Google Sheets (decisão do plan-reviewer
  C4):** colunas mínimas: `estabelecimento_norm` (chave), `descricao`, `valor`, `M` (total),
  `N_no_seed`, `ciclo_referencia` (data do ciclo em que `N_no_seed` era verdade). `N_atual` é
  **derivado** na leitura (não persistido). **Casamento seed↔lançamento por chave
  `(estabelecimento_norm, M)`** — nunca por valor (dois itens podem coincidir em valor).
- **Projeção derivada, nunca persistida como confirmada:** recalculada todo ciclo a partir
  da aba `Parcelas` (evita dupla contagem quando a parcela vira lançamento real no próximo
  ciclo). Mesmo princípio do `valor_acumulado` derivado do item 10. **Horizonte 6 meses,
  parametrizável na aba Config** (S2 — junto de `cartao_vencimento_dia`), não hardcoded.
- **Categoria do C6 (decisão do plan-reviewer ponto 4):** o texto traz a categoria do próprio
  C6. Em **v1**, ela é **gravada como metadado**, mas a categorização efetiva segue o
  `categorizacao-hibrida` normal (Dicionário → Gemini → manual) — **fallback**: categoria C6
  sem de-para não inventa nada. O **de-para completo C6→projeto** fica para a **v2** (é
  "bônus", a feature funciona sem ele).
- **Dashboard (decisão do plan-reviewer C2 — corrige colisão com código em produção):** a
  regra 3 do `dashboard-data` ("Previsão do Próximo Mês") **já** soma `tipo='saída' AND
  status='previsto'` do próximo mês → os provisórios `fatura-aberta` entrariam nela
  automaticamente (dupla contagem) e as parcelas projetadas (derivadas, não gravadas) não
  entrariam. **v1 inclui a correção mínima de backend:** a regra 3 passa a **excluir
  `rótulo=fatura-aberta`** (e ciclos `não-fechado`). O **bloco visual consolidado**
  (fatura aberta + parcelas) é a **v2** no React.

## Critérios de sucesso (verificáveis)
### v1 — lógica pura + backend
- [ ] `fatura-aberta.js` (lógica pura, TDD) contra a **amostra real** colada no grill:
  - [ ] Parseia os ~40 lançamentos (data `DD/MM/AA`→`YYYY`, categoria, estabelecimento,
        valor BR), ignorando o valor duplicado e o cabeçalho de totais.
  - [ ] Extrai `Total dessa fatura = R$ 7.873,89` e **exclui** `Inclusao de Pagamento
        −R$ 9.363,91` do gasto e do checksum; soma dos lançamentos (sem pagamento) **bate**.
  - [ ] `Em Mx` capturado como total de parcelas; linha sem `Em Mx` = à vista.
- [ ] **Checksum:** soma == total → fecha o ciclo + reporta; soma ≠ total → ciclo
      `não-fechado` + avisa (casos "captura incompleta", "sobra/estorno" e "gêmeo real").
- [ ] **Regravação por ciclo:** recolar a mesma fatura (1 msg ou partida em N) → mesmo
      conjunto de provisórios, sem duplicar; uma colagem com 1 lançamento a menos (estorno)
      → o lançamento some do ciclo. Checksum recalculado.
- [ ] **Ciclo:** transações 04→03 carimbadas no ciclo que fecha dia 03; transação dia 03 e
      dia 04 caem nos ciclos corretos (teste de borda).
- [ ] **Índice de parcela derivado (R1):** seed `GOL=2/3` com `ciclo_referencia`; após **uma
      virada de ciclo de calendário** `N_atual=3/3` **mesmo sem nova colagem**; após **duas**,
      a parcela está encerrada. Reseed via `/seedparcelas` sobrescreve o estado.
- [ ] **Parcela terminando (R2):** GOL 3/3 ainda na fatura colada → contada 1× como
      lançamento, projeção 0; nunca 2× nem ausente.
- [ ] **Projeção:** `CLUBEW Em 12x` (seed 1/12) → 11 cobranças futuras de R$ 123,54;
      `GOL 3/3` → 0; soma por mês à frente correta no horizonte (lido da aba Config).
- [ ] **Reconciliação (C1):** ao importar o CSV do ciclo, os `previsto`+`fatura-aberta`
      daquele ciclo são apagados **antes** e o `faturaJaImportada` **não** os conta no
      bloqueio → a importação do CSV oficial **roda** e entram `confirmado`; provisórios de
      **outro** ciclo intactos. Sem dupla contagem.
- [ ] **Backend dashboard (C2):** a regra 3 do `dashboard-data` **não** soma
      `rótulo=fatura-aberta` nem ciclos `não-fechado` (teste do contrato da query).
- [ ] **Não-regressão:** roteador despacha `/faturaaberta` e `/seedparcelas` sem canibalizar
      comandos/callbacks existentes; suíte completa (12+ arquivos) continua verde.
- [ ] Gerador produz o(s) workflow(s) válido(s); `import-workflows.ps1` roda sem erro.

### v2 — dashboard React
- [ ] Bloco "Comprometido futuro" (fatura aberta + parcelas/mês) consome o backend já
      corrigido; de-para de categorias C6→projeto aplicado.

## Fora de escopo
- **Bloco React "Comprometido futuro" e de-para de categorias** — são a **v2** (não v1).
- **Gemini Vision / OCR / print / Live Text** — entrada é texto real do app web.
- **Push de compra** (iPhone não permite) e **tempo real** (janela é semanal).
- **Agregador Open Finance pago** (Pluggy/Belvo) — Marcelo recusou custo/CNPJ.
- **Inferir índice de parcela por data** — provado furado; usa-se estado derivável + reseed.
- **Editar/excluir lançamento provisório individual** via Telegram (snapshot por colagem).
- **App mobile do C6** como fonte (só web desktop, texto selecionável) — exceto o **seed/
  reseed** de parcelas (lê "Parcela N de M" do celular).
- **Migrar/recategorizar** lançamentos históricos com a taxonomia do C6.
