# workflows/

Workflows do n8n exportados em JSON (um arquivo por workflow), versionados no git.

- Exportar: `scripts\export-workflows.ps1` (após cada mudança relevante no n8n)
- Importar: `scripts\import-workflows.ps1` (em máquina nova ou após recriar o volume)

Workflows previstos (ordem de implementação no HANDOFF.md):

| Workflow | Responsabilidade |
|---|---|
| `ingestao-csv-cartao` | Parser C6 cartão, reescrita de data (dia 10), estornos, confirmação Telegram |
| `ingestao-csv-conta` | Parser C6 conta corrente, entrada/saída, confirmação Telegram |
| `roteador-central` | Recebe Telegram, detecta tipo (arquivo/comando/NL/botão), roteia |
| `ingestao-pdf` | Gemini Flash extrai lançamentos → JSON → confirmação |
| `lembretes-agendados` | Crons por conta fixa + sextas (empregada) |
| `relatorio-mensal` | Fechamento mensal + comparativo + gráfico |
| `dashboard` | Página web leve + link via Telegram |
| `gerenciar-metas` | CRUD de metas temporárias |
