# Spec — Rateio cumulativo, depósito do Marcelo e gastos exclusivos (2026-06-23)

Continuação direta de [HANDOFF-2026-06-22-comprometido-futuro-e-buffer]. Surgiu ao conferir o
dashboard ao vivo: o depósito de R$ 10.400 do Marcelo sumiu, o saldo com a casa é só do mês (não
detecta dívida acumulada) e faltam categorias de gasto exclusivo de cada um. Mais a mitigação do
race do buffer (mensagens coladas em sequência caindo no stub).

## Problema (4 itens, decisões já travadas com o Marcelo)

1. **Depósito do Marcelo some.** `06/06 · Pix recebido de MARCELO SILVA LEITE · 10400 · entrada`
   foi categorizado **"Pagamento"** porque o Dicionário tem `MARCELO SILVA LEITE → Pagamento/Retirada`
   e o parser resolve entrada→"Pagamento" (transferência interna). "Pagamento" está em
   `CATEGORIAS_TRANSFERENCIA` → descartado de entradas, gastos **e** rateio. Os depósitos da Harumi
   aparecem porque a regra dela é `→ Depósito Harumi`. → **Decisão: regra fixa.**

2. **Saldo com a casa deve ser cumulativo** (detectar dívida que sobrou de meses anteriores). Hoje
   `rateioMes` filtra só o mês selecionado. → **Decisão: acumular desde o início dos dados, até o
   mês selecionado (≤).**

3. **Categorias de gasto exclusivo** `Gastos Marcelo` / `Gastos Harumi`: despesas que NÃO entram na
   divisão por salário. → **Decisão: cobradas 100% de quem é** (saem da base dividida e somam
   integralmente à cota da pessoa dona).

4. **Buffer (race):** duas mensagens coladas em sequência → a 2ª lê o `FaturaBuffer` antes da 1ª
   gravar → cai no stub de NL. → **Decisão: mitigação leve** — melhorar a mensagem do stub para
   orientar a recolar (sem reescrever a arquitetura).

## Proposta

### 1. Depósito do Marcelo (parser + Dicionário + dado existente)
- **Novo pseudo-categoria** `Depósito Marcelo/Retirada` no `parser-conta.js:100`: entrada→`Depósito Marcelo`,
  saída→`Retirada`. Espelha o `Pagamento/Retirada`. **Dois `if` independentes de igualdade exata**
  (não `else if` encadeado dependente de ordem). Mantém a retirada (saída entre contas próprias)
  como transferência, e só a ENTRADA vira contribuição à casa. (rev #5 — confirmado sem colisão com
  `RE_PAGAMENTO` em fatura-aberta.js:14, que só roda sobre fatura de cartão, nem com `startsWith("Meta: ")`.)
