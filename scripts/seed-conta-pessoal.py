# Seed one-shot do livro-razão real da conta pessoal → aba Lançamentos.
# Implementa gstack/specs/seed-conta-pessoal.md.
#
# Fluxo: chama o parser JS testado (workflows/src/seed-parser.js) para obter as
# linhas A:J em JSON, LIMPA Lançamentos!A2:J (preserva header) e reescreve com
# valueInputOption=RAW (datas como string DD/MM/YYYY, sem coerção a serial).
# Idempotente: rodar 2x dá o mesmo resultado.
#
# Pré-requisitos (iguais a popular-google-sheet.py):
#   - credentials/bot-financeiro-sa.json  - GOOGLE_SHEETS_ID no .env
#   - node no PATH                        - os 2 CSVs em Dados CSV/
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

RAIZ = Path(__file__).resolve().parent.parent
CHAVE_SA = RAIZ / "credentials" / "bot-financeiro-sa.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
COLUNAS = ["data_competencia", "data_original", "descricao", "titulo", "valor",
           "categoria", "tipo", "origem", "status", "id_meta"]
ENTRADA = RAIZ / "Dados CSV" / "lançamentos conta pessoal entrada.CSV"
SAIDA = RAIZ / "Dados CSV" / "lançamentos conta pessoal saida.CSV"
PARSER = RAIZ / "workflows" / "src" / "seed-parser.js"


def ler_sheets_id() -> str:
    for linha in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if linha.startswith("GOOGLE_SHEETS_ID="):
            valor = linha.split("=", 1)[1].strip()
            if valor:
                return valor
    sys.exit("GOOGLE_SHEETS_ID não preenchido no .env")


def parsear_via_node(hoje: str) -> dict:
    saida = subprocess.run(
        ["node", str(PARSER), str(ENTRADA), str(SAIDA), hoje],
        capture_output=True, text=True, encoding="utf-8",
    )
    if saida.returncode != 0:
        sys.exit(f"parser JS falhou:\n{saida.stderr}")
    return json.loads(saida.stdout)


def main() -> None:
    hoje = dt.date.today().strftime("%d/%m/%Y")
    dados = parsear_via_node(hoje)
    linhas, resumo = dados["linhas"], dados["resumo"]
    if dados["avisos"]:
        print("avisos:", *dados["avisos"], sep="\n  ")

    valores = [[l[c] for c in COLUNAS] for l in linhas]

    sid = ler_sheets_id()
    creds = service_account.Credentials.from_service_account_file(str(CHAVE_SA), scopes=SCOPES)
    sheets = build("sheets", "v4", credentials=creds).spreadsheets()

    # 1) limpa as linhas antigas (preserva o header A1)
    sheets.values().clear(spreadsheetId=sid, range="Lançamentos!A2:J").execute()
    # 2) escreve as linhas reais como RAW (datas ficam string, não serial)
    sheets.values().update(
        spreadsheetId=sid, range="Lançamentos!A2",
        valueInputOption="RAW", body={"values": valores},
    ).execute()
    # 3) Log
    log = [dt.datetime.now().isoformat(timespec="seconds"), "seed_baseline", "Lançamentos",
           "", f"{resumo['total']} linhas ({resumo['entradas']['n']} ent + {resumo['saidas']['n']} saí)",
           "seed-conta-pessoal"]
    sheets.values().append(
        spreadsheetId=sid, range="Log!A:F",
        valueInputOption="RAW", insertDataOption="INSERT_ROWS", body={"values": [log]},
    ).execute()

    print(f"OK: {resumo['total']} linhas em Lançamentos "
          f"({resumo['entradas']['n']} entradas R$ {resumo['entradas']['total']:.2f} + "
          f"{resumo['saidas']['n']} saídas R$ {resumo['saidas']['total']:.2f}; "
          f"{resumo['previstos']} previstos). Log +1.")
    print(f"https://docs.google.com/spreadsheets/d/{sid}/edit")


if __name__ == "__main__":
    main()
