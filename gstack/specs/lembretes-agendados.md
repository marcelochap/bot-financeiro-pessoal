# Spec — lembretes-agendados

> Item 7 da ordem de implementação. Revisada pelo plan-reviewer (REVISAR → 6
> correções aplicadas). **Emenda ao HANDOFF registrada:** o HANDOFF (linha 168)
> esboça "cron jobs por conta fixa"; esta spec usa UM cron diário + decisão
> data-driven a partir da aba Contas Fixas — N crons hardcoded duplicariam os
> dados da planilha e dessincronizariam ao editar `dia_vencimento`.

## Objetivo
Lembrar o Marcelo das contas fixas via Telegram antes do vencimento, com botões
"✅ Paguei" / "⏰ Ainda não", repetindo o lembrete no dia do vencimento quando não
houver confirmação. Empregada é semanal (toda sexta). O clique "Paguei" só registra
a confirmação no Log — o lançamento real continua vindo do CSV (reconciliação é
responsabilidade da ingestão + categorização, já prontas).

## Entradas
- **Cron diário** às 09:00 America/Sao_Paulo (um único Schedule Trigger; ver
  emenda acima).
- Aba **Contas Fixas** (`nome, dia_vencimento, valor_esperado, ativo`):
  6 contas mensais (dia 5, 8, 11) + Empregada com `dia_vencimento = "sexta-feira"`.
- Aba **Log** como ESTADO append-only (mesmo padrão de `categoria_perguntada`).
  Formato das linhas de estado deste workflow:
  - `acao`: `lembrete_enviado` | `pagamento_confirmado` | `pagamento_adiado` | `lembrete_erro`
  - `valor_anterior`: `<conta>|<referencia>` (chave de estado)
  - `valor_novo`: para `lembrete_enviado`, `<tipo>|<hoje>` (ex.: `D-1|2024-07-04`) —
    o dia do envio entra AQUI (não no timestamp de escrita) para a deduplicação
    ser pura e funcionar com o `hoje` simulado do harness.
- **Callbacks** do Telegram via roteador-central (novos prefixos `pg|`/`np|`).

## Saídas
- Mensagem Telegram por conta a lembrar — conteúdo mínimo: nome da conta,
  `valor_esperado` formatado (R$), data/tipo do vencimento e, no caso da
  Empregada com sexta anterior pendente, a menção à pendência. Teclado inline
  `pg|<conta>|<referencia>` / `np|<conta>|<referencia>` (≤ 64 bytes, com teste).
- Log: `lembrete_enviado` a cada envio; `pagamento_confirmado`/`pagamento_adiado`
  a cada clique; clique repetido na mesma referência → answerCallbackQuery
  "já registrado", sem regravar (mesmo padrão do aplicar-categoria).
- editMessageText após o clique (remove o teclado e mostra o resultado).

## Regras de negócio aplicáveis (HANDOFF.md, seção "Lembretes via Telegram")
- Contas mensais: lembrete em **D-1** (dia 4 → venc. 5; dia 7 → venc. 8; dia 10 → venc. 11),
  derivado de `dia_vencimento - 1` — sem hardcode por conta.
- Se não houver `pagamento_confirmado` da referência até **D0**, lembra de novo no
  dia do vencimento (cobre tanto "ainda não" quanto ausência de resposta).
- Após D0, não insiste mais no mês (sem spam diário) — o CSV reconcilia depois.
- **Idempotência do cron**: re-execução no mesmo dia (retry/execução manual) NÃO
  reenvia — `decidirLembretes` suprime quando já existe `lembrete_enviado` da
  mesma `<conta>|<referencia>` com o MESMO dia em `valor_novo`. O D0 reenvia a
  mesma referência porque o dia difere do D-1.
- **Empregada**: lembrete **toda sexta** (referência = data da sexta, `YYYY-MM-DD`);
  se a sexta imediatamente anterior ficou sem confirmação, a mensagem da sexta
  atual menciona a pendência (é o "lembra na sexta seguinte"). Com 2+ sextas
  pendentes, menciona só a anterior (simplicidade; atende o HANDOFF).
- Referência das mensais = mês do VENCIMENTO (`YYYY-MM`), não a do dia do envio
  (o D-1 de um vencimento dia 1º cai no mês anterior).
- "Sim, paguei" → `pagamento_confirmado` no Log; reconciliação do valor real fica
  com a ingestão do CSV (fora deste workflow).
- Invariante (espelho do plano da categorização): renomear conta na aba Contas
  Fixas órfã o estado anterior do Log e os teclados abertos — aceito e documentado;
  não construir migração.

## Casos especiais e erros
- `dia_vencimento` maior que o nº de dias do mês → vence no último dia do mês
  (regra genérica; hoje nenhuma conta cai nisso).
- Conta com `ativo != "sim"` → ignorada.
- Conta inválida (`dia_vencimento` não-numérico e ≠ "sexta-feira", OU nome
  contendo `|`, que quebraria o callback_data) → **notifica via Telegram**
  (HANDOFF: nunca falhar em silêncio) + `lembrete_erro` no Log com chave
  `<conta>|invalida`; a própria linha `lembrete_erro` suprime nova notificação
  nos dias seguintes (sem spam diário). Não trava as demais contas.
