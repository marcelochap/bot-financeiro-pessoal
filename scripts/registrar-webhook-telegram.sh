#!/usr/bin/env bash
# Registra o webhook do Telegram apontando para o roteador-central (path
# "telegram-bot") na WEBHOOK_URL do .env. Versão Linux do .ps1, para rodar na VPS.
# Rodar a partir da raiz do repositório:  bash scripts/registrar-webhook-telegram.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Carrega o .env (apenas linhas KEY=VALUE)
set -a
# shellcheck disable=SC1091
source <(grep -E '^[A-Z_][A-Z0-9_]*=' .env)
set +a

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN ausente no .env}"
: "${WEBHOOK_URL:?WEBHOOK_URL ausente no .env}"

webhook_url="${WEBHOOK_URL%/}"
target="${webhook_url}/webhook/telegram-bot"

args=(--data-urlencode "url=${target}" --data-urlencode 'allowed_updates=["message","callback_query"]')
if [[ -n "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
	args+=(--data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}")
fi

echo "Registrando webhook: ${target}"
res=$(curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" "${args[@]}")
echo "$res" | grep -q '"ok":true' || { echo "setWebhook FALHOU: $res" >&2; exit 1; }
echo "OK."

echo "Confirmando no Telegram..."
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo
