# Spec — ingestao-csv-conta

Status: aprovado pelo plan-reviewer em 2026-06-10 (após correções 1–5 da revisão)
Data: 2026-06-10

> **Convenção canônica do projeto (decidida nesta revisão):** `valor` é SEMPRE positivo
> (magnitude); a direção fica em `tipo` (entrada/saída). O plano do cartão foi emendado
> para seguir a mesma regra (estorno sem par → ABS(valor), tipo=entrada).

## Objetivo
Sub-workflow n8n que processa o CSV do extrato de conta corrente C6 (já extraído do ZIP),
classifica entrada/saída, categoriza pelo Dicionário (chave: campo Título) e grava na aba
Lançamentos **somente após confirmação via Telegram**.

## Entradas
- **Gatilho:** Execute Workflow Trigger, recebendo `{ csv: string, nome_arquivo: string }`
  (mesma interface do `ingestao-csv-cartao`; chamador é o `roteador-central`, item 5)
- **Formato (HANDOFF, confirmado no arquivo real `01KTRWXKPTD3BJ86T8YNHJ0XK1.csv`):**
  - UTF-8 **com BOM** (`﻿`) — remover antes do parse
  - **8 linhas de metadata** antes do header (título, agência/conta, gerado em, período…);
    header na linha 9: `Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)`
  - Separador `,`; valores com ponto decimal (`1981.55`)
  - A linha 6 do metadata informa o período: `Extrato de DD/MM/YYYY a DD/MM/YYYY`
- O nome do arquivo é um identificador opaco (ULID) — NÃO contém data; usado só para log

## Premissas explícitas (validar na revisão)
1. **Datas:** regime de caixa da conta = data real → `data_competencia` = `data_original` =
   `Data Lançamento`; `Data Contábil` e `Saldo do Dia(R$)` são ignorados
2. **Direção:** `tipo = entrada` se `Entrada(R$) > 0`, `tipo = saída` se `Saída(R$) > 0`;
   `valor` é sempre o montante POSITIVO da coluna preenchida (convenção canônica do projeto).
   Linha com ambas as colunas zeradas → descartar com aviso na confirmação; ambas
   preenchidas → erro (formato inesperado)
3. **Transferências entre contas próprias** (HANDOFF: NÃO ignorar; registrar como Pagamento
   na entrada ou Retirada na saída): detectadas via Dicionário com a pseudo-categoria
   `Pagamento/Retirada` — o parser SEMPRE resolve pela direção (entrada→`Pagamento`,
   saída→`Retirada`); o literal `Pagamento/Retirada` NUNCA aparece em Lançamentos.
   A regra `MARCELO SILVA LEITE → Pagamento/Retirada` (origem=conta) é semeada no setup
   da planilha (item 2: `gerar-planilha-inicial.py` + planilha viva)
4. **Resgate de CDB** (HANDOFF: perguntar meta via Telegram): a pergunta interativa é o
   fluxo do item 6 — aqui, Título contendo `RESGATE` + `CDB` fica com categoria vazia +
   aviso na confirmação. Limitação conhecida: lançamentos de viagem/hospedagem na conta
   (ex.: descrição "Hospedagem Pipa") não casam pela chave Título e caem como
   sem-categoria genérica (resolvidos no item 6)
5. **Categoria sem match** no Dicionário fica vazia (igual ao cartão; Gemini/manual = item 6)

## Transformações (ordem)
1. Remover BOM; pular as 8 linhas de metadata (validar que a linha 9 é o header esperado);
   extrair o período da linha `Extrato de ... a ...` para o resumo
2. Parse CSV (`,`) **RFC 4180** — campos entre aspas podem conter vírgula (caso real:
   Descrição `"1/2 de 9,906.65"`) — + trim; validar 7 colunas por linha
3. Determinar direção/valor (premissa 2); descartar dupla-zerada com aviso
4. Categoria: busca no Dicionário (`origem=conta`) por "**Título** contém chave"
   (case-insensitive); `Pagamento/Retirada` resolve pela direção (premissa 3)
5. Montar linha: data_competencia, data_original, descricao=`Descrição`, titulo=`Título`,
   valor, categoria, tipo, origem=conta, status=confirmado, id_meta (categoria `Meta: X` →
   match exato com `nome` na aba Metas; sem match → vazio + aviso)

## Confirmação humana (obrigatória — HANDOFF)
Mensagem Telegram com botões ✅/❌ (sendAndWait, igual ao cartão):
> "Extrato de DD/MM a DD/MM: N lançamentos (E entradas R$ X, S saídas R$ Y).
> [avisos] Confirmar?"
- Confirmar → append em Lançamentos + Log | Cancelar → descarta + Log
- Nada é gravado antes do Confirmar

## Casos especiais e erros
- Header da linha 9 diferente do esperado, < 9 linhas, valor não numérico, data inválida →
  notificar Telegram com detalhe e abortar sem travar
- Extrato sem lançamentos (só metadata + header) → notificar "nenhum lançamento"

## Critérios de sucesso (verificáveis contra o extrato real, 24 linhas de dados)
- [ ] BOM removido e 8 linhas de metadata puladas; **24** lançamentos parseados
- [ ] Linha com campo aspeado contendo vírgula (`"1/2 de 9,906.65"`) parseada em 7 colunas
- [ ] `SEFAZ DISTRITO FEDERAL` → categoria `Meta: IPTU`, id_meta `IPTU`, tipo saída, valor 1981.55
- [ ] `Pix enviado para MARCELO SILVA LEITE` → categoria `Retirada` (transferência própria, saída)
- [ ] Pix recebidos sem regra → categoria vazia, tipo entrada, status confirmado
- [ ] `AIBR INSTITUICAO DE PAGAMENTO` → categoria `Compras` (Dicionário)
- [ ] Período do resumo = `11/05/2026 a 10/06/2026` (da linha 6 do metadata)
- [ ] Totais do resumo: 10 entradas = R$ 46.160,10 e 14 saídas = R$ 37.232,80
- [ ] Fixtures sintéticas: linha dupla-zerada descartada com aviso; `RESGATE CDB` com aviso;
      header inesperado → erro
- [ ] Nenhuma escrita na planilha antes do Confirmar; Log registra importação/cancelamento

## Fora de escopo
- Descompactar ZIP com senha (roteador, item 5)
- Pergunta interativa de meta (CDB/viagem) e Gemini/manual (item 6)
- Reconciliação com lembretes de contas fixas (item 7)
