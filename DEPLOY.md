# Deploy — Bot Financeiro na VPS Hostinger

Guia para subir a stack (**n8n + Caddy/HTTPS**) numa VPS KVM da Hostinger, com acesso
via **SSH** e gerenciamento opcional via **MCP da Hostinger**.

A stack inteira (dashboard + webhooks do Telegram) é servida pelo n8n. O Caddy fica na
frente como reverse proxy e cuida do certificado HTTPS (Let's Encrypt) automaticamente.

Arquivos relevantes:
- [`docker-compose.prod.yml`](docker-compose.prod.yml) — stack de produção (n8n + Caddy, sem ngrok)
- [`deploy/Caddyfile`](deploy/Caddyfile) — reverse proxy + HTTPS automático
- [`scripts/registrar-webhook-telegram.sh`](scripts/registrar-webhook-telegram.sh) — registra o webhook do Telegram (Linux)
- [`.env.example`](.env.example) — variáveis (inclui a seção **PRODUÇÃO**)

> Preencha antes de começar: `DOMAIN` (ex.: `bot.seudominio.com`), `VPS_IP`, `VPS_USER` (na Hostinger geralmente `root`).

---

## 0. Pré-requisitos

- VPS KVM da Hostinger (Ubuntu/Debian) já provisionada — você já tem ✅
- Um domínio/subdomínio que você controla, para apontar para a VPS
- Portas **80** e **443** liberadas (firewall do painel Hostinger + `ufw` na VPS)

---

## 1. SSH (acesso à VPS)

Já existe uma chave dedicada gerada nesta máquina:

```
Privada: ~/.ssh/hostinger_botfinanceiro
Pública: ~/.ssh/hostinger_botfinanceiro.pub
```

Chave pública (cole no `authorized_keys` da VPS ou no painel da Hostinger → SSH Keys):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAiRzPorhUtrl4KQ26R5VG+yNgEY7R+K6MO4TG1j8m9c bot-financeiro-deploy@DESKTOP-51LL0UU
```

### 1.1 Instalar a chave na VPS

Opção A — pelo painel Hostinger: **VPS → SSH Keys → Add SSH Key**, cole a pública, e
recrie/reinicie a VPS se ela pedir (ou já associe na criação).

Opção B — por linha de comando (precisa da senha de root uma vez):

```powershell
# PowerShell, na sua máquina (substitua o IP):
type $env:USERPROFILE\.ssh\hostinger_botfinanceiro.pub | ssh root@VPS_IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

### 1.2 Atalho no `~/.ssh/config` (sua máquina)

Adicione ao seu `~/.ssh/config` (crie o arquivo se não existir):

```
Host botfinanceiro
    HostName VPS_IP
    User root
    IdentityFile ~/.ssh/hostinger_botfinanceiro
    IdentitiesOnly yes
```

Teste: `ssh botfinanceiro` deve entrar sem senha.

### 1.3 Hardening (depois que a chave funcionar)

Na VPS, em `/etc/ssh/sshd_config`, desabilite login por senha:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

Depois: `systemctl restart ssh`. Habilite o firewall:

```bash
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
```

---

## 2. MCP da Hostinger (opcional, para gerenciar a VPS via API)

O MCP **não está conectado nesta sessão**. Para eu poder gerenciar a VPS pela API
(reiniciar, ver métricas, DNS, etc.), conecte-o ao Claude Code:

1. No painel Hostinger, gere um **API token** (conta → API).
2. Adicione o MCP (confirme o nome do pacote/comando na doc oficial:
   <https://www.hostinger.com/support/11079316-hostinger-api-mcp-server>):

   ```powershell
   claude mcp add hostinger --env HOSTINGER_API_TOKEN=SEU_TOKEN -- npx -y hostinger-api-mcp
   ```

3. Reinicie o Claude Code. As ferramentas `mcp__hostinger__*` ficarão disponíveis.

> O token da API é um segredo — não comite e não cole em arquivos versionados.
> O deploy em si (passos 4–7) é todo por **SSH** e não depende do MCP.

---

## 3. DNS — apontar o domínio para a VPS

No seu provedor de DNS (ou no painel Hostinger, se o domínio estiver lá), crie:

```
Tipo: A    Nome: bot (ou @)    Valor: VPS_IP    TTL: padrão
```

Aguarde propagar (`nslookup bot.seudominio.com` deve retornar o IP da VPS). O Caddy
só consegue emitir o certificado depois que o DNS resolver para a VPS.

---

## 4. Preparar a VPS (Docker + repositório)

Conecte: `ssh botfinanceiro`. Então:

```bash
# Docker + plugin compose (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

# Clonar o repositório
git clone https://github.com/marcelochap/bot-financeiro-pessoal.git
cd bot-financeiro-pessoal
```

---

## 5. Configurar o `.env` de produção (na VPS)

```bash
cp .env.example .env
nano .env
```

Preencha **no mínimo**:

| Variável | Valor |
|---|---|
| `N8N_VERSION` | versão pinada (ex.: `1.70.0`) — **não** `latest` |
| `DOMAIN` | `bot.seudominio.com` |
| `ACME_EMAIL` | seu e-mail (Let's Encrypt) |
| `N8N_ENCRYPTION_KEY` | gere: `openssl rand -hex 32` — **guarde com segurança** |
| `TELEGRAM_WEBHOOK_SECRET` | gere: `openssl rand -hex 16` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | do BotFather / @userinfobot |
| `GEMINI_API_KEY` | chave do Gemini |
| `C6_ZIP_PASSWORD` | senha dos ZIPs do C6 |
| `GOOGLE_SHEETS_ID` | ID da planilha |
| `DASHBOARD_PASSWORD` | senha do dashboard |
| `DASHBOARD_URL` | `https://bot.seudominio.com/webhook/dashboard-data` |

`WEBHOOK_URL` é montada automaticamente como `https://${DOMAIN}/` pelo compose de prod.

> ⚠️ Se você já tinha credenciais salvas no n8n com **outra** `N8N_ENCRYPTION_KEY`,
> use a mesma chave aqui ou terá que recriar as credenciais no n8n.

---

## 6. Subir a stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy   # acompanhar emissão do certificado
```

Acesse `https://bot.seudominio.com` — deve abrir o n8n com HTTPS válido. Crie a conta
de owner do n8n no primeiro acesso.

---

## 7. Importar workflows e registrar o webhook do Telegram

```bash
# Importar os workflows versionados (ajuste o script se necessário p/ Linux)
bash scripts/import-workflows.sh   # ou importe pela UI do n8n

# Apontar o bot do Telegram para a VPS
bash scripts/registrar-webhook-telegram.sh
```

Mande uma mensagem ao bot para validar a ponta a ponta.

---

## 8. Atualizações futuras

```bash
ssh botfinanceiro
cd bot-financeiro-pessoal
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 9. Backup (importante)

- **`N8N_ENCRYPTION_KEY`**: guarde fora da VPS. Sem ela as credenciais do n8n são inúteis.
- **Volume `n8n_data`**: contém workflows ativos e credenciais. Backup periódico:

  ```bash
  docker run --rm -v botfinanceiropessoal_n8n_data:/data -v $(pwd):/backup alpine \
    tar czf /backup/n8n_data_$(date +%F).tar.gz -C /data .
  ```

- Os dados financeiros vivem no **Google Sheets** (já fora da VPS).
