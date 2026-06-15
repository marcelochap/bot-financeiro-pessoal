# Spec — dashboard-reuniao-familiar (Salários + rateio + previsão)

> Pedido do Marcelo em 15/06: dashboard no Google Sheets para a reunião familiar
> — gastos do mês passado, previsão do próximo mês, e rateio das contas
> proporcional ao salário individual. Depende do seed estar feito.
> **Revisada pelo plan-reviewer (15/06) — correções 7-13 aplicadas.** TDD: testes primeiro.

## Objetivo
Dar ao casal uma visão única, atualizável, para a reunião mensal: quanto se
gastou no mês fechado, quanto se prevê gastar/depositar no mês seguinte, e quanto
cada um deve ter pago das contas pela proporção salarial — terminando num
**número de acerto** ("Harumi deve R$ X ao Marcelo" / vice-versa).

## Entradas
- Aba `Lançamentos` populada pelo seed (`A:J`, com `tipo`, `status`, `categoria`).
- Aba **`Contas Fixas`** (já existe — `gerar-planilha-inicial.py:21`):
  `nome | dia_vencimento | valor_esperado | ativo`. **É a fonte canônica do valor
  das contas fixas na projeção** (correção #7): Claro 159, Luz 521, Condomínio
  1253, Empregada **2240 (mensal — já agrega as 4 sextas)**, Gás 90, Tênis 750,
  Personal 640. Usar `valor_esperado` onde `ativo="sim"` — resolve a
  periodicidade da Empregada (#9) e inclui Tênis (#10) sem heurística de "último
  valor".
- Aba **`Salários`** (NOVA — `pessoa | salario`):

  | pessoa | salario |
  |---|---|
  | Marcelo | 20000 |
  | Harumi | 4000 |

  **NÃO reusar a aba `Config` existente** (esquema `chave|valor`, p/ outras
  configs — colisão). Aba dedicada `Salários`, estrutura para **N pessoas**.
  Proporção = `salario / Σ salários` → Marcelo 0,8333 / Harumi 0,1667. Salários
  reais confirmados pelo usuário em 15/06.

## Saídas
Aba **`Dashboard`** (snapshot) com 3 blocos:

### 1. Mês passado — default maio/2026 (mês-calendário fechado relativo a hoje 15/06)
"Mês passado" = maio (leitura literal). Mês é **parâmetro** (default = mês
anterior) para reusar em qualquer reunião; junho fica disponível mas não é o
default. Só `status = confirmado`.
- Total de saídas, total de entradas, saldo do mês.
- Saídas por categoria (tabela ordenada desc) + gráfico. Categorias livres têm
  cauda longa (`calimed?`, `camisinha`...) → gráfico mostra **top-N + "Outros"**.
- "Outras receitas" (entradas `Outros`: tia marcia, sonisia, vendas) listadas à
  parte, informativas — **não** entram no rateio per-capita (ver bloco 3).

### 2. Previsão do próximo mês — julho/2026
`previsao_gastos =` projeção das contas fixas **+** parcelas/fatura já lançadas:
- **Parcelas futuras já lançadas**: Σ saídas com `data_competencia` em jul/2026
  e `status=previsto` (a "fatura do cartão" + parcelas: punta cana, casamento,
  BTS 3/3, prospin, calimed, passagem BH...).
- **Projeção das contas fixas (correção #7):** para cada conta em `Contas Fixas`
  com `ativo="sim"`, se **NÃO** existe linha com aquela categoria no mês-alvo
  (match accent-insensitive — `Contas Fixas` usa acento `Condomínio/Gás/Tênis`,
  o Lançamentos preserva o cru `Condominio/Gas/Tenis`), somar `valor_esperado`.
  Evita dupla contagem e não depende de "último valor" do Lançamentos.
- **Previsão de depósitos** (regra confirmada pelo Marcelo em 15/06):
  `deposito_previsto_pessoa = previsao_gastos × proporção_pessoa`. Ex.: gastos
  previstos R$ 10.000 → Marcelo 8.333,33; Harumi 1.666,67.

### 3. Rateio do mês — número de acerto (escopo: TODAS as despesas)
Decisão explícita do Marcelo: rateia **todas** as saídas do mês, sem separar
pessoal de compartilhado.
- `total_despesas` = Σ saídas confirmadas do mês.
- `cota_pessoa = total_despesas × proporção_pessoa`.
- `pago_pessoa` = Σ entradas do mês cuja `categoria` casa `Deposito {pessoa}`
  **(match accent-insensitive — o CSV traz `Deposito` sem acento; a aba
  Categorias canoniza com acento `Depósito`; casar normalizando acentos para
  funcionar nos dois)** (correção #11).
- `saldo_pessoa = pago_pessoa − cota_pessoa`.
- **Número de acerto**: quem tem saldo negativo deve a quem tem positivo o valor
  que zera os dois (2 pessoas → `|saldo|`). Mensagem: "Em maio/2026, Harumi
  pagou R$ A, devia R$ B → deve R$ (B−A) ao Marcelo."

## Regras de negócio aplicáveis
- Convenção valor-positivo + `tipo`: somas filtram por `tipo`, não por sinal.
- Base do rateio = **despesas brutas** do mês (pedido literal "todas as despesas
  ÷ proporção"); receitas `Outros` não abatem a base nem contam como depósito de
  pessoa.
- "Mês passado" = último mês-calendário fechado relativo a `hoje`; parametrizável.

## Casos especiais e erros
- `Salários` vazia / salário 0 / Σ = 0 → não dividir por zero; aviso "configurar
  salários".
- Mês sem lançamentos → blocos zerados, sem quebrar.
- Pessoa sem nenhum `Deposito {pessoa}` no mês → `pago = 0` (deve a cota inteira).
- Conta fixa em `Contas Fixas` sem categoria correspondente no Lançamentos →
  projetada normalmente pelo `valor_esperado` (é o ponto de a aba existir).

## Decisões de arquitetura
- **Lógica pura em JS com TDD** (exigência do Marcelo):
  - `workflows/src/rateio.js`: `proporcoes(salarios)`, `rateioMes(lancamentos,
    salarios, mes)` → `{ cota, pago, saldo, acerto }`. Match de depósito
    accent-insensitive.
  - `workflows/src/dashboard.js`: `gastosPorCategoria(lancamentos, mes)`,
    `previsaoProximoMes(lancamentos, contasFixas, salarios, mes)` →
    `{ gastos, depositosPrevistos }`. Match de categoria fixa accent-insensitive,
    "já existe no mês" por maior `data_competencia` se necessário.
- **Renderização: snapshot, não fórmula viva.** Motivo (corrigido — não é "TDD"):
  fórmulas Sheets **não reproduzem** o filtro por `status`, a projeção de fixas
  ausentes e a herança/normalização de acento sem virar `ARRAYFORMULA` frágil e
  não-versionável. O runner lê Lançamentos+Contas Fixas+Salários, chama os
  módulos TDD'd e grava valores+gráficos na aba `Dashboard`.
  - **Re-rodar antes da reunião** (snapshot-on-demand). **Cron n8n fica FORA da
    v1** (correção #13 — é trabalho de fase futura; extensão fácil depois, padrão
    idêntico ao `lembretes`).
- Runner: mesmo padrão/linguagem do seed (Python + service-account). Gráficos via
  `addChart` (batchUpdate) — simples (1 barras de gastos por categoria, 1 resumo).
- Abas `Salários` e `Dashboard` criadas pelo runner com header congelado, padrão
  de `popular-google-sheet.py`.

## Critérios de sucesso (verificáveis)
- [ ] `proporcoes({Marcelo:20000, Harumi:4000})` → {Marcelo:0.8333…,
  Harumi:0.1667…}, soma = 1; Σ=0 → erro tratado.
- [ ] `rateioMes`: mês com despesas R$ 12.000, depósitos Marcelo 8.000 / Harumi
  1.000 → cota 10.000 / 2.000; saldo −2.000 / −1.000; acerto coerente.
  **Match `Deposito` sem acento bate** (e `Depósito` com acento também).
- [ ] `gastosPorCategoria`: só `status=confirmado` do mês; ordenado desc; soma
  bate com total de saídas.
- [ ] `previsaoProximoMes`: usa `valor_esperado` das fixas ativas ausentes no mês
  (Empregada 2240, Tênis 750 incluídos) + parcelas `previsto` de jul/2026;
  `depositosPrevistos` = previsão × proporção; match de categoria accent-insensitive.
- [ ] Bordas: Salários vazia, mês vazio, pessoa sem depósito, fixa sem categoria
  no Lançamentos.
- [ ] E2E: rodar runner pós-seed → aba `Dashboard` com os 3 blocos (maio passado,
  jul previsão), número de acerto conferido à mão contra 1 mês; aba `Salários`
  com Marcelo/Harumi.

## Fora de escopo
- Dashboard web / fora do Google Sheets.
- Separar gastos pessoais de compartilhados no rateio (Marcelo escolheu "todas").
- Abater outras receitas (`Outros`) da base do rateio.
- Cron n8n de atualização automática (fase futura — v1 é snapshot-on-demand).
- Relatório no Telegram (item relatorio-mensal, separado).
- Histórico de proporções variando no tempo (salário é config fixa atual).
