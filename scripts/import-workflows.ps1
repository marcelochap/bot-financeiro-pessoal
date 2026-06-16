# Importa os workflows versionados em ./workflows para o n8n e reativa os de
# producao, contornando a pegadinha do n8n 2.x:
#   - import:workflow DESATIVA todos os workflows ao importar;
#   - os 6 sub-workflows chamados via Execute Workflow tem active:false no JSON,
#     mas PRECISAM estar ativos no n8n ("Workflow is not active and cannot be
#     executed").
# Por isso reativamos todos os workflows MENOS os harness "teste-*" (webhooks sem
# autenticacao -- nao devem ficar ativos; para testar um, ative-o a mao:
#   docker compose exec n8n n8n update:workflow --id=<ID> --active=true ; docker compose restart n8n).
# Ao final reiniciamos o n8n, pois a CLI avisa que ativacoes nao valem com ele rodando.
# Requer o container "financeiro-n8n" rodando (docker compose up -d).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> Importando workflows de ./workflows ..."
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
if ($LASTEXITCODE -ne 0) { throw "import:workflow falhou (exit $LASTEXITCODE); nada foi reativado." }

# IDs de producao (exclui teste-*) lidos dos proprios JSONs versionados.
$prod = Get-ChildItem .\workflows -Filter *.json | ForEach-Object {
  $wf = Get-Content $_.FullName -Raw | ConvertFrom-Json
  if ($wf.name -and ($wf.name -notlike "teste-*")) {
    [pscustomobject]@{ id = $wf.id; name = $wf.name }
  }
}

Write-Host "==> Reativando $($prod.Count) workflows de producao (teste-* ficam inativos) ..."
$falhas = @()
foreach ($wf in $prod) {
  docker compose exec -T n8n n8n update:workflow --id=$($wf.id) --active=true
  if ($LASTEXITCODE -eq 0) { Write-Host "   ativado: $($wf.name)" }
  else { $falhas += $wf.name; Write-Warning "   FALHOU ao ativar: $($wf.name) ($($wf.id))" }
}

Write-Host "==> Reiniciando n8n para aplicar as ativacoes ..."
docker compose restart n8n

if ($falhas.Count -gt 0) {
  Write-Warning ("Workflows que NAO ativaram: " + ($falhas -join ', ') + ". Verifique no editor do n8n.")
} else {
  Write-Host ("OK: import + reativacao concluidos (" + $prod.Count + " workflows ativos; teste-* inativos).")
}
