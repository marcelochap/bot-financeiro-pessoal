# Spec — saneamento-dados-e-pagamento-cartao

> Origem: achados do teste manual (bloco 6) em 2026-06-19. O relatório (`/relatorio`)
> não bate com a realidade. Decisão do Marcelo: **corrigir na raiz** (formato nativo +
> regra de pagamento do cartão + dedup) e então **apagar o legado e reimportar** extrato
> e cartão do zero. Despachar `plan-reviewer` antes do build.

## Objetivo
Tornar os números do relatório/dashboard confiáveis e auditáveis, atacando três defeitos
que se somam: (1) valores e datas gravados como **texto** na aba Lançamentos; (2) **dupla
contagem** do gasto do cartão (pagamento da fatura na conta corrente + compras itemizadas
do cartão); (3) **linhas duplicadas** da mesma fatura. Entregar com TDD e uma migração
limpa (wipe + reimport).

## Entradas
- Dados atuais na aba **Lançamentos** (mistos: seed legado em texto + imports n8n).
- Reimportação via os workflows existentes `ingestao-csv-cartao` e `ingestao-csv-conta`
  (já gravam com `cellFormat: USER_ENTERED`), a partir dos CSVs reais em `Dados CSV/`.

## Saídas
- Aba Lançamentos com `valor` **numérico** e `data_competencia`/`data_original` como
  **data real** (somáveis/filtráveis no Sheets).
- Pagamento da fatura do cartão **não** contado como despesa (sem dupla contagem).
- Aba Log registrando a migração (wipe + reimport) e os lançamentos neutralizados.

## Regras de negócio aplicáveis (HANDOFF.md)
- Regime de caixa: cartão reescreve `data_competencia` para o vencimento (dia 10).
- Transferências entre contas próprias NÃO são ignoradas.
- **NOVA regra:** o **pagamento da fatura do C6** lançado na conta corrente é **liquidação
  do cartão**, não despesa (HANDOFF:58 já trata movimentação entre contas próprias como
  transferência; `rateio.js:14-16` cita explicitamente "pagar a fatura do cartão"). As
  despesas reais já entram itemizadas por `ingestao-csv-cartao`. → tratar como
  **transferência** (categoria que `ehTransferencia` já reconhece), preservando o
  lançamento na planilha para conciliação do saldo, mas fora dos totais de saída.

## Causas-raiz confirmadas (investigação + plan-reviewer 2026-06-19)
1. **Texto — há DOIS caminhos distintos, não um:**
   - **Data como texto = seed.** `seed-conta-pessoal.py:6,65,68` grava com
     `valueInputOption="RAW"`, de propósito ("datas como string DD/MM/YYYY"). RAW não
     interpreta locale → a data fica **texto**. (O `valor` do seed é **número**:
     `seed-parser.js:7-11` emite `1011.87` e o Python passa o float via RAW → número.)
   - **Valor como texto = imports n8n (a confirmar).** Appends do n8n usam `USER_ENTERED`
     em locale pt_BR ([gerar-workflow-cartao.js:96], [gerar-workflow-conta.js:111]); o
     número `1011.87` com **ponto** decimal pode ser interpretado como **texto** em pt_BR
     (que espera vírgula). Logo a data n8n fica nativa, mas o valor n8n pode virar texto —
     o inverso do seed. **Verificar empiricamente** (ver gate pré-migração).
   - Defesa-em-profundidade: `relatorio.js`/`dashboard.js` somam com `Number(l.valor)` →
     qualquer texto BR `"1.011,87"` vira `NaN`. Tornar os somatórios robustos a ambos os
     formatos é barato e vale independente da causa.
2. **Dupla contagem:** `parser-conta.js` não distingue o pagamento da fatura; ele vira
   saída `origem=conta`, somando com as compras `origem=cartao`. **O mecanismo de exclusão
   já existe** (`rateio.js:20-23` `CATEGORIAS_TRANSFERENCIA`/`ehTransferencia`; `dashboard.js:11,23`
   já filtram). Reusar — não criar categoria/lógica nova.
3. **Bug independente no relatório (achado do reviewer):** `relatorio.js:49-51`
   (`contasFixasDoMes`) soma a fatura do cartão como `Σ origem=cartao` **sem** filtrar
   `ehTransferencia`, **sem** filtrar `status`, e somando `tipo=entrada` (estornos) com
   sinal **positivo** → infla a fatura. Entra no escopo (é parte do "/relatorio não bate").
4. **Duplicatas (linhas 497/502):** causa NÃO confirmada. Hipóteses do reviewer (ordenar
   por evidência das linhas reais): (a) gate `faturaJaImportada` não conectado no JSON do
   workflow; (b) `data_competencia` divergente entre importações (serial vs DD/MM/YYYY
   escapando o match); (c) duplicata **intra-importação** (mesma fatura, 2 cartões
   1455/2843) — aí `faturaJaImportada` nem se aplica. **Anexar as linhas 497/502 reais
   antes de codar a correção.**

