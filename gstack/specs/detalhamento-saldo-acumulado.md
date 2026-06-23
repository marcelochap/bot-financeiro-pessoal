# Spec — detalhamento-saldo-acumulado

## Objetivo
Implementar uma nova experiência interativa no dashboard web da Reunião Familiar que permite detalhar e auditar a evolução do saldo cumulativo de Marcelo e Harumi com a casa. Ao clicar em um dos cards de saldo, um modal translúcido deve se abrir mostrando a evolução mensal em tabela cronológica (Mês, Cota, Gastos Exclusivos, Depósitos, Saldo Mensal e Acumulado).

## Entradas
- **API n8n (`GET /webhook/dashboard-data`):**
  - Continua consumindo as abas `Lançamentos` e `Salários` para o cálculo do rateio.
  - O parâmetro `mes` (formato `MM/YYYY`) continua servindo como limite/teto superior para o rateio acumulado.
- **Payload retornado:**
  - O campo `rateio` do JSON de resposta incluirá uma nova chave `historico` que conterá um array de objetos representando a evolução do rateio mês a mês.

## Saídas
- **Frontend (dashboard-web):**
  - Nova propriedade de estado local no componente React (`selectedPerson`) para gerenciar qual modal de detalhamento de saldo exibir.
  - Componente modal elegante (Clean Glassmorphism) que renderiza a tabela de histórico de composição da dívida do usuário selecionado.

## Regras de negócio aplicáveis

### 1. Construção do Histórico de Rateio (Backend)
- A função `rateioAcumulado` em `rateio.js` filtrará os lançamentos até o mês de corte.
- Identificará todos os meses únicos presentes no histórico filtrado, ordenando-os cronologicamente (crescente).
- Para cada mês individual, calculará o rateio daquele mês usando a proporção salarial atual e gastos exclusivos do mês:
  - `totalDespesas` = Despesas compartilhadas da casa no mês
  - `cota` = `(totalDespesas * prop_pessoa) + gastos_exclusivos_pessoa_no_mes`
  - `pago` = Depósitos realizados pela pessoa naquele mês
  - `saldo` = `pago - cota`
- Manterá uma soma acumulada contínua do saldo de cada pessoa (`saldoAcumulado`).
- Retornará uma lista contendo esses cálculos para cada mês no campo `rateio.historico`.

### 2. Formato do Histórico no JSON
```json
"historico": [
  {
    "mes": "04/2026",
    "totalDespesas": 1000,
    "cota": { "Marcelo": 833.33, "Harumi": 166.67 },
    "pago": { "Marcelo": 400, "Harumi": 0 },
    "saldo": { "Marcelo": -433.33, "Harumi": -166.67 },
    "saldoAcumulado": { "Marcelo": -433.33, "Harumi": -166.67 }
  },
  {
    "mes": "05/2026",
    "totalDespesas": 2000,
    "cota": { "Marcelo": 2166.67, "Harumi": 333.33 }, // Cota base + Gastos Exclusivos (Ex: Gastos Marcelo: 500)
    "pago": { "Marcelo": 8000, "Harumi": 100 },
    "saldo": { "Marcelo": 5833.33, "Harumi": -233.33 },
    "saldoAcumulado": { "Marcelo": 5400.00, "Harumi": -400.00 }
  }
]
```

### 3. Exibição e Interatividade (Frontend)
- **Ação de Clique:** Os cards de "Saldo Marcelo c/ Casa" e "Saldo Harumi c/ Casa" ganham a classe CSS `cursor-pointer` e um visual hover para indicar interatividade.
- **Abertura do Modal:** Clicar em um dos cards atualiza o estado para a pessoa correspondente (Marcelo ou Harumi), exibindo o modal.
- **Composição da Tabela do Modal:**
  - O cabeçalho da tabela exibe: Mês, Cota da Casa (Parte Compartilhada), Gastos Exclusivos (100% cobrado da pessoa), Depósitos (Contribuições), Saldo do Mês, Saldo Acumulado.
  - A coluna "Gastos Exclusivos" deve somar apenas a categoria correspondente a `Gastos {Pessoa}` realizada no mês correspondente.
- **Estilo Visual (Glassmorphism):**
  - Fundo desfocado com `backdrop-blur-md` e borda sutil com opacidade (`border-white/10`).
  - Textos de saldo do mês e acumulado coloridos: verde se `>= 0`, vermelho/rosa se `< 0`.

## Casos especiais e erros
- **Histórico vazio:** Se não houver lançamentos passados registrados (ex. antes do início do histórico), o array `historico` estará vazio. O modal deverá exibir: *"Sem histórico de lançamentos para este período."*
- **Fechar modal:** O modal deve ser fechado ao clicar no botão de fechar (✖), ao pressionar a tecla `Escape` ou ao clicar na área escura de fundo (overlay).

## Critérios de sucesso (verificáveis)
- [ ] O teste automatizado em `rateio.test.js` passa validando que a função `rateioAcumulado` calcula corretamente o array `historico` com saldos acumulados móveis consistentes.
- [ ] A API do webhook do n8n retorna o array `historico` no objeto de payload de resposta.
- [ ] Os blocos de saldo de Marcelo e Harumi no dashboard web abrem seus respectivos modais detalhados ao serem clicados.
- [ ] O modal de detalhamento de saldo exibe as colunas e os dados monetários reais corretos de forma legível e com formatação pt-BR (R$).
- [ ] O modal se fecha corretamente com clique no overlay ou no botão de fechar (✖).

## Fora de escopo
- Edição direta de valores dentro do modal (dashboard é somente visualização).
- Filtros avançados de transações por categoria dentro do modal de histórico.
