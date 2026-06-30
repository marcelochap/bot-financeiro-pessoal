# Cria a aba "Orçamentos" (teto de acompanhamento por categoria) no Google Sheets,
# via service account. CIRÚRGICO: toca SÓ a aba Orçamentos — nunca as demais.
# Idempotente: se a aba já existe e já tem dados (A2 preenchido), NÃO sobrescreve
# os tetos do usuário; só garante o cabeçalho. Se a aba é nova/vazia, semeia
# placeholders (ajuste os valores na planilha).
#
# Schema alinhado com workflows/src/dashboard.js (gastosPorCategoria, 4º param).
# Pré-requisitos: credentials/bot-financeiro-sa.json + GOOGLE_SHEETS_ID no .env +
# planilha compartilhada (Editor) com a service account.
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

RAIZ = Path(__file__).resolve().parent.parent
CHAVE_SA = RAIZ / "credentials" / "bot-financeiro-sa.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

ABA = "Orçamentos"
CABECALHO = ["categoria", "teto_mensal", "ativo"]
# Placeholders das categorias VARIÁVEIS (as fixas herdam o valor_esperado da
# Contas Fixas via fallback — não precisam entrar aqui). Calibrados ~acima do
# gasto atual para a barra começar informativa, não num mar de vermelho.
SEED = [
    ["Alimentação", 1600, "sim"],
    ["Supermercado", 1300, "sim"],
    ["Compras", 1300, "sim"],
    ["Gastos Harumi", 1100, "sim"],
    ["Streams", 150, "sim"],
    ["Outros", 200, "sim"],
]


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
    metas = {s["properties"]["title"]: s["properties"] for s in doc["sheets"]}

    nova = ABA not in metas
    if nova:
        resp = sheets.spreadsheets().batchUpdate(
            spreadsheetId=sid,
            body={"requests": [{
                "addSheet": {"properties": {"title": ABA, "gridProperties": {"frozenRowCount": 1}}}
            }]},
        ).execute()
        sheet_id = resp["replies"][0]["addSheet"]["properties"]["sheetId"]
        print(f"Aba '{ABA}' criada.")
    else:
        sheet_id = metas[ABA]["sheetId"]
        print(f"Aba '{ABA}' já existe — preservando dados.")

    # Cabeçalho sempre (idempotente, só a linha 1).
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{ABA}'!A1",
        valueInputOption="RAW", body={"values": [CABECALHO]},
    ).execute()

    # Semeia placeholders SÓ se a área de dados estiver vazia (A2 vazio).
    a2 = sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{ABA}'!A2:C2",
    ).execute().get("values", [])
    if not a2:
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range=f"'{ABA}'!A2",
            valueInputOption="RAW", body={"values": SEED},
        ).execute()
        print(f"Semeadas {len(SEED)} categorias variáveis (placeholders — ajuste os tetos).")
    else:
        print("Já havia dados em A2 — tetos do usuário preservados (nada semeado).")

    # Negrito no cabeçalho.
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=sid,
        body={"requests": [{
            "repeatCell": {
                "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                "fields": "userEnteredFormat.textFormat.bold",
            }
        }]},
    ).execute()
    print(f"OK: https://docs.google.com/spreadsheets/d/{sid}/edit")


if __name__ == "__main__":
    main()