## Decisões travadas (confirmadas na amostra real 2026-06-19)
1. **Identificação do pagamento da fatura — RESOLVIDO.** Na amostra real o pagamento
   aparece como `Título="PGTO FAT CARTAO C6"`, `Descrição="Fatura de cartão"`
   (`01KV8SC8A62M11BJJ3Q1D8NP1A.csv`, 11/06/2026, saída 9363.91). Regra: detectar no
   `parser-conta.js` por `Título` normalizado contendo `PGTO FAT CARTAO` **ou** `Descrição`
   == `Fatura de cartão` (case/acentos-insensível). Descritor específico → risco de
   falso-positivo baixo.
2. **Rótulo do pagamento — DECIDIDO (Marcelo, 2026-06-19): reusar `Pagamento/Retirada`.**
   Marcar na ingestão (auditável), reusando o mecanismo de transferência existente — sem
   categoria/lógica nova. Implementação: regra no **Dicionário** com chave
   `PGTO FAT CARTAO` (origem=conta) → `Pagamento/Retirada`; como é saída, `parser-conta.js:93`
   mapeia `Pagamento/Retirada`→`Retirada`, e `dashboard.js`/`rateio.js` já excluem via
   `ehTransferencia`. E **corrigir o `contasFixasDoMes`** (causa-raiz #3) para também
   respeitar `ehTransferencia`+`status`.

## Gate pré-migração e migração (revisado pelo plan-reviewer)
3. **Gate de locale ANTES do wipe (não depois).** Antes de apagar produção, fazer 1 append
   de teste numa aba scratch (mesmo nó googleSheets, `typeVersion 4.5`, `USER_ENTERED`,
   mesma SA/planilha) com valor e data conhecidos, e ler de volta com `ISNUMBER()`/`ISTEXT()`.
   Se `1011.87` virar texto → corrigir o caminho de escrita (enviar valor como número
   nativo, não string) **antes** de migrar. Senão o reimport repete o problema.
4. **Migração — DECIDIDO (Marcelo, 2026-06-19): DESCARTAR o legado.** Wipe total
   `Lançamentos!A2:J` (precedente: `seed-conta-pessoal.py:64`) e **NÃO re-semear** o razão.
   Daqui pra frente só entram extratos/faturas oficiais do C6 via os workflows n8n (fonte
   saneada). Consequência: o `seed-conta-pessoal.py`/`seed-parser.js` saem do caminho de
   produção (o bug RAW deles vira irrelevante — não rodar de novo). Importar cada CSV
   **exatamente uma vez**, em ordem, conferindo contagem contra o resumo antes de seguir.

## Casos especiais e erros
- Reimport deve ser idempotente: `faturaJaImportada` precisa bloquear corretamente após o
  wipe; investigar por que 497/502 passaram (mesma `data_competencia`?).
- Parser nunca trava: descritor de pagamento não reconhecido → segue como saída + aviso.
- Pagamento da fatura parcial / antecipado → ainda assim neutraliza pelo descritor.

## Critérios de sucesso (verificáveis)
- [ ] `relatorio.js`/`dashboard.js` robustos a `valor` em texto BR (parse `1.011,87` e
      `1011.87`) — teste unitário verde.
- [ ] `relatorio.js:contasFixasDoMes` corrigido: fatura do cartão soma só `tipo=saída`,
      `status=confirmado`, `!ehTransferencia` — teste unitário (estorno não infla).
- [ ] Pagamento da fatura na conta não entra nos totais de saída — teste unitário com
      amostra real (`PGTO FAT CARTAO C6`, compras do cartão + 1 pagamento → soma = só as
      compras), via reuso de `ehTransferencia`.
- [ ] **Gate pré-migração:** append scratch confirma `ISNUMBER(valor)` e data nativa antes
      do wipe.
- [ ] Causa de 497/502 reproduzida com as linhas reais; `faturaJaImportada` bloqueia a 2ª
      importação (regressão).
- [ ] `splitLinha` (parser-conta) tolera linha inteira entre aspas com vírgulas internas
      (amostra real linha 24) — não trava nem desalinha colunas.
- [ ] Após wipe + reimport real: aba Lançamentos com `valor` numérico, `data` como data;
      soma da fatura confere com o `Total dessa fatura`.
- [ ] `/relatorio` bate com a conferência manual na planilha.

## Fora de escopo
- De-para de categorias C6→projeto (já é v2 da fatura-aberta).
- Bloco React "Comprometido futuro" (v2 do dashboard).
- Blocos 3/4/5 do teste manual (confirmação tripla, /categorizar, lembretes) — tratados
  à parte, aguardando logs do n8n.
