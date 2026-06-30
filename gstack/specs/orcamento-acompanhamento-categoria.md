# Spec — orcamento-acompanhamento-categoria

> Teto de gasto por categoria com barra de progresso no dashboard.
> Despachar `plan-reviewer` sobre esta spec antes do build.

## Objetivo

Dar ao Marcelo um **teto de acompanhamento mensal por categoria** (quanto ele
quer, no máximo, gastar em cada categoria) com **barra de progresso** na tabela
"Gastos por Categoria" do dashboard, que fica **vermelha quando o gasto
confirmado estoura o teto**. É um conceito separado da previsão de gastos: serve
para vigiar gastos variáveis do cartão (Alimentação, Supermercado, Compras,
Streams, Outros, Gastos Harumi...) sem afetar a previsão do próximo mês nem os
lembretes de contas fixas.

## Entradas

- Nova aba **`Orçamentos`** na planilha Google Sheets — colunas:
  | coluna | tipo | descrição |
  |--------|------|-----------|
  | `categoria` | texto | nome **idêntico** ao da categoria nos Lançamentos |
  | `teto_mensal` | número | teto de gasto do mês (ex.: `1500.00`) |
  | `ativo` | `sim`/`não` | só `sim` é considerado |
- O workflow `dashboard` passa a ler o range `Orçamentos!A:C` no batchGet
  existente ([gerar-workflow-dashboard.js:34-35](../../scripts/gerar-workflow-dashboard.js)).
- Função pura `gastosPorCategoria(lancamentos, mes, contasFixas, orcamentos)`
  ganha o 4º parâmetro `orcamentos` (default `[]` — preserva compat das chamadas
  com 1/2/3 args nos testes existentes).
- O range `Orçamentos!A:C` é **anexado ao FINAL** do array de ranges do batchGet
  (índice 7, lido com `paraObjetos(7)`) — nunca inserido no meio, para não
  deslocar os índices 0-6 (faturaAberta/parcelas/config).

## Saídas

- Cada item de `gastos` no payload ganha o campo **`orcamento`** (número): o teto
  resolvido para aquela categoria. `0` quando não há teto definido.
- A função pura devolve só `orcamento` (número). **A lógica de cor mora na UI**
  (`Dashboard.jsx`), espelhando o padrão `naoPaga` já existente. Contrato da UI —
  `pct = confirmado / orcamento`:
  - `pct < 1` → **cor natural** (gradiente roxo→ciano)
  - `pct == 1` (100%, arredondado e sem estourar) → **verde**
  - `pct > 1` → **vermelho** (estouro), barra cheia
- Regras da barra na tabela "Gastos por Categoria":
  - largura = `min(pct, 1) * 100%`
  - categoria **sem teto** (`orcamento === 0`) → sem barra (comportamento atual)
  - rótulo: `confirmado / teto (pct%)`; no estouro, mostrar quanto passou

## Regras de negócio aplicáveis

