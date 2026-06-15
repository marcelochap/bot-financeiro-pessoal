# Spec — dedup-importacao (emenda aos itens 3 e 4)

> Pedido do Marcelo em 12/06 (após a fatura duplicar com um segundo clique ✅):
> "nas próximas importações fosse verificado a partir de qual ponto começar,
> para não gerar importações duplicadas". Emenda ao comportamento das ingestões
> já entregues — despachar `plan-reviewer` antes do build.

## Objetivo
Impedir que reimportar o mesmo arquivo (ou um extrato com período sobreposto)
duplique lançamentos na planilha. A verificação é DATA-DRIVEN a partir das
linhas já existentes em Lançamentos — sem aba nova e sem depender do Log.

## Entradas
- As mesmas dos workflows `ingestao-csv-cartao` e `ingestao-csv-conta`
  (CSV + nome do arquivo).
- **Uma leitura nova de `Lançamentos`** que ambos os workflows passam a fazer
  antes da confirmação. Mecanismo (ver "Decisões"): um TERCEIRO nó `googleSheets`
  `operation: "read"` ("Ler Lançamentos"), igual aos nós "Ler Dicionário" /
  "Ler Metas" que já existem. NÃO é batchGet — as ingestões nunca usaram
  batchGet (isso é só do cron de lembretes).

## Formato das datas em Lançamentos (premissa que o build DEVE confirmar)
O nó `googleSheets` read devolve cada coluna como veio da planilha. A coluna
`data_competencia` / `data_original` foi gravada via append com strings
`DD/MM/YYYY`, mas o Google Sheets pode tê-las coagido a número serial (dias
desde 1899-12-30) ou ISO ao exibir. Portanto a comparação NÃO pode assumir um
único formato. A lógica pura normaliza qualquer um dos três para a chave
canônica `DD/MM/YYYY`:
- `string "DD/MM/YYYY"` → como está;
- `string "YYYY-MM-DD"` → reordena;
- `number` (serial) ou `string` numérica → converte serial→data;
- qualquer outra coisa → `null` (linha ignorada no cálculo, não trava).

**Tarefa de build (obrigatória antes do E2E):** logar UM read real de
Lançamentos e confirmar em qual dos três formatos `data_competencia` volta;
os testes já cobrem os três, então o código está pronto seja qual for — mas o
log confirma que a normalização está de fato sendo exercitada.

## Regras de negócio
### Cartão (fatura = documento fechado, identificado pelo vencimento)
- Toda linha de cartão gravada tem `data_competencia = vencimento da fatura`
  (invariante do item 3). Logo: se JÁ existe qualquer linha com
  `origem = cartao` e `data_competencia` (normalizada) `= vencimento` do
  arquivo recebido, a fatura já foi importada.
- Comportamento: **bloquear** — mensagem Telegram
  "⚠️ Fatura com vencimento DD/MM/AAAA já importada (N lançamentos na planilha).
  Nada foi gravado. Para reimportar, apague as linhas dessa fatura na planilha."
  + linha de Log `importacao_bloqueada`. SEM pergunta de confirmação (bloquear
  é mais simples e seguro que "confirmar mesmo assim"; reimporte legítimo é
  raro e tem caminho manual documentado na mensagem).

### Conta (extrato = janela contínua; "a partir de qual ponto começar")
Marco d'água: a MAIOR `data_original` (normalizada) entre as linhas existentes
com `origem = conta`. A decisão usa também o PERÍODO do arquivo recebido
(`periodo.inicio`/`periodo.fim` já extraídos pelo parser, parser-conta.js:56-57)
para distinguir extensão legítima de importação retroativa. Situações:

| situação | condição | comportamento |
|---|---|---|
| `vazia` | nenhuma linha conta existente | importa tudo (1ª importação) |
| `tudo_novo` | `periodo.inicio` > marco | importa tudo |
| `extensao` | `periodo.inicio` ≤ marco < `periodo.fim` | importa só `data_original` > marco — **este é o pedido** |
| `ja_importado` | `periodo.fim` = marco (tudo ≤ marco) | bloqueia: "✅ Nenhum lançamento novo (extrato já importado até DD/MM/AAAA)" + Log `importacao_bloqueada` |
| `retroativo` | `periodo.fim` < marco | bloqueia com mensagem HONESTA (ver abaixo) — **NÃO descarta em silêncio** |

- **Caso `retroativo` (correção do bug de perda silenciosa de mês):** se o
  extrato é inteiramente anterior ao último lançamento já importado, NÃO dá
  para saber por marco d'água se aquelas linhas antigas já foram gravadas.
  Em vez de descartar um mês inteiro sem avisar, bloqueia com mensagem:
  "⚠️ Este extrato (DD/MM a DD/MM) é anterior ao último lançamento já importado
  (DD/MM/AAAA). Nada foi gravado — para reconciliar um período antigo, importe
  manualmente." + Log `importacao_bloqueada`.
- Confirmação no caso `extensao`/`tudo_novo`: "N novos lançamentos (M ignorados
  — anteriores ao último lançamento importado, DD/MM/AAAA)".
