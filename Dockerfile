# n8n + 7zip (descompactar ZIPs do C6 protegidos por senha — ZipCrypto e AES)
# A imagem oficial do n8n 2.x remove o apk (hardening), então o 7z vem de um
# stage Alpine separado — copiamos apenas o binário (estaticamente linkado ao musl).
ARG N8N_VERSION=latest

FROM alpine:3.21 AS tools
RUN apk add --no-cache 7zip

FROM docker.n8n.io/n8nio/n8n:${N8N_VERSION}
COPY --from=tools /usr/bin/7z /usr/local/bin/7z
# Smoke test do binário no build: falha aqui se faltar dependência
RUN /usr/local/bin/7z i > /dev/null
USER node
