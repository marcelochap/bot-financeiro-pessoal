# Monta o Dashboard da reunião familiar (snapshot) no Google Sheets.
# Implementa gstack/specs/dashboard-reuniao-familiar.md.
#
# Garante as abas `Salários` (pessoa|salario — preencher na planilha, não no código)
# e `Dashboard`; lê Lançamentos + Contas Fixas + Salários; chama o emissor JS
# testado (workflows/src/dashboard.js) e escreve os 3 blocos + 1 gráfico.
# Snapshot-on-demand: re-rodar antes da reunião. Argumentos opcionais:
#   montar-dashboard.py [mesPassado MM/YYYY] [mesPrevisao MM/YYYY]
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
EMISSOR = RAIZ / "workflows" / "src" / "dashboard.js"
# Placeholder — renda real NÃO vai no código. Preencher direto na aba Salários
# (este default só é escrito ao CRIAR a aba; se ela já existe, não é tocado).
SALARIOS_DEFAULT = [["Pessoa A", 0], ["Pessoa B", 0]]


def ler_sheets_id() -> str:
    for linha in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if linha.startswith("GOOGLE_SHEETS_ID="):
            v = linha.split("=", 1)[1].strip()
            if v:
                return v
    sys.exit("GOOGLE_SHEETS_ID não preenchido no .env")


def meses_default() -> tuple[str, str]:
    hoje = dt.date.today()
    pas = (hoje.replace(day=1) - dt.timedelta(days=1))          # mês anterior
    prox = (hoje.replace(day=28) + dt.timedelta(days=10)).replace(day=1)  # próximo mês
    return pas.strftime("%m/%Y"), prox.strftime("%m/%Y")


def garantir_abas(sheets, sid: str) -> dict:
    doc = sheets.get(spreadsheetId=sid).execute()
    ids = {s["properties"]["title"]: s["properties"]["sheetId"] for s in doc["sheets"]}
    novas = []
    for nome in ("Salários", "Dashboard"):
        if nome not in ids:
            novas.append({"addSheet": {"properties": {"title": nome,
                          "gridProperties": {"frozenRowCount": 1}}}})
    if novas:
        resp = sheets.batchUpdate(spreadsheetId=sid, body={"requests": novas}).execute()
        for r in resp.get("replies", []):
            p = r.get("addSheet", {}).get("properties")
            if p:
                ids[p["title"]] = p["sheetId"]
        if "Salários" in [n["addSheet"]["properties"]["title"] for n in novas]:
            sheets.values().update(
                spreadsheetId=sid, range="Salários!A1", valueInputOption="RAW",
                body={"values": [["pessoa", "salario"]] + SALARIOS_DEFAULT}).execute()
    return ids


