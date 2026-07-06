#!/usr/bin/env bash
# Importa os workflows do Bot Financeiro da HARUMI (workflows-harumi/*.json) para a
# MESMA instância n8n do Marcelo (financeiro.minhaautomacao.cloud), via
# docker-compose.vps-shared.yml. Mesma lógica de import-workflows.sh, mas aponta
# para /workflows-harumi (montado a partir de ./workflows-harumi) para não misturar
# com os workflows de produção do Marcelo em ./workflows.
#
# Pré-requisito manual (uma vez, pela UI do n8n): criar a credencial Telegram
# "Telegram Bot (Harumi)" com o token de @BotFather da Harumi — credenciais nativas
# do n8n não são importáveis só com variável de ambiente.
#
# Requer o container "financeiro-n8n" rodando e python3.
# Rodar a partir da raiz do repositório:  bash scripts/import-workflows-harumi.sh
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.vps-shared.yml"

echo "==> Importando workflows de ./workflows-harumi ..."
$COMPOSE exec -T n8n n8n import:workflow --separate --input=/workflows-harumi

# IDs de produção (exclui teste-*) lidos dos próprios JSONs versionados.
mapfile -t prod < <(
  python3 - <<'PY'
import json, glob, os
for f in glob.glob("workflows-harumi/*.json"):
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

echo "==> Reativando ${#prod[@]} workflows da Harumi (teste-* ficam inativos) ..."
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
