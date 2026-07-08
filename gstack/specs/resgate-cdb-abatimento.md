# Spec — resgate-cdb-abatimento

> Extensão pontual de `categorizacao-hibrida`/`aplicar-categoria` (Telegram) e do
> núcleo `rateio.js` (dashboard). Não é um sub-workflow novo.

## Contexto / bug relatado

Hoje, ao detectar um lançamento `RESGATE ... CDB` na conta corrente, o bot **sempre**
força a pergunta "qual meta associar?" (HANDOFF.md linha 59) e grava
`categoria = "Meta: <nome>"`. Em `rateio.js`, `ehMeta()` faz `calcularRateio` **excluir
totalmente** qualquer lançamento `Meta: …` — não soma em `base`, não soma em
`exclusivo`, e (por ser entrada) também não conta como `pago` (que só aceita
`categoria === "Depósito {pessoa}"` exato). Ou seja: **um resgate de CDB vinculado a
uma meta é hoje 100% invisível para a Cota da Casa/Depósitos/Saldo do "Detalhamento do
Saldo"** — não existe nenhum caminho de código para reduzir proporcionalmente o total
a depositar da casa quando o resgate foi usado para cobrir uma despesa compartilhada
(ex.: pagar a fatura do cartão referente ao gasto que gerou a meta).

Esta spec adiciona o mecanismo que falta: perguntar explicitamente se aquele resgate
deve abater proporcionalmente (por proporção salarial, igual ao resto do rateio) o
total da Cota da Casa do mês, ou apenas ser ignorado (comportamento atual).

## Objetivo
Ao detectar um resgate de CDB, a MESMA pergunta de sempre ("qual meta associar?")
ganha, para cada meta ativa, **dois botões** em vez de um: associar normalmente
(comportamento atual, ignorado pelo rateio) ou associar **e abater** proporcionalmente
da Cota da Casa do mês. Se "abater", a Cota da Casa do mês é reduzida pelo valor do
resgate **antes** de dividir por proporção salarial — exatamente como uma despesa a
menos, não como um depósito de uma pessoa só.

> **Decisão (simplificação vs. rascunho anterior):** a primeira versão desta spec
> propunha uma SEGUNDA pergunta sequencial após a escolha da meta. O `plan-reviewer`
> apontou que isso exigia um bypass do guard "categoria já preenchida → recusar" em
> `aplicar-categoria`, uma leitura nova da aba Log só para detectar clique duplo, e um
> caso extra de "estado inesperado" (linha mudou entre as duas perguntas). Dobrar os
> botões na MESMA pergunta resolve tudo isso de graça: é uma única resposta, o guard
> existente continua protegendo sem exceção, e não há janela entre duas perguntas.

## Entradas
- Lançamento de conta corrente com `titulo` contendo `RESGATE` + `CDB` (mesma detecção
  de `ehResgateCdb`, `categorizador.js:47-50`), `categoria` vazia.
- Resposta ao teclado de metas: `meta|row|nome` (associa, comportamento atual) OU
  `metaab|row|nome` (associa E abate — novo).

## Saídas
- **Categoria gravada:**
  - `meta|row|nome` → `categoria = "Meta: <nome>"` (igual hoje, sem mudança).
  - `metaab|row|nome` → `categoria = "Meta: <nome> (abatimento cdb)"` — convenção de
    string, **sem coluna nova** na aba Lançamentos (evita mexer nos `A:J` hardcoded em
    6+ workflows). `id_meta` continua só `<nome>` (sem sufixo), para não quebrar o
    match exato do `/metas` (`gerenciar-metas.md` linha 63-64).
  - **Invariante de arquitetura:** nenhum dos dois cria linha no Dicionário — `regra`
    continua `null` para `cb.tipo === 'meta'` OU `'metaab'` (só `cat|` cria regra,
    igual hoje). O sufixo `(abatimento cdb)` NUNCA é gravado no Dicionário, mesmo no
    futuro — se algum código novo tratar "Meta: …" genericamente para o Dicionário,
    ele deve continuar ignorando ambas as variantes.
- **Log:** a linha `categoria_aplicada_manual` já existente passa a registrar o valor
  completo (`"Meta: X (abatimento cdb)"` quando for o caso) — nenhuma linha de Log
  nova é necessária, pois não há mais uma segunda pergunta/resposta para auditar.
- **rateio.js:** `calcularRateio` passa a reconhecer a categoria
  `"Meta: … (abatimento cdb)"` e subtrai o valor da entrada de `base` **antes** do
  split proporcional — reduzindo a Cota da Casa de todos proporcionalmente, igual ao
  pedido do usuário (`resgate × prop[pessoa]` de redução por pessoa).

