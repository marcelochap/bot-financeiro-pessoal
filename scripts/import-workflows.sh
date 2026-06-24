#!/usr/bin/env bash
# Importa os workflows versionados em ./workflows para o n8n e reativa os de
# produção (mesma lógica do import-workflows.ps1, para a VPS Linux).
#
# Pegadinha do n8n 2.x: import:workflow DESATIVA tudo ao importar, mas os
# sub-workflows chamados via Execute Workflow PRECISAM estar ativos. Os harness
# "teste-*" (webhooks sem auth) ficam INATIVOS de propósito.
#
# Requer o container "financeiro-n8n" rodando e python3 (padrão no Ubuntu/Debian).
# Rodar a partir da raiz do repositório:  bash scripts/import-workflows.sh
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Importando workflows de ./workflows ..."
$COMPOSE exec -T n8n n8n import:workflow --separate --input=/workflows

# IDs de produção (exclui teste-*) lidos dos próprios JSONs versionados.
mapfile -t prod < <(
  python3 - <<'PY'
import json, glob, os
for f in glob.glob("workflows/*.json"):
    try:
        wf = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    name = wf.get("name") or ""
    wid = wf.get("id") or ""
    if name and wid and not name.startswith("teste-"):
        print(f"{wid}\t{name}")
PY
)

echo "==> Reativando ${#prod[@]} workflows de produção (teste-* ficam inativos) ..."
falhas=()
for line in "${prod[@]}"; do
  id="${line%%$'\t'*}"; name="${line#*$'\t'}"
  if $COMPOSE exec -T n8n n8n update:workflow --id="$id" --active=true >/dev/null; then
    echo "   ativado: $name"
  else
    falhas+=("$name"); echo "   FALHOU ao ativar: $name ($id)" >&2
  fi
done

echo "==> Reiniciando n8n para aplicar as ativações ..."
$COMPOSE restart n8n

if [[ ${#falhas[@]} -gt 0 ]]; then
  echo "ATENÇÃO: não ativaram: ${falhas[*]}. Verifique no editor do n8n." >&2
else
  echo "OK: import + reativação concluídos (${#prod[@]} ativos; teste-* inativos)."
fi
