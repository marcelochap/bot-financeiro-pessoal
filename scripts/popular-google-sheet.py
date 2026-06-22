# Popula a planilha Google Sheets do bot financeiro (7 abas + dados iniciais
# de gerar-planilha-inicial.py) via Sheets API com a service account.
#
# Pré-requisitos:
#   - credentials/bot-financeiro-sa.json (chave da service account)
#   - GOOGLE_SHEETS_ID preenchido no .env
#   - Planilha compartilhada (Editor) com a service account
import importlib.util
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

RAIZ = Path(__file__).resolve().parent.parent
CHAVE_SA = RAIZ / "credentials" / "bot-financeiro-sa.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

spec = importlib.util.spec_from_file_location(
    "planilha", RAIZ / "scripts" / "gerar-planilha-inicial.py"
)
planilha = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planilha)
ABAS = planilha.ABAS


def ler_sheets_id() -> str:
    for linha in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if linha.startswith("GOOGLE_SHEETS_ID="):
            valor = linha.split("=", 1)[1].strip()
            if valor:
                return valor
    sys.exit("GOOGLE_SHEETS_ID não preenchido no .env")


def main() -> None:
    sid = ler_sheets_id()
    creds = service_account.Credentials.from_service_account_file(str(CHAVE_SA), scopes=SCOPES)
    sheets = build("sheets", "v4", credentials=creds)

    doc = sheets.spreadsheets().get(spreadsheetId=sid).execute()
    existentes = {s["properties"]["title"]: s["properties"]["sheetId"] for s in doc["sheets"]}
    nomes = list(ABAS)

    # Renomeia a primeira aba padrão e cria as demais, todas com cabeçalho congelado
    primeira_id = doc["sheets"][0]["properties"]["sheetId"]
    requests = []
    if nomes[0] not in existentes:
        requests.append({
            "updateSheetProperties": {
                "properties": {"sheetId": primeira_id, "title": nomes[0],
                               "gridProperties": {"frozenRowCount": 1}},
                "fields": "title,gridProperties.frozenRowCount",
            }
        })
        existentes[nomes[0]] = primeira_id
    for nome in nomes[1:]:
        if nome not in existentes:
            requests.append({
                "addSheet": {
                    "properties": {"title": nome, "gridProperties": {"frozenRowCount": 1}}
                }
            })
    if requests:
        resposta = sheets.spreadsheets().batchUpdate(
            spreadsheetId=sid, body={"requests": requests}
        ).execute()
        for reply in resposta.get("replies", []):
            props = reply.get("addSheet", {}).get("properties")
            if props:
                existentes[props["title"]] = props["sheetId"]

    dados = [
        {"range": f"'{nome}'!A1", "values": [header] + linhas}
        for nome, (header, linhas) in ABAS.items()
    ]
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=sid, body={"valueInputOption": "RAW", "data": dados}
    ).execute()

    negrito = [
        {
            "repeatCell": {
                "range": {"sheetId": existentes[nome], "startRowIndex": 0, "endRowIndex": 1},
                "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                "fields": "userEnteredFormat.textFormat.bold",
            }
        }
        for nome in ABAS
    ]
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": negrito}).execute()

    print(f"OK: {len(ABAS)} abas populadas em https://docs.google.com/spreadsheets/d/{sid}/edit")


if __name__ == "__main__":
    main()