- **Limitação documentada (aceita)**: lançamentos NOVOS com data EXATAMENTE
  igual ao marco d'água seriam ignorados. Na prática o C6 fecha o extrato por
  dia (períodos consecutivos não repetem o dia de corte); reimportar um extrato
  estendido do mesmo mês só traz os dias posteriores — exatamente o pedido.

## Casos especiais e erros
- Datas em formato inesperado nas linhas existentes → `normalizarData` devolve
  `null` e a linha é ignorada NO CÁLCULO do marco (não trava a importação).
- Falha na leitura de Lançamentos → erro notificado via Telegram (padrão
  "parser nunca trava em silêncio"), sem importar nada.

## Decisões de arquitetura
- **Leitura: 3º nó `sheetsRead` "Ler Lançamentos" (`Lançamentos!A:J`), NÃO
  batchGet.** O plan-reviewer sugeriu converter as leituras em um único
  `values:batchGet` por cota. Decisão deliberada de NÃO fazer isso aqui:
  (1) a ingestão é disparada manualmente ao subir um arquivo — evento raro,
  sem a pressão de cota que justificou o batchGet no cron de lembretes;
  (2) adicionar um nó idêntico aos dois já existentes é cirúrgico e
  consistente com o padrão das ingestões; (3) um refactor para batchGet
  tocaria nós que já passaram QA nos itens 3 e 4. Simplicidade + mudança
  cirúrgica (CLAUDE.md §2/§3) vencem a micro-otimização de cota.
- Lógica pura com TDD:
  - `parser-cartao.js`:
    - `normalizarData(v)` → `"DD/MM/YYYY"` | `null` (serial/ISO/ddmmyyyy).
    - `faturaJaImportada(existentes, vencimentoDDMMYYYY)` →
      `{ bloqueada: boolean, quantidade: number }`. (`vencimentoDoNome` já
      devolve `DD/MM/YYYY`, então a assinatura recebe DD/MM/YYYY, não ISO.)
  - `parser-conta.js`:
    - `filtrarJaImportados(lancamentos, existentes, periodo)` →
      `{ novos, ignorados, marco, situacao }`, onde `situacao` ∈
      {`vazia`,`tudo_novo`,`extensao`,`ja_importado`,`retroativo`} e
      `marco` = `"DD/MM/YYYY"` | `null`. Reusa `normalizarData` (exportada de
      parser-cartao? não — cada arquivo é autocontido para o Code node;
      duplica-se `normalizarData` em parser-conta, como já se faz com
      `splitLinha`).
- Glue dos geradores: cartão decide bloqueio ANTES do sendAndWait; conta
  filtra/decide antes do resumo/confirmação. A mensagem é escolhida por
  `situacao`.
- Nenhuma mudança no roteador, categorização ou lembretes.

## Critérios de sucesso (verificáveis)
- [ ] `normalizarData`: testa serial (ex.: 46183 → "10/06/2026"),
  "2026-06-10" e "10/06/2026" → todos "10/06/2026"; lixo → null.
- [ ] Cartão: fatura repetida → `{bloqueada:true, quantidade:N}`; planilha
  vazia → `bloqueada:false`; vencimento ausente nas existentes → não bloqueia;
  data ilegível em existentes não trava.
- [ ] Conta: `vazia`→tudo; `tudo_novo`→tudo; `extensao`→só os > marco com
  contagem de ignorados; `ja_importado`→0 novos; `retroativo`→0 novos com
  `situacao:"retroativo"` (mensagem honesta, NÃO "já importado"); data ilegível
  em existentes ignorada no marco.
- [ ] E2E harness cartão (`/webhook/teste-cartao`) com a planilha atual
  (fatura 2026-06-10 já importada) → mensagem de bloqueio + EXATAMENTE 1 nova
  linha de Log `importacao_bloqueada`, NENHUMA confirmação pendente,
  Lançamentos com a MESMA contagem de antes.
- [ ] E2E harness conta (`/webhook/teste-conta`) com o extrato real já
  importado → "nenhum lançamento novo", Lançamentos com a MESMA contagem,
  EXATAMENTE 1 nova linha de Log `importacao_bloqueada`.
- [ ] Suítes existentes continuam verdes (parser-cartao 13, parser-conta 15).

## Estado-base para o E2E
A planilha já foi higienizada nesta sessão: **76 lançamentos** (as 52 linhas
duplicadas da fatura 2026-06-10 foram removidas; Dicionário deduplicado; Log
sem mojibake). Logo o E2E de cartão parte de "fatura 2026-06-10 presente, 76
linhas" e deve terminar com **76 linhas** (inalterado) + 1 Log; o de conta
parte do extrato real já importado e deve terminar com a mesma contagem + 1 Log.

## Fora de escopo
- Reimportação forçada via comando/botão ("confirmar mesmo assim").
- Dedup por linha individual dentro do mesmo período (duas compras idênticas
  no mesmo dia são legítimas — HLENTRETENIMENTO 2x é caso real).
- Backfill/realinhamento de importações antigas (o caso `retroativo` apenas
  bloqueia e orienta; não tenta reconciliar).
- Refactor das leituras existentes para batchGet (decisão acima).
