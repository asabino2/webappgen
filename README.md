# WebAppGen 🚀

> Transforme qualquer website ou aplicação web em um aplicativo nativo para **Windows (.exe)**, **macOS (.dmg)**, **Linux (AppImage, DEB, RPM)** e **Android (.apk)** com interface web moderna, logs em tempo real e download direto.

---

## ✨ Recursos

- 🌐 **Interface Web Moderna**: Design responsivo com estética dark mode, glassmorphism, tipografia moderna (Plus Jakarta Sans e JetBrains Mono) e efeitos visuais refinados.
- ⚙️ **Escolha de Framework**:
  - **⚡ Electron (Padrão)**: Runtime completo baseado em Chromium + Node.js com isolamento de contexto seguro.
  - **🦀 Tauri**: Alternativa ultra-leve baseada em Rust e WebView nativo do sistema operacional.
  - **📱 Capacitor (Android)**: Motor de empacotamento móvel moderno para gerar instaladores APK para dispositivos Android.
- 📦 **Formatos Suportados & Seleção Inteligente**:
  - **Windows Executável (.exe)**: Versão portável autocontida para Windows.
  - **macOS Imagem de Disco (.dmg)**: Pacote instalador oficial `.dmg` para computadores macOS (compatível com Electron e Tauri).
  - **Linux AppImage (.AppImage)**: Pacote universal executável para qualquer distribuição Linux.
  - **Instalador Debian / Ubuntu (.deb)**: Pacote nativo `.deb`.
  - **Instalador Fedora / RHEL (.rpm)**: Pacote nativo `.rpm`.
  - **APK Android (.apk / .apk TV)**: Pacotes instaladores Android compilados via Gradle (Mobile e Android TV Leanback).
  - 💡 *Sincronização de Combobox*: Ao selecionar **Capacitor**, o combobox de formatos ajusta-se automaticamente exibindo as opções Android (APK Mobile e Android TV). Ao escolher **Electron** ou **Tauri**, ficam disponíveis os formatos de desktop suportados (Windows e distribuições Linux); a opção **macOS (.dmg)** só é exibida e habilitada dinamicamente caso o servidor esteja sendo executado em um ambiente macOS (`darwin`).
- ⚡ **Compilação e Logs em Tempo Real**: Console estilo terminal integrado com streaming contínuo de logs via Server-Sent Events (SSE).
- 📊 **Barra de Progresso Dinâmica**: Indicador visual do estágio atual (resolução de ícones, configuração de templates, compilação nativa com Gradle/Electron/Tauri).
- 🎯 **Download Imediato**: Botão de download com identificação de tamanho do arquivo e nome do instalador gerado.
- 🖼️ **Resolução e Adaptação de Ícones**: Busca automática de favicon em alta resolução da URL fornecida, adaptando para resoluções desktop e para todas as densidades de tela do Android (`mdpi`, `hdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`).
- 🐳 **Docker Multiplataforma Completo**: `Dockerfile` baseado em **Debian Bookworm** (`node:20-bookworm-slim`) com todas as ferramentas essenciais pré-configuradas (Wine com arquitetura multi-arch i386/x64 para geração de `.exe` Windows com ícones e ASAR integrity, OpenJDK 17 nativo e Android SDK para compilação de APKs com Capacitor, compiladores nativos glibc, Electron e Tauri).

---

## 🚀 Como Executar

### Opção 1: Usando Docker Compose (Recomendado)

O container Docker baseado em Debian Bookworm já vem totalmente equipado com Node.js 20, Wine (wine32 e wine64), OpenJDK 17, Android SDK (`cmdline-tools`, `platforms;android-34`, `build-tools;34.0.0`), ferramentas de empacotamento Linux (`rpm`, `fuse`) e compiladores nativos:

```bash
# Iniciar o container
docker compose up --build
```

Acesse no seu navegador:
👉 **`http://localhost:3000`**

Os instaladores gerados ficam salvos automaticamente na pasta `./builds` da sua máquina host através do volume montado. Além disso, downloads do Gradle e Electron são armazenados em volumes persistentes para acelerar compilações futuras.

---

### Opção 2: Executando Localmente com Node.js

Requisitos:
- **Node.js 18+** (testado no Node.js v20 e v22).
- Para compilar APKs Android com Capacitor localmente fora do Docker, é necessário ter o **JDK 17** e a variável `ANDROID_HOME` configurada na máquina.

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Inicie o servidor:
   ```bash
   npm start
   ```
   *(ou `npm run dev` para modo de desenvolvimento com hot-reload)*

3. Acesse:
   👉 **`http://localhost:3000`**

---

## 🛠️ Arquitetura do Projeto

```
webappgen/
├── Dockerfile                   # Imagem Docker Alpine Linux com Android SDK, JDK 17 e ferramentas nativas
├── docker-compose.yml           # Orquestração do container, portas e volumes de cache (Electron e Gradle)
├── server.js                    # Servidor Express, validações, rotas REST e streaming SSE
├── lib/
│   ├── builder.js               # Orquestrador do ciclo de compilação (Electron, Tauri e Capacitor)
│   ├── icon-helper.js           # Utilitário de busca e extração de ícones em alta resolução
│   └── templates/
│       ├── main.js              # Template do processo principal do Electron
│       └── preload.js           # Template de isolamento e contexto seguro
├── public/
│   ├── index.html               # Interface Web responsiva
│   ├── css/style.css            # Estilos dark mode com glassmorphism e micro-animações
│   ├── js/app.js                # Lógica do frontend (combobox dinâmico, SSE, progresso, terminal)
│   └── assets/                  # Ícones e recursos gráficos
└── builds/                      # Diretório de saída dos aplicativos gerados
```

