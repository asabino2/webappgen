# WebAppGen 🚀

> Transforme qualquer website ou aplicação web em um aplicativo nativo para **Windows (.exe)** e **Linux (AppImage, DEB, RPM)** com interface web moderna, logs em tempo real e download direto.

---

## ✨ Recursos

- 🌐 **Interface Web Moderna**: Design responsivo com estética dark mode, glassmorphism, tipografia moderna (Plus Jakarta Sans e JetBrains Mono) e efeitos visuais refinados.
- ⚙️ **Escolha de Framework**:
  - **⚡ Electron (Padrão)**: Runtime completo baseado em Chromium + Node.js com isolamento de contexto seguro.
  - **🦀 Tauri**: Alternativa ultra-leve baseada em Rust e WebView nativo do sistema operacional.
- 📦 **Formatos Suportados**:
  - **Windows Executável (.exe)**: Versão portável autocontida, roda diretamente sem necessidade de instalação.
  - **Linux AppImage (.AppImage)**: Pacote universal executável para qualquer distribuição Linux.
  - **Instalador Debian / Ubuntu (.deb)**: Pacote nativo `.deb`.
  - **Instalador Fedora / RHEL (.rpm)**: Pacote nativo `.rpm`.
- ⚡ **Compilação e Logs em Tempo Real**: Console estilo terminal integrado com streaming contínuo de logs via Server-Sent Events (SSE).
- 📊 **Barra de Progresso Dinâmica**: Indicador visual do estágio atual (resolução de ícones, configuração do Electron, empacotamento nativo).
- 🎯 **Download Imediato**: Botão de download com identificação de tamanho do arquivo e nome do instalador gerado.
- 🖼️ **Resolução Automática de Ícones**: Busca automática do favicon em alta resolução da URL fornecida (com fallback holográfico).
- 🐳 **Pronto para Docker**: Inclui `Dockerfile` e `docker-compose.yml` pré-configurados com todas as ferramentas de compilação multi-plataforma.

---

## 🚀 Como Executar

### Opção 1: Usando Docker Compose (Recomendado para compilação multi-plataforma completa)

O ambiente Docker inclui todas as dependências nativas Linux (`rpm`, `dpkg`, `fuse`, `wine`) para compilar todos os formatos sem restrições de sistema operacional:

```bash
# Iniciar o container
docker compose up --build
```

Acesse no seu navegador:
👉 **`http://localhost:3000`**

Os instaladores gerados ficam salvos automaticamente na pasta `./builds` da sua máquina host através do volume montado.

---

### Opção 2: Executando Localmente com Node.js

Requisitos: Node.js 18+ (testado no Node.js v20 e v22).

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
├── Dockerfile                   # Imagem Docker com ferramentas de compilação Linux e Windows
├── docker-compose.yml           # Orquestração do container e montagem de volumes
├── server.js                    # Servidor Express, rotas REST e stream SSE
├── lib/
│   ├── builder.js               # Orquestrador do ciclo de vida da compilação e Electron Builder
│   ├── icon-helper.js           # Utilitário de busca e extração de ícones em alta resolução
│   └── templates/
│       ├── main.js              # Template do processo principal do Electron (atalhos, menu, zoom)
│       └── preload.js           # Template de isolamento e contexto seguro
├── public/
│   ├── index.html               # Interface Web
│   ├── css/style.css            # Estilos dark mode com glassmorphism
│   ├── js/app.js                # Lógica do frontend (SSE, barra de progresso, terminal)
│   └── assets/                  # Ícones e recursos gráficos
└── builds/                      # Diretório de saída dos aplicativos gerados
```

---

## 💻 Características do Aplicativo Desktop Gerado

Cada aplicativo gerado para um website conta com recursos nativos integrados:
- **Navegação completa**: Atalhos `Alt + ←` (Voltar), `Alt + →` (Avançar), `Ctrl + R` (Recarregar), `Ctrl + Shift + R` (Forçar Recarregamento).
- **Controles de Zoom**: `Ctrl + +`, `Ctrl + -`, `Ctrl + 0` (Restaurar).
- **Tela Cheia**: Alternância rápida via `F11`.
- **Janela de Erro Amigável**: Tela nativa de reconexão automática caso o site fique offline.
- **Isolamento de Segurança**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- **Tratamento de Links Externos**: Links para outros domínios abrem no navegador padrão do sistema.

---

## 📄 Licença

MIT License.
