# Spec — <nome-do-sub-workflow>

> Copie este arquivo para `gstack/specs/<nome>.md` antes de construir.
> Despache o subagente `plan-reviewer` sobre a spec antes do build.

## Objetivo
<o que este sub-workflow resolve, em 2-3 frases>

## Entradas
<gatilho: mensagem Telegram, arquivo, cron, chamada de outro workflow — e formato dos dados>

## Saídas
<o que produz: linhas no Sheets, mensagem Telegram, registro no Log>

## Regras de negócio aplicáveis
<copiar/referenciar as regras do HANDOFF.md que este workflow implementa>

## Casos especiais e erros
<estornos, BOM, formato inesperado, falha de API — o que acontece em cada um;
lembre: parser nunca trava, notifica via Telegram e segue>

## Critérios de sucesso (verificáveis)
- [ ] <critério testável 1 — ex.: processa Fatura_2026-06-10.csv sem erro>
- [ ] <critério testável 2>

## Fora de escopo
<o que explicitamente NÃO entra nesta entrega>
