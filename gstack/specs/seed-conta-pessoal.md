# Spec — seed-conta-pessoal (baseline pré-produção)

> Pedido do Marcelo em 15/06: "importe esses lançamentos para a planilha para
> partirmos desse ponto de partida". Carga única (one-shot) do livro-razão real
> da conta antes de colocar o bot em produção.
> **Revisada pelo plan-reviewer (15/06) — correções 1-6 aplicadas.** TDD: testes primeiro.

## Objetivo
Popular a aba `Lançamentos` com o histórico real da conta pessoal do Marcelo
(out/2025 → jun/2026 + parcelas futuras já contratadas), substituindo as 76
linhas de teste, para servir de base ao dashboard da reunião familiar e à
operação em produção.

## Entradas
Dois CSVs separados pelo usuário (decisão de 15/06 — sem inferência de tipo):
- `Dados CSV/lançamentos conta pessoal entrada.CSV` — 35 linhas → `tipo = entrada`
- `Dados CSV/lançamentos conta pessoal saida.CSV` — 408 linhas → `tipo = saída`

Formato de ambos (idêntico, **NÃO é o extrato C6** que `parser-conta.js` come):
```
Data;Valor;Descri��o;Categoria
06/10/2025;$6.300,00;Pagamento;Deposito Marcelo
```
- Separador `;`. Codificação **Latin-1 / Windows-1252** (`Alimenta��o` =
  "Alimentação"; nenhum emoji no arquivo) → decodificar para UTF-8 na leitura.
