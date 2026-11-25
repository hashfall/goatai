# AGENTS.md — Goatai

Contexto e histórico para agentes de IA que forem trabalhar neste repositório.

Leia também as regras globais em `~/.config/opencode/AGENTS.md`. Este documento complementa
aquelas regras com o que é específico do Goatai.

---

## 1. Visão geral

- Este repositório é um fork do **FireDragon v13** (base Firefox 160.0.1 + patches do FireDragon/LibreWolf).
- O produto em construção é o **Goatai**: o FireDragon com um agente de IA internalizado.
- O agente vai poder usar os recursos do navegador (abas, navegação, leitura e ações em páginas).
- O backend planejado é **Cloudflare Agents** (plano gratuito).
- A configuração do agente ficará em um `agents.json` no profile global do navegador.
- Interface principal: **painel lateral fixo de chat**, sempre ancorado ao lado do conteúdo.

O nome/branding visível do assistente é **Goatai**. IDs internos de extensão continuam
`firedragon-*` por compatibilidade; não renomeie IDs sem um plano de migração.

---

## 2. Estado atual (2026-11-25)

Implementado e validado:

- Painel lateral fixo de chat, à direita do conteúdo, redimensionável e persistente.
- Addon embutido `builtin-addons/ai` (WXT + Vue + Quasar), com UI de chat e i18n `en-US`/`pt-BR`.
- Injeção do painel no chrome do navegador via `content/src/browser/aiPanel.ts`.
- Preferências do painel: abertura e largura.
- Atalho de teclado e item no menu Exibir.
- Build completo do navegador gerado e testado com o painel aberto de verdade.
- Leitura do `agents.json` no profile global via experiment API
  `browser.firedragon.getAgentsConfig()`.
- Transporte real para um Worker no Cloudflare com Workers AI
  (`@cf/zai-org/glm-4.7-flash`), streaming SSE e token de acesso.
- Teste ponta a ponta: painel conectado ao Worker, mensagem enviada e resposta
  “Conectado” recebida no navegador.
- Ferramentas de navegador no agente: `list_tabs`, `get_page`, `navigate`, `click`,
  `type`, `scroll`, `go_back`, `go_forward`.
- Página **Settings → IA** para salvar endpoint/modelo/token e carregar/editar/salvar o
  `AGENTS.md` local (upload ou textarea).
- O `AGENTS.md` é enviado como instruções de sistema em todas as conversas. Teste real:
  persona “Fatec: …” aplicada e `list_tabs`/`navigate`/`get_page`/`click` executados.
- Botão na toolbar, imediatamente à esquerda do menu hambúrguer, para mostrar/ocultar o
  painel IA; estado sincronizado com `firedragon.ai.panel.open`.

Ainda **não** implementado:

- Confirmação explícita na UI para ações sensíveis (o prompt orienta o modelo a pedir,
  mas não há bloqueio/confirmação técnica).
- Histórico de conversa sincronizado entre janelas.

Artefato de build validado:

```
.dist/firedragon-v13.13.2.linux-x64.tar.xz   139 MB
sha256: eb5eb12555a518f07fd87c8bc790975068ce7315ed19a273d1b3173b326db65c
```

---

## 3. Arquitetura do painel

### 3.1 Addon embutido: `builtin-addons/ai`

- `entrypoints/panel/` — página HTML/Vue do chat (`panel.html` no addon).
- `entrypoints/panel/App.vue` — estado da conversa, streaming, composer, empty state.
- `components/MessageBubble.vue` — bolhas usuário/assistente.
- `utils/agent.ts` — contrato `ChatTransport` + stub que retorna “não configurado”.
- `utils/i18n.ts` + `assets/locales/{en-US,pt-BR}.json`.
- `entrypoints/panel/panel.scss` — layout do painel (tema claro/escuro via `light-dark()`).
- `wxt.config.ts` — id `firedragon-ai`, display name `Goatai`, permissão `storage`.

