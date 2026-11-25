# Goatai Agent Worker

Worker mínimo que expõe o Workers AI (`@cf/openai/gpt-oss-20b`) para o painel Goatai.

## Deploy

```bash
cd workers/goatai-agent
pnpm dlx wrangler login          # abra o navegador e autorize
pnpm dlx wrangler deploy
openssl rand -hex 32 | pnpm dlx wrangler secret put AGENT_TOKEN
```

O `wrangler deploy` mostra a URL `https://goatai-agent.<seu-subdominio>.workers.dev`.

## Configuração no navegador

Copie `agents.example.json` para o `agents.json` do profile global do Goatai e ajuste
`endpoint` e `token`. O painel lê o arquivo via API `browser.firedragon.getAgentsConfig()`.

## Endpoints

- `GET /health` — retorna `{ ok, model }` (sem autenticação).
- `POST /chat` — body `{ "messages": [{ "role": "user", "content": "..." }] }`,
  header `Authorization: Bearer <AGENT_TOKEN>`. Resposta em SSE (`text/event-stream`).

## Modelo

O modelo padrão é `@cf/openai/gpt-oss-20b` (function calling, reasoning, 128k de contexto).
Pode ser trocado pela variável `MODEL` no `wrangler.toml` ou por `wrangler secret put MODEL`.
