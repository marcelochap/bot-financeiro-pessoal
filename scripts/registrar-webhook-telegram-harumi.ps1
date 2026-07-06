# Registra o webhook do Telegram do bot da HARUMI, apontando para o
# roteador-central (Notion -- Harumi) (path "telegram-bot-harumi") na URL publica
# atual (WEBHOOK_URL do .env). Versao Harumi de registrar-webhook-telegram.ps1 --
# mesma WEBHOOK_URL (mesma instancia n8n), token e path diferentes.
# Rodar: scripts\registrar-webhook-telegram-harumi.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$envLines = Get-Content .env
function Get-EnvVal($k) { ($envLines | Where-Object { $_ -match "^$k=" } | Select-Object -First 1) -replace "^$k=", "" }

$token = Get-EnvVal "TELEGRAM_BOT_TOKEN_HARUMI"
$webhookUrl = (Get-EnvVal "WEBHOOK_URL").TrimEnd("/")
$secret = Get-EnvVal "TELEGRAM_WEBHOOK_SECRET"
if (-not $token) { throw "TELEGRAM_BOT_TOKEN_HARUMI ausente no .env" }
if (-not $webhookUrl) { throw "WEBHOOK_URL ausente no .env" }

$target = "$webhookUrl/webhook/telegram-bot-harumi"
$body = @{ url = $target; allowed_updates = '["message","callback_query"]' }
if ($secret) { $body.secret_token = $secret }

$res = Invoke-RestMethod "https://api.telegram.org/bot$token/setWebhook" -Method Post -Body $body -TimeoutSec 10
if (-not $res.ok) { throw "setWebhook falhou: $($res.description)" }
Write-Host "Webhook registrado (Harumi): $target"

$info = (Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo" -TimeoutSec 10).result
Write-Host "Confirmado no Telegram: $($info.url)"
if ($info.last_error_message) { Write-Host "ATENCAO ultimo erro: $($info.last_error_message)" }