Comportamento atual:

- Mensagens e rascunho são persistidos em `browser.storage.local`
  (`local:messages` e `local:draft`).
- Enviar mensagem usa o transport stub; o streaming é simulado e explica que o agente
  ainda não está conectado.
- O botão de fechar chama `browser.firedragon.setBoolPref('firedragon.ai.panel.open', false)`.
- O botão de nova conversa aborta o streaming e limpa as mensagens.
- Enter envia; Shift+Enter quebra linha.
- A UI é renderizada dentro de `<browser>` no chrome; por isso não depende do chrome do
  Firefox para tema, mas segue `prefers-color-scheme`.

O addon não usa `sidebar_action`. O painel **não** é a sidebar nativa do Firefox; é um
painel dedicado, fixo, independente do Ctrl+B.

### 3.2 Injeção no chrome: `content/src/browser/aiPanel.ts`

Roda em cada janela de navegador (`content/src/browser.ts` importa todos os módulos de
`content/src/browser/`).

O que faz em `DOMContentLoaded`:

1. Ignora janelas popup (`chromehidden` contém `toolbar`) e evita duplicação.
2. Cria um `<splitter>` e um `<vbox>` com um `<browser>` (`panel.html` do addon) e insere
   dentro de `#browser`, antes de `#ai-window-splitter` (o painel de IA nativo do Firefox 160)
   ou no fim.
3. Define a URL do addon via `BuiltinAddons.ai.getURL('panel.html')`.
4. Lê/grava as prefs:
   - `firedragon.ai.panel.open` (bool, padrão `true`)
   - `firedragon.ai.panel.width` (int, padrão `380`, mínimo `300`, máximo `75vw`)
5. Expõe `window.gFiredragonAIPanel = { toggle, show, hide }` para futuros botões de toolbar.
6. Adiciona atalho e item de menu:
   - Atalho: `accel+alt+A` (Ctrl+Alt+A; Cmd+Alt+A no macOS)
   - Menu: Exibir → Goatai (checkbox sincronizado com a pref)
7. O painel é escondido em fullscreen (`:root[inFullscreen]` / `:root[inDOMFullscreen]`).
8. O splitter salva a largura ao final do resize (`command`).
9. Insere o botão `#firedragon-ai-button` na toolbar, imediatamente antes de
   `#PanelUI-button` (menu hambúrguer). O botão usa `content/public/ai-toolbar.svg`,
   alterna a pref `firedragon.ai.panel.open` e reflete o estado em `checked`/`aria-pressed`.

IDs relevantes:

| Elemento | ID |
|---|---|
| Caixa do painel | `firedragon-ai-panel-box` |
| Splitter | `firedragon-ai-panel-splitter` |
| `<browser>` | `firedragon-ai-panel-browser` |
| Atalho | `firedragon-ai-panel-key` |
| Command | `firedragon-ai-panel-toggle` |
| Item de menu | `firedragon-ai-panel-menu` |
| Botão da toolbar | `firedragon-ai-button` |

### 3.3 CSS do chrome

`content/src/browser/aiPanel.css`:

- Usa as variáveis `--sidebar-background-color`, `--sidebar-text-color` e
  `--sidebar-border-color` para integrar com o tema.
- Reaproveita a classe `sidebar-splitter` do Firefox.
- Esconde o painel em fullscreen.

### 3.4 Registros que precisam existir ao adicionar um addon embutido

Sempre que criar um novo addon em `builtin-addons/`:

1. `pnpm-workspace.yaml` → adicionar o diretório.
2. `builtin-addons/moz.build` → adicionar o diretório em `DIRS`.
3. `modules/src/modules/BuiltinAddons.sys.mts` → getter e `getAll()`.
4. O addon precisa gerar `dist/jar.mn` (o módulo WXT faz isso) e ter `moz.build` com
   `JAR_MANIFESTS += ['dist/jar.mn']`.
