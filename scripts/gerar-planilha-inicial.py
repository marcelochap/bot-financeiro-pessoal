# Gera a planilha inicial do bot financeiro (sheets/bot-financeiro.xlsx)
# com as 8 abas e dados iniciais definidos no HANDOFF.md.
# Depois: fazer upload no Google Drive e abrir como Google Sheets.
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

CRIADO_EM = "2026-06-10"
HEADER_FONT = Font(name="Arial", bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", start_color="2E5E37")
BODY_FONT = Font(name="Arial")

ABAS: dict[str, tuple[list[str], list[list]]] = {
    "Lançamentos": (
        ["data_competencia", "data_original", "descricao", "titulo", "valor",
         "categoria", "tipo", "origem", "status", "id_meta"],
        [],
    ),
    "Contas Fixas": (
        ["nome", "dia_vencimento", "valor_esperado", "ativo"],
        [
            ["Claro", 8, 159.00, "sim"],
            ["Luz", 8, 521.00, "sim"],
            ["Condomínio", 5, 1253.00, "sim"],
            ["Empregada", "sexta-feira", 2240.00, "sim"],
            ["Gás", 11, 90.00, "sim"],
            ["Tênis", 5, 750.00, "sim"],
            ["Personal", 5, 640.00, "sim"],
        ],
    ),
    "Contas Variáveis": (
        ["nome", "categoria", "observacao"],
        [],
    ),
    "Dicionário": (
        ["descricao_original", "categoria_mapeada", "origem", "criado_em"],
        # Conta corrente (chave: campo Título)
        [["LILIAN ALVES PEIXOTO", "Empregada", "conta", CRIADO_EM],
         ["CONDOMINIO PENINSULA", "Condomínio", "conta", CRIADO_EM],
         ["SUPERGASBRAS", "Gás", "conta", CRIADO_EM],
         ["CLARO", "Claro", "conta", CRIADO_EM],
         ["SEFAZ DISTRITO FEDERAL", "Meta: IPTU", "conta", CRIADO_EM],
         ["AIBR INSTITUICAO DE PAGAMENTO", "Compras", "conta", CRIADO_EM],
         # Transferência entre contas próprias: parser resolve pela direção
         # (entrada -> Pagamento, saída -> Retirada); literal nunca vai a Lançamentos
         ["MARCELO SILVA LEITE", "Pagamento/Retirada", "conta", CRIADO_EM],
         # Cartão de crédito (chave: campo Descrição)
         ["COMERCIAL DE ALIM BOM", "Supermercado", "cartao", CRIADO_EM],
         ["PANNABREADPAESE", "Supermercado", "cartao", CRIADO_EM],
         ["ATACADAO DIA A DIA", "Supermercado", "cartao", CRIADO_EM],
         ["IFD*", "Alimentação", "cartao", CRIADO_EM],
         ["RESTAURANTE", "Alimentação", "cartao", CRIADO_EM],
         ["BURGER KING", "Alimentação", "cartao", CRIADO_EM],
         ["GIRAFFAS", "Alimentação", "cartao", CRIADO_EM],
         ["OUTBACK", "Alimentação", "cartao", CRIADO_EM],
         ["DIVINO FOGAO", "Alimentação", "cartao", CRIADO_EM],
         ["COCO BAMBU", "Alimentação", "cartao", CRIADO_EM],
         ["SPOTIFY", "Streams", "cartao", CRIADO_EM],
         ["GOL LINHAS", "Meta: Viagem Lua de Mel", "cartao", CRIADO_EM],
         ["LATAM AIR", "Meta: Viagem Lua de Mel", "cartao", CRIADO_EM],
         ["ARAJET", "Meta: Viagem Lua de Mel", "cartao", CRIADO_EM],
         ["CLICKBUS", "Meta: Viagem Lua de Mel", "cartao", CRIADO_EM],
         ["MERCADOLIVRE", "Compras", "cartao", CRIADO_EM],
         ["AMAZON", "Compras", "cartao", CRIADO_EM]],
    ),
    "Categorias": (
        ["nome", "tipo", "ativo"],
        [["Claro", "fixa", "sim"],
         ["Luz", "fixa", "sim"],
         ["Condomínio", "fixa", "sim"],
         ["Empregada", "fixa", "sim"],
         ["Gás", "fixa", "sim"],
         ["Tênis", "fixa", "sim"],
         ["Personal", "fixa", "sim"],
         ["Supermercado", "variável", "sim"],
         ["Alimentação", "variável", "sim"],
         ["Streams", "variável", "sim"],
         ["Compras", "variável", "sim"],
         ["Outros", "variável", "sim"],
         ["Depósito Harumi", "entrada", "sim"],
         ["Depósito Marcelo", "entrada", "sim"],
         ["Bônus", "entrada", "sim"],
         ["Juros", "entrada", "sim"],
         ["Pagamento", "entrada", "sim"],
         ["Retirada", "entrada", "sim"],
         ["Outros (entrada)", "entrada", "sim"]],
    ),
    "Metas": (
        ["nome", "orcamento_total", "valor_acumulado", "prazo", "status", "criado_em"],
        [["Viagem Lua de Mel", "", 0, "", "ativa", CRIADO_EM],
         ["Cama de Casal BH", "", 0, "", "ativa", CRIADO_EM],
         ["Ar Condicionado Portátil", "", 0, "", "ativa", CRIADO_EM],
         ["Plantas", "", 0, "", "ativa", CRIADO_EM],
         ["IPTU", "", 0, "", "ativa", CRIADO_EM],
         ["Casamento", "", 0, "", "ativa", CRIADO_EM]],
    ),
    "Config": (
        ["chave", "valor"],
        [["cartao_vencimento_dia", "10"],
         ["telegram_chat_id", "PREENCHER_NO_SETUP"],
         ["empregada_nome", "LILIAN ALVES PEIXOTO"],
         ["empregada_valor", "2240.00"],
         # gemini-2.0-flash-preview do HANDOFF não existe na API; lite = mais barato
         ["gemini_model", "gemini-3.1-flash-lite"]],
    ),
    "Log": (
        ["timestamp", "acao", "entidade", "valor_anterior", "valor_novo", "origem"],
        [],
    ),
}


def main() -> None:
    wb = Workbook()
    wb.remove(wb.active)
    for nome, (header, linhas) in ABAS.items():
        ws = wb.create_sheet(nome)
        ws.append(header)
        for col in range(1, len(header) + 1):
            cell = ws.cell(row=1, column=col)
            cell.font = HEADER_FONT
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal="center")
            ws.column_dimensions[get_column_letter(col)].width = max(14, len(header[col - 1]) + 4)
        for linha in linhas:
            ws.append(linha)
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.font = BODY_FONT
        ws.freeze_panes = "A2"
    destino = Path(__file__).resolve().parent.parent / "sheets" / "bot-financeiro.xlsx"
    destino.parent.mkdir(exist_ok=True)
    wb.save(destino)
    print(f"OK: {destino}")


if __name__ == "__main__":
    main()
