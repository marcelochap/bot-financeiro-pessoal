# Spec — ingestao-csv-cartao

Status: aprovado pelo plan-reviewer em 2026-06-10 (após correções 1–4 da revisão)
Data: 2026-06-10

## Objetivo
Sub-workflow n8n que processa o CSV da fatura do cartão C6 (já extraído do ZIP), aplica as
regras de negócio do HANDOFF (regime de caixa, estornos, lançamentos especiais), categoriza
pelo Dicionário e grava na aba Lançamentos **somente após confirmação via Telegram**.

## Entradas
- **Gatilho:** Execute Workflow Trigger, recebendo `{ csv: string, nome_arquivo: string }`.
  Quem chama é o `roteador-central` (item 5); até lá, teste manual com arquivo de `/data/csv`.
- **Formato (HANDOFF):** separador `;`, UTF-8, 9 colunas: Data de Compra, Nome no Cartão,
  Final do Cartão, Categoria, Descrição, Parcela, Valor (em US$), Cotação (em R$), Valor (em R$).
- Dois cartões no mesmo arquivo (finais 1455 e 2843) — ambos processados juntos.
- **Confirmado no arquivo real** (`Fatura_2026-06-10.csv`, 57 linhas): campos de descrição
  têm espaços à direita (`Inclusao de Pagamento     `) — todo matching usa valores com trim.

## Premissas explícitas (validar na revisão)
1. **Vencimento da fatura** vem do nome do arquivo (`Fatura_YYYY-MM-DD.csv`). A data de
   competência de TODOS os lançamentos = essa data (dia 10, conforme regime de caixa).
   Nome fora do padrão → notificar via Telegram e abortar (sem travar).
2. **Estorno sem par idêntico** no arquivo é mantido como lançamento de valor negativo
   (crédito na fatura), categorizado normalmente. Nota: no arquivo real o estorno
   `MERCADOLIVRE*MERCADOL` -251,64 TEM par idêntico (cai na regra de cancelamento 1:1);
   a ramificação "sem par" será testada com fixture sintética no QA.
3. **Parcela** é anotada na descrição: `DESCRICAO (2/3)` quando `Parcela != "Única"`
   (a aba Lançamentos não tem coluna de parcela).
4. **Categoria sem match no Dicionário** fica vazia — o fluxo híbrido completo
   (Gemini + manual) é o item 6; aqui só lookup no Dicionário.

## Transformações (ordem)
1. Parse CSV (`;`, UTF-8) + trim em todos os campos; validar as 9 colunas esperadas
2. Descartar linhas `Inclusao de Pagamento` (após trim)
3. Cancelamento automático de pares (mesmo |valor|, sinais opostos, no mesmo arquivo):
   a. `Anuidade*` + `Estorno Tarifa` → descartar ambos, registrar no Log
   b. Estorno (valor negativo) + lançamento de mesma descrição (trim) e mesmo |valor| →
      **pareamento 1:1**: cada estorno cancela exatamente UM positivo (o mais próximo em
      data de compra); descartar o par, registrar no Log. Positivos idênticos excedentes
      seguem como lançamentos normais (caso real: `MERCADOLIVRE*MERCADOL` tem 2 positivos
      e 1 estorno → 1 par cancelado, 1 compra mantida)
4. `data_competencia` = data do nome do arquivo; `data_original` = Data de Compra
5. Categoria: busca no Dicionário (aba do Sheets, `origem=cartao`) por "descrição contém
   chave" (case-insensitive); sem match → vazia
6. Montar linha: data_competencia, data_original, descricao (+sufixo parcela), titulo="",
   valor, categoria, tipo=saída (entrada se valor negativo mantido), origem=cartao,
   status=confirmado, id_meta. Resolução de meta: categoria `Meta: X` → match EXATO de X
   com `nome` na aba Metas (o Dicionário semeado já usa nomes completos, ex.
   `Meta: Viagem Lua de Mel`); sem match → id_meta vazio + aviso na mensagem de confirmação.
   Nota: lançamentos com categoria vazia ficam `status=confirmado` mesmo assim (a
   confirmação humana ocorreu); o item 6 os localizará pelo campo categoria vazio.

## Confirmação humana (obrigatória — HANDOFF)
Mensagem Telegram com botões inline Confirmar/Cancelar:
> "Encontrei N lançamentos, total R$ X, período DD/MM a DD/MM (vencimento DD/MM).
> M pares cancelados automaticamente. Confirmar?"
- Confirmar → append em Lançamentos + registro da importação no Log
- Cancelar → descartar tudo + registro no Log
- **Nada é gravado na planilha antes do Confirmar.**

## Casos especiais e erros
- Colunas/formato inesperado, valor não numérico, data inválida → notificar Telegram com
  o detalhe e abortar o arquivo; workflow nunca trava (Error Workflow / continueOnFail)
- Planilha indisponível (API fora) → notificar Telegram
- CSV vazio (só header) → notificar "nenhum lançamento encontrado"

## Critérios de sucesso (verificáveis contra Fatura_2026-06-10.csv)
- [ ] `Inclusao de Pagamento` (-8.135,44) não vira lançamento
- [ ] Par `Anuidade Diferenciada` +98,00 / `Estorno Tarifa` -98,00 descartado e registrado no Log
- [ ] Estorno `MERCADOLIVRE*MERCADOL` -251,64 cancela exatamente UM dos 2 positivos idênticos (1:1); o outro segue como Supermercado/Compras normal
- [ ] Ramificação "estorno sem par → crédito mantido" passa com fixture sintética
- [ ] 12 lançamentos parcelados mantidos com sufixo `(n/m)` (13 no arquivo, menos a `Anuidade Diferenciada 6/12` descartada no par do critério 2)
- [ ] 100% dos lançamentos gravados com `data_competencia = 2026-06-10`
- [ ] `GOL LINHAS A*...` → `Meta: Viagem Lua de Mel` com id_meta resolvido; demais via Dicionário
- [ ] Mensagem de confirmação com contagem, total e período corretos
- [ ] Nenhuma escrita na planilha antes do Confirmar; Log registra importação e cancelamentos

## Fora de escopo
- Descompactar ZIP com senha (fica no roteador-central, item 5)
- Gemini Flash e categorização manual via Telegram (item 6)
- CSV de conta corrente (item 4), PDF (roteador/ingestao-pdf)
- Lembretes, relatórios, metas (itens 7+)