- **Resolução do teto (decisão do Marcelo — fallback ao Contas Fixas):**
  para cada categoria, `orcamento` =
  1. `teto_mensal` da aba `Orçamentos` se houver linha com `ativo = sim` e
     `categoria` casando; senão
  2. `valor_esperado` da `Contas Fixas` (o `previsto` que já é calculado hoje).
  - **Match de categoria:** o fallback reusa **a mesma chave** que o mapa `prev`
    já indexa hoje (`f.nome` da Contas Fixas) e que `conf` usa (`l.categoria`).
    Nada de normalização nova divergente — senão "Condomínio" (fixa, com acento) e
    "Condominio" (lançamento, sem acento) não se encontrariam. O parse do
    `teto_mensal` usa `valorNum` (de rateio.js) para tolerar formato PT-BR.
  - Lê de `Contas Fixas` mas **nunca escreve** — previsão do próximo mês e
    lembretes ficam 100% intactos. (CLAUDE.md: "Contas Fixas alimenta previsão +
    lembretes" permanece verdadeiro.)
- **Barra em categoria fixa é intencional (não é bug).** Como o fallback dá teto
  a toda conta fixa ativa, elas ganham barra: o `confirmado` reconciliado bater ou
  passar o `valor_esperado` pinta âmbar/vermelho — exatamente o sinal "paguei mais
  que o previsto" que o Marcelo quer ver (ex.: Gás R$90→R$193, Tênis R$750→R$828).
  Decisão confirmada com o usuário: **barra em todas as categorias** (fixas e
  variáveis), não só variáveis.
- O `confirmado` continua sendo a soma das saídas confirmadas do mês da categoria,
  já calculada em `gastosPorCategoria` — reaproveitar, não recalcular.
- Mantém as exclusões atuais: transferência, movimentação pessoal e Metas não
  entram em "Gastos por Categoria".
- A coluna "Previsão" da tabela **não muda** de fonte (continua `previsto` =
  Contas Fixas). A barra é um elemento novo, ortogonal à coluna Previsão.

## Casos especiais e erros

- Aba `Orçamentos` **ausente ou vazia** → `orcamentos = []`; toda categoria cai no
  fallback (Contas Fixas) ou fica sem barra. Dashboard nunca quebra.
- `teto_mensal` inválido/vazio na aba → tratar como sem teto naquela linha (cai no
  fallback). Não derrubar o payload.
- `teto_mensal = 0` explícito → sem barra (evita divisão por zero).
- **Decisão fixada (questão ao plan-reviewer resolvida):** categoria com teto mas
  **sem confirmado e sem previsto** no mês **NÃO** ganha linha nova na tabela. O
  conjunto de categorias continua sendo `conf.keys() ∪ prev.keys()` (dashboard.js:27);
  não se injeta um terceiro Set vindo de `Orçamentos` — evita poluir a tabela com
  categorias que nunca gastam. Teto só vira barra quando a categoria já aparece.
- Categoria que aparece (tem confirmado ou previsto) e tem teto, mas confirmado=0
  → barra em 0% (não é estouro).
- Encoding: nome de aba com acento (`Orçamentos`) precisa de `encodeURIComponent`
  no range — o gerador já faz isso no `.map`.

## Critérios de sucesso (verificáveis)

- [ ] `gastosPorCategoria` com `orcamentos` retorna `orcamento` correto: teto da
      aba quando `ativo=sim`; fallback ao `valor_esperado`; `0` quando nenhum.
- [ ] `ativo=não` na aba `Orçamentos` é ignorado (cai no fallback).
- [ ] Chamada antiga `gastosPorCategoria(l, mes, cf)` (sem 4º arg) não quebra —
      `orcamentos` default `[]`. (Compat com testes existentes.)
- [ ] Teste de estouro: `confirmado > orcamento` → flag/critério que a UI usa p/
      pintar de vermelho é verdadeiro (ex.: `pct >= 1`).
- [ ] `scripts/gerar-workflow-dashboard.js` inclui `Orçamentos!A:C` e passa
      `orcamentos` ao `gastosPorCategoria` no glue; `node gerar-workflow-dashboard.js`
      roda sem erro e `workflows/dashboard.json` contém o novo range.
- [ ] `Dashboard.jsx` pinta a barra de vermelho no estouro e some quando
      `orcamento === 0`. (Validação visual.)
- [ ] `gastosPorCategoria` usa a **mesma chave de categoria** que `prev`/`conf` já
      indexam (sem normalização nova); `teto_mensal` em formato PT-BR é parseado
      via `valorNum`.
- [ ] Categoria com teto mas sem confirmado e sem previsto **não** aparece na tabela.
- [ ] `scripts/gerar-planilha-inicial.py` cria a aba `Orçamentos` com header
      `["categoria", "teto_mensal", "ativo"]` e seed das categorias variáveis do
      HANDOFF (Supermercado, Alimentação, Streams, Compras, Outros). **"Gastos
      Harumi" fica fora do seed** (não está nas Categorias-semente; usuário adiciona
      na planilha viva).

## Fora de escopo

- CRUD da aba `Orçamentos` via Telegram (por ora edita-se direto na planilha;
  comando `/orcamento` fica para uma entrega futura, análoga ao `/novameta`).
- Alerta proativo via Telegram ao estourar o teto (futuro).
- Mudar a coluna "Previsão" ou a previsão do próximo mês.
- Tetos por pessoa ou histórico de orçamento mês a mês.
