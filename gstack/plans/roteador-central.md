# Spec — roteador-central

Status: aprovado pelo plan-reviewer em 2026-06-10 (após correções 1–5 da revisão)
Data: 2026-06-10

## Objetivo
Workflow n8n de entrada única do bot: recebe updates do Telegram, valida o remetente,
identifica o tipo de conteúdo (arquivo ZIP/CSV/PDF, comando, texto livre) e roteia para
os sub-workflows de ingestão. Único workflow exposto publicamente.

## Entradas
- **Gatilho:** Webhook genérico `POST /webhook/telegram-bot` recebendo o update JSON do
  Telegram. **Decisão:** Webhook em vez de Telegram Trigger porque (a) Telegram Trigger
  chama `setWebhook` na ativação e exige URL pública até em dev; (b) com Webhook genérico,
  o teste local usa POSTs simulando updates reais e produção usa um `setWebhook` manual
  apontando para o domínio público
- Tipos de update tratados: `message.document`, `message.text`

## Segurança (usuário único — pré-requisito do CSO)
1. Updates com `message.chat.id != TELEGRAM_CHAT_ID` → responder HTTP 200 sem ação
   (não vazar existência do bot; não processar)
2. Se `TELEGRAM_WEBHOOK_SECRET` estiver definido no ambiente: validar o header
   `X-Telegram-Bot-Api-Secret-Token` (configurado no `setWebhook` em produção);
   ausente/errado → 200 sem ação. Em dev local o secret fica vazio (check desligado)

## Premissas explícicas (validar na revisão)
1. **ZIP com senha:** o container precisa de `7z` (suporta ZipCrypto e AES) — imagem
   custom `Dockerfile` (`FROM n8nio/n8n` + `apk add p7zip`) e `build:` no compose.
   Senha vem de `C6_ZIP_PASSWORD` (env). Em dev, ZIP de teste com senha placeholder
2. **Detecção de tipo de CSV pelo conteúdo**, não pelo nome — com **strip de BOM
   (`﻿`) antes do match** (o extrato real começa com `EF BB BF`): header começando
   com `Data de Compra;` → cartão; conteúdo iniciando com `EXTRATO DE CONTA CORRENTE` →
   conta. Outro conteúdo → responder "formato não reconhecido". O `csv` é repassado à
   ingestão como string ORIGINAL (a ingestão da conta remove o BOM por conta própria)
3. **nome_arquivo repassado às ingestões** = nome do arquivo INTERNO do ZIP (o C6 nomeia
   `Fatura_YYYY-MM-DD.csv`, de onde o parser do cartão extrai o vencimento); arquivo .csv
   enviado solto usa o nome do documento do Telegram
4. **Escopo desta fase:** PDF → responder "em construção" (ingestao-pdf é fase futura);
   comandos `/relatorio`, `/dashboard`, `/metas` → "em construção" (itens 8–10);
   `/start` → mensagem de boas-vindas com instruções; texto livre → "em construção"
   (interpretação por Gemini é o item 6). Roteador NÃO grava em Sheets (as ingestões logam).
   **`callback_query` e demais tipos de update → rota `ignorar` nesta fase**: as
   confirmações das ingestões usam sendAndWait (webhook de espera do próprio n8n, não
   geram callback_query no webhook do bot); botões inline próprios chegam com os itens 8–10
5. **Arquivos temporários** do unzip em `/tmp/roteador/<executionId>/` com limpeza no fim
   (sucesso ou erro); requer `/tmp/roteador` em `N8N_RESTRICT_FILE_ACCESS_TO` (separador `;`)

## Fluxo
1. Webhook → Code `Classificar Update` (pura, testável): valida chat_id/secret e retorna
   `{ rota: 'documento'|'comando'|'texto'|'ignorar', dados }`
2. Switch por `rota`:
   - **documento:** Telegram getFile (download binário) →
     - `.zip` → gravar com nome FIXO `/tmp/roteador/<exec>/input.zip` (nunca usar o
       file_name vindo do Telegram em comando shell — injeção) →
       `7z x -p"$C6_ZIP_PASSWORD"` (senha entre aspas) → ler todos os `.csv` extraídos
     - `.csv` → usar binário direto
     - `.pdf` → responder "em construção"; outros → "formato não suportado"
   - Para cada CSV: Code `Detectar Tipo` (pura, testável) → Execute Workflow
     `ingestao-csv-cartao` ou `ingestao-csv-conta` com `{ csv, nome_arquivo }`
   - **comando/texto:** Telegram sendMessage com a resposta adequada (premissa 4)
3. Erros (senha errada no 7z, download falhou, zip sem CSV) → Telegram sendMessage com
   detalhe e fim limpo — nunca travar (regra do HANDOFF)

## Critérios de sucesso (verificáveis localmente via POST simulado)
- [ ] Update com chat_id estranho → 200, nenhuma ação, nenhuma resposta no Telegram
- [ ] `/start` → mensagem de boas-vindas; `/relatorio` → "em construção"; texto livre → "em construção"
- [ ] ZIP (senha correta) com os 2 CSVs reais → ambos detectados e roteados: 2 sub-workflows
      disparados, cada um chegando à sua mensagem de Confirmação
- [ ] ZIP com senha errada → mensagem de erro no Telegram, workflow termina sem travar
- [ ] CSV de cartão enviado solto → roteado para `ingestao-csv-cartao` com o nome original
- [ ] PDF → resposta "em construção"
- [ ] Funções `classificarUpdate` e `detectarTipoCsv` com testes unitários (Node) verdes
- [ ] `docker build` OK (Alpine: conferir nome do pacote — `7zip` nas versões recentes,
      `p7zip` nas antigas) e `7z x` extrai ZIP de teste cifrado
- [ ] `/tmp/roteador/<exec>` limpo ao final (inclusive no branch de erro)

## Fora de escopo
- Gemini (texto livre e PDF) — item 6; lembretes/relatórios/dashboard/metas — itens 7–10
- Deploy em produção (clawdinho): `setWebhook` + envs — etapa posterior. **Checklist de
  deploy DEVE exigir `TELEGRAM_WEBHOOK_SECRET` não-vazio antes do `setWebhook`** (sem ele,
  o único workflow público fica protegido apenas pelo chat_id)