5. O build do Firefox gera `built_in_addons.json` escaneando
   `browser/chrome/browser/builtin-addons/*/manifest.json`; por isso o `manifest.json`
   precisa ter `browser_specific_settings.gecko.id` (o módulo WXT adiciona).
6. `getURL('panel.html')` devolve `moz-extension://<uuid>/panel.html`, que é o que o
   `<browser>` do chrome carrega.

O addon é empacotado dentro de `browser/omni.ja` em
`chrome/browser/builtin-addons/firedragon-ai/` e exposto como
`resource://builtin-addons/firedragon-ai/`.

---

## 4. Preferências

Definidas em `profile/inc/base.js` (defaults do Firefox):

```
firedragon.ai.panel.open   (bool, true)
firedragon.ai.panel.width  (int, 380)
```

Observações:

- `firedragon.ai.panel.open` é global (fecha/abre em todas as janelas), não por janela.
- A largura também é global.
- O addon usa `browser.firedragon.*` (experiment API) para ler/gravar prefs; a permissão
  `firedragon` é adicionada automaticamente pelo módulo WXT.

---

## 5. Build do navegador

### 5.1 Ambiente usado

- Host: CachyOS (Arch-like), 16 cores, 19 GB RAM, Docker disponível.
- Build em container Debian trixie (imagem `goatai-make`, baseada em
  `docker/make.dockerfile`).
- Toolchain Gecko: bootstrap do Firefox baixa clang, rust, sysroot, nasm, cbindgen etc.
  para `/root/.mozbuild` (montado no host em `.build/mozbuild`).

### 5.2 Fonte usada

O link de release do source está **404**:

```
https://gitlab.com/garuda-linux/firedragon/firedragon13/-/releases/v13.13.2/downloads/firedragon-v13.13.2.source.tar.xz
```

O arquivo existe no registry de pacotes:

```
https://gitlab.com/api/v4/projects/75420733/packages/generic/firedragon/13.13.2/firedragon-v13.13.2.source.tar.xz
```

Ele foi baixado para `.cache/firedragon-v13.13.2.source.tar.xz` (854 MB) e extraído em
`.build/firedragon-v13.13.2.linux-x64/`.

**Atenção:** esse tarball é o source **upstream**. O fork foi sobreposto manualmente com:

```bash
rsync -a \
  --exclude=/.git --exclude=/.build --exclude=/.cache --exclude=/.dist \
  --exclude=/.profile --exclude=node_modules --exclude=dist --exclude=.wxt \
  --exclude=.pnpm --filter=':- .gitignore' \
  ./ .build/firedragon-v13.13.2.linux-x64/browser/firedragon/
```

Por isso, um `pnpm make build` futuro usando apenas o `.cache` vai compilar o upstream
sem as mudanças do fork. Para reproduzir o Goatai pelo pipeline padrão, rode antes:

```bash
pnpm make source
```

(que regenera o tarball a partir do repositório atual), ou compile incrementalmente na
árvore `.build/`.

### 5.3 `mozconfig` obrigatório

Antes de configurar, o `mozconfig` precisa existir na raiz da árvore extraída. O build
atual usa:

```
. "$topsrcdir/browser/firedragon/mozconfig/edition/firedragon-dr460nized.mozconfig"
. "$topsrcdir/browser/firedragon/mozconfig/target/linux-x64.mozconfig"
ac_add_options --enable-bootstrap
ac_add_options --with-firedragon-update=https://gitlab.com/garuda-linux/firedragon/firedragon13/-/releases/permalink/latest/downloads/firedragon.linux-x64.update.xml
mk_add_options MOZ_OBJDIR="$topsrcdir/obj-x86_64-pc-linux-gnu"
```

A última linha foi adicionada para reaproveitar o objdir existente. O upstream usa
`obj/`; o build validado usou `obj-x86_64-pc-linux-gnu/`.

Sem o `mozconfig`, o build gera **Firefox vanilla** (`MOZ_APP_NAME=firefox`, branding
`unofficial`), mesmo com os patches do FireDragon já aplicados no source.