## Regras de negócio aplicáveis
- HANDOFF.md linha 59 ("Resgate de CDB → perguntar qual meta associar") — mantida,
  ganha o botão extra de abatimento na mesma pergunta.
- `gstack/specs/rateio-cumulativo-e-gastos-exclusivos.md` ("Metas fora do rateio") —
  emenda: **regra geral continua valendo** (Meta: X fica fora do rateio); a única
  exceção é a variante `(abatimento cdb)`, que é tratada como uma despesa negativa da
  base compartilhada, não como poupança.
- Match exato de `id_meta` para `/metas` (gerenciar-metas.md linha 63-64) — preservado
  porque o sufixo `(abatimento cdb)` fica só na `categoria`, não no `id_meta`.

## Fluxo — categorizacao-hibrida / aplicar-categoria (extensão)
1. Varredura detecta `RESGATE CDB` → pergunta meta com o teclado **estendido**:
   `montarTecladoMetas(row, metas)` passa a gerar, para CADA meta ativa, dois botões
   — `🎯 <nome>` (`meta|row|nome`, associa só) e `💰 <nome> (abater)`
   (`metaab|row|nome`, associa e abate). **Só este teclado muda** —
   `montarTeclado(row, categorias, metas)` (usado no fluxo geral de
   viagem/hospedagem/ambíguo, onde a meta é ligada a uma SAÍDA, não a uma entrada)
   continua com um botão só por meta (abatimento não faz sentido para despesa).
2. Usuário clica `meta|row|nome` → **sem mudança**: `categoria = "Meta: <nome>"` +
   `id_meta = <nome>`.
3. Usuário clica `metaab|row|nome` → `categoria = "Meta: <nome> (abatimento cdb)"` +
   `id_meta = <nome>` (mesmo valor, sem sufixo — preserva o match exato do `/metas`).
4. `aplicar-categoria` (`codigoProcessar`, `scripts/gerar-workflow-categorizacao.js`):
   o branch hoje exclusivo de `cb.tipo === 'meta'` passa a cobrir também
   `cb.tipo === 'metaab'`: mesma validação (`metas.includes(cb.nome)`), mesmo
   `idMeta = cb.nome`, e `categoria` ganha o sufixo só quando `cb.tipo === 'metaab'`.
   `regra` continua `null` em ambos os casos (branch `else` que cria `regra` só roda
   para `cat|`). **A checagem "categoria já preenchida → recusar" (linha 407-409 do
   JSON gerado) NÃO muda** — continua rodando ANTES do branch por tipo, para os três
   prefixos igualmente (`cat`/`meta`/`metaab`), porque não há mais uma segunda rodada
   sobre a mesma linha.
5. `editMessageText` de confirmação já existente passa a exibir a categoria completa
   (com o sufixo, quando for o caso) — sem novo texto/mensagem.

## Roteamento (`roteador.js`)
- `workflows/src/roteador.js:37` tem a whitelist fechada
  `/^(cat|meta|pg|np|gmnova|gmenc|gmok)\|/` — ganha o prefixo novo:
  `/^(cat|meta|metaab|pg|np|gmnova|gmenc|gmok)\|/`.
- `metaab` cai no mesmo `else` que já resolve `destino = "aplicar-categoria"`
  (linha 42) — nenhuma outra mudança de roteamento necessária.
- **Não-regressão (critério de sucesso):** após estender o regex, `cat|12|Streams`,
  `meta|12|Viagem`, `gmnova|`, `gmenc|Viagem` e `gmok|Viagem` continuam roteando para
  os destinos de sempre; `metaab|12|Viagem` roteia para `aplicar-categoria`; prefixo
  desconhecido continua `{ rota: "ignorar" }`.

## Regra de cálculo (rateio.js)
- Nova função pura `ehAbatimentoCdb(categoria)` → regex
  `/^meta:.*\(abatimento cdb\)$/i` (normalizado, case-insensitive).
- Em `calcularRateio`, o loop principal (hoje só processa `tipo === "saída"`) ganha um
  segundo laço (ou extensão do mesmo) para entradas confirmadas com
  `ehAbatimentoCdb(categoria)`: `base = arred(base - valorNum(l.valor))`.
- **Sem clamp em zero:** se o resgate for maior que a base do mês, `base` fica
  negativo (a casa "deve" para as pessoas naquele mês) — aceito, documentado, caso
  raro. Sem migração de dados retroativa automática (ver "Fora de escopo").
- `totalDespesas` continua sendo `base + Σexclusivo` (já reflete a base reduzida).

## Casos especiais e erros
- Resgate de CDB sem meta ativa disponível → mantém o aviso atual (parser não trava);
  sem metas ativas, nenhum dos dois botões (`meta|`/`metaab|`) aparece.
