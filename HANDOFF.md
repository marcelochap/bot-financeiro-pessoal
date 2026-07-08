# Handoff — Bot Financeiro Doméstico

## Contexto
Sessão de grill-me concluída. Todas as decisões de design foram tomadas. O agente deve iniciar a implementação do bot financeiro doméstico sem precisar fazer perguntas de alinhamento — tudo está documentado aqui.

## O que é o projeto
Bot de controle financeiro doméstico via Telegram, integrado ao n8n, com Google Sheets como banco de dados inicial. Processa extratos do C6 Bank (conta corrente e cartão de crédito), categoriza lançamentos, dispara lembretes de contas fixas e gera relatórios e dashboard.

---

## Stack e Infraestrutura

- **Orquestração:** n8n self-hosted + Docker parametrizado + ngrok
- **Interface:** Telegram Bot (usuário único — Marcelo)
- **Banco de dados:** Google Sheets (evolução futura para SQLite — arquitetura deve prever migração)
- **LLM:** Gemini Flash (`gemini-2.0-flash-preview`) — extração de PDFs e categorização de desconhecidos
- **Evolução planejada:** migração para VPS preservada via Docker Compose parametrizado

---

## Fontes de Dados

### C6 Cartão de Crédito
- **Formato:** CSV protegido por senha (ZIP)
- **Separador:** `;`
- **Encoding:** UTF-8
- **Colunas:** `Data de Compra`, `Nome no Cartão`, `Final do Cartão`, `Categoria`, `Descrição`, `Parcela`, `Valor (em US$)`, `Cotação (em R$)`, `Valor (em R$)`
- **Observação:** Dois cartões no mesmo arquivo — final `1455` e `2843`
- **Regime:** Caixa — data de competência reescrita para dia 10 (vencimento da fatura)

### C6 Conta Corrente
- **Formato:** CSV protegido por senha (ZIP)
- **Separador:** `,`
- **Encoding:** UTF-8 com BOM (`\ufeff`)
- **Header:** 8 linhas de metadata antes dos dados
- **Colunas:** `Data Lançamento`, `Data Contábil`, `Título`, `Descrição`, `Entrada(R$)`, `Saída(R$)`, `Saldo do Dia(R$)`
- **Chave de mapeamento para dicionário:** campo `Título`

---

## Regras de Negócio Críticas

### Regime de Caixa
- Cartão de crédito: todos os lançamentos têm data de competência reescrita para dia 10 do mês seguinte ao período da fatura
- Conta corrente: data real do lançamento

### Tratamento de Lançamentos Especiais (Cartão)
| Caso | Ação |
|------|------|
| Parcelas | Lançamento independente por parcela (já vem correto no CSV) |
| Estorno + par idêntico (valor negativo + mesma descrição no período) | Cancelamento automático → registrar no Log |
| `Inclusao de Pagamento` | Ignorar |
| Anuidade + Estorno Tarifa que se cancelam | Ignorar automaticamente |

### Tratamento de Lançamentos Especiais (Conta Corrente)
| Caso | Ação |
|------|------|
| Transferências entre contas próprias | **NÃO ignorar** — registrar como Pagamento (entrada) ou Retirada (saída) |
| Resgate de CDB | Perguntar via Telegram qual meta temporária associar; oferece também a opção de abater proporcionalmente da Cota da Casa do mês (gstack/specs/resgate-cdb-abatimento.md) |
| Lançamentos de viagem/hospedagem | Perguntar via Telegram qual meta temporária associar |
| Desconhecidos | Dicionário → Gemini Flash → Manual via Telegram → salvar regra no dicionário |

### Fluxo de Categorização (Híbrido)
1. Busca no **Dicionário** (Google Sheets) pelo Título/Descrição
2. Se não encontrar → **Gemini Flash** sugere categoria
3. Se Gemini Flash não tiver confiança → **Manual via Telegram**
4. Regra nova sempre salva no Dicionário automaticamente

