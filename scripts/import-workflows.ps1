# Importa os workflows versionados em ./workflows para o n8n.
# Requer o container "financeiro-n8n" rodando (docker compose up -d).
Set-Location (Split-Path $PSScriptRoot -Parent)
docker compose exec n8n n8n import:workflow --separate --input=/workflows
