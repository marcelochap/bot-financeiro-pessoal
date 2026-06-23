# Migração (idempotente) da spec rateio-cumulativo-e-gastos-exclusivos + adendo de
# movimentação pessoal. Converge a planilha para o ESTADO FINAL — seguro rodar várias vezes.
#   1. Dicionário: MARCELO SILVA LEITE -> "Depósito Marcelo/Retirada" (pseudo).
#   2. Lançamentos (reclassifica + Log de auditoria; toca SÓ a coluna categoria):
#        - entrada do Marcelo "Pagamento"            -> "Depósito Marcelo"   (contribuição p/ casa)
#        - saída  do Marcelo "Retirada"/"Saque Marcelo" -> "Saída para o Marcelo" (pessoal, neutra)
#        - depósitos pessoais (Eduardo/Wilson) "Outros..." -> "Depósito para o Marcelo"
#   3. Categorias: garante Gastos/ Depósito para / Saída para (Marcelo+Harumi);
#        remove órfãs "Saque Marcelo"/"Saque Harumi" (conceito descartado).
#   py scripts/migrar-deposito-marcelo-e-gastos-exclusivos.py
from datetime import datetime, timezone, timedelta
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

RAIZ = Path(__file__).resolve().parent.parent
CHAVE_SA = RAIZ / "credentials" / "bot-financeiro-sa.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
BRT = timezone(timedelta(hours=-3))

# Depósitos pessoais (Pix de terceiros que eram do Marcelo) — correção pontual por título.
PESSOAIS_ENTRADA = ("EDUARDO CONY", "WILSON ANTHONY")


def sid() -> str:
    for ln in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if ln.startswith("GOOGLE_SHEETS_ID="):
            return ln.split("=", 1)[1].strip()
    raise SystemExit("GOOGLE_SHEETS_ID não preenchido no .env")


def main() -> None:
    creds = service_account.Credentials.from_service_account_file(str(CHAVE_SA), scopes=SCOPES)
    sh = build("sheets", "v4", credentials=creds).spreadsheets()
    s = sid()
    agora = datetime.now(BRT).isoformat(timespec="seconds")
    doc = sh.get(spreadsheetId=s).execute()

    # ── 1. Dicionário ────────────────────────────────────────────────────────────
    dic = sh.values().get(spreadsheetId=s, range="Dicionário!A:D").execute().get("values", [])
    alvo_dic = "Depósito Marcelo/Retirada"
    for i, row in enumerate(dic[1:], start=2):
        if (row[0] if row else "").strip().upper() == "MARCELO SILVA LEITE":
            cat = (row[1] if len(row) > 1 else "").strip()
            if cat == alvo_dic:
                print(f"1. Dicionário: regra já é '{alvo_dic}' (linha {i}).")
            else:
                sh.values().update(spreadsheetId=s, range=f"Dicionário!B{i}",
                                   valueInputOption="USER_ENTERED", body={"values": [[alvo_dic]]}).execute()
                print(f"1. Dicionário: linha {i} '{cat}' -> '{alvo_dic}'.")
            break
    else:
        print("1. Dicionário: regra 'MARCELO SILVA LEITE' não encontrada.")

    # ── 2. Lançamentos ───────────────────────────────────────────────────────────
    lan = sh.values().get(spreadsheetId=s, range="Lançamentos!A:J").execute().get("values", [])
    logs, n = [], 0
    for i, row in enumerate(lan[1:], start=2):
        titulo = (row[3] if len(row) > 3 else "")
        valor = (row[4] if len(row) > 4 else "")
        cat = (row[5] if len(row) > 5 else "")
        tipo = (row[6] if len(row) > 6 else "")
        tu = titulo.upper()
        eh_marcelo = "MARCELO SILVA LEITE" in tu
        novo = None
        if eh_marcelo and tipo == "entrada" and cat == "Pagamento":
            novo = "Depósito Marcelo"
        elif eh_marcelo and tipo == "saída" and cat in ("Retirada", "Saque Marcelo"):
            novo = "Saída para o Marcelo"
        elif tipo == "entrada" and any(p in tu for p in PESSOAIS_ENTRADA) and cat.startswith("Outros"):
            novo = "Depósito para o Marcelo"
        if novo and novo != cat:
            sh.values().update(spreadsheetId=s, range=f"Lançamentos!F{i}",
                               valueInputOption="USER_ENTERED", body={"values": [[novo]]}).execute()
            logs.append([agora, "reclassificacao_categoria", f"Lançamentos!linha {i} (R$ {valor})",
                         cat, novo, "migracao"])
            n += 1
            print(f"2. Lançamentos: linha {i} (R$ {valor}) '{cat}' -> '{novo}'.")
    if n == 0:
        print("2. Lançamentos: nada a reclassificar (já no estado final).")
    if logs:
        sh.values().append(spreadsheetId=s, range="Log!A:F", valueInputOption="USER_ENTERED",
                          insertDataOption="INSERT_ROWS", body={"values": logs}).execute()
        print(f"   Log: {len(logs)} linha(s) de auditoria.")

    # ── 3. Categorias: adiciona desejadas, remove órfãs "Saque ..." ───────────────
    cat_vals = sh.values().get(spreadsheetId=s, range="Categorias!A:C").execute().get("values", [])
    existentes = {(r[0] if r else "").strip() for r in cat_vals[1:]}
    desejadas = [
        ("Gastos Marcelo", "variável"), ("Gastos Harumi", "variável"),
        ("Depósito para o Marcelo", "entrada"), ("Depósito para a Harumi", "entrada"),
        ("Saída para o Marcelo", "saída"), ("Saída para a Harumi", "saída"),
    ]
    novas = [(nm, t) for (nm, t) in desejadas if nm not in existentes]
    if novas:
        sh.values().append(spreadsheetId=s, range="Categorias!A:C", valueInputOption="USER_ENTERED",
                          insertDataOption="INSERT_ROWS", body={"values": [[nm, t, "sim"] for (nm, t) in novas]}).execute()
        print(f"3. Categorias: adicionada(s) {', '.join(nm for nm, _ in novas)}.")
    else:
        print("3. Categorias: todas as desejadas já existem.")

    # remove órfãs (conceito "Saque" descartado) — deleta de baixo p/ cima preservando índices
    orfas = {"Saque Marcelo", "Saque Harumi"}
    cat_sheet_id = next(a["properties"]["sheetId"] for a in doc["sheets"] if a["properties"]["title"] == "Categorias")
    apagar = [i for i, r in enumerate(cat_vals) if (r[0] if r else "").strip() in orfas]  # 0-based incl. cabeçalho
    if apagar:
        reqs = [{"deleteDimension": {"range": {"sheetId": cat_sheet_id, "dimension": "ROWS",
                 "startIndex": i, "endIndex": i + 1}}} for i in sorted(apagar, reverse=True)]
        sh.batchUpdate(spreadsheetId=s, body={"requests": reqs}).execute()
        print(f"3b. Categorias: removida(s) {len(apagar)} órfã(s) 'Saque ...'.")
    else:
        print("3b. Categorias: nenhuma órfã 'Saque ...' a remover.")

    print("\nMigração concluída.")


if __name__ == "__main__":
    main()
