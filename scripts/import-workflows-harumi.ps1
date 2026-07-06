# Importa os workflows do Bot Financeiro da HARUMI (workflows-harumi/*.json) para a
# MESMA instancia n8n do Marcelo (financeiro.minhaautomacao.cloud), via
# docker-compose.vps-shared.yml. Mesma logica de import-workflows.ps1, mas aponta
# para /workflows-harumi (montado a partir de ./workflows-harumi) para nao misturar
# com os workflows de producao do Marcelo em ./workflows.
#
# Pre-requisito manual (uma vez, pela UI do n8n): criar a credencial Telegram
# "Telegram Bot (Harumi)" com o token de @BotFather da Harumi -- credenciais
# nativas do n8n nao sao importaveis so com variavel de ambiente.
#
# Requer o container "financeiro-n8n" rodando (docker compose -f docker-compose.vps-shared.yml up -d).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$compose = @("compose", "-f", "docker-compose.vps-shared.yml")

Write-Host "==> Importando workflows de ./workflows-harumi ..."
docker @compose exec -T n8n n8n import:workflow --separate --input=/workflows-harumi
if ($LASTEXITCODE -ne 0) { throw "import:workflow falhou (exit $LASTEXITCODE); nada foi reativado." }

# IDs de producao (exclui teste-*) lidos dos proprios JSONs versionados.
$prod = Get-ChildItem .\workflows-harumi -Filter *.json | ForEach-Object {
  $wf = Get-Content $_.FullName -Raw | ConvertFrom-Json
  if ($wf.name -and ($wf.name -notlike "teste-*")) {
    [pscustomobject]@{ id = $wf.id; name = $wf.name }
  }
}

Write-Host "==> Reativando $($prod.Count) workflows da Harumi (teste-* ficam inativos) ..."
$falhas = @()
foreach ($wf in $prod) {
  docker @compose exec -T n8n n8n update:workflow --id=$($wf.id) --active=true
  if ($LASTEXITCODE -eq 0) { Write-Host "   ativado: $($wf.name)" }
  else { $falhas += $wf.name; Write-Warning "   FALHOU ao ativar: $($wf.name) ($($wf.id))" }
}

Write-Host "==> Reiniciando n8n para aplicar as ativacoes ..."
docker @compose restart n8n

if ($falhas.Count -gt 0) {
  Write-Warning ("Workflows que NAO ativaram: " + ($falhas -join ', ') + ". Verifique no editor do n8n.")
} else {
  Write-Host ("OK: import + reativacao concluidos (" + $prod.Count + " workflows ativos; teste-* inativos).")
}
