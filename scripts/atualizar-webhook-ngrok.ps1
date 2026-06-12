# Lê a URL pública do túnel ngrok efêmero e grava em WEBHOOK_URL no .env,
# recriando o n8n (restart NÃO recarrega env). Rodar após subir o perfil tunnel:
#   docker compose --profile tunnel up -d
Set-Location (Split-Path $PSScriptRoot -Parent)
$tuneis = (Invoke-RestMethod "http://localhost:4040/api/tunnels" -TimeoutSec 10).tunnels
$url = ($tuneis | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
if (-not $url) { throw "túnel ngrok não encontrado em localhost:4040" }
$env = Get-Content .env -Raw
$env -replace "WEBHOOK_URL=.*", "WEBHOOK_URL=$url/" | Set-Content .env -Encoding utf8 -NoNewline
Write-Host "WEBHOOK_URL=$url/ gravado; recriando n8n..."
docker compose up -d
