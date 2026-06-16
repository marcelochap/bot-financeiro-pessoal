# Spec — relatorio-mensal

> Item 8 da ordem de implementação. **Grill-me feito** (2026-06-16): relatório
> SIMPLES e COMPACTO. Decisões travadas com o Marcelo abaixo. Reusa a lógica já
> testada de `dashboard.js`/`rateio.js` (DRY) — o trabalho novo é: contas fixas do
> mês vigente com datas, fatura do cartão, formatação Telegram, cron e roteamento.

## Objetivo
Entregar no Telegram um relatório financeiro mensal compacto, acionado por
`/relatorio` (sob demanda) **e** por um cron mensal automático. Conteúdo:
1. **Gastos do mês** (fechamento) + rateio/acerto por pessoa.
2. **Contas fixas do mês vigente** com datas de vencimento, incluindo a **fatura
   do cartão**, agrupando recorrências (Empregada → 1 linha "sextas").
3. **Link do Dashboard** (a planilha já tem o gráfico — não geramos imagem).

O valor novo deste item sobre o Dashboard (aba Sheets) é a **entrega no Telegram**
(sem abrir a planilha) + **agendamento automático**. Não duplica lógica: reusa
`totaisMes`, `gastosPorCategoria`, `previsaoProximoMes` (dashboard.js) e `rateioMes`
(rateio.js).

## Decisões travadas no grill-me (2026-06-16)
| Tema | Decisão |
|---|---|
| Gatilho | `/relatorio` sob demanda **+ cron mensal** (Schedule dia 1, 09:00 BRT) |
| Destinatário | **Só o chat do Marcelo** (`TELEGRAM_CHAT_ID`) na v1. Harumi audita no Sheets; adicionar `chat_id` dela é trivial depois |
| Gráfico/imagem | **Sem imagem.** Manda o **link da planilha** (gráfico já vive na aba Dashboard) |
| Conteúdo | Compacto: gastos do mês + rateio + contas fixas do mês vigente (datas + fatura cartão) |
| Agrupar recorrências | Empregada (semanal) → **1 linha** "sextas, R$ 2.240/mês". Mensais → 1 linha cada |
| Previsão | **Reusa** `previsaoProximoMes` do dashboard.js (fixas da aba Contas Fixas + parcelas futuras) — só se couber compacto; ver "Fora de escopo" |

## Meses de referência (o ponto a validar)
Dois recortes, derivados de `hoje` (timezone America/Sao_Paulo resolvida no glue) e
do **modo do gatilho** — passados explícitos à lógica pura (testável):
- **`mesGastos`** (gastos realizados + rateio): `comando` → **mês vigente** de `hoje`
  (até agora); `cron` → **mês anterior** (fechamento do mês que terminou).
- **`mesFixos`** (contas fixas + fatura + datas): **sempre o mês vigente** de `hoje`
  (o Marcelo pediu "mês vigente" explicitamente).

Coerência: cron roda dia 1 → "mês X fechou: gasto + rateio; mês X+1 começou: o que
vence e quando". On-demand no meio do mês → ambos = mês vigente.

## Entradas
- **Cron mensal**: Schedule Trigger dia 1, 09:00 America/Sao_Paulo (`modo=cron`).
- **`/relatorio`**: roteador-central passa a devolver `rota: "relatorio"` (hoje é
  "em construção", `roteador.js:72`) e despacha o sub-workflow (`modo=comando`).
- **Leitura via UM `values:batchGet`** (cota baixa do Sheets — padrão do projeto),
  ranges: `Lançamentos!A:J`, `Contas Fixas!A:D`, `Salários!A:B`, `Config!A:B`.
  `Config` é nova na leitura — fornece `cartao_vencimento_dia` (= "10").
- **Aba Log** como estado: só para idempotência do cron (`relatorio_enviado`).

## Saídas
- **UMA** mensagem Telegram (`sendMessage`, `parse_mode: HTML`) com, nesta ordem:
  - Cabeçalho: `📊 Relatório — <mesGastos>` (ex.: `maio/2026`).
  - **Gastos do mês**: total saídas, entradas, saldo (de `totaisMes`); top
    categorias compacto (de `gastosPorCategoria`, **top 5** + "outras" agregando o
    resto — compacto).
  - **Rateio** (de `rateioMes`): por pessoa, `acerto` (quem deve quanto). Linha-resumo
    "Harumi deve R$ X · Marcelo deve R$ Y".
  - **Contas fixas — <mesFixos>**: uma linha por conta fixa ativa, ordenada por dia
    de vencimento: `Nome — R$ valor_esperado — vence dia D`. Empregada agrupada em
    1 linha (`Empregada — R$ 2.240 — sextas`). **Fatura do cartão**: `Cartão C6 —
    R$ Z — vence dia 10`. Subtotal das fixas (com cartão).
  - Link: `🔗 Dashboard: <url da planilha>`.
