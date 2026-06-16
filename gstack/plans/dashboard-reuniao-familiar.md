# Spec — dashboard-reuniao-familiar (Web Dashboard Dinâmico)

> Pedido do Marcelo em 16/06: Evolução do dashboard para uma página web dinâmica via n8n
> — despesas do mês passado, previsão estática do próximo mês, metas temporárias e rateio proporcional.
> Substitui a versão anterior do Google Sheets.

## Objetivo
Fornecer uma página web dinâmica e responsiva com visualização premium (Clean Glassmorphism) para a reunião familiar mensal, consolidando as despesas reais, o rateio proporcional com base nos salários, a projeção estática do próximo mês e o progresso das metas.

## Entradas
- **Google Sheets:**
  - Aba `Lançamentos` (`A:J`): Contem as transações com `tipo` (entrada/saída), `valor`, `data_competencia` e `status`.
  - Aba `Contas Fixas` (`A:D`): Contem `nome`, `valor_esperado` e `ativo` (sim/não).
  - Aba `Salários` (`A:B`): Estrutura `pessoa | salario` para cálculo dinâmico de proporções.
  - Aba `Metas` (`A:F`): Contem `nome`, `orcamento_total`, `valor_acumulado`, `prazo` e `status`.
- **Query Parameter:**
  - `mes` (formato `MM/YYYY`): Se omitido, assume o último mês fechado em relação à data atual (ex: se hoje é 16/06/2026, assume `05/2026`).

## Saídas
- **Endpoint Web (n8n Webhook):** Retorna uma página HTML renderizada com CSS Vanilla no estilo **Clean Glassmorphism** e gráficos interativos gerados via **ApexCharts** (CDN).
- **Conteúdo da Página:**
  - **Cabeçalho:** Seletor dropdown dinâmico para trocar de mês.
  - **KPIs (Topo):**
    - Receitas do Mês (Mês Passado)
    - Despesas do Mês (Mês Passado)
    - Saldo Marcelo com a Casa (Mês Passado): Verde se >= 0, Vermelho se < 0.
    - Saldo Harumi com a Casa (Mês Passado): Verde se >= 0, Vermelho se < 0.
    - Previsão de Depósito Marcelo (Próximo Mês)
    - Previsão de Depósito Harumi (Próximo Mês)
  - **Coluna Esquerda:**
    - Tabela de Gastos por Categoria (ordenada desc).
    - Gráfico Treemap (ApexCharts) com a proporção de cada categoria no total de gastos.
  - **Coluna Direita:**
    - Tabela de Previsão do Próximo Mês (Categoria | Valor).
  - **Rodapé (Scroll Down):**
    - Grid de Cards de Metas Temporárias (com barras de progresso lineares).

## Regras de negócio aplicáveis

### 1. Saldo Individual com a Casa (Mês Passado)
- `cota_pessoa = total_despesas_confirmadas_do_mes * proporção_salário`
- `pago_pessoa = soma(entradas cuja categoria seja "Deposito {Nome}" ou "Depósito {Nome}")`
- `saldo_pessoa = pago_pessoa - cota_pessoa`
  - Se `saldo_pessoa >= 0` → Mostrar como saldo positivo (Fundo Verde).
  - Se `saldo_pessoa < 0` → Mostrar como débito com a casa (Fundo Vermelho: *"Deve à casa R$ |saldo|"*).

### 2. Previsão do Próximo Mês (Estática)
- `previsao_gastos = soma(valor_esperado de todas as contas em Contas Fixas com ativo='sim') + soma(valor de lançamentos em Lançamentos para o próximo mês com tipo='saída' e status='previsto' - ex: parcelas de cartão)`
- Este valor é estático e não muda à medida que as contas são pagas.
- `deposito_previsto_pessoa = previsao_gastos * proporção_salário` (exibido como KPI no topo).

### 3. Normalização de Nomes e Match Accent-Insensitive
- Todas as comparações de categorias e nomes de depósitos devem ser normalizadas (remover acentos e caixa alta/baixa) para evitar discrepâncias (ex: `Depósito` vs `Deposito`).

## Casos especiais e erros
- **Meses sem lançamentos:** Se o mês selecionado não possuir transações, exibir uma mensagem centralizada clara: *"Não foram encontrados lançamentos para o mês em questão."*
- **Aba Salários sem configuração:** Se a soma dos salários for 0 ou vazia, exibir um aviso amarelo no topo: *"Atenção: Configure os salários na aba Salários para calcular o rateio"*, e assumir rateio `50% / 50%`.

## Critérios de sucesso (verificáveis)
- [ ] O endpoint `/webhook/dashboard` renderiza corretamente no navegador móvel e desktop.
- [ ] O seletor de meses atualiza a URL dinamicamente via query param e recarrega os dados corretos.
- [ ] O gráfico de gastos por categoria é exibido como um Treemap interativo da ApexCharts.
- [ ] O cálculo de saldo individual (deve à casa) mostra a cor de fundo correta (verde se >= 0, vermelho se < 0).
- [ ] A previsão do próximo mês é calculada de forma estática somando todas as contas fixas ativas e parcelas futuras previstas.
- [ ] Caso não haja lançamentos, a mensagem correspondente é exibida de forma limpa.

## Fora de escopo
- Autenticação por senha na página web (dashboard restrito pelo link/URL secreta do ngrok e segurança por obscuridade inicial).
- Edição de transações diretamente pela página web (somente leitura).
- Histórico comparativo em múltiplos gráficos temporais (mantido simples para v1).