### 5.4 Comandos usados (dentro do container)

```bash
cd /src/.build/firedragon-v13.13.2.linux-x64/browser/firedragon
pnpm install --frozen-lockfile
pnpm all:build

cd /src/.build/firedragon-v13.13.2.linux-x64
./mach --no-interactive bootstrap --application-choice browser
./mach configure
./mach build -j8            # com CARGO_BUILD_JOBS=4
cat browser/locales/shipped-locales | xargs ./mach package-multi-locale --locales
```

O `mach bootstrap` avisa que `watchman` não existe no Debian trixie, mas continua e o
build funciona.

### 5.5 Armadilhas de build

1. **OOM no `gkrust`**: com 16 jobs, o rustc foi morto pelo OOM killer
   (`total-vm` ~22 GB). Use `-j8` e `CARGO_BUILD_JOBS=4`.
2. **Headers WebIDL obsoletos**: reconfigurar um objdir já construído com outro
   `mozconfig` deixa `UnionTypes.h`/`*Binding.h` inconsistentes.
   Solução: `./mach clobber` e build limpo depois de mudar configuração/branding.
3. **`pnpm install` sem o submodule `startpage`**: o lockfile perde o importer de
   `builtin-addons/startpage` e remove centenas de pacotes. Inicialize o submodule antes:
   `git -c url.https://gitlab.com/.insteadOf=git@gitlab.com: submodule update --init --recursive`.
4. **Arquivos root no bind mount**: o container roda como root e pode criar
   `.pnpm-store/` no repositório. Remova com um container root:
   `docker run --rm -v "$PWD:/src" goatai-make rm -rf /src/.pnpm-store`.
5. **`pnpm make build` não usa o workspace atual**: ele extrai o source tarball do
   `.cache`. Veja a seção 5.2.
6. **Artefato do Firefox**: o `.tar.xz` final tem nome interno
   `firedragon-160.0.1.en-US.linux-x86_64.tar.xz` (versão Gecko), mas o display version é
   `13.13.2`. O `package_name.txt` é a referência correta.

### 5.6 Resultado do build

Artefato final copiado de `obj-x86_64-pc-linux-gnu/dist/` para:

```
.dist/firedragon-v13.13.2.linux-x64.tar.xz
```

Empacotamento verificado:

- `browser/omni.ja` contém `chrome/browser/builtin-addons/firedragon-ai/` e
  `chrome/firedragon/content/browser.js` com o código do painel.
- `built_in_addons.json` contém `firedragon-ai@firedragon.garudalinux.org`.
- `defaults/preferences/firedragon.js` contém `firedragon.ai.panel.*`.
- Não há `firedragon.jar` separado no pacote; o conteúdo foi mesclado ao `omni.ja`.

Teste real feito com o binário extraído do `.tar.xz`, perfil temporário, em Wayland/niri:
o navegador abriu com o painel Goatai fixo à direita e o tema carregado.

---

## 6. Desenvolvimento local

```bash
pnpm install
pnpm make dev          # artifact build + abre o navegador de desenvolvimento
```

Builds/checagens úteis:

```bash
pnpm -C builtin-addons/ai build
pnpm -C content build
pnpm -C builtin-addons/ai exec tsc --noEmit
pnpm -C content exec tsc --noEmit   # há erros pré-existentes; verifique apenas os novos
pnpm exec oxfmt <arquivos>
```

Observações:

- O `.wxt` é gerado pelo WXT; sem ele o `tsc` do addon reclama de `App.vue`.
- `vue-tsc` não está configurado; a validação de tipos de `.vue` é via build.
- Não rode `pnpm install` na raiz sem o submodule `startpage` inicializado.
- A build de produção do Firefox não roda neste host sem o container/toolchain descritos
  acima.

---

## 7. UI do painel: decisões e padrões