- **Log** (só no `modo=cron`): `relatorio_enviado`, chave `<mesGastos>` em
  `valor_anterior`, para **idempotência** (retry/execução manual no mesmo mês não
  reenvia). `modo=comando` **nunca** grava (é explícito; pode repetir à vontade).
- Erro de Telegram/Sheets → `retryOnFail` nos nós de API (padrão do projeto).

## Regras de negócio
- **Fatura do cartão (mesFixos)** = Σ `valor` dos lançamentos `origem="cartao"` cuja
  `data_competencia` (= **vencimento**, dia 10) cai em `mesFixos` (confirmado +
  previsto). Validado pelo plan-reviewer: `parser-cartao.js:137` grava
  `data_competencia = vencimento` (do nome `Fatura_YYYY-MM-DD.csv`) e `data_original`
  = data da compra — então somar por `mês(data_competencia)` agrupa pela **fatura
  que vence naquele mês**, não pelo consumo. Regime de caixa intencional: a fatura
  que vence no mês vigente é o consumo do ciclo anterior — é exatamente "o que vou
  pagar este mês". Vencimento exibido = `Config.cartao_vencimento_dia` (10).
  Se a soma = 0 → linha "Cartão C6 — fatura ainda não importada / sem lançamentos".
- **Contas fixas**: só `ativo="sim"`. `dia_vencimento` numérico → linha com a data;
  `"sexta-feira"` → linha agrupada "sextas" (não lista cada sexta). Match
  accent-insensitive já está em rateio.js (`normalizar`) — reusar para qualquer
  comparação de nome.
- **Gastos do mês / rateio** usam SÓ `status="confirmado"` (idêntico ao dashboard:
  `totaisMes`/`gastosPorCategoria`/`rateioMes` já filtram). Previstos NÃO entram no
  fechamento (entram só na fatura do cartão e na previsão).
- **mês** de um lançamento = `mês(data_competencia)`, formato `MM/YYYY`
  (`mesDe` de rateio.js).
- **Idempotência do cron**: `deveEnviarCron(logs, mesGastos)` recebe `mesGastos`
  **derivado de `hoje`+`modo` no glue** (nunca lê relógio interno — espelha a lição
  de `lembretes.md`: a referência vai na CHAVE, não no timestamp, p/ a dedup ser
  pura sob `hoje` simulado). Suprime se já existe `relatorio_enviado` com
  `valor_anterior = mesGastos` no Log.

## Casos especiais e erros
- Mês sem lançamentos (gastos = 0) → mensagem ainda é enviada (mostra R$ 0,00 e as
  contas fixas do mês vigente — o relatório do cron pode cair num mês magro).
- **Cron do dia 1 e a fatura do cartão**: a fatura que vence dia 10 do mês vigente
  pode ainda não ter sido importada quando o cron roda no dia 1 → a linha do cartão
  sai como "fatura ainda não importada". **Comportamento aceito e documentado**
  (decisão travada: `mesFixos` é sempre o mês vigente, inclusive p/ o cartão; não
  fazer regime especial por modo). On-demand no meio do mês já mostra a fatura.
- Salários ausentes/zerados na aba `Salários` → `rateioMes` lança se Σ ≤ 0; o glue
  trata e a seção de rateio vira "rateio indisponível (configure a aba Salários)".
  Não derruba o resto do relatório.
- `Config.cartao_vencimento_dia` ausente → default 10 + aviso silencioso (não falha).
- Nome de conta com `|` ou caractere de markup → escapar no HTML (sem teclado aqui,
  então sem limite de 64 bytes; só escapar `<`/`>`/`&`).
- Telegram/Sheets fora → `retryOnFail`.
- Callback: este workflow não tem teclado inline (sem botões) → nada a validar.

## Decisões de arquitetura
- **Lógica pura nova em `workflows/src/relatorio.js`** (TDD antes do build), que
  **requer** `dashboard.js` e `rateio.js`:
  - `contasFixasDoMes(contasFixas, lancamentos, config, mesFixos)` →
    `[{nome, valor, vencimento}]` (mensais ordenadas por dia + Empregada agrupada +
    fatura do cartão), já no formato de exibição.
  - `montarRelatorio({lancamentos, contasFixas, salarios, config}, {mesGastos, mesFixos, urlPlanilha})`
    → `{ texto }` (HTML do Telegram), compondo gastos + rateio + fixas + link.
  - `deveEnviarCron(logs, mesGastos)` → boolean (idempotência pura).
  - Reusa: `totaisMes`, `gastosPorCategoria`, `previsaoProximoMes` (dashboard.js);
    `rateioMes`, `mesDe`, `normalizar`, `arred` (rateio.js).
