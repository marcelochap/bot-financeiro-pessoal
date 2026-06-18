# Cria as abas da feature fatura-aberta-projecao no Google Sheets, via service account.
# Idempotente: pula abas que já existem (mas garante o cabeçalho).
#
# Pré-requisitos (iguais a popular-google-sheet.py):
#   - credentials/bot-financeiro-sa.json
#   - GOOGLE_SHEETS_ID no .env
#   - planilha compartilhada (Editor) com a service account
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

RAIZ = Path(__file__).resolve().parent.parent
CHAVE_SA = RAIZ / "credentials" / "bot-financeiro-sa.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Schemas alinhados com workflows/src/fatura-aberta.js
ABAS = {
    "FaturaAberta": [
        "ciclo", "data_compra", "estabelecimento", "categoria_c6",
        "valor", "parcelas_total", "status",
    ],
    "Parcelas": [
        "estabelecimento", "valor", "M", "N_no_seed", "ciclo_referencia",
    ],
}


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
    existentes = {s["properties"]["title"] for s in doc["sheets"]}

    requests = []
    for nome in ABAS:
        if nome not in existentes:
            requests.append({
                "addSheet": {
                    "properties": {
                        "title": nome,
                        "gridProperties": {"frozenRowCount": 1},
                    }
                }
            })
    if requests:
        sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": requests}).execute()
        print(f"Abas criadas: {[r['addSheet']['properties']['title'] for r in requests]}")
    else:
        print("Nenhuma aba nova (já existiam).")

    # Garante o cabeçalho (idempotente — sobrescreve só a linha 1)
    data = [{"range": f"'{nome}'!A1", "values": [cab]} for nome, cab in ABAS.items()]
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=sid,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()
    print(f"Cabeçalhos gravados: {list(ABAS)}")


if __name__ == "__main__":
    main()