- Layout raiz é um flex column (`div.panel`), **não** `q-layout/q-page`.
  Motivo: o `q-page` do Quasar força `min-height` e quebrava o preenchimento vertical
  dentro do `<browser>` do chrome.
- `App.vue` **não pode** usar `await` no setup (async setup) sem `<Suspense>`.
  O carregamento do storage é feito em `onMounted`.
- O scroll deve ficar no container de mensagens (`overflow-y: auto; min-height: 0`),
  com o composer fixo no fim do flex.
- Cores usam `light-dark()`; o tema acompanha `prefers-color-scheme`.
- O botão de enviar/parar é o mesmo componente alternado por `streaming`.
- Mensagens são persistidas, mas ainda não há sincronização ao vivo entre janelas.
- O streaming do stub simula palavras; o transport real deve ser assíncrono e cancelável
  via `AbortSignal`.

---

## 8. Cloudflare Agents + `agents.json` (implementado)

### 8.1 Worker

- Código: `workers/goatai-agent/`.
- URL de produção: `https://goatai-agent.goatai-agent.workers.dev`.
- Modelo: `@cf/zai-org/glm-4.7-flash` (Workers AI, function calling, 131k de contexto).
- Endpoints:
  - `GET /health` → `{ ok: true, model }` (sem autenticação).
  - `POST /chat` → body `{ messages: [{ role, content }] }`; exige
    `Authorization: Bearer <AGENT_TOKEN>`; responde SSE (`text/event-stream`).
- O token fica no secret `AGENT_TOKEN` do Worker, nunca no código.
- O Worker usa o binding `env.AI` (`[ai] binding = "AI"` no `wrangler.toml`).
- `max_tokens` atual: 2048. O modelo emite `reasoning_content`; o transporte do painel
  ignora esse campo e mostra apenas `content`.

Deploy (a conta já está autenticada no Wrangler neste ambiente):

```bash
cd workers/goatai-agent
pnpm dlx wrangler deploy
```

Se o login expirar:

```bash
pnpm dlx wrangler login --device
```

O `--device` mostra uma URL e um código curto; o login é feito no navegador do usuário.
Não peça senha/2FA e não imprima o token.

### 8.2 Configuração no navegador

O arquivo real fica em:

```
~/.config/firedragon/config/agents.json
```

(UAppData no Linux para este build é `~/.config/firedragon`; o `ConfigLoader` do
FireDragon também usa `UAppData/config`.)

Formato usado:

```json
{
  "default": "goatai",
  "agents": {
    "goatai": {
      "provider": "cloudflare",
      "endpoint": "https://goatai-agent.goatai-agent.workers.dev/chat",
      "model": "@cf/zai-org/glm-4.7-flash",
      "token": "<AGENT_TOKEN>"
    }
  }
}
```

O arquivo deve ter permissão `600` e **nunca** deve ser commitado. Um exemplo sem segredo
está em `workers/goatai-agent/agents.example.json`.

Leitura do arquivo no chrome: `content/src/extensions.ts` expõe a função de experiment API
`getAgentsConfig()`; o schema está em `content/public/extensions.json` e os tipos em
`shared/src/types/extensions.ts`. A busca tenta, nesta ordem:

1. `UAppData/config/agents.json`
2. `UAppData/agents.json`
3. `ProfD/agents.json`
4. `GreD/config/agents.json`

A resposta é um JSON com `{ path, config, error?, searched? }`.

### 8.3 Transporte no painel

`builtin-addons/ai/utils/agent.ts`:

- `loadAgentConfig()` chama `browser.firedragon.getAgentsConfig()` e resolve o agente
  `default`.
- `createCloudflareTransport(agent)` faz `fetch` no endpoint, envia o token e interpreta o
  SSE.
- Chunks aceitos: `data.response`, `data.choices[0].delta.content` e
  `data.choices[0].message.content`.
