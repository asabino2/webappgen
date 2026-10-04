# WebAppGen 🚀

> Transforme qualquer website ou aplicação web em um aplicativo nativo para **Windows (.exe)**, **Linux (AppImage, DEB, RPM)** e **Android (.apk)** com interface web moderna, logs em tempo real e download direto.

---

## ✨ Recursos

- 🌐 **Interface Web Moderna**: Design responsivo com estética dark mode, glassmorphism, tipografia moderna (Plus Jakarta Sans e JetBrains Mono) e efeitos visuais refinados.
- ⚙️ **Escolha de Framework**:
  - **⚡ Electron (Padrão)**: Runtime completo baseado em Chromium + Node.js com isolamento de contexto seguro.
  - **🦀 Tauri**: Alternativa ultra-leve baseada em Rust e WebView nativo do sistema operacional.
  - **📱 Capacitor (Android)**: Motor de empacotamento móvel moderno para gerar instaladores APK para dispositivos Android.
- 📦 **Formatos Suportados & Seleção Inteligente**:
  - **Windows Executável (.exe)**: Versão portável autocontida para Windows.
  - **Linux AppImage (.AppImage)**: Pacote universal executável para qualquer distribuição Linux.
  - **Instalador Debian / Ubuntu (.deb)**: Pacote nativo `.deb`.
  - **Instalador Fedora / RHEL (.rpm)**: Pacote nativo `.rpm`.
  - **APK Android (.apk)**: Pacote instalador Android compilado via Gradle.
  - 💡 *Sincronização de Combobox*: Ao selecionar **Capacitor**, o combobox de formatos ajusta-se automaticamente exibindo **apenas** a opção **APK Android**. Ao escolher outro framework (Electron ou Tauri), o formato APK é ocultado e ficam disponíveis apenas os formatos desktop.
- ⚡ **Compilação e Logs em Tempo Real**: Console estilo terminal integrado com streaming contínuo de logs via Server-Sent Events (SSE).
- 📊 **Barra de Progresso Dinâmica**: Indicador visual do estágio atual (resolução de ícones, configuração de templates, compilação nativa com Gradle/Electron/Tauri).
- 🎯 **Download Imediato**: Botão de download com identificação de tamanho do arquivo e nome do instalador gerado.
- 🖼️ **Resolução e Adaptação de Ícones**: Busca automática de favicon em alta resolução da URL fornecida, adaptando para resoluções desktop e para todas as densidades de tela do Android (`mdpi`, `hdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`).
- 🐳 **Docker Otimizado em Alpine Linux**: `Dockerfile` baseado em **Alpine Linux** (`node:20-alpine`) com todas as ferramentas essenciais pré-configuradas (OpenJDK 17, Android SDK Command-Line Tools, Platform Tools, Build Tools, camada `gcompat`, Electron e Tauri).

---

## 🚀 Como Executar

### Opção 1: Usando Docker Compose (Recomendado)

O container Docker baseado em Alpine Linux já vem totalmente equipado com Node.js 20, OpenJDK 17, Android SDK (`cmdline-tools`, `platforms;android-34`, `build-tools;34.0.0`), ferramentas de empacotamento Linux (`rpm`, `fuse`) e compiladores:

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

## 📱 Suporte ao Framework Capacitor (Android APK)

- **WebView Otimizado**: Carrega a URL web informada diretamente com suporte a conteúdo misto seguro e tela de splash/fallback integrada.
- **Configuração Automática**: Gera `capacitor.config.json` com `appId` sanitizado e estrutura nativa Android com `cap add android` / `cap sync android`.
- **Compilação Gradle**: Executa `./gradlew assembleDebug` gerando o arquivo `.apk` pronto para instalação em smartphones e tablets Android.
- **Ícones Multi-Densidade**: Redimensiona automaticamente o ícone do site para todas as pastas `res/mipmap-*` do projeto Android.

---

## 💻 Características dos Aplicativos Desktop (Electron / Tauri)

- **Navegação completa**: Atalhos `Alt + ←` (Voltar), `Alt + →` (Avançar), `Ctrl + R` (Recarregar), `Ctrl + Shift + R` (Forçar Recarregamento).
- **Controles de Zoom**: `Ctrl + +`, `Ctrl + -`, `Ctrl + 0` (Restaurar).
- **Tela Cheia**: Alternância rápida via `F11`.
- **Janela de Erro Amigável**: Tela nativa de reconexão automática caso o site fique offline.
- **Isolamento de Segurança**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- **Tratamento de Links Externos**: Links externos abrem no navegador padrão do sistema.

---

## 📄 Licença

MIT License.