- **Dicionário:** trocar a regra `MARCELO SILVA LEITE` de `Pagamento/Retirada` → `Depósito Marcelo/Retirada`.
- **EFEITO em `totais.entradas` (rev #1 — decisão explícita):** ao virar entrada não-transferência,
  "Depósito Marcelo" passa a **somar em `totais.entradas`** (igual à Harumi hoje). Isso é desejado
  (o KPI Entradas estava subnotificado). `totaisMes`/`gastosPorCategoria` **não mudam de código** —
  o efeito vem do dado. Teste fixa o novo número de `entradas`.
- **Dado existente:** reclassificar a linha de R$ 10.400 (06/06) de `Pagamento` → `Depósito Marcelo`
  via script one-off. A categoria "Depósito Marcelo" já existe na aba Categorias (tipo=entrada).
  - **Toca SÓ a coluna `categoria`** — não mexe em `data_original`/`origem` (não move o marco d'água
    de `filtrarJaImportados`, parser-conta.js:180). (rev #8a)
  - **Idempotente:** se a categoria da linha já for "Depósito Marcelo", não reescreve nem duplica Log. (rev #8b)
  - **Log (rev #8c):** `acao=reclassificacao_categoria`, `valor_anterior="Pagamento"`,
    `valor_novo="Depósito Marcelo"`, entidade = nº da linha do lançamento.
- Trade-off aceito pelo Marcelo: todo Pix recebido por ele passa a contar como depósito para a casa.

### 2. Saldo cumulativo (`rateio.js` + webhook + dashboard)
- Extrair helper interno `calcularRateio(lancamentosFiltrados, prop, pessoas)` que devolve
  `{totalDespesas, cota, pago, saldo, acerto}` (DRY). `rateioMes` passa a chamá-lo (filtro = mês);
  novo `rateioAcumulado(lancamentos, salarios, mesAte)` chama-o com filtro `mesDe ≤ mesAte`.
- **`proporcoes()` continua LANÇANDO** com salários zerados (rateio.js:48). `calcularRateio` recebe
  `prop` já pronto, então a chamada a `proporcoes()` fica em `rateioMes`/`rateioAcumulado` — **não
  mover para dentro do helper de forma que escape do try/catch do relatório** (relatorio.js:99-108).
  Webhook trata via fallback de salários; relatório via try/catch. (rev #2)
- Comparação de mês via `mesParaNum("MM/YYYY") → YYYYMM` (helper novo, exportado). **Lançamentos com
  `mesDe()===null` (data ilegível) são DESCARTADOS do acumulado** — nunca comparados. (rev #7)
- **Webhook dashboard:** o campo `rateio` passa a ser `rateioAcumulado(..., mesPassado)` (era
  `rateioMes`). Mesma forma de objeto (`saldo.Marcelo/.Harumi`) — sem quebra no front. Acrescenta
  `rateio.acumulado = true`. **Mudar o mês no seletor move o TETO do acumulado** (ponto de corte),
  não uma janela. (rev #6)
- **Relatório mensal:** segue usando `rateioMes` (visão do mês) — fora do escopo mudar.

### 3. Gastos exclusivos (`rateio.js`)
- `categoriaExclusivaDe(categoria, pessoas)` → nome da pessoa se `normalizar(categoria) ===
  "gastos " + normalizar(pessoa)`, senão `null`.
- Em `calcularRateio`: **base dividida** = saídas confirmadas não-transferência **e não-exclusivas**;
  `exclusivo[p]` = Σ saídas confirmadas com categoria `Gastos {p}`; `cota[p] = arred(base×prop[p] +
  exclusivo[p])`. **Invariante de conservação (rev #3):** `Σ cotas = base + Σ exclusivos = Σ saídas
  CONFIRMADAS não-transferência` — linhas `status:"previsto"` (parcelas semeadas) NÃO entram em base
  nem exclusivo e NÃO afetam Σcotas. Teste de conservação inclui uma linha `previsto` que deve ser ignorada.
- `totaisMes`/`gastosPorCategoria` **não mudam**: o gasto exclusivo é despesa real (saiu da conta/
  cartão compartilhado), continua em Saídas e aparece como sua própria categoria. Só a DIVISÃO muda.
- Adicionar `Gastos Marcelo` e `Gastos Harumi` à aba Categorias (tipo=variável, ativo=sim) para
  ficarem disponíveis na categorização (Dicionário/Gemini/manual).

### 4. Buffer — mitigação leve (`fatura-buffer.js`)
- No branch `stub-nl` do `decidirFluxoBuffer` (fatura-buffer.js:64): se o fragmento **parece trecho
  de fatura**, responder uma mensagem orientando — "Parece um trecho de fatura. Se a colagem se
  dividiu em várias mensagens, reenvie tudo de uma vez começando com /faturaaberta." — em vez do
  stub genérico de NL.
- **Limiar anti-falso-positivo (rev #9):** "parece fatura" = **≥2 ocorrências de `R$`** OU **≥3 linhas
  contendo valor monetário**. Texto curto de NL ("gastei R$ 50 com pizza") tem 1 só → segue no stub
  de NL normal. Teste de falso-positivo incluído. Sem mudança de arquitetura (sem tocar no race).

## Não-objetivos
- Não reescrever a arquitetura do buffer (race fica para depois — decisão do Marcelo).
- Não mudar o relatório mensal do Telegram para cumulativo.
- Não migrar Sheets→SQLite.
- **Sem dupla-contagem rateio × Comprometido (rev #4):** as fontes são disjuntas — `rateioAcumulado`
  lê só `Lançamentos`; `comprometidoFuturo` lê só `FaturaAberta`/`Parcelas`. A sobreposição temporária
  na virada de ciclo (fatura fechada e importada como Lançamentos) é problema pré-existente do bloco
  Comprometido e fica fora deste escopo.

## Casos de teste (TDD)
- **parser:** `Depósito Marcelo/Retirada` → entrada vira "Depósito Marcelo"; saída vira "Retirada".
- **totaisMes (rev #1):** com "Depósito Marcelo" reclassificado, `entradas` cresce desse valor.
- **rateioAcumulado:** soma cotas/pagos de vários meses ≤ alvo; ignora meses futuros; saldo negativo
  detecta dívida acumulada; mês anterior a todo histórico → tudo 0 (não quebra).
- **exclusivo:** gasto `Gastos Marcelo` de R$ 500 entra 100% na cota do Marcelo (não ×prop);
  conservação `Σ cotas == Σ saídas CONFIRMADAS não-transferência` com uma linha `previsto` presente
  que NÃO afeta Σcotas (rev #3); gasto exclusivo continua em `gastosPorCategoria` e `totaisMes.saidas`.
- **salários zerados (rev #2):** `rateioAcumulado` lança (proporcoes); webhook usa fallback.
- **mesParaNum (rev #7):** ordena 12/2025 < 01/2026; aceita formatos de `mesDe`; `mesDe===null`
  descartado do acumulado.
- **buffer stub (rev #9):** ≥2 "R$" → orientação; "gastei R$ 50" (1 ocorrência) → stub de NL normal.

## Adendo (2026-06-23) — Movimentação PESSOAL (pass-through pela conta)

Surgiu ao conferir o mês 05: entraram R$ 9.906,65 (EDUARDO CONY) + R$ 9.906,65 (WILSON) que eram
dinheiro **pessoal do Marcelo**, e saiu o "Pix enviado para MARCELO SILVA LEITE" (R$ 19.813,30, a
soma) de volta p/ a conta dele. **Decisão do Marcelo:** *(a)* tudo que entra e sai tem que aparecer
no fluxo de caixa (Entradas/Saídas); *(b)* mas isso NÃO é despesa nem contribuição da casa — é
**neutro ao rateio**. (Substitui a ideia anterior de "Saque que abate a contribuição", que estava
errada: o saque casava com depósitos de terceiros, não com a contribuição do Marcelo à casa.)

- **Duas categorias pessoais:** `Depósito para o/a {pessoa}` (entrada) e `Saída para o/a {pessoa}`
  (saída). O pseudo `Depósito Marcelo/Retirada` no parser resolve **saída → `Saída para o Marcelo`**
  (Pix do Marcelo p/ ele mesmo). `Retirada` segue reservada a PGTO FAT CARTAO C6 / APLICAÇÃO DE CDB.
- **`rateio.js`:** `ehMovimentacaoPessoal` (prefixos `deposito para `/`saida para `). Em
  `calcularRateio`, movimentação pessoal é **ignorada** (não entra em base, cota, exclusivo nem pago).
  `pago[p]` voltou a ser só Σ(`Depósito {p}`). Conservação `Σcotas = totalDespesas` preservada.
- **`dashboard.js`:** `gastosPorCategoria` exclui pessoal (não é gasto da casa); `totaisMes` **inclui**
  (é fluxo de caixa) — só exclui transferência interna. Logo `saidas` pode ser > Σ gastos da casa.
- **Dado:** depósitos Eduardo/Wilson `Outros → Depósito para o Marcelo`; Pix de saída do Marcelo
  `→ Saída para o Marcelo` (com Log). Categorias pessoais criadas (Marcelo+Harumi); órfãs `Saque ...`
  removidas.

## Frontend (rev #6)
- `Dashboard.jsx:172` e `:190` — subtítulo dos dois cards de saldo anexa `(acumulado até {mesPassado})`
  quando `rateio.acumulado` for verdadeiro.

## Arquivos afetados
- `workflows/src/parser-conta.js` (+test) — pseudo `Depósito Marcelo/Retirada`.
- `workflows/src/rateio.js` (+test) — `calcularRateio`, `rateioAcumulado`, `mesParaNum`,
  `categoriaExclusivaDe`; `rateioMes` refatorado.
- `workflows/src/fatura-buffer.js` (+test) — orientação no stub.
- `scripts/gerar-workflow-dashboard.js` — `rateio` ← `rateioAcumulado`.
- `dashboard-web/src/components/Dashboard.jsx` — rótulo "(acumulado até <mês>)".
- `scripts/` — one-off: reclassificar R$ 10.400 + Log; atualizar regra Dicionário; +2 categorias.
- Gerar `workflows/dashboard.json` e reimportar (`& ".\scripts\import-workflows.ps1"`).

## Adendo (2026-06-23) — Debug da conta da casa: Metas fora + mês de início + previsão por vencimento

Debug do "Saldo com a Casa" (não zerava). Decisões do Marcelo e mudanças (commits 5bb390c, 0a8731d):
- **Metas fora do rateio:** `Meta: ...` é poupança rastreada à parte (aba Metas) → predicado `ehMeta`
  exclui de `calcularRateio` E `gastosPorCategoria` (treemap). Continua no fluxo de caixa (`totaisMes`).
- **Mês de início da conta da casa:** `Config.rateio_mes_inicio` (= 01/2026). `rateioAcumulado(…, mesInicio)`
  descarta meses pré-rastreio. Webhook normaliza serial→"MM/YYYY" (Sheets coage data em USER_ENTERED).
- **Coluna Previsão (gastos):** `gastosPorCategoria(…, contasFixas)` → `{categoria, previsto, confirmado}`;
  `previsto` = Conta Fixa ativa; fixa não-paga = `confirmado 0` ("a pagar"). Treemap/relatorio usam `confirmado`.
- **Fatura por vencimento:** `previsaoProximoMes` só soma fatura aberta cujo ciclo (`10/MM`) vence no mês previsto.
- **Personal/Tênis** permanecem compartilhados. **Gastos exclusivos manuais:** LIBERDADE COMERCIO (Harumi) —
  parcelas reclassificadas + regra de Dicionário `LIBERDADE COMERCIO DE → Gastos Harumi`.