### Aprovação Humana
Todo arquivo importado passa por confirmação via Telegram antes de salvar:
> "Encontrei 23 lançamentos, total R$ 4.320, período 01/05 a 31/05. Confirmar?"

---

## Estrutura Google Sheets

| Aba | Colunas principais |
|-----|--------------------|
| **Lançamentos** | data_competencia, data_original, descricao, titulo, valor, categoria, tipo (entrada/saída), origem (cartão/conta), status (confirmado/pendente), id_meta |
| **Contas Fixas** | nome, dia_vencimento, valor_esperado, ativo |
| **Contas Variáveis** | nome, categoria, observacao |
| **Dicionário** | descricao_original, categoria_mapeada, origem (cartão/conta), criado_em |
| **Categorias** | nome, tipo (fixa/variável/entrada), ativo |
| **Metas** | nome, orcamento_total, valor_acumulado, prazo, status (ativa/encerrada), criado_em |
| **Config** | chave, valor (parâmetros globais) |
| **Log** | timestamp, acao, entidade, valor_anterior, valor_novo, origem |

---

## Categorias

### Fixas (conta corrente)
| Categoria | Valor | Vencimento |
|-----------|-------|------------|
| Claro | R$ 159,00 | Dia 08 |
| Luz | R$ 521,00 | Dia 08 |
| Condomínio | R$ 1.253,00 | Dia 05 |
| Empregada | R$ 2.240,00 | Toda sexta-feira |
| Gás | R$ 90,00 | Dia 11 |
| Tênis | R$ 750,00 | Dia 05 |
| Personal | R$ 640,00 | Dia 05 |

### Variáveis (cartão de crédito)
Supermercado, Alimentação, Streams, Compras, Outros

### Entradas
Depósito Harumi, Depósito Marcelo, Bônus, Juros, Pagamento, Retirada, Outros

### Temporárias (metas iniciais)
Viagem Lua de Mel, Cama de Casal BH, Ar Condicionado Portátil, Plantas, IPTU, Casamento

---

## Dicionário Inicial

### Conta Corrente
| Título (contém) | Categoria |
|-----------------|-----------|
| LILIAN ALVES PEIXOTO | Empregada |
| CONDOMINIO PENINSULA | Condomínio |
| SUPERGASBRAS | Gás |
| CLARO | Claro |
| SEFAZ DISTRITO FEDERAL | Meta: IPTU |
| AIBR INSTITUICAO DE PAGAMENTO | Compras |

### Cartão de Crédito
| Descrição (contém) | Categoria |
|--------------------|-----------|
| COMERCIAL DE ALIM BOM | Supermercado |
| PANNABREADPAESE | Supermercado |
| ATACADAO DIA A DIA | Supermercado |
| IFD* | Alimentação |
| RESTAURANTE / BURGER KING / GIRAFFAS / OUTBACK / DIVINO FOGAO / COCO BAMBU | Alimentação |
| SPOTIFY | Streams |
| GOL LINHAS / LATAM AIR / ARAJET / CLICKBUS | Meta: Viagem |
| MERCADOLIVRE / AMAZON | Compras |

---

## Lembretes via Telegram

| Conta | Lembrete | Se "não paguei ainda" |
|-------|----------|-----------------------|
| Condomínio, Tênis, Personal | Dia 04 | Lembra no dia 05 |
| Claro, Luz | Dia 07 | Lembra no dia 08 |
| Gás | Dia 10 | Lembra no dia 11 |
| Empregada (Lilian) | Toda sexta-feira | Lembra na sexta seguinte |

Quando responde "sim, paguei" → marca como confirmado, aguarda CSV para reconciliar valor real.

---

## Arquitetura n8n — Workflows

### Roteador Central
Recebe mensagens do Telegram e roteia para sub-workflows baseado em:
- Arquivo recebido (PDF ou CSV) → detecta tipo → delega
- Slash command → roteia para sub-workflow correspondente
- Linguagem natural → Gemini Flash interpreta intenção → roteia
- Botão inline → ação direta

