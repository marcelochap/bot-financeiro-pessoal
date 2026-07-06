#!/usr/bin/env bash
# Registra o webhook do Telegram do bot da HARUMI, apontando para o
# roteador-central (Notion — Harumi) (path "telegram-bot-harumi") na WEBHOOK_URL
# do .env. Versão Harumi de registrar-webhook-telegram.sh — mesma WEBHOOK_URL
# (mesma instância n8n), token e path diferentes.
# Rodar a partir da raiz do repositório:  bash scripts/registrar-webhook-telegram-harumi.sh
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
source <(grep -E '^[A-Z_][A-Z0-9_]*=' .env)
set +a

: "${TELEGRAM_BOT_TOKEN_HARUMI:?TELEGRAM_BOT_TOKEN_HARUMI ausente no .env}"
: "${WEBHOOK_URL:?WEBHOOK_URL ausente no .env}"

webhook_url="${WEBHOOK_URL%/}"
target="${webhook_url}/webhook/telegram-bot-harumi"

args=(--data-urlencode "url=${target}" --data-urlencode 'allowed_updates=["message","callback_query"]')
if [[ -n "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
	args+=(--data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}")
fi

echo "Registrando webhook (Harumi): ${target}"
res=$(curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_HARUMI}/setWebhook" "${args[@]}")
echo "$res" | grep -q '"ok":true' || { echo "setWebhook FALHOU: $res" >&2; exit 1; }
echo "OK."

echo "Confirmando no Telegram..."
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_HARUMI}/getWebhookInfo"
echo