- **Header em mojibake** (`Descri��o`): o parser NÃO casa o header por string —
  **parseia por índice de coluna** (0=Data, 1=Valor, 2=Descrição, 3=Categoria)
  e descarta a 1ª linha. (correção #4 do plan-reviewer)
- `Valor`: pt-BR com prefixo `$` e milhar-ponto/decimal-vírgula (`$1.011,87`,
  `$10.216,00`). Sempre positivo no arquivo.
- `Data`: `DD/MM/YYYY`. **Linhas NÃO ordenadas** cronologicamente (confirmado:
  entrada linha 5 `03/11` antes da linha 6 `22/10`).
- `Categoria`: categorias livres do usuário (`Deposito Marcelo`, `Condominio`,
  `Alimentação`, `Streams`, `Viagem Lua de mel`, `Casamento`, `Outros`...).
  **~11 linhas de saída com categoria em branco** (parcelas futuras: linhas
  335/338/341/349/350/356/357/368/369/372/373 do arquivo unificado original).

## Saídas
- Aba `Lançamentos` (`A:J`) reescrita: as 76 linhas de teste apagadas e as ~443
  linhas reais escritas. Shape por linha (igual a `parser-conta.js:105`):

  | coluna | origem do valor |
  |---|---|
  | `data_competencia` | `Data` do CSV (`DD/MM/YYYY`, string) |
  | `data_original` | `Data` do CSV (igual) |
  | `descricao` | `Descrição` |
  | `titulo` | `Descrição` (o CSV não tem título separado) |
  | `valor` | número **positivo** (`$1.011,87` → `1011.87`) |
  | `categoria` | `Categoria` (em branco → herda da parcela irmã, ver regras) |
  | `tipo` | `entrada` (arquivo entrada) / `saída` (arquivo saída) |
  | `origem` | `conta` |
  | `status` | `confirmado` se `Data ≤ 15/06/2026`; `previsto` se futura |
  | `id_meta` | `""` (vínculo com Metas fica fora — é o item gerenciar-metas) |

- 1 linha de Log (`A:F`, esquema real `timestamp | acao | entidade |
  valor_anterior | valor_novo | origem`):
  `timestamp | seed_baseline | Lançamentos | "" | "443 linhas (35 ent + 408 saí)" | seed-conta-pessoal`.

## Regras de negócio aplicáveis
- **Tipo vem do arquivo**, não inferido: entrada→`entrada`, saída→`saída`. (As
  receitas em `Outros` do arquivo de entrada — `tia marcia`, `deposito sonisia`,
  vendas — são todas `entrada` por estarem no arquivo certo. Resolvido na origem.)
- **Valor canônico**: sempre positivo; direção só no `tipo` (convenção do projeto).
- **status = previsto** para `Data > hoje (15/06/2026)`. São as parcelas já
  lançadas (punta cana 4/6→6/6, BTS 3/3, passagem gol yukawas, latam natal,
  prospin, calimed, passagem BH). Alimentam a previsão do dashboard.
- **Categoria em branco herda da parcela irmã**: linhas futuras sem categoria
  são continuações de uma compra parcelada cuja 1ª parcela TEM categoria e MESMA
  `descricao`. Regra: para `descricao` idêntica, preencher categoria vazia com a
  categoria não-vazia mais frequente daquela `descricao`. Se nenhuma irmã tiver
  categoria → `Outros` + aviso. **Cuidado com sufixo de parcela na descrição**
  (`latam viagem natal` vs `latam viagem natal 2/4` são descrições diferentes —
  a herança casa por descrição exata; nos dados atuais sobra irmã idêntica, mas
  é frágil — ver critério de teste). (correção #6)

## Dependência: emenda ao dedup (NÃO implementada aqui)
Semear parcelas futuras como `origem=conta` envenenaria o marco d'água do dedup
(`filtrarJaImportados`, parser-conta.js:183): o marco viraria `10/09/2026` e o
próximo extrato real seria bloqueado. **A correção pertence a
`dedup-importacao.md` (dono da função e dos testes), não a esta spec**
(CLAUDE.md §3). Esta spec apenas declara a dependência:

> **Bloqueio:** o seed só pode rodar depois que `filtrarJaImportados` ignorar
> linhas `status === "previsto"` do cálculo do marco. A regra correta é
> **blacklist `r.status !== "previsto"`** (tolerante às fixtures atuais, que não
> têm `status` — `dedup.test.js:74`), **NÃO** whitelist `=== "confirmado"`
> (essa zera as 19 fixtures e quebra a suíte). Ver emenda em `dedup-importacao.md`.

### Risco de primeira ordem (não rodapé) — guarda-chuva `10/06`
O razão manual usa `10/06/2026` como **data guarda-chuva** de centenas de
lançamentos (linhas 331-396), enquanto junho também tem datas reais anteriores
(`02/06`, `05/06`, `08/06` — linhas 397-400). Após o seed, o marco d'água
confirmado fica em `10/06/2026`. O **primeiro extrato bancário real de junho**
trará lançamentos com data real anterior a 10/06 → caem em `retroativo` e são
**bloqueados** (com mensagem honesta, sem perda silenciosa — a rede do dedup
funciona, mas a UX trava). **Plano de reconciliação da 1ª importação real
pós-seed:** importar manualmente / revisar antes de confiar no fluxo automático.
Documentar isto no HANDOFF ao encerrar.

## Casos especiais e erros
- Encoding: byte inválido em Latin-1 → abortar com erro claro (parser nunca grava
  lixo silenciosamente).
- Valor não-parseável → abortar apontando a linha.
- Data fora de `DD/MM/YYYY` → abortar apontando a linha.
- `passagem gol yukawas` repetida (4 passagens × 3 meses) e `latam natal` em
  dobro — **legítimo** (várias pessoas), NÃO deduplicar dentro do seed. (O seed é
  write direto; não passa por `filtrarJaImportados`.)
- **Idempotência:** roda → `clear` Lançamentos `A2:J` (preserva header) →
  reescreve. Rodar 2× dá o mesmo resultado.

## Decisões de arquitetura
- **Lógica pura em JS com TDD**: `workflows/src/seed-parser.js`
  - `parseValorBR("$1.011,87")` → `1011.87`
  - `parseLinhaSeed(campos, tipo, hoje)` → linha `A:J` (parseia por índice; status por data)
  - `herdarCategorias(linhas)` → preenche categorias vazias pela irmã
  - `processarSeed(entradaTxt, saidaTxt, hoje)` → `{ linhas, resumo, avisos }`
- **Runner / escrita no Sheets** (Opção A aprovada pelo plan-reviewer): runner em
  **Python** lendo o JSON de linhas que o `seed-parser.js` emite — reusa o
  caminho service-account já provado em `popular-google-sheet.py`
  (`credentials/bot-financeiro-sa.json`), sem nova dependência npm.
  - **Write idempotente (correção #3):** `values().clear("Lançamentos!A2:J")`
    (preserva header A1) → `values().update`/`batchUpdate` com
    **`valueInputOption: "RAW"`** e datas como **string `DD/MM/YYYY`** (consistente
    com o que o parser de produção grava e com a normalização do dedup; evita que
    o Sheets coaja a data a serial). O script de referência NÃO tem `clear` — é
    código novo.
- **Não** é workflow n8n: carga única manual, fora do fluxo de webhook.

## Critérios de sucesso (verificáveis)
- [ ] `parseValorBR`: `"$1.011,87"`→1011.87, `"$10.216,00"`→10216, `"$0,90"`→0.9,
  `"$24,90"`→24.9; lixo → erro.
- [ ] `parseLinhaSeed`: parseia por índice (header mojibake ignorado); data
  passada → `status:"confirmado"`; data futura (>15/06/2026) → `status:"previsto"`;
  tipo carimbado do parâmetro; valor positivo.
- [ ] `herdarCategorias`: `passagem gol yukawas` futura em branco herda
  `Casamento`; **caso de sufixo divergente** `latam viagem natal 2/4` (a 4ª
  parcela em branco herda de uma irmã `latam viagem natal` idêntica); `descricao`
  sem nenhuma irmã categorizada → `Outros` + aviso.
- [ ] `processarSeed` sobre os 2 CSVs reais: total = 35 entradas + 408 saídas;
  resumo bate (Σ entradas, Σ saídas, nº previstos); **nenhuma categoria vazia na saída**.
- [ ] Suítes existentes continuam verdes (parser-conta 15, dedup 19, etc.) —
  a emenda do dedup é responsabilidade da spec dedup e deve manter as 19 verdes.
- [ ] E2E one-shot (após emenda do dedup): rodar o runner → `Lançamentos` com
  ~443 linhas reais (0 de teste), `data_competencia` legível string `DD/MM/YYYY`,
  1 Log `seed_baseline`. Idempotente (rodar 2× → mesma contagem).

## Fora de escopo
- A emenda ao `filtrarJaImportados` (pertence a `dedup-importacao.md`).
- Vincular categorias a Metas (`id_meta`) — é o item gerenciar-metas.
- Mapear as categorias livres para o Dicionário canônico — o seed preserva a
  categoria do usuário como veio.
- Reconciliar o razão manual com extratos bancários reais sobrepostos (risco
  documentado acima — tratado na 1ª importação real, não no seed).
- Qualquer cálculo de dashboard/rateio — é a outra spec.
