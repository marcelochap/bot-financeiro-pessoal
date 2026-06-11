# Spec — categorizacao-hibrida (+ aplicar-categoria)

Status: aprovado pelo plan-reviewer em 2026-06-10 (após correções 1–8 da revisão)
Data: 2026-06-10

## Objetivo
Completar o fluxo de categorização do HANDOFF para lançamentos gravados sem categoria:
**Dicionário (já feito nos parsers) → Gemini Flash → manual via Telegram**, com toda regra
nova salva automaticamente no Dicionário e tudo registrado no Log.

## Arquitetura (2 sub-workflows novos + extensões pontuais)
1. **`categorizacao-hibrida`** — varre pendências e resolve via Gemini ou pergunta
2. **`aplicar-categoria`** — aplica a escolha manual vinda de um clique (callback_query)
3. **Extensões:** roteador ganha a rota `callback_query` (prefixos `cat|` e `meta|`) e o
   comando `/categorizar`; ingestões chamam `categorizacao-hibrida` (fire-and-forget)
   após gravar lançamentos

## Premissas explícitas (validar na revisão)
1. **Modelo Gemini:** o `gemini-2.0-flash-preview` do HANDOFF NÃO existe na API (validado
   com a chave real — **emenda ao HANDOFF registrada**). Usar `$env.GEMINI_MODEL` =
   `gemini-3.1-flash-lite` (validado: JSON limpo com `responseMimeType: application/json`).
   **Decisão fonte da config:** env (sem leitura extra do Sheets por chamada); a chave
   `gemini_model` da aba Config fica como referência/auditoria, atualizada junto.
   Chamada via HTTP Request com header `x-goog-api-key: $env.GEMINI_API_KEY`
2. **Pendência = lançamento com `categoria` vazia** na aba Lançamentos (convenção já
   aprovada nos planos dos parsers). Leitura com `row_number` para permitir update pontual.
   **Invariante:** Lançamentos é append-only — deleção manual de linhas invalida teclados
   abertos (callback pode apontar para outra linha)
3. **Limiar de confiança fixo 0.8**: resposta do Gemini `{categoria, confianca}`;
   `confianca >= 0.8` E categoria existente na aba Categorias (ativa) → aplica direto;
   senão → pergunta manual. Sem chave nova na Config (simplicidade; ajuste = 1 linha).
   O Gemini só escolhe entre Categorias ativas — `Meta: X` nunca vem do Gemini (só do
   Dicionário ou da resposta manual `meta|`)
4. **Pergunta manual via inline keyboard com `callback_data`** (`cat|<row>|<categoria>`),
   NÃO sendAndWait: callbacks chegam pelo nosso webhook → roteáveis e SIMULÁVEIS
   localmente. Emenda ao plano do roteador: `callback_query` deixa de ser ignorada e é
   roteada quando `data` tem prefixo conhecido (`cat|`, `meta|`); demais continuam
   ignoradas. **Segurança (CSO):** a validação de remetente se estende ao callback —
   `callback_query.from.id != TELEGRAM_CHAT_ID` → ignorar (callback forjado não pode
   escrever na planilha). Limite de 64 bytes do callback_data respeitado (testado).
   **O teclado manual inclui também as metas ativas** (`meta|<row>|<nome>`) — caminho
   para associar viagem/hospedagem a metas, como exige o HANDOFF
5. **Caso especial RESGATE CDB** (HANDOFF: "perguntar qual meta temporária associar"):
   na varredura, título contendo RESGATE+CDB pula o Gemini e pergunta direto a META
   (teclado de metas ativas, `meta|<row>|<nome>`); a resposta grava categoria `Meta: <nome>`
   + `id_meta`. Lançamentos de viagem/hospedagem sem regra caem no fluxo normal
   (Gemini/manual) nesta fase
6. **Regra nova no Dicionário**: chave = `titulo` (origem conta) ou `descricao` sem o
   sufixo de parcela ` (n/m)` (origem cartao); `origem` preservada; `criado_em` = data.
   Salva tanto no caminho Gemini quanto no manual (HANDOFF: "Regra nova sempre salva").
   Perguntas de META não geram regra no Dicionário (meta é pontual, não recorrente)

