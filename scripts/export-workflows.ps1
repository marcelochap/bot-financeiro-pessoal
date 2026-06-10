# Exporta todos os workflows do n8n para ./workflows (um JSON por workflow).
# Requer o container "financeiro-n8n" rodando (docker compose up -d).
Set-Location (Split-Path $PSScriptRoot -Parent)
docker compose exec n8n n8n export:workflow --all --separate --output=/workflows
