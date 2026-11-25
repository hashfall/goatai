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

Ainda **não** implementado:

- Leitura do `agents.json`.
- Transporte real para Cloudflare Agents (o `utils/agent.ts` é um stub).
- Ferramentas do agente (abas, cliques, formulários, navegação).
- Tela/UX de configuração do agente.
- Permissões e confirmações para ações sensíveis.

Artefato de build validado:

```
.dist/firedragon-v13.13.2.linux-x64.tar.xz   141 MB
sha256: 44868fed30fe78bb6c2104106ea1abb6c8b1875431dbe2d86127605439cb0cf9
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

IDs relevantes:

| Elemento | ID |
|---|---|
| Caixa do painel | `firedragon-ai-panel-box` |
| Splitter | `firedragon-ai-panel-splitter` |
| `<browser>` | `firedragon-ai-panel-browser` |
| Atalho | `firedragon-ai-panel-key` |
| Command | `firedragon-ai-panel-toggle` |
| Item de menu | `firedragon-ai-panel-menu` |

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

## 8. Próximo passo: Cloudflare Agents + `agents.json`

### 8.1 Onde plugar

- Trocar o stub em `builtin-addons/ai/utils/agent.ts` por um transport real.
- O transport recebe `messages: ChatMessage[]` e `signal: AbortSignal` e deve render
  chunks de texto (streaming).
- A UI já suporta: envio, streaming, parada, erro, persistência, nova conversa.

### 8.2 Configuração

O arquivo `agents.json` ainda **não** é lido. Decisão pendente de localização:

- `UAppData/config/agents.json` (global por usuário) — combina com os diretórios que o
  `ConfigLoader` do FireDragon já usa (`UAppData/config`, `GreD/config`).
- Ou o diretório do perfil ativo (`ProfD`), se a configuração for por perfil.

Requisitos de segurança:

- Não commitar tokens/segredos.
- O addon deve ler o arquivo via API privilegiada do chrome (experiment API) ou via
  mensagem para o processo pai; páginas de extensão não leem `file://` do profile
  diretamente.
- A URL do agente Cloudflare e o token devem ser tratados como segredo local.

Sugestão de formato (a confirmar com o dono do projeto):

```json
{
  "default": "goatai",
  "agents": {
    "goatai": {
      "provider": "cloudflare",
      "endpoint": "https://seu-worker.workers.dev/...",
      "model": "...",
      "token": "..."
    }
  }
}
```

### 8.3 Ferramentas do agente

Para navegar e agir em páginas, o addon vai precisar de permissões como:

- `tabs`, `scripting`, `webNavigation`, `storage`
- host permissions (`<all_urls>` ou por origem)

Padrões recomendados:

- Ações destrutivas/sensíveis pedem confirmação na UI.
- Diferenciar leitura (snapshot/extração) de escrita (click, type, navigate).
- Não executar instruções vindas do conteúdo da página.
- Limitar escopo por aba/origem e registrar um log de ações.
- Preferir APIs de extensão (`browser.tabs`, `browser.scripting`) a eval no conteúdo.

---

## 9. Regras para agentes que forem editar este repo

- Antes de mexer no painel, leia:
  `content/src/browser/aiPanel.ts`, `content/src/browser/aiPanel.css`,
  `builtin-addons/ai/entrypoints/panel/App.vue`, `builtin-addons/ai/utils/agent.ts`.
- Não renomeie IDs internos (`firedragon-ai`, `firedragon-ai-panel-*`) sem migração.
  O nome visível é Goatai.
- Preserve as strings i18n em `en-US` e `pt-BR`; adicione novas chaves nos dois arquivos.
- Não commite `.build/`, `.cache/`, `.dist/`, `node_modules/`, `.wxt/`, `dist/`.
- `branding/goatai/` é trabalho do usuário; não apague nem sobrescreva.
- Não altere `pnpm-lock.yaml` à mão; rode `pnpm install` com o submodule inicializado.
- Se alterar `mozconfig`, branding, app name ou opções de configure: faça clobber antes de
  rebuildar.
- Para builds longos, use `-j8` e `CARGO_BUILD_JOBS=4`; acompanhe até o fim e só declare
  sucesso com o artefato gerado e um smoke test.
- Nunca diga que o build passou sem verificar `dist/bin/firedragon --version` ou o
  `.tar.xz` final.
- Ao testar UI, use perfil temporário (`--profile /tmp/...`) para não tocar no perfil real.
- A árvore `.build/firedragon-v13.13.2.linux-x64` (25 GB) pode ser removida se não for
  mais necessária; `.cache` guarda o source de 854 MB.

---

## 10. Comandos rápidos

```bash
# painel / addon
pnpm -C builtin-addons/ai build
pnpm -C content build

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

- Painel ainda não conectado a nenhum agente real.
- Sem `agents.json` implementado.
- Sem ferramentas de navegador/ação.
- Sem confirmação de ações sensíveis.
- Sem sincronização de conversa entre janelas.
- Sem testes automatizados do painel (validação atual é manual/visual).
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

