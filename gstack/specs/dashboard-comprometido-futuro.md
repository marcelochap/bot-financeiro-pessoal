# Spec — dashboard-comprometido-futuro (v2 da fatura-aberta-projecao)

> Entrega **v2** da feature [`fatura-aberta-projecao`](fatura-aberta-projecao.md). A v1
> (parser + checksum + provisórios na aba `FaturaAberta` + seed/projeção de parcelas na aba
> `Parcelas` + correção do backend `dashboard-data`) **já está no ar e validada** (ver
> `gstack/context/HANDOFF-2026-06-18-fatura-aberta.md`). Esta spec detalha **só o que faltava
> da v2**: expor o comprometido no backend `dashboard-data` e exibi-lo no React.
>
> Despachar o `plan-reviewer` sobre esta spec antes do build.

## Objetivo
Hoje o Marcelo cola a fatura aberta via `/faturaaberta` (grava na aba `FaturaAberta`) e
semeia parcelas via `/seedparcelas` (aba `Parcelas`), mas **nada disso aparece no
dashboard-web** — único dashboard que ele usa. A previsão do React (`previsaoProximoMes`)
**exclui** `origem=fatura-aberta` de propósito (anti-dupla-contagem, decisão C2 da v1), e o
bloco "Comprometido Futuro" nunca foi construído. Esta entrega fecha o ciclo: o `dashboard-data`
passa a expor o **comprometido** (fatura aberta do ciclo corrente + projeção das parcelas
futuras) e o React ganha um bloco que o exibe. Sem isso, "atualizar a previsão com a fatura
atual" não tem efeito visível.

## Entradas
- **Backend** (Code node do workflow `dashboard`, gerado por
  `scripts/gerar-workflow-dashboard.js`): além das abas já lidas (`Lançamentos`, `Contas
  Fixas`, `Salários`, `Metas`), passa a ler:
  - **`FaturaAberta!A:G`** — `ciclo | data_compra | estabelecimento | categoria_c6 | valor |
    parcelas_total | status`. Só `status='fechado'` conta (R3: `rascunho`/não-fechado é
    excluído do dashboard).
  - **`Parcelas!A:E`** — `estabelecimento | valor | M | N_no_seed | ciclo_referencia`
    (a aba **não tem** coluna `chave` — `montarEstadoParcelas` a produz mas o workflow de seed
    a descarta na gravação, `gerar-workflow-fatura-aberta.js:179`).
    ⚠️ `ciclo_referencia` vem do Sheets como **serial** (ex.: 46213) → passar por
    `normalizarCiclo` antes de usar (gotcha documentado no HANDOFF-2026-06-18).
  - **`Config!A:B`** (`chave | valor`) — para `comprometido_horizonte` (default 6). A aba
    **já existe** em produção (`gerar-planilha-inicial.py:98`), então pode entrar no mesmo
    `batchGet` sem risco de 400; o parse do horizonte usa try/default 6.
- **Lógica pura reusada** (já testada, 34 testes em `fatura-aberta.test.js`):
  `projetarComprometido(parcelaRows, vencimentoAtual, horizonte)`, `indiceAtual`,
  `normalizarCiclo`, `addMesesVencimento`. O módulo `workflows/src/fatura-aberta.js` é
  **autocontido** (sem `require` local) → concatenável no Code node pelo mesmo padrão que o
  gerador já usa para `rateio.js`+`dashboard.js`. As `parcelaRows` lidas da aba alimentam
  `projetarComprometido` **diretamente** (via `paraObjetos`) — **não** se roda
  `montarEstadoParcelas` no dashboard (isso é do fluxo de seed; `projetarComprometido`/
  `indiceAtual` só usam `N_no_seed`, `ciclo_referencia`, `M`, `valor`).
- **Frontend** (`dashboard-web/src/components/Dashboard.jsx`): consome o novo campo
  `comprometido` do payload JSON do webhook `dashboard-data`.

## Saídas
- **Backend** — novo campo no payload do `dashboard-data`:
  ```
  comprometido: {
    faturaAberta: { ciclo: "10/07/2026", total: 7873.89, status: "fechado",
                    porCategoria: [{ categoria, total }] } | null,   // null se aba vazia
    parcelas: [{ vencimento: "10/08/2026", total: 1234.56 }, ...],   // horizonte ciclos futuros
    horizonte: 6
  }
  ```
  - `faturaAberta.total` = soma dos `valor` das linhas `status='fechado'` (a aba já não guarda
    pagamentos/negativos — `montarProvisorios` só grava `parse.lancamentos`). `null` quando não
    há linhas fechadas.
  - `vencimentoAtual` (âncora da projeção) = **`max(ciclo da FaturaAberta normalizado,
    vencimentoCicloAberto(hoje))`** (decisão Q2). Ancorar no maior evita que uma fatura colada
    há 2 ciclos e não regravada projete a partir do passado. `addMesesVencimento` só anda para
    frente (k≥1), então a projeção começa sempre **no ciclo seguinte a hoje**, sem sobrepor a
    fatura aberta nem recobrir gastos já passados.
  - `parcelas`: saída de `projetarComprometido` — **um item por ciclo do horizonte, inclusive
    os de total 0** (decisão Q1: a linha do tempo fica completa; o React decide se renderiza
    a linha zerada apagada). `parcelas.length === horizonte` sempre.
