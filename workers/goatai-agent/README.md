# Goatai Agent Worker

Worker mínimo que expõe o Workers AI (`@cf/openai/gpt-oss-20b`) para o painel Goatai.

## Deploy

```bash
cd workers/goatai-agent
pnpm dlx wrangler whoami         # confira qual conta está autenticada
pnpm dlx wrangler login          # abra o navegador e autorize
pnpm dlx wrangler deploy
openssl rand -hex 32 | pnpm dlx wrangler secret put AGENT_TOKEN
```

O `wrangler deploy` mostra a URL `https://goatai-agent.<seu-subdominio>.workers.dev`.

## Replicar em outra conta Cloudflare

O Worker não guarda estado: o mesmo `wrangler.toml` + `src/index.js` roda em quantas
contas você quiser. Cada conta tem URL e `AGENT_TOKEN` próprios.

1. Entre na outra conta (sem browser aberto na conta atual, para não autorizar a errada):

   ```bash
   pnpm dlx wrangler login --device --browser false
   # abra a URL, digite o código e autorize com a conta nova
   pnpm dlx wrangler whoami
   ```

   `whoami` lista as contas do token. Se aparecer mais de uma, escolha com
   `CLOUDFLARE_ACCOUNT_ID=<id> pnpm dlx wrangler deploy`.

2. Confirme que o Worker ainda não existe nessa conta (evita sobrescrever algo):

   ```bash
   pnpm dlx wrangler deployments list --name goatai-agent
   # "This Worker does not exist on your account" => conta nova, pode seguir
   ```

3. Deploy e secret novo (não reaproveite o token de outra conta):

   ```bash
   pnpm dlx wrangler deploy
   pnpm dlx wrangler secret put AGENT_TOKEN
   ```

4. Teste:

   ```bash
   curl -s https://goatai-agent.<subdominio-novo>.workers.dev/health
   ```

5. Acrescente a conta nova no `agents.json` do profile, mantendo a antiga:

   ```json
   {
     "default": "goatai2",
     "agents": {
       "goatai": { "...": "conta antiga" },
       "goatai2": {
         "provider": "cloudflare",
         "endpoint": "https://goatai-agent.<subdominio-novo>.workers.dev/chat",
         "model": "@cf/openai/gpt-oss-20b",
         "token": "<AGENT_TOKEN da conta nova>"
       }
     }
   }
   ```

   O painel usa o agente apontado por `default`; trocar de conta é trocar esse campo
   (e reiniciar o painel/aba) — não precisa rebuildar o navegador.

Para voltar a fazer deploy na conta original, rode `wrangler login --device` de novo com
ela (ou use `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` da conta desejada, que não
altera a sessão salva).

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