## Fluxo — categorizacao-hibrida
Gatilho: Execute Workflow Trigger sem inputs (chamado pelas ingestões e por `/categorizar`)
1. Ler Lançamentos (com row_number), Categorias (ativas), Metas (ativas), Dicionário
2. Filtrar pendentes (categoria vazia). Nenhum → fim silencioso
3. Para cada pendente (sequencial):
   a. Linha com pergunta aberta (Log tem `categoria_perguntada` para o row, sem aplicação
      posterior) → pular (não re-perguntar no `/categorizar`)
   b. RESGATE CDB → Telegram com teclado de metas (`meta|row|nome`) + Log → próximo
   c. Re-lookup no Dicionário (pode ter surgido regra nova) → achou → update na linha +
      Log (`categoria_aplicada_dicionario`), **SEM novo append no Dicionário**
   d. Gemini → válida e confiante → update categoria na linha, append regra no Dicionário
      (com Log próprio: entidade=dicionario, acao=`regra_adicionada`),
      Log (`categoria_aplicada_gemini`)
   e. Senão → Telegram com teclado de categorias + metas + Log (`categoria_perguntada`)
4. Resumo final via Telegram apenas se houve ações ("N categorizados, M perguntados")

**Concorrência:** varreduras quase simultâneas (ZIP com 2 CSVs → 2 aprovações) são
possíveis mas raras — usuário único aprova sequencialmente; o guard "já categorizado"
do apply e o skip do passo 3a limitam o dano a, no pior caso, uma chamada Gemini
duplicada. Aceito explicitamente nesta fase.

## Fluxo — aplicar-categoria
Gatilho: Execute Workflow Trigger `{ callback_id, data, chat_id, message_id }` (do roteador)
1. Parse `cat|row|categoria` ou `meta|row|nome` (inválido → answerCallbackQuery "expirado")
2. Validar categoria/meta ainda existe; ler a linha do lançamento
3. Update na linha: categoria (e id_meta no caso `meta|`), append Dicionário (só `cat|`,
   conforme premissa 6, com Log próprio entidade=dicionario), Log (`categoria_aplicada_manual`)
4. `answerCallbackQuery` + `editMessageText` ("✅ DESCRIÇÃO → Categoria") para remover o teclado

## Erros
- Gemini fora/429/resposta não-JSON → tratar como baixa confiança (pergunta manual);
  nunca travar (HANDOFF)
- Callback para linha já categorizada → answerCallbackQuery "já categorizado", sem update

## Critérios de sucesso (verificáveis localmente — seed sintético na planilha)
- [ ] Funções puras com testes Node verdes: montar prompt, parsear resposta do Gemini
      (inclui não-JSON e categoria inválida), chave do Dicionário (strip parcela),
      montar teclado (≤64 bytes por callback_data), parsear callback
- [ ] Seed de 4 lançamentos sem categoria (1 óbvio p/ Gemini, 1 ambíguo, 1 RESGATE CDB,
      1 com regra já no Dicionário) → rodar varredura →
      óbvio: categoria aplicada + regra no Dicionário + Log;
      com regra: aplicado SEM chamar Gemini;
      CDB: pergunta de meta recebida; ambíguo: pergunta de categoria recebida
- [ ] POST simulado de callback_query `cat|...` → linha atualizada, Dicionário + Log,
      mensagem editada; `meta|...` → categoria `Meta: X` + id_meta preenchidos
- [ ] callback_query com data desconhecida → ignorada (rota atual preservada)
- [ ] Limpeza ao final do teste: linhas seed de Lançamentos E regras sintéticas criadas
      no Dicionário removidas (Log de teste permanece — é histórico fiel)

## Fora de escopo
- Interpretação de linguagem natural ("quanto gastei...") — fica com itens 8+ (o HANDOFF
  associa NL a consultas/relatórios)
- Ingestão de PDF via Gemini (sub-workflow `ingestao-pdf`, fase própria)
- DETECÇÃO automática de viagem/hospedagem (sem regra confiável pela chave Título) —
  mas o caminho manual de meta existe: o teclado de pergunta inclui as metas ativas