- Nenhuma conta a lembrar hoje → execução termina sem enviar nada (sem mensagem
  "nada hoje" — silêncio é o comportamento certo de um lembrete).
- Telegram/Sheets fora → `retryOnFail` nos nós de API (padrão do projeto);
  leitura via UM `values:batchGet` (cota baixa do Sheets).
- Callback `pg|`/`np|` forjado (from.id ≠ TELEGRAM_CHAT_ID) → roteador ignora
  (mesma validação dos prefixos `cat|`/`meta|`).
- Duplo clique / clique em lembrete antigo já resolvido → "já registrado", sem
  segunda linha de Log.

## Decisões de arquitetura
- **Lógica pura em `workflows/src/lembretes.js`** (TDD antes do build):
  `decidirLembretes(contas, logs, hojeISO)` → lista de lembretes do dia
  (conta, referência, tipo D-1/D0/semanal, flag pendência anterior) + lista de
  contas inválidas a notificar; `montarMensagemLembrete(...)`,
  `montarTecladoLembrete(...)`, `parsearCallbackLembrete(data)`. A data "hoje"
  entra como PARÂMETRO (timezone America/Sao_Paulo resolvida no glue) —
  testável com datas fixas.
- **Destino do callback decidido na lógica pura**: `classificarUpdate`
  (roteador.js) passa a devolver, na rota `callback`, também o `destino`
  (`aplicar-categoria` para `cat|`/`meta|`; `responder-lembrete` para
  `pg|`/`np|`) — o glue do roteador só despacha, sem Switch por regex.
- **2 workflows novos** gerados por `scripts/gerar-workflow-lembretes.js`:
  `lembretes-agendados` (cron) e `responder-lembrete` (chamado pelo roteador).
- **Harness de teste** `POST /webhook/teste-lembretes` com `{"hoje": "YYYY-MM-DD"}`.
  **Datas de teste SEMPRE no passado distante (2024)** — o Log é estado vivo:
  um `pagamento_confirmado` de teste com referência futura suprimiria o
  lembrete real daquele mês. Referências 2024 nunca colidem com produção.

## Critérios de sucesso (verificáveis)
- [ ] Testes unitários de `lembretes.js` cobrindo: D-1 e D0 das 6 mensais
  (5, 8, 11), sexta da Empregada, pendência da sexta anterior, fevereiro com
  `dia_vencimento` > nº de dias (caso sintético dia 30), conta inativa,
  `dia_vencimento` inválido e nome com `|` (→ notificação + supressão),
  supressão após `pagamento_confirmado`, supressão pós-D0, idempotência
  (mesmo dia não reenvia; D0 no dia seguinte reenvia), referência no mês do
  vencimento quando D-1 cai no mês anterior (venc. dia 1º — caso sintético),
  teclado com callback_data ≤ 64 bytes (asserção explícita, nomes reais).
- [ ] Harness com `hoje=2024-07-04` (quinta) → exatamente 3 lembretes D-1
  (Condomínio, Tênis, Personal) com botões e `lembrete_enviado` no Log.
- [ ] Harness repetido com `hoje=2024-07-04` → 0 reenvios (idempotência).
- [ ] Clique ✅ via POST simulado no roteador sobre o lembrete D-1 de
  **`Condomínio|2024-07`** → `pagamento_confirmado` no Log + editMessageText;
  segundo clique → "já registrado" sem nova linha.
- [ ] Clique ⏰ sobre o lembrete D-1 de **`Tênis|2024-07`** →
  `pagamento_adiado` no Log + editMessageText.
- [ ] Harness com `hoje=2024-07-05` (sexta), UMA execução, com o
  `pagamento_confirmado` de Condomínio já gravado pelo clique acima →
  exatamente 2 lembretes D0 (Tênis, Personal) + lembrete semanal da Empregada
  (referência `2024-07-05`). O cenário "sem confirmação → 3 D0" fica
  exclusivamente nos testes unitários puros (o Log append-only não permite
  isolar os dois cenários no mesmo mês de referência).
- [ ] A Empregada de `2024-07-05` permanece SEM confirmação; harness com
  `hoje=2024-07-12` (sexta seguinte) → mensagem menciona a pendência de
  `2024-07-05`.
- [ ] Suítes existentes continuam verdes (roteador ganha casos novos p/
  `pg|`/`np|` e para o campo `destino`).
- [ ] Linhas de Log geradas pelos testes (referências 2024) documentadas como
  inertes; nenhuma referência ≥ 2026 criada por teste.

## Fora de escopo
- Reconciliação do valor real com o CSV (já coberta por ingestão + categorização).
- Criar lançamento na planilha ao confirmar pagamento (CSV é a fonte da verdade).
- CRUD de contas fixas via Telegram (editar direto na planilha).
- Lembrete de fatura do cartão (não consta no HANDOFF).
- Horário configurável do cron (fixo 09:00; mudar exige regenerar o workflow).
- Migração de estado ao renomear conta (invariante documentado acima).
