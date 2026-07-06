// Helpers Notion (HTTP cru via this.helpers do n8n + paginação) compartilhados entre
// os geradores *-notion.js. Só o código-fonte (strings) — quem concatena no Code node
// e escreve o JSON final é cada gerador. Mantém os geradores DRY sem tornar os Code
// nodes gerados dependentes uns dos outros (cada workflow continua autocontido).
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");

const notionMapSrc = fs
  .readFileSync(path.join(RAIZ, "workflows-harumi", "src", "notion-map.js"), "utf-8")
  .replace(/module\.exports[\s\S]*$/, "");

// $env/this.helpers só existem dentro do Code node do n8n — este bloco é só texto até
// ser concatenado por um gerador e gravado no jsCode de um node "n8n-nodes-base.code".
const notionHttpSrc = [
  "// ── Notion: HTTP cru + paginação (this.helpers vem do runtime do Code node) ──",
  "const NOTION_TOKEN = $env.NOTION_TOKEN;",
  "const NOTION_VERSION = $env.NOTION_VERSION || '2022-06-28';",
  "const HELPERS = this.helpers;",
  "function notionHeaders() {",
  "  return { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };",
  "}",
  "async function notionQueryAll(databaseId, filter) {",
  "  let results = [];",
  "  let cursor;",
  "  do {",
  "    const body = { page_size: 100 };",
  "    if (filter) body.filter = filter;",
  "    if (cursor) body.start_cursor = cursor;",
  "    const resp = await HELPERS.httpRequest({",
  "      method: 'POST',",
  "      url: `https://api.notion.com/v1/databases/${databaseId}/query`,",
  "      headers: notionHeaders(),",
  "      body,",
  "      json: true,",
  "    });",
  "    results = results.concat(resp.results || []);",
  "    cursor = resp.has_more ? resp.next_cursor : null;",
  "  } while (cursor);",
  "  return results;",
  "}",
  "async function notionCreatePage(databaseId, properties) {",
  "  return HELPERS.httpRequest({",
  "    method: 'POST',",
  "    url: 'https://api.notion.com/v1/pages',",
  "    headers: notionHeaders(),",
  "    body: { parent: { database_id: databaseId }, properties },",
  "    json: true,",
  "  });",
  "}",
].join("\n");

module.exports = { notionMapSrc, notionHttpSrc };