- Erros HTTP viram exceção e o painel mostra a mensagem de erro localizada.
- O status do compositor mostra “Connected”/“Not connected” e o nome do modelo; o `title`
  mostra o caminho do `agents.json` ou o erro de configuração.

Permissões no `wxt.config.ts` para o fetch funcionar em página de extensão:

- `https://*.workers.dev/*`
- `http://localhost/*`
- `http://127.0.0.1/*`

Para um domínio próprio, adicione o padrão correspondente e rebuild o addon/navegador.

### 8.4 Ferramentas do agente (implementado)

Código: `builtin-addons/ai/utils/tools.ts`; loop de tool calling em
`builtin-addons/ai/utils/agent.ts` (`createAgentTransport`).

Ferramentas:

- `list_tabs` — lista abas (id, título, URL, ativa, pinned, audible).
- `get_page` — URL, título, seleção, texto (até 9.000 chars) e até 120 elementos
  interativos com `ref` (`g1`, `g2`, …).
- `navigate` — navega a aba ativa/`tab_id` para URL http/https.
- `click` — clica em um `ref` retornado por `get_page`.
- `type` — digita em um `ref`; `submit=true` envia o formulário ou pressiona Enter.
- `scroll` — rola para cima/baixo.
- `go_back` / `go_forward` — histórico da aba.

Como funciona:

1. O painel envia `messages`, `system` (AGENTS.md) e `tools` ao Worker.
2. O Worker chama o Workers AI com `tool_choice: 'auto'` e devolve a mensagem.
3. Se houver `tool_calls`, o painel executa localmente via `browser.tabs` /
   `browser.tabs.executeScript`, devolve mensagens `role: 'tool'` e repete.
4. O limite é 8 passos; o conteúdo final é fatiado no stream da UI.

Permissões: `tabs` e `<all_urls>` além das permissões de host do Worker.

Segurança: o prompt orienta a pedir confirmação antes de ações destrutivas, mas ainda
**não** existe bloqueio/confirmação técnica na UI. O conteúdo da página é tratado como
dado não confiável no prompt.

### 8.5 Settings → IA

- Página: `builtin-addons/settings/pages/ai/index.vue`.
- Rota: `/ai`; item “AI” no menu lateral.
- Campos: endpoint, modelo e token (password com mostrar/ocultar).
- “Save connection” cria/atualiza `agents.json` com permissão `600`.
- “Upload AGENTS.md” (máx. 128 KB) ou edição direta no textarea; “Save instructions”
  grava `UAppData/config/AGENTS.md` com permissão `600`.
- Instruções de como obter o token ficam em um `q-expansion-item`.
- i18n: `en-US` e `pt-BR` (novo locale parcial; demais chaves caem no fallback en-US).
- Experiment APIs usadas: `getAgentsConfig`, `saveAgentsConfig`, `getAgentsMd`,
  `saveAgentsMd` (definidas em `content/src/extensions.ts` + schema + types).

---

## 9. Regras para agentes que forem editar este repo

- Antes de mexer no painel, leia:
  `content/src/browser/aiPanel.ts`, `content/src/browser/aiPanel.css`,
  `builtin-addons/ai/entrypoints/panel/App.vue`, `builtin-addons/ai/utils/agent.ts`.
- Não renomeie IDs internos (`firedragon-ai`, `firedragon-ai-panel-*`) sem migração.
  O nome visível é Goatai.
- Preserve as strings i18n em `en-US` e `pt-BR`; adicione novas chaves nos dois arquivos.
- Não commite `.build/`, `.cache/`, `.dist/`, `node_modules/`, `.wxt/`, `dist/`.
- Nunca commite `agents.json`, `.dev.vars` ou tokens. O `agents.json` real fica fora do
  repositório, com permissão `600`.
- Não imprima o valor de `AGENT_TOKEN` em logs, chat ou commits. Para trocar, gere um novo
  token, aplique com `wrangler secret put AGENT_TOKEN` e atualize o `agents.json` local.
