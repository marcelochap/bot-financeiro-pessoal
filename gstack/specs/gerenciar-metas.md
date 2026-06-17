# Spec — gerenciar-metas

> Item 10 da ordem de implementação (o último de feature). Copiada do TEMPLATE.
> **Revisada pelo `plan-reviewer` (APROVAR COM AJUSTES → 6 correções aplicadas).**
>
> **Emenda ao HANDOFF #1 — `valor_acumulado` derivado, coluna C como cache:** o
> HANDOFF lista `valor_acumulado` como coluna da aba Metas, mas a categorização
> (item 6) só escreve `id_meta` nos Lançamentos e **nunca atualiza** essa coluna —
> hoje ela nasce no seed e congela. Manter um contador escrito a cada lançamento
> dessincronizaria do mesmo jeito que o HANDOFF de `lembretes` rejeitou os "N crons
> hardcoded". **Decisão travada:** o progresso é **sempre derivado** dos Lançamentos
> (Σ `|valor|` dos `confirmado` com `id_meta == nome`) e a coluna C **nunca é lida
> como fonte**; mas é **reescrita como cache** (`values:update`) a cada `/metas` e
> `/novameta`, para que o dashboard (item 9, já entregue, que lê `Metas!A:F`) veja um
> valor não-congelado sem precisar ser reescrito. Zero acoplamento com o item 9.
>
> **Emenda ao HANDOFF #2 — criação via comando estruturado, não conversa multi-passo:**
> o HANDOFF (linha 183) diz "Botões inline: Criar/encerrar meta". Esta spec cria via
> comando estruturado `/novameta <nome> | <orçamento> | <prazo>` (stateless), e o botão
> inline "➕ Nova meta" devolve esse template pronto para preencher. Justificativa: uma
> máquina de conversa multi-passo exigiria estado de sessão fora do Log — o n8n é hostil
> a fluxos conversacionais stateful; o comando estruturado é robusto e testável puro.

## Objetivo
Permitir ao Marcelo, via Telegram, **ver o progresso das metas temporárias**, **criar**
uma meta nova e **encerrar** uma meta ativa — sem editar a planilha à mão. O comando
`/metas` lista cada meta ativa com acumulado/orçamento, percentual e prazo; botões inline
criam e encerram metas. Progresso é sempre calculado a partir dos Lançamentos (fonte da
verdade), não de um contador escrito.

## Entradas
- **Comando `/metas`** (Telegram) → lista metas ativas com progresso.
- **Comando `/novameta <nome> | <orçamento> | <prazo>`** (Telegram) → cria meta.
  Botão inline "➕ Nova meta" responde com este template pronto para preencher
  (criação stateless: sem máquina de conversa multi-passo no n8n — ver decisões).
- **Callbacks** do Telegram via roteador-central, **prefixos NOVOS** (o `meta|` já
  existe e é associação de lançamento→meta da categorização — não reusar):
  - `gmenc|<nome>` → pedir confirmação de encerramento.
  - `gmok|<nome>` → confirmar encerramento.
  - `gmnova|` → responder o template de `/novameta`.
- Aba **Metas** (`A:F`: `nome, orcamento_total, valor_acumulado, prazo, status, criado_em`).
- Aba **Lançamentos** (`A:J`) — para derivar o acumulado por `id_meta`.
- Aba **Log** (append-only) — auditoria de criação/encerramento.
- Leitura única via `values:batchGet` (`Metas!A:F` + `Lançamentos!A:J`), padrão do projeto (cota Sheets).

## Saídas
- **`/metas`**: uma mensagem Telegram listando cada meta ativa — `nome`, `R$ acumulado /
  R$ orçamento` formatado, `pct%`, `prazo` — com teclado inline `🏁 Encerrar <nome>`
  (`gmenc|<nome>`) por meta + linha final `➕ Nova meta` (`gmnova|`). Sem metas ativas →
  mensagem amigável + só o botão "Nova meta".
- **`/novameta`**: nova linha na aba **Metas** (`status=ativa`, `valor_acumulado=0` ou
  vazio, `criado_em=hoje`), confirmação Telegram com o resumo da meta criada, e Log
  `meta_criada`.
- **Encerrar**: `gmenc|` → editMessageText pedindo confirmação com teclado
  `✅ Confirmar` (`gmok|<nome>`); `gmok|` → `status=encerrada` na linha da meta +
  editMessageText "Meta encerrada" + Log `meta_encerrada`.
- Toda alteração de dados → linha na aba **Log** (`acao`, `entidade=<nome>`,
  `valor_anterior`, `valor_novo`, `origem=telegram`).

