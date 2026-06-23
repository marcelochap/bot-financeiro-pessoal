# Handoff — Detalhamento de Saldo Acumulado e Previsão de Próximo Mês com Gastos Exclusivos (2026-06-23)

Para o próximo agente. Continua após `HANDOFF-2026-06-23-rateio-cumulativo-pessoal.md`. Branch
`feat/dashboard-web`. **Tudo implementado, testado (todas as suítes verdes), gerado e pronto para merge.** 
Spec única: `gstack/plans/detalhamento-saldo-acumulado.md`.

## O que motivou
1. **Detalhamento do Saldo Acumulado:** O Marcelo queria ver como o saldo acumulado (crédito/débito com a casa) foi composto mês a mês. O clique nos cards de saldo agora abre um modal exibindo esse extrato evolutivo detalhado.
2. **Correção do Depósito Previsto (Próximo Mês):** O cálculo anterior do Depósito Previsto rateava a fatura aberta inteira proporcionalmente, mas algumas despesas do cartão são 100% individuais (exclusivas). A fórmula precisava isolar a base comum e somar os gastos exclusivos diretamente ao respectivo dono.

## O que foi entregue

1. **Histórico de Saldo Acumulado no Backend:**
   - Modificado `rateioAcumulado` em `rateio.js` para retornar a lista histórica de evolução de saldos contendo: `mes`, `cotaBase`, `gastosExclusivos`, `pago` e os saldos `saldo` e `acumulado`.
   - Adicionados testes em `rateio.test.js` para cobrir o cálculo de histórico.
2. **Cálculo de Previsão Corrigido:**
   - Atualizado `previsaoProximoMes` em `dashboard.js` para receber `faturaAbertaRows`.
   - Implementada a separação: `Base Comum = Gastos Fixos Ativos + (Fatura Aberta - Gastos Pessoais da Fatura)`.
   - Rateio da `Base Comum` feito proporcionalmente aos salários cadastrados.
   - Depósito Previsto individual = `Cota Proporcional da Base + Gastos Pessoais 100% individuais`.
   - Adicionados testes rigorosos de previsão em `dashboard.test.js` (todos verdes).
3. **Modal Glassmórfico no Frontend:**
   - Implementado em `dashboard-web/src/components/Dashboard.jsx` um modal glassmórfico de detalhamento ao clicar no card de saldo do Marcelo ou da Harumi.
   - Exibe a tabela evolutiva histórica com as cotas de base, gastos exclusivos, depósitos e saldo acumulado.
   - Ícone de fechar (`X`) adicionado, controle de estado local do modal e visual premium (glassmorphism coerente com o design do dashboard).
4. **Regeneração de Workflows:**
   - Atualizado script `scripts/gerar-workflow-dashboard.js` para injetar `faturaAbertaRows` como quinto argumento de `previsaoProximoMes`.
   - Regenerado `workflows/dashboard.json` e atualizado com sucesso.

## Estado / validado
- Todas as 13 suítes de testes em `workflows/src/` estão **100% verdes** (incluindo testes de rateio, parser, roteador e dashboard).
- Lint do frontend passou com 0 erros.
- A interface web foi validada no dev server local em `http://localhost:5173/`.

## Gotchas
- **Arredondamento e Conservação:** A cota base rateada e o saldo acumulado continuam utilizando a regra de repassar o resíduo de centavos ao último elemento para manter a consistência contábil de R$ 0,01.

## Skills sugeridas
- `test-driven-development` para futuros ajustes de lógica.
- `handoff` ao final de cada sessão.