- `branding/goatai/` é trabalho do usuário; não apague nem sobrescreva.
- Não altere `pnpm-lock.yaml` à mão; rode `pnpm install` com o submodule inicializado.
- Se alterar `mozconfig`, branding, app name ou opções de configure: faça clobber antes de
  rebuildar.
- Ao adicionar permissões de host no `wxt.config.ts` (ex.: domínio próprio do Worker),
  rebuild o addon e o navegador; sem isso o `fetch` da página de extensão falha.
- Em código chrome, `IOUtils` é global no Firefox 160; não importe
  `resource://gre/modules/IOUtils.sys.mjs` (não existe mais).
- Para builds longos, use `-j8` e `CARGO_BUILD_JOBS=4`; acompanhe até o fim e só declare
  sucesso com o artefato gerado e um smoke test.
- Nunca diga que o build passou sem verificar `dist/bin/firedragon --version` ou o
  `.tar.xz` final.
- Ao testar UI, use perfil temporário (`--profile /tmp/...`) para não tocar no perfil real.
  Se precisar interagir via X11, use `GDK_BACKEND=x11 MOZ_ENABLE_WAYLAND=0` e `xdotool`.
- A árvore `.build/firedragon-v13.13.2.linux-x64` (25 GB) pode ser removida se não for
  mais necessária; `.cache` guarda o source de 854 MB.

---

## 10. Comandos rápidos

```bash
# painel / addon
pnpm -C builtin-addons/ai build
pnpm -C content build

# Cloudflare Worker
cd workers/goatai-agent
pnpm dlx wrangler deploy
pnpm dlx wrangler login --device     # se o login expirar
curl https://goatai-agent.goatai-agent.workers.dev/health

# build incremental do navegador (container)
docker run -d --name goatai-build --init \
  -v "$PWD:/src" -v "$PWD/.build/mozbuild:/root/.mozbuild" \
  -w /src goatai-make sleep infinity
docker exec -e CARGO_BUILD_JOBS=4 goatai-build bash -lc \
  'cd /src/.build/firedragon-v13.13.2.linux-x64 && ./mach build -j8'

# empacotar
docker exec goatai-build bash -lc \
  'cd /src/.build/firedragon-v13.13.2.linux-x64 && \
   cat browser/locales/shipped-locales | xargs ./mach package-multi-locale --locales'

# smoke test do artefato
tar -xJf .dist/firedragon-v13.13.2.linux-x64.tar.xz -C /tmp/opencode/goatai-run --strip-components=1
/tmp/opencode/goatai-run/firedragon --version
```

---

## 11. Pendências conhecidas

- Sem confirmação técnica/bloqueio para ações sensíveis (só orientação no prompt).
- Sem sincronização de conversa entre janelas.
- Sem testes automatizados do painel (validação atual é manual/visual).
- Rotação do `AGENT_TOKEN` é manual (Worker secret + `agents.json` local).
- Branding do navegador inteiro continua FireDragon; apenas o assistente é Goatai.

---

## 12. Histórico desta implementação (2026-11-25)

### Painel

1. Criado o addon `builtin-addons/ai` (WXT/Vue/Quasar), com painel de chat, i18n,
   persistência local e transport stub.
2. Criado `content/src/browser/aiPanel.ts` e `aiPanel.css` para injetar o painel fixo no
   chrome, com splitter, prefs, atalho, menu e esconder em fullscreen.
3. Registrado o addon em `pnpm-workspace.yaml`, `builtin-addons/moz.build`,
   `BuiltinAddons.sys.mts` e adicionadas as prefs em `profile/inc/base.js`.
4. Renomeado o branding visível de “Goat AI” para **Goatai**.

### Validação da UI

- `pnpm -C builtin-addons/ai build` passou.
- `pnpm -C content build` passou.
- UI testada no navegador embutido com APIs de extensão mockadas, em largura cheia e em
  380 px; streaming e nova conversa funcionando.
