# Spec — dashboard-reuniao-familiar (Web Dashboard React + n8n API)

> Pedido do Marcelo em 16/06: Evolução do dashboard para um Web App React estático (Vite + TailwindCSS)
> alimentado por uma API JSON no n8n, com autenticação por senha protegendo os dados.
> Substitui a versão anterior em HTML cru servida diretamente do n8n.

## Objetivo
Fornecer um Web App moderno, seguro e responsivo (estilo Clean Glassmorphism) construído em React e Vite para a reunião familiar mensal. O frontend é estático e consome dados dinâmicos de uma API exposta no n8n. O acesso aos dados é restrito por uma senha definida em variável de ambiente.

## Entradas
- **API n8n (`GET /webhook/dashboard-data`):**
  - Query Parameter: `mes` (formato `MM/YYYY`). Se omitido, assume o último mês fechado relativo a hoje.
  - Header `Authorization`: `Bearer <senha_dashboard>` (senha de acesso para liberar os dados).
- **Google Sheets (lido pela API do n8n):**
  - Aba `Lançamentos` (`A:J`)
  - Aba `Contas Fixas` (`A:D`)
  - Aba `Salários` (`A:B`)
  - Aba `Metas` (`A:F`)

## Saídas
- **API n8n:** Retorna um objeto JSON contendo todas as agregações financeiras e dados de metas, ou `401 Unauthorized` se a senha for inválida.
- **Frontend (dashboard-web):** SPA em React que renderiza:
  - **Tela de Login:** Exigida se não houver um token válido no `sessionStorage`. Valida a senha contra a API do n8n.
  - **Cabeçalho:** Menu dropdown preenchido dinamicamente com os meses disponíveis para navegação.
  - **KPIs (Topo):**
    - Receitas e Despesas do Mês.
    - Saldo de Marcelo e Harumi com a Casa: Verde se >= 0, Vermelho se < 0 (com a mensagem *"deve à casa R$ |saldo|"*).
    - Previsão de Depósito de Marcelo e Harumi para o Próximo Mês (com base na projeção estática).
  - **Coluna Esquerda:**
    - Tabela de Gastos por Categoria (ordenada desc).
    - Gráfico Treemap (ApexCharts) interativo.
  - **Coluna Direita:**
    - Tabela de Previsão Detalhada do Próximo Mês (Categoria | Valor).
  - **Rodapé:**
    - Cards das Metas Temporárias ativas com barra de progresso linear animada.

## Regras de negócio aplicáveis

### 1. Autenticação e Segurança
- A senha da reunião familiar é definida no `.env` do n8n na chave `DASHBOARD_PASSWORD`.
- O webhook do n8n deve verificar o cabeçalho `Authorization` correspondente ao formato `Bearer <senha>`. Se a senha não bater com `DASHBOARD_PASSWORD`, deve responder imediatamente com status `401` e JSON `{ "error": "Senha inválida" }`.

### 2. Saldo Individual com a Casa (Mês Passado)
- `cota_pessoa = total_despesas_confirmadas_do_mes * proporção_salário`
- `pago_pessoa = soma(entradas cuja categoria seja "Deposito {Nome}" ou "Depósito {Nome}")`
- `saldo_pessoa = pago_pessoa - cota_pessoa`
  - Se `saldo_pessoa >= 0` → Mostrar como saldo positivo (Fundo Verde).
  - Se `saldo_pessoa < 0` → Mostrar como débito com a casa (Fundo Vermelho: *"Deve à casa R$ |saldo|"*).

### 3. Previsão do Próximo Mês (Estática)
- `previsao_gastos = soma(valor_esperado de todas as contas em Contas Fixas com ativo='sim') + soma(valor de lançamentos em Lançamentos para o próximo mês com tipo='saída' e status='previsto')`
- Este valor é estático e não muda à medida que as contas são pagas ao longo do mês.
- `deposito_previsto_pessoa = previsao_gastos * proporção_salário` (exibido como KPI no topo).
- A tabela de previsão listará individualmente as contas fixas e as parcelas futuras na coluna direita.

### 4. Normalização de Nomes e Match Accent-Insensitive
- Todas as comparações de categorias e nomes de depósitos são normalizadas (removendo acentos e caixa alta/baixa) para evitar discrepâncias.

## Casos especiais e erros
- **Mês sem transações:** Se o mês selecionado não possuir dados, a API do n8n retornará um sinalizador no JSON e o React exibirá a mensagem centralizada: *"Não foram encontrados lançamentos para o mês em questão."*
- **Salários vazios ou zerados:** Se a soma dos salários for 0 ou vazia, exibir um aviso amarelo no topo: *"Atenção: Configure os salários na aba Salários para calcular o rateio"*, e assumir rateio `50% / 50%`.

## Critérios de sucesso (verificáveis)
- [ ] O endpoint da API `/webhook/dashboard-data` retorna erro `401` se a senha estiver incorreta ou ausente.
- [ ] O endpoint `/webhook/dashboard-data` retorna os dados corretos no formato JSON estruturado se a senha estiver correta.
- [ ] A tela de login no React bloqueia o acesso e exibe erro adequado se a autenticação falhar.
- [ ] O dashboard React carrega com o tema Clean Glassmorphism e exibe KPIs, Treemap e Metas corretos.
- [ ] O seletor de meses no frontend atualiza os dados na tela em tempo real sem recarregar a página inteira (reatividade React).
- [ ] Caso não haja lançamentos, a mensagem correspondente é exibida de forma limpa.

## Fora de escopo
- Edição ou exclusão de transações pela interface web (dashboard é somente leitura).
- Múltiplos usuários ou controle de permissões por pessoa (senha de acesso única compartilhada pelo casal).
