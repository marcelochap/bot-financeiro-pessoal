# Registra o webhook do Telegram apontando para o roteador-central
# (no Webhook, path "telegram-bot") na URL publica atual (WEBHOOK_URL do .env).
# O roteador usa um no Webhook generico -- o n8n NAO registra no Telegram
# automaticamente (so faria isso com um no Telegram Trigger). Por isso este
# setWebhook e obrigatorio sempre que a WEBHOOK_URL muda.
# Rodar: scripts\registrar-webhook-telegram.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$envLines = Get-Content .env
function Get-EnvVal($k) { ($envLines | Where-Object { $_ -match "^$k=" } | Select-Object -First 1) -replace "^$k=", "" }

$token = Get-EnvVal "TELEGRAM_BOT_TOKEN"
$webhookUrl = (Get-EnvVal "WEBHOOK_URL").TrimEnd("/")
$secret = Get-EnvVal "TELEGRAM_WEBHOOK_SECRET"
if (-not $token) { throw "TELEGRAM_BOT_TOKEN ausente no .env" }
if (-not $webhookUrl) { throw "WEBHOOK_URL ausente no .env (rode atualizar-webhook-ngrok.ps1 antes)" }

$target = "$webhookUrl/webhook/telegram-bot"
$body = @{ url = $target; allowed_updates = '["message","callback_query"]' }
if ($secret) { $body.secret_token = $secret }

$res = Invoke-RestMethod "https://api.telegram.org/bot$token/setWebhook" -Method Post -Body $body -TimeoutSec 10
if (-not $res.ok) { throw "setWebhook falhou: $($res.description)" }
Write-Host "Webhook registrado: $target"

$info = (Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo" -TimeoutSec 10).result
Write-Host "Confirmado no Telegram: $($info.url)"
if ($info.last_error_message) { Write-Host "ATENCAO ultimo erro: $($info.last_error_message)" }