---

## 📱 Suporte ao Framework Capacitor (Android Mobile & Android TV)

- **WebView Otimizado**: Carrega a URL web informada diretamente com suporte a conteúdo misto seguro e tela de splash/fallback integrada.
- **Configuração Automática**: Gera `capacitor.config.json` com `appId` sanitizado e estrutura nativa Android com `cap add android` / `cap sync android`.
- **Compilação Gradle**: Executa `./gradlew assembleDebug` gerando o arquivo `.apk` pronto para instalação.
- **Ícones Multi-Densidade**: Redimensiona automaticamente o ícone do site para todas as pastas `res/mipmap-*` do projeto Android.
- **📺 Modo Android TV (.apk Leanback / Smart TV)**:
  - **Banner 16:9 Oficial**: Gera o banner de launcher para Android TV (`res/drawable*/banner.png`, 320x180 px) baseado no ícone customizado ou do website com gradiente e moldura TV.
  - **Leanback Launcher**: Configura o `AndroidManifest.xml` com `<category android:name="android.intent.category.LEANBACK_LAUNCHER" />`, `<uses-feature android.software.leanback>`, touchscreen desabilitado como obrigatório e orientação landscape.
  - **Navegação Amigável por Controle Remoto**: Suporte total a D-pad (setas cima, baixo, esquerda, direita) com detecção espacial de elementos interativos, contorno visual em destaque azul ciano e rolagem de tela inteligente.
  - **Suporte a Joystick e Gamepads**: Modo de ponteiro virtual com direcional analógico esquerdo, rolagem suave de página com analógico direito, clique com botão A / Gatilho, e botão B para voltar.
  - **Retorno no Histórico**: O botão voltar (Back) do controle remoto navega no histórico do WebView antes de fechar o aplicativo.

---

## 💻 Características dos Aplicativos Desktop (Electron / Tauri)

- **Navegação completa**: Atalhos `Alt + ←` (Voltar), `Alt + →` (Avançar), `Ctrl + R` (Recarregar), `Ctrl + Shift + R` (Forçar Recarregamento).
- **Controles de Zoom**: `Ctrl + +`, `Ctrl + -`, `Ctrl + 0` (Restaurar).
- **Tela Cheia**: Alternância rápida via `F11`.
- **Janela de Erro Amigável**: Tela nativa de reconexão automática caso o site fique offline.
- **Isolamento de Segurança**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- **Tratamento de Links Externos**: Links externos abrem no navegador padrão do sistema.

---

## 📝 Changelog

### Versão 1.3.0
- 🍎 **Exportação para macOS (.dmg) no Electron e Tauri**: Adicionado suporte à exportação e geração de imagens de disco `.dmg` para Apple macOS ao selecionar os motores Electron ou Tauri.
- ⚙️ **Configuração de Alvos do Electron Builder**: Configuração do alvo nativo `mac: { target: ['dmg'] }` e integração com a CLI do electron-builder (`--mac dmg`).
- 🦀 **Integração com Tauri Bundler**: Suporte à flag `--bundles dmg` e cópia recursiva automática de pacotes DMG compilados na pasta de distribuição.
- 🖥️ **Interface e Sincronização Dinâmica**: Adição da opção `🍎 macOS Imagem de Disco (.dmg)` no seletor de formatos de desktop (exibida e validada exclusivamente quando o servidor estiver rodando em macOS), tag visual estilizada no histórico de builds e validação de requisições no backend.

### Versão 1.2.0
- 📺 **Formato Android TV no Framework Capacitor**: Adicionada nova opção de formato de aplicativo `Android TV (.apk Leanback / Smart TV)`.
- 🖼️ **Geração Automática de Banner 16:9**: Criação automática do banner do app para o launcher do Android TV com base no ícone informado.
- 🎮 **Amigável a Controle Remoto e Joystick**: Injeção de controlador de navegação espacial D-pad com anel de foco fluorescente, ponteiro virtual e rolagem analógica por gamepad.
- 🔄 **Navegação Nativa de Retorno**: Tecla Back do controle remoto retorna páginas no histórico do WebView.

### Versão 1.1.0
- ✨ **Campo Título do Aplicativo**: Novo campo para definir o título oficial da janela e da aplicação desktop/mobile.
- 🖼️ **Campo de Seleção de Ícone Customizado**: Novo seletor de arquivos de imagem (`.png`, `.ico`, `.jpg`, `.svg`, `.webp`) com miniatura de pré-visualização em tempo real, distintivo de origem (Padrão, Favicon Site ou Arquivo) e botão para redefinir.
- ⚡ **Preenchimento Automático do Website (Botões Inline)**:
  - **Auto Título**: Botão ao lado do campo *Título do Aplicativo* para extrair automaticamente a tag `<title>` ou metadados OpenGraph diretamente da página do website.
  - **Auto Nome Compacto**: Botão ao lado do campo *Nome do Aplicativo* para gerar automaticamente uma versão limpa, concisa e sanitizada do título da página.
  - **Auto Favicon**: Botão ao lado do campo *Ícone do Aplicativo* para buscar, converter para PNG em alta resolução e aplicar o favicon do site instantaneamente na interface e no instalador final.
- 🚀 **Novo Endpoint `/api/site-metadata`**: Rota backend otimizada para detecção de metadados, títulos, favicons com fallback seguro e suporte a requisições com imagens em formato Base64 até 15MB.

---

## 📄 Licença

MIT License.