- **Frontend** — bloco **"Comprometido Futuro"** no `Dashboard.jsx`:
  - Cartão "Fatura aberta (ciclo {ciclo})": total + badge de status; quebra por categoria_c6
    (tabela curta) quando houver.
  - Lista/mini-gráfico "Parcelas futuras": valor projetado por mês (vencimento) no horizonte.
  - Estado vazio limpo quando `comprometido` é nulo/sem dados ("Nenhuma fatura aberta
    capturada — use /faturaaberta no Telegram.").

## Regras de negócio aplicáveis (do HANDOFF e da spec-mãe)
- **Sem dupla contagem (C2):** na v1 final os provisórios da fatura aberta vivem na **aba
  própria `FaturaAberta`**, NÃO em `Lançamentos` (HANDOFF-2026-06-18, l.22-24) → logo
  `previsaoProximoMes` **nunca os vê** (o filtro `l.origem !== 'fatura-aberta'` em
  `dashboard.js:43,57` é só rede de segurança defensiva, não o mecanismo principal). A projeção
  de parcelas é **derivada** (`projetarComprometido`), nunca lida de `Lançamentos`. O bloco
  "Comprometido Futuro" é **informativo/separado** do bloco "Previsão Próximo Mês" — não somar
  um no outro.
- **Não-sobreposição parcela×previsão:** para um dado mês de vencimento, uma parcela deve
  aparecer em **exatamente um** bloco. Estruturalmente: `comprometido.parcelas` vem só da aba
  `Parcelas` (derivada) e `previsao.gastos.parcelas` vem só de `Lançamentos` (`status=previsto`).
  Hoje não há parcela futura gravada como `previsto` em `Lançamentos` (parcelas só viram
  lançamento real quando o CSV do ciclo fecha → aí entram como `confirmado` no mês corrente, não
  como `previsto` futuro). O build inclui teste que prova a não-sobreposição (ver Critérios).
- **Ciclo:** fecha dia 03, vence dia 10. A projeção usa vencimentos `10/MM/YYYY`.
- **Índice de parcela derivado do calendário (R1):** `projetarComprometido` já aplica
  `indiceAtual = N_no_seed + meses(ciclo_referencia → venc)`; só ativa quando `1 ≤ N ≤ M`.
- **Não-fechado fora do dashboard (R3):** linhas `status≠'fechado'` na `FaturaAberta` são
  ignoradas no total.
- **Parser/leitura nunca trava:** aba vazia, serial em vez de data, ou Config ausente →
  fallback silencioso (horizonte 6, `faturaAberta=null`), nunca derruba o webhook.

## Casos especiais e erros
- **Sem fatura aberta capturada** (`FaturaAberta` vazia ou só `rascunho`): `faturaAberta=null`;
  a projeção de parcelas ainda roda a partir do ciclo derivado de hoje. UI mostra estado vazio
  do cartão de fatura, mas pode mostrar parcelas se a aba `Parcelas` tiver seed.
- **Sem parcelas semeadas** (`Parcelas` vazia): `parcelas=[]`; UI mostra "nenhuma parcela
  futura projetada".
- **`ciclo_referencia` / `ciclo` como serial do Sheets:** `normalizarCiclo` converte
  (46213 → "10/07/2026"). Sem normalizar, a projeção quebraria silenciosamente — bug já
  pego na v1.
- **Parcela encerrando no ciclo aberto (`N==M`)**: já cobrado pela `projetarComprometido`
  (projeção futura = 0). Não recontar.
- **Config sem `comprometido_horizonte`:** default 6.
- **Webhook sem auth / senha inválida:** inalterado — a validação de senha precede tudo.

## Decisões de arquitetura
- **Reuso, não reescrita:** toda a matemática vem de `fatura-aberta.js` (já testado). O build
  acrescenta **um único helper puro novo** — `vencimentoCicloAberto(hojeISO)` (dado "hoje"
  YYYY-MM-DD em America/Sao_Paulo: dia ≤ 03 → vence dia 10 do mês corrente; senão dia 10 do
  mês seguinte) — com TDD em `fatura-aberta.test.js`. Usado só como fallback quando não há
  fatura aberta.
- **Concatenação no Code node:** o gerador `gerar-workflow-dashboard.js` passa a concatenar
  `fatura-aberta.js` no array `baseSrc` como **`semRequireLocal(semExports(lerSrc("fatura-aberta.js")))`**,
  igual ao tratamento atual de `dashboard.js` (gerador l.13-16). **Sem colisão de identificadores
  de topo** (verificado): `rateio.js` usa `arred`/`normalizar`/`mesDe`; `fatura-aberta.js` usa
  `arredonda`/`normalizarChave`/`normalizarCiclo`/`MESES` — nomes distintos. `fatura-aberta.js`
  não tem `require` local (passa limpo pelo `semRequireLocal`) e tem um único `module.exports`
  no fim (cortado por `semExports`). **Guarda:** o build roda `node -c` no `dashboard.json`
  gerado (ou valida o Code node) + a suíte completa, travando regressão se algum nome colidir no
  futuro.
- **Backend calcula, React só exibe:** o `Dashboard.jsx` não faz contas de ciclo — recebe
  `comprometido` pronto. Mantém o React fino (mesma divisão dos outros blocos).
- **De-para de categorias C6→projeto: FORA desta entrega** (v2.1). O bloco mostra
  `categoria_c6` como vem (já é legível: "Supermercado", "Restaurante"…). Isolar risco.

## Decisões do plan-reviewer (resolvidas — GO-com-correções, 2026-06-22)
- **Q1 — meses com total 0:** **mantidos** na lista (linha do tempo completa do horizonte).
  `projetarComprometido` já retorna sempre `horizonte` itens, incluindo zeros; ocultar exigiria
  pós-filtro (código novo, contra "reuso não reescrita"). O React decide o estilo da linha
  zerada. Critério: `parcelas.length === horizonte`.
- **Q2 — âncora da projeção (o ponto mais arriscado):** `vencimentoAtual =
  max(FaturaAberta normalizado, vencimentoCicloAberto(hoje))`. Ancorar no maior impede que uma
  fatura antiga não regravada projete a partir do passado (erro silencioso que o R1 da
  spec-mãe combate). Critério: nenhum vencimento projetado ≤ hoje.
- **Q3 — seletor de mês:** o bloco "Comprometido Futuro" é **sempre prospectivo a partir de
  hoje**, ignora `selectedMonth`. O seletor governa só o histórico (`mesPassado`/gastos/rateio).
  O backend calcula `comprometido` a partir de `hoje` (`gerar-workflow-dashboard.js:103`), não
  de `mesReq`.

## Critérios de sucesso (verificáveis)
- [ ] `vencimentoCicloAberto` (TDD): hoje 02/07 → "10/07/2026"; hoje 04/07 → "10/08/2026";
      borda dia 03 e dia 04 corretas; vira o ano em dez→jan.
- [ ] `gerar-workflow-dashboard.js` concatena `fatura-aberta.js` sem colisão de nomes; o
      `dashboard.json` gerado é válido e `import-workflows.ps1` roda sem erro.
- [ ] Backend lê `FaturaAberta`/`Parcelas`/`Config`, normaliza seriais e expõe `comprometido`
      com o shape acima; `faturaAberta=null` quando a aba está vazia/só-rascunho; `parcelas`
      sempre com `length === horizonte`.
- [ ] Projeção bate com `fatura-aberta.test.js:289-309`: CLUBEW seed 1/12, ciclo_ref 10/07 →
      **6 cobranças de R$ 123,54** (parcela só encerra fora da janela); GOL 2/3 → **R$ 1.401,68
      no 1º ciclo (10/08) e 0 nos demais**; GOL 3/3 → **0 em todos**. Dados reais já semeados (13 parcelas).
- [ ] **Âncora (Q2):** fatura colada há 2 ciclos (não regravada) → projeção começa no ciclo
      seguinte a HOJE; nenhum vencimento projetado ≤ hoje.
- [ ] **Não-sobreposição:** teste monta cenário com parcela na aba `Parcelas` e um `previsto`
      em `Lançamentos` no mesmo mês e prova que o mesmo gasto não aparece nos dois blocos.
- [ ] **Não-regressão de backend:** o diff do payload mostra **apenas a adição** da chave
      `comprometido`; `totais`/`gastos`/`rateio`/`previsao` (inclusive `previsao.detalhes`)/
      `metas`/`mesesDisponiveis`/`avisos` byte-idênticos para o mesmo input; suíte completa verde.
- [ ] Bloco React "Comprometido Futuro" renderiza fatura aberta (total+status+categorias) e
      parcelas por mês; estados vazios limpos; não quebra quando `comprometido` ausente
      (compat. com payload antigo).
- [ ] Conferência ao vivo: após o Marcelo colar a fatura via `/faturaaberta`, o bloco reflete
      o total da fatura e o checksum bate (R$ 7.873,89 na amostra real).

## Fora de escopo
- **De-para de categorias C6→projeto** (v2.1).
- **Somar o comprometido dentro de "Previsão Próximo Mês"** — são blocos distintos (anti-dupla
  contagem).
- **Edição de provisórios/parcelas pela web** — captura é por Telegram (`/faturaaberta`,
  `/seedparcelas`).
- **Mudar o parser/checksum/seed da v1** — já validados; esta entrega só consome.
- **Remoção do snapshot Sheets** (`montar-dashboard.py` + aba `Dashboard`) — tarefa paralela
  desta sessão, não faz parte desta spec.
</content>
</invoke>