## Regras de negócio aplicáveis (HANDOFF.md — "Metas", "Interface Telegram")
- Metas são **temporárias** com `status` ∈ {`ativa`, `encerrada`}. `/metas` mostra só `ativa`.
- Progresso (`valor_acumulado` derivado) = Σ `|valor|` de Lançamentos com
  `status=confirmado` e `id_meta == nome` (match EXATO do nome, como na ingestão e na
  categorização: categoria `Meta: <nome>` → `id_meta=<nome>`).
- `pct = round(acumulado / orcamento_total * 100)`; `orcamento_total` ausente/0 → exibe
  acumulado sem percentual (não divide por zero).
- **Aprovação/auditoria**: encerrar exige confirmação em 2 toques (botão →
  `✅ Confirmar`); toda criação/encerramento é registrada no Log (HANDOFF: auditoria).
- **Invariante (espelho do plano da categorização):** encerrar uma meta NÃO mexe nos
  Lançamentos já associados a ela (`id_meta` continua); eles só somem do `/metas` porque
  a meta sai de `ativa`. Documentado, sem migração.

## Casos especiais e erros
- `/novameta` mal formado (faltam campos, `orçamento` não numérico, `prazo` inválido,
  ou `nome` contendo `|` que quebraria o callback_data) → **notifica via Telegram** com o
  template correto; nada é gravado (HANDOFF: nunca falhar em silêncio, parser não trava).
- `/novameta` com `nome` que já existe entre metas **ativas** → recusa com aviso
  (evita duas metas homônimas e ambiguidade no `id_meta`). Nome igual a uma meta
  **encerrada** é permitido (reabrir um tema), documentado.
- `gmenc|`/`gmok|` para meta inexistente ou já encerrada (teclado antigo) →
  answerCallbackQuery "Meta não está mais ativa.", sem regravar (padrão aplicar-categoria).
- Duplo clique em `gmok|` da mesma meta → segundo clique vê `status=encerrada` e responde
  "já encerrada", sem segunda linha de Log.
- Callback forjado (`from.id ≠ TELEGRAM_CHAT_ID`) → roteador ignora (mesma validação de
  `cat|`/`meta|`/`pg|`).
- Telegram/Sheets fora → `retryOnFail` nos nós de API (padrão do projeto).
- `callback_data` de todo botão ≤ 64 bytes (asserção explícita nos testes, com nomes reais
  de meta — "Viagem Lua de Mel", "Ar Condicionado Portátil").

## Decisões de arquitetura
- **Lógica pura em `workflows/src/metas.js`** (TDD antes do build):
  - `calcularProgresso(metas, lancamentos)` → para cada meta `ativa`: `{nome, orcamento,
    acumulado, pct|null, prazo}`. Pura, sem I/O.
  - `montarMensagemMetas(progresso)` e `montarTecladoMetas(progresso)` (CRUD —
    distinto do `montarTeclado*` de categorizador.js, que é associação).
  - `parsearNovaMeta(texto)` → `{ok, meta?|erro}`; valida nome/orçamento/prazo.
  - `parsearCallbackMetaGestao(data)` → `gmnova|` | `gmenc|<nome>` | `gmok|<nome>`; inválido → null.
  - `validarNomeMeta(nome)` (sem `|`, não vazio, trim).
- **Roteamento (roteador.js):** `/metas` deixa de responder "em construção" e passa a
  `{rota:"metas"}`; novo `/novameta` → `{rota:"nova-meta", texto}`; em `callback_query`,
  o regex de prefixo ganha `gmnova|gmenc|gmok` com `destino:"gerenciar-metas"`. O
  `RESPOSTAS.boasVindas` perde o "(em construção)" de `/metas`.