### Sub-workflows
| Nome | Responsabilidade |
|------|-----------------|
| `ingestao-csv-cartao` | Parser C6 cartão, reescrita de data, detecção de estornos, confirmação Telegram |
| `ingestao-csv-conta` | Parser C6 conta corrente, classificação entrada/saída, confirmação Telegram |
| `ingestao-pdf` | Gemini Flash extrai lançamentos → JSON → confirmação Telegram |
| `lembretes-agendados` | Cron jobs por conta fixa + sextas para empregada |
| `relatorio-mensal` | Fechamento mensal + comparativo + gráfico via Telegram |
| `dashboard` | Gera página web leve + envia link via Telegram |
| `gerenciar-metas` | Criar, atualizar progresso, encerrar metas temporárias |

---

## Interface Telegram

| Tipo | Exemplos |
|------|---------|
| Arquivo enviado | Dispara ingestão automaticamente |
| `/relatorio` | Relatório mensal texto + gráfico |
| `/dashboard` | Link para dashboard web |
| `/metas` | Lista metas com progresso |
| Botões inline | Criar/encerrar meta, lançamento manual, confirmar importação |
| Linguagem natural | "Quanto gastei com alimentação em abril?" |

---

## Relatórios e Dashboard

- **Relatório mensal:** texto + imagem de gráfico via Telegram, acionado por `/relatorio`
- **Previsão próximo mês:** fixos com valor configurável (aba Config) + variáveis por média dos últimos 3 meses + metas com valor mensal definido na criação
- **Dashboard:** página web leve gerada pelo n8n, acessível via link enviado pelo bot
- **Harumi:** recebe relatórios mensais automaticamente, audita diretamente no Google Sheets

---

## Configuração Config (aba Google Sheets)

| Chave | Valor |
|-------|-------|
| `cartao_vencimento_dia` | `10` |
| `telegram_chat_id` | `[REDACTED — preencher no setup]` |
| `empregada_nome` | `LILIAN ALVES PEIXOTO` |
| `empregada_valor` | `2240.00` |
| `gemini_model` | `gemini-2.0-flash-preview` |

---

## Skills Sugeridas para o Próximo Agente

- **superpowers** (`https://github.com/obra/superpowers`) — composição de sub-agentes no n8n
- **improve-codebase-architecture** (`https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture`) — usar após primeira versão funcional
- **caveman** (`https://github.com/JuliusBrussee/caveman`) — debugging de workflows n8n
- **handoff** (`https://github.com/mattpocock/skills/tree/main/skills/productivity/handoff`) — ao encerrar sessão, gerar novo handoff para continuar

---

## Ordem de Implementação Sugerida

1. **Setup Docker** — `docker-compose.yml` com n8n + variáveis de ambiente parametrizadas
2. **Google Sheets** — criar planilha com todas as abas e popular dados iniciais (categorias, dicionário, contas fixas, config)
3. **Parser CSV Cartão** — sub-workflow `ingestao-csv-cartao` com todas as regras
4. **Parser CSV Conta** — sub-workflow `ingestao-csv-conta`
5. **Roteador Central** — recebe Telegram, identifica tipo de arquivo, roteia
6. **Categorização híbrida** — integração Dicionário + Gemini Flash + fallback manual
7. **Lembretes** — cron jobs por conta + sextas
8. **Relatório mensal** — geração e envio via Telegram
9. **Dashboard** — página web leve
10. **Gerenciar metas** — CRUD de metas temporárias via Telegram

---

## Observações Importantes

- Arquivos CSV do C6 chegam em ZIP protegido por senha — o n8n precisa descompactar antes de processar
- A senha do ZIP é pessoal do usuário — armazenar em variável de ambiente, nunca hardcoded
- Toda alteração em dados deve ser registrada na aba Log
- Parser deve ser tolerante a falhas — se encontrar formato inesperado, notificar via Telegram sem travar o workflow
- Arquitetura Docker deve ter volumes persistentes para o n8n não perder workflows ao reiniciar