- **Roteamento**: `classificarUpdate` devolve `rota: "relatorio"` no `/relatorio`
  (espelha `rota: "categorizar"`). O glue do roteador despacha o sub-workflow de
  relatório (mesmo padrão do `/categorizar`). **Também atualizar a string
  `boasVindas` (`roteador.js:8`)**: tirar `/relatorio` da lista "(em construção)"
  ao promovê-lo a rota ativa (senão o teste de boas-vindas do roteador quebra).
- **Mapeamento Salários→objeto**: o glue lê `Salários!A:B` (header `pessoa|salario`)
  e transforma as linhas em `[{pessoa, salario}]` antes de passar a `rateioMes`
  (mesmo padrão do `montar-dashboard.py`). `proporcoes` (rateio.js) aceita esse
  array.
- **Workflows gerados** por `scripts/gerar-workflow-relatorio.js` (NUNCA editar JSON
  à mão): `relatorio-mensal` (Schedule Trigger → lerDados batchGet → Code(relatorio.js)
  → sendMessage → grava Log) e `relatorio-sob-demanda` (Execute Workflow Trigger
  chamado pelo roteador → mesmo Code → sendMessage, sem Log). Ambos do mesmo template;
  diferem só em trigger e no `modo` (que decide `mesGastos` e a gravação no Log).
- **Harness de teste** `POST /webhook/teste-relatorio` com
  `{"hoje":"YYYY-MM-DD"}` — **sempre `modo=comando` (read-only)**. O harness HTTP
  **NÃO expõe `modo=cron`**: um teste ao vivo com `modo=cron` gravaria
  `relatorio_enviado` real e suprimiria o relatório de produção daquele mês. A
  idempotência do cron é exercida SÓ nos **testes unitários puros**
  (`deveEnviarCron`), nunca pela rede.

## Critérios de sucesso (verificáveis)
- [ ] Testes unitários de `relatorio.js` com **dados sintéticos** (padrão de
  `dashboard.test.js`/`rateio.test.js` — não cravar números do seed, que não estão
  versionados):
  - `montarRelatorio` **reusa** `totaisMes`/`gastosPorCategoria`/`rateioMes` — por
    construção os números batem com o dashboard; o teste verifica que a seção de
    gastos/rateio reflete o retorno dessas funções (não recalcula à parte).
  - `contasFixasDoMes` sobre fixtures: mensais com a data certa
    (Condomínio/Tênis/Personal dia 5; Claro/Luz dia 8; Gás dia 11), Empregada em
    **1 linha** "sextas" (não 4–5), fatura do cartão com vencimento dia 10 e soma
    correta dos `origem="cartao"` cuja `data_competencia` cai no mês; soma 0 →
    "fatura ainda não importada".
  - `deveEnviarCron`: 1º envio do mês → true; 2º (com `relatorio_enviado|<mes>` no
    Log) → false; mês diferente → true.
  - Mensagem HTML: sem markup quebrado, escapando `<`/`>`/`&`; compacta (top 5
    categorias + "outras").
  - Salários zerados → seção de rateio degrada para aviso, resto intacto.
- [ ] `roteador.js`: `/relatorio` → `{ rota: "relatorio" }` **e** `boasVindas` não
  lista mais `/relatorio` como "em construção"; suíte do roteador atualizada e
  demais suítes verdes (124 → 124+).
- [ ] Live (recontagem manual): `POST /webhook/teste-relatorio {"hoje":"2026-05-31"}`
  (modo=comando, read-only) → mensagem chega no Telegram; os valores de maio/2026
  conferem com a saída do `montar-dashboard.py` rodado sobre o mesmo seed (R$
  15.981,37 saídas / acerto Marcelo 2.018,81 / Harumi 1.163,56 — **fonte: execução
  ao vivo da Entrega 2**, não asserção de teste unitário); **nada gravado no Log**.
- [ ] `gerar-workflow-relatorio.js` gera os 2 workflows; importados e ativos no n8n
  dev; cron com expressão mensal correta (dia 1, 09:00, America/Sao_Paulo).

## Fora de escopo (v1)
- **Imagem de gráfico** no Telegram (manda link da planilha; decisão do grill-me).
- **Envio à Harumi** (sem `chat_id` dela; adicionar depois é 1 linha de config).
- **Comparativo vs mês anterior** (o Marcelo pediu compacto; pode virar v2).
- **Previsão do próximo mês**: **default = FORA da v1** (manter compacto). Incluir
  exige nova micro-decisão explícita no build (no máximo 2 linhas: total previsto +
  depósitos previstos de `previsaoProximoMes`) — não entra por inércia.
- Horário/dia do cron configurável (fixo; mudar = regenerar o workflow).
- CRUD de contas fixas / metas via Telegram (itens próprios).