- **`valor_acumulado` derivado + coluna C como cache (emenda #1, travada):** a leitura
  do progresso é **sempre** `calcularProgresso(metas, lancamentos)` — a coluna C nunca é
  fonte. Mas o `/metas` e o `/novameta` **reescrevem** a coluna C (`values:update` por
  linha de meta ativa) com o acumulado derivado, para o dashboard (item 9) não ver valor
  congelado. Match exato `id_meta == nome` **após trim** dos dois lados (consistente com o
  que a ingestão/categorização gravou) — sem trim, um nome com espaço de borda somaria 0
  silenciosamente.
- **1 workflow novo** `gerenciar-metas` gerado por `scripts/gerar-workflow-metas.js`
  (mesmo padrão dos demais geradores: `lerDados` via batchGet, Code node com a lógica
  pura embutida, nós Telegram `appendAttribution:false`). Trata `/metas`, `/novameta` e os
  três callbacks (Switch por `fase`/`acao`, como nos outros).
- **Harness de teste** `POST /webhook/teste-metas` com `{ "comando": "...", "callback": "...",
  "metas": [...], "lancamentos": [...] }` para exercitar a lógica com estado simulado.
  Datas de teste no passado (2024), nunca ≥ 2026 (Log e Metas são estado vivo).

## Critérios de sucesso (verificáveis)
- [ ] Testes unitários de `metas.js`: progresso derivado (soma só `confirmado` +
  `id_meta==nome`; ignora pendentes e outras metas); `pct` arredondado; orçamento 0 →
  sem percentual e sem divisão por zero; `parsearNovaMeta` feliz e os 4 erros (campos
  faltando, orçamento não numérico, prazo inválido, nome com `|`); nome duplicado entre
  ativas recusado, homônimo de encerrada permitido; `parsearCallbackMetaGestao` dos 3
  prefixos + lixo→null; `callback_data` ≤ 64 bytes com nomes reais.
- [ ] Harness `/metas` com 3 metas ativas e Lançamentos mistos → mensagem com os 3
  acumulados corretos, percentuais e botões `gmenc|` + `➕ Nova meta`; meta sem
  lançamentos aparece com 0%. Verifica também que a **coluna C (`valor_acumulado`) é
  reescrita** com o acumulado derivado de cada meta ativa (cache p/ o dashboard).
- [ ] **Match exato pós-trim:** lançamento com `id_meta=" Viagem Lua de Mel "` (espaço de
  borda) ou capitalização diferente **não** soma no progresso de `Viagem Lua de Mel`;
  `validarNomeMeta` aplica o mesmo trim que a ingestão/categorização gravou.
- [ ] **Não-regressão do roteador:** após estender o regex de prefixo, `meta|5|Viagem`
  ainda roteia para `aplicar-categoria` (associação, categorizador) e
  `gmnova|`/`gmenc|Viagem`/`gmok|Viagem` roteiam para `gerenciar-metas`; `gmnova|` com
  payload vazio é aceito. Prova que o prefixo `meta|` não foi canibalizado.
- [ ] Harness `/novameta Cama Nova | 1800 | 2026-12` → nova linha em Metas
  (`status=ativa`, `criado_em` hoje) + Log `meta_criada` + confirmação; repetir com o
  mesmo nome → recusa, sem 2ª linha.
- [ ] Harness `/novameta` mal formado (cada um dos 4 erros) → notificação com template,
  Metas inalterada.
- [ ] Encerrar: `gmenc|Cama Nova` → pede confirmação (editMessageText + `✅ Confirmar`);
  `gmok|Cama Nova` → `status=encerrada` + Log `meta_encerrada` + editMessageText; 2º
  `gmok|` → "já encerrada" sem nova linha. Após encerrar, `/metas` não lista mais.
- [ ] **Invariante de encerramento:** encerrar uma meta com N lançamentos associados →
  `/metas` para de listá-la, mas os N lançamentos mantêm `id_meta` intacto no estado
  simulado do harness (verifica que encerrar não mexe em Lançamentos).
- [ ] Suítes existentes continuam verdes (roteador ganha casos `/metas`, `/novameta` e os
  prefixos `gm*` + campo `destino`; o teste do `/metas` "em construção" é atualizado).
- [ ] `scripts/gerar-workflow-metas.js` gera `workflows/gerenciar-metas.json` válido e o
  `export-workflows.ps1`/`import-workflows.ps1` rodam sem erro.

## Fora de escopo
- **Editar** meta existente (orçamento/prazo/nome) via Telegram — só criar e encerrar
  (HANDOFF: "Criar, atualizar progresso, encerrar"; "atualizar progresso" é automático e
  derivado, não comando). Edição de atributos = direto na planilha.
- Recriar/migrar a coluna `valor_acumulado` histórica e reconciliar lançamentos antigos.
- Máquina de conversa multi-passo para criação (decidido: comando estruturado stateless).
- Lançamento manual via Telegram (item separado do HANDOFF, não é meta).
- Alterar a associação lançamento→meta (isso é da categorização, item 6).
- Capturar `valor_mensal` da meta na criação (HANDOFF linha 191, usado pela previsão do
  item 8 já entregue): `/novameta` só captura `nome | orçamento | prazo`. O item 8 deriva
  o valor mensal de `orçamento / meses até o prazo` — não é um 4º campo deste comando.
- Linguagem natural ("quanto falta pra viagem?") — fora do item 10.