- Corrigido um bug de async setup sem `<Suspense>` (carregamento do storage movido para
  `onMounted`) e um bug de layout do Quasar (`q-page` sem altura) trocando o root por um
  flex column.

### Build do navegador

1. Source do release retornou 404; baixado do registry de pacotes (854 MB).
2. Source extraído (5,2 GB) e fork sobreposto com `rsync`.
3. Imagem Docker de build criada a partir de `docker/make.dockerfile`.
4. `mach bootstrap` + `mach configure` concluídos.
5. Primeiro `mach build` gerou Firefox vanilla, porque o `mozconfig` ainda não tinha sido
   gravado antes do configure.
6. Reconfigure com o `mozconfig` correto e objdir reaproveitado; build incremental falhou
   por headers WebIDL inconsistentes.
7. `mach clobber` + build limpo; falhou por OOM no `gkrust` com 16 jobs.
8. Retomada com `-j8` + `CARGO_BUILD_JOBS=4`; build concluído.
9. `package-multi-locale` gerou o `.tar.xz` de 141 MB; artefato copiado para `.dist/`.
10. Binário extraído do próprio `.tar.xz` executado com perfil temporário em Wayland/niri;
    o painel Goatai apareceu fixo à direita e funcional.

### Cloudflare

1. Modelo escolhido: `@cf/zai-org/glm-4.7-flash` (function calling, 131k de contexto).
2. Criado o Worker `workers/goatai-agent` com binding `env.AI`, CORS e autenticação por
   token.
3. Login do Wrangler feito com `wrangler login --device` (código curto no navegador,
   sem senha/2FA no chat).
4. Deploy em `https://goatai-agent.goatai-agent.workers.dev`.
5. Secret `AGENT_TOKEN` gerado com `openssl rand -hex 32` e gravado no Worker.
6. `agents.json` criado em `~/.config/firedragon/config/agents.json` (permissão 600).
7. Adicionada a experiment API `getAgentsConfig()` e o transporte SSE no addon.
8. Primeiro teste mostrou “Not connected” porque `IOUtils` não é mais um módulo no
   Firefox 160; corrigido usando o global `IOUtils.readUTF8`.
9. Teste final: painel “Connected”, mensagem enviada e resposta “Conectado” recebida do
   GLM-4.7-Flash via Worker.
10. `/chat` sem token retorna 401; `/health` retorna 200.

### Ferramentas e Settings (2026-11-25)

1. Criado `builtin-addons/ai/utils/tools.ts` com `list_tabs`, `get_page`, `navigate`,
   `click`, `type`, `scroll`, `go_back`, `go_forward`.
2. O Worker passou a aceitar `tools`, `system` e mensagens `role: 'tool'`, com chamada
   não-streaming e retorno JSON `{ message }`.
3. O painel implementa o loop de tool calling (até 8 passos) e executa as ferramentas via
   APIs de extensão.
4. Criada a página `Settings → IA` com endpoint/modelo/token e upload/edição do
   `AGENTS.md`.
5. Adicionadas as experiment APIs `saveAgentsConfig`, `getAgentsMd`, `saveAgentsMd`.
6. Testes reais no navegador:
   - persona do `AGENTS.md` (“Fatec: …”) aplicada;
   - `list_tabs` retornou a aba ativa;
   - `navigate` para `example.com` + `get_page` leu o texto;
   - `click` no link “Learn More” navegou para `iana.org` e o agente leu a página.

### Toolbar (2026-11-25)

1. Adicionado `content/public/ai-toolbar.svg` (ícone de chat com `context-fill`).
2. `content/src/browser/aiPanel.ts` insere `#firedragon-ai-button` antes de
   `#PanelUI-button`.
3. O botão alterna `firedragon.ai.panel.open` e sincroniza `checked`/`aria-pressed` com a
   pref; também abre/fecha pelo menu Exibir e Ctrl+Alt+A.
4. Testado no build: botão aparece à esquerda do hambúrguer e oculta/mostra o painel.