def main() -> None:
    mes_pas, mes_prox = meses_default()
    if len(sys.argv) >= 3:
        mes_pas, mes_prox = sys.argv[1], sys.argv[2]

    sid = ler_sheets_id()
    creds = service_account.Credentials.from_service_account_file(str(CHAVE_SA), scopes=SCOPES)
    api = build("sheets", "v4", credentials=creds).spreadsheets()
    ids = garantir_abas(api, sid)

    got = api.values().batchGet(
        spreadsheetId=sid,
        ranges=["Lançamentos!A:J", "Contas Fixas!A:D", "Salários!A:B"],
        valueRenderOption="UNFORMATTED_VALUE").execute()["valueRanges"]
    lanc_rows = got[0].get("values", [])[1:]
    fix_rows = got[1].get("values", [])[1:]
    sal_rows = got[2].get("values", [])[1:]

    COL = ["data_competencia", "data_original", "descricao", "titulo", "valor",
           "categoria", "tipo", "origem", "status", "id_meta"]
    lancamentos = [dict(zip(COL, r + [""] * (10 - len(r)))) for r in lanc_rows]
    contas_fixas = [{"nome": r[0], "valor_esperado": r[2] if len(r) > 2 else 0,
                     "ativo": r[3] if len(r) > 3 else "sim"} for r in fix_rows if r]
    salarios = [{"pessoa": r[0], "salario": r[1]} for r in sal_rows if len(r) >= 2]

    entrada = json.dumps({"lancamentos": lancamentos, "contasFixas": contas_fixas,
                          "salarios": salarios, "mesPassado": mes_pas, "mesPrevisao": mes_prox})
    proc = subprocess.run(["node", str(EMISSOR)], input=entrada,
                          capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        sys.exit(f"emissor JS falhou:\n{proc.stderr}")
    b = json.loads(proc.stdout)

    # ── monta a matriz do Dashboard ──────────────────────────────────
    pessoas = list(b["rateio"]["cota"].keys())
    prop = b["rateio"]["proporcoes"]
    agora = dt.datetime.now().strftime("%d/%m/%Y %H:%M")
    linhas, gastos_ini = [], None

    def add(*c):
        linhas.append(list(c))

    add(f"DASHBOARD — Reunião familiar", f"atualizado {agora}")
    add("")
    add(f"MÊS PASSADO — {mes_pas}")
    add("Total saídas", b["totais"]["saidas"])
    add("Total entradas", b["totais"]["entradas"])
    add("Saldo", b["totais"]["saldo"])
    add("")
    add("Gastos por categoria", "R$")
    gastos_ini = len(linhas)  # índice 0-based da 1ª linha de dados
    for g in b["gastos"]:
        add(g["categoria"], g["total"])
    gastos_fim = len(linhas)  # exclusivo
    add("")
    add(f"RATEIO — " + " / ".join(f"{p} {round(prop[p]*100,1)}%" for p in pessoas))
    add("Pessoa", "Cota (devia)", "Depositou", "Saldo", "Acerto (deve)")
    for p in pessoas:
        add(p, b["rateio"]["cota"][p], b["rateio"]["pago"][p],
            b["rateio"]["saldo"][p], b["rateio"]["acerto"][p])
    add("")
    add(f"PREVISÃO PRÓXIMO MÊS — {mes_prox}")
    add("Contas fixas projetadas", b["previsao"]["gastos"]["fixas"])
    add("Parcelas / fatura cartão", b["previsao"]["gastos"]["parcelas"])
    add("Total previsto", b["previsao"]["gastos"]["total"])
    for p in pessoas:
        add(f"Depósito previsto {p}", b["previsao"]["depositosPrevistos"][p])

    api.values().clear(spreadsheetId=sid, range="Dashboard!A:Z").execute()
    api.values().update(spreadsheetId=sid, range="Dashboard!A1",
                        valueInputOption="RAW", body={"values": linhas}).execute()

    # ── gráfico de gastos por categoria (best-effort) ────────────────
    grafico_ok = False
    if gastos_fim > gastos_ini:
        dash_id = ids["Dashboard"]

        def _src(col):
            return {"sources": [{"sheetId": dash_id, "startRowIndex": gastos_ini,
                    "endRowIndex": gastos_fim, "startColumnIndex": col, "endColumnIndex": col + 1}]}

        chart = {"addChart": {"chart": {
            "spec": {"title": f"Gastos por categoria — {mes_pas}",
                     "basicChart": {"chartType": "COLUMN", "legendPosition": "NO_LEGEND",
                                    "domains": [{"domain": {"sourceRange": _src(0)}}],
                                    "series": [{"series": {"sourceRange": _src(1)}}]}},
            "position": {"overlayPosition": {"anchorCell": {
                "sheetId": dash_id, "rowIndex": 2, "columnIndex": 6}}}}}}
        # apaga gráficos antigos antes de adicionar (re-run não empilha)
        meta = api.get(spreadsheetId=sid,
                       fields="sheets(properties.sheetId,charts.chartId)").execute()
        reqs = [{"deleteEmbeddedObject": {"objectId": c["chartId"]}}
                for s in meta["sheets"] if s["properties"]["sheetId"] == dash_id
                for c in s.get("charts", [])]
        reqs.append(chart)
        try:
            api.batchUpdate(spreadsheetId=sid, body={"requests": reqs}).execute()
            grafico_ok = True
        except Exception as e:  # gráfico é acessório — não derruba o snapshot
            print(f"aviso: gráfico não criado ({e})")

    r = b["rateio"]
    print(f"OK Dashboard ({mes_pas} passado / {mes_prox} previsão). "
          f"Saídas R$ {b['totais']['saidas']:.2f}; "
          f"acerto " + ", ".join(f"{p} R$ {r['acerto'][p]:.2f}" for p in pessoas) +
          f"; previsto R$ {b['previsao']['gastos']['total']:.2f}. "
          f"Gráfico: {'sim' if grafico_ok else 'não'}.")
    print(f"https://docs.google.com/spreadsheets/d/{sid}/edit")


if __name__ == "__main__":
    main()