- Segundo clique (linha já categorizada, em `meta|`, `metaab|` ou `cat|`) →
  `answerCallbackQuery` "Já categorizado: …" (guard existente, inalterado).
- Callback forjado (`from.id != TELEGRAM_CHAT_ID`) → roteador ignora, mesma validação
  já aplicada a `cat|`/`meta|`/`gm*`.
- `callback_data` de `metaab|<row>|<nome>` — 2 bytes a mais que `meta|<row>|<nome>`
  por causa do `ab`; testado com nomes reais (`"Viagem Lua de Mel"`,
  `"Ar Condicionado Portátil"`) continua ≤ 64 bytes (mesmo teste de
  `montarTeclado`/`montarTecladoMetas` já existente).

## Extensão — "Depósito Previsto" (previsão do mês, `dashboard.js`)

`previsaoProximoMes` (dashboard.js) é uma projeção FORWARD-LOOKING (Contas Fixas +
fatura de cartão fechada do mês, dividida por proporção salarial) — nunca lia a aba
Lançamentos, então não tinha nenhum canal para saber de um resgate de CDB na conta
corrente. Ganhou o mesmo tratamento de `calcularRateio`: uma entrada confirmada do mês
com `ehAbatimentoCdb(categoria)` reduz `totalPrevistoBase` (fixas + fatura, antes do
exclusivo) proporcionalmente, do mesmo jeito que reduz a `base` do rateio real. O
gasto bruto exibido (`gastos.total`/`gastos.parcelas`) NÃO muda — só `depositosPrevistos`
(quanto cada um efetivamente precisa depositar) reflete o crédito.

## Fora de escopo
- Corrigir retroativamente linhas já gravadas como `"Meta: X"` sem a nova pergunta
  (inclui o mês 07/2026 relatado pelo usuário) — correção manual pontual na planilha,
  fora deste código.
- Mudar como `metas.js` (`calcularProgresso`) soma o resgate no progresso da meta
  (hoje soma valor absoluto sem olhar `tipo`, então o resgate infla o progresso em vez
  de completá-lo/reduzi-lo) — bug relacionado, mas em módulo e spec diferentes
  (`gerenciar-metas.md`); tratar separadamente.
- Adicionar coluna nova na aba Lançamentos (decidido: convenção de string na
  categoria, para não tocar nos `A:J` hardcoded em ingestão/dashboard/relatórios).
- Permitir abatimento parcial (ex.: abater só metade do resgate) — é tudo ou nada
  (`sim`/`nao`), como pedido pelo usuário.

## Critérios de sucesso (verificáveis)
- [ ] `categorizador.test.js`: `parsearCallback` aceita `metaab|12|Viagem`
      (`{tipo:'metaab', row:12, nome:'Viagem'}`); `montarTecladoMetas(row, metas)`
      gera 2 botões por meta (`meta|` e `metaab|`), todos `callback_data` ≤ 64 bytes
      com nomes reais; `montarTeclado(row, categorias, metas)` (fluxo geral) **não**
      muda — continua 1 botão por meta.
- [ ] `roteador.test.js` (ou equivalente): `metaab|12|Viagem` roteia para
      `{ destino: "aplicar-categoria" }`; não-regressão de `cat|`, `meta|`, `pg|`,
      `np|`, `gmnova|`, `gmenc|`, `gmok|` e prefixo desconhecido → `ignorar`.
- [ ] `rateio.test.js`: lançamento entrada confirmada `categoria = "Meta: Viagem
      (abatimento cdb)"` reduz `totalDespesas`/`cota` de todas as pessoas
      proporcionalmente. Reproduz o exemplo do usuário com a fixture já existente
      (`rateio.test.js:32`, `SAL = { Marcelo: 20000, Harumi: 4000 }`, total da casa =
      R$ 24.000): resgate de R$ 2.264,04 → Cota da Casa de Marcelo reduz em
      R$ 2.264,04 × 20.000/24.000 = R$ 1.886,70. Uma entrada `"Meta: Viagem"` (sem
      sufixo) continua 100% excluída (não-regressão).
- [ ] Harness do `aplicar-categoria`: clique em `metaab|row|X` de um resgate CDB grava
      `categoria = "Meta: X (abatimento cdb)"` + `id_meta = "X"`, sem criar linha no
      Dicionário; clique em `meta|row|X` continua gravando só `"Meta: X"`; segundo
      clique em qualquer um dos dois → "Já categorizado: …", sem regravar.
- [ ] `scripts/gerar-workflow-categorizacao.js` roda sem erro e regenera
      `categorizacao-hibrida.json`/`aplicar-categoria.json` com o teclado novo.
