# Handoff — Correções pós-teste e ajustes de layout (2026-06-16)

Para o próximo agente. Continua `HANDOFF-2026-06-16-correcoes-pos-teste.md`.

## Onde paramos

**Todos os 4 bugs relatados pelo Marcelo estão 100% corrigidos, compilados, importados no n8n e commitados.**
A branch `feat/dashboard-web` foi associada ao repositório remoto correto no GitHub e enviada com sucesso.

Falta implementar o **item 10 (`gerenciar-metas`)**.

## O que foi feito nesta sessão

### 1. Correções na Planilha (C6 Fatura Duplicada)
* **Regra adicionada:** Regra `PGTO FAT CARTAO C6 -> Pagamento/Retirada` gravada na aba **Dicionário** (origem: `conta`).
* **Lançamentos corrigidos:** A categoria da linha `497` da aba **Lançamentos** foi atualizada de vazia para `Retirada`. As despesas da casa em Maio/2026 agora batem ao centavo e não contam duas vezes o pagamento da fatura.

### 2. Formato da Resposta da API no n8n Corrigido
* A API do n8n retornava `{statusCode: 200, payload: {...}}` devido a um erro de parse de expressões ternárias complexas.
* Refatorado o gerador `scripts/gerar-workflow-dashboard.js` para retornar a `payload` pura do Code node de sucesso e o erro `{ error: "..." }` de falha.
* O nó `Responder Webhook` foi simplificado para `={{ $json }}` e o status code para `={{ $json.error ? 401 : 200 }}`.
* O workflow do dashboard foi re-importado no n8n (`scripts/import-workflows.ps1`). A resposta da API agora é consumida diretamente pelo React no formato correto.

### 3. Ajustes de Layout e Legibilidade (dashboard-web)
* **Estrutura:** O componente `Dashboard.jsx` foi modificado para exibir o **Treemap no topo** ocupando 100% de largura (tela inteira). As tabelas de Gastos por Categoria e Previsão Próximo Mês foram movidas para baixo dele lado a lado.
* **Textos:** Os rótulos das caixas do Treemap agora quebram em duas linhas (Categoria na 1ª, Valor e percentual na 2ª) e o tamanho da fonte foi aumentado para **`18px bold`**, resolvendo a dificuldade de leitura.
* **Build:** Os imports no `index.css` foram ajustados para eliminar os alertas do compilador CSS. A build de produção foi gerada com sucesso (`npm run build`).

### 4. Git e Remote Push
* Adicionado o remote `origin` apontando para o repositório remoto privado do usuário:
  `https://github.com/marcelochap/bot-financeiro-pessoal.git`
* A branch `feat/dashboard-web` foi enviada com sucesso: `git push -u origin feat/dashboard-web`.
* O repositório local está com o status limpo e todos os arquivos atualizados foram devidamente commitados.

## Estado dos Workflows e JSONs
* Os 10 workflows de produção estão ativos no n8n local.
* Todos os arquivos JSON em `workflows/` estão sincronizados com as modificações desta sessão.

## Próximo Passo Imediato
1. **Item 10 — `gerenciar-metas`** (CRUD de metas temporárias via Telegram).
   * Spec: criar `gstack/specs/gerenciar-metas.md` (copiando e editando do TEMPLATE.md).
   * Desenvolver e testar a lógica do comando `/metas` e fluxos de criação/exclusão de metas.
