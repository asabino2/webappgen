const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

// Clean standard Chrome User-Agent (compatible with WhatsApp Web, Notion, Google, etc.)
const CHROME_VERSION = "131.0.0.0";
const CHROME_MAJOR = "131";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Target configuration injected during build
const CONFIG = {
  url: "___TARGET_URL___",
  appName: "___APP_NAME___",
  width: 1280,
  height: 850,
  minWidth: 800,
  minHeight: 600
};

let mainWindow = null;

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: CONFIG.width,
    height: CONFIG.height,
    minWidth: CONFIG.minWidth,
    minHeight: CONFIG.minHeight,
    title: CONFIG.appName,
    icon: iconPath,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Apply User-Agent directly to webContents
  mainWindow.webContents.setUserAgent(CHROME_UA);

  // Build standard native application menu
  const template = [
    {
      label: 'Navegação',
      submenu: [
        { label: 'Voltar', accelerator: 'Alt+Left', click: () => mainWindow.webContents.canGoBack() && mainWindow.webContents.goBack() },
        { label: 'Avançar', accelerator: 'Alt+Right', click: () => mainWindow.webContents.canGoForward() && mainWindow.webContents.goForward() },
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.webContents.reload() },
        { label: 'Forçar Recarregamento', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Página Inicial', click: () => mainWindow.loadURL(CONFIG.url) },
        { type: 'separator' },
        { label: 'Fechar', accelerator: 'CmdOrCtrl+W', click: () => app.quit() }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar Tudo' }
      ]
    },
    {
      label: 'Visualização',
      submenu: [
        { role: 'resetZoom', label: 'Tamanho Padrão' },
        { role: 'zoomIn', label: 'Aumentar Zoom' },
        { role: 'zoomOut', label: 'Diminuir Zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' },
        { role: 'toggleDevTools', label: 'Ferramentas do Desenvolvedor' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: `Sobre ${CONFIG.appName}`,
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `Sobre ${CONFIG.appName}`,
              message: `${CONFIG.appName}`,
              detail: `Gerado por WebAppGen para o endereço:\n${CONFIG.url}\n\nVersão do Pacote: 1.0.0`
            });
          }
        },
        {
          label: 'Abrir no Navegador Padrão',
          click: () => shell.openExternal(CONFIG.url)
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Handle external navigation (links target=_blank)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const targetHost = new URL(url).hostname;
      const initialHost = new URL(CONFIG.url).hostname;
      // If navigating within same host or auth provider, open in window
      if (targetHost === initialHost || targetHost.endsWith('.' + initialHost)) {
        return { action: 'allow' };
      }
    } catch (_) {}
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle load failure with a friendly retry page
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (errorCode === -3) return; // ABORTED (e.g. redirected)
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Falha ao carregar</title>
        <style>
          body {
            background: #0f172a;
            color: #f8fafc;
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
          }
          .card {
            background: #1e293b;
            padding: 2.5rem;
            border-radius: 1rem;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            max-width: 480px;
          }
          h1 { margin-top: 0; color: #38bdf8; font-size: 1.5rem; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          button {
            background: #2563eb;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            font-size: 1rem;
            border-radius: 0.5rem;
            cursor: pointer;
            margin-top: 1rem;
            transition: background 0.2s;
          }
          button:hover { background: #1d4ed8; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Não foi possível conectar</h1>
          <p>Ocorreu um erro ao tentar acessar <strong>${CONFIG.url}</strong>.</p>
          <p><small style="color:#ef4444">${errorDescription} (${errorCode})</small></p>
          <button onclick="window.location.href='${CONFIG.url}'">Tentar Novamente</button>
        </div>
      </body>
      </html>
    `;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  });

  // Load the target website
  mainWindow.loadURL(CONFIG.url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Ensure session headers match standard Google Chrome to satisfy WhatsApp Web & modern SPAs
app.whenReady().then(() => {
  session.defaultSession.setUserAgent(CHROME_UA);

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_UA;
    details.requestHeaders['sec-ch-ua'] = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`;
    details.requestHeaders['sec-ch-ua-mobile'] = '?0';
    details.requestHeaders['sec-ch-ua-platform'] = process.platform === 'win32' ? '"Windows"' : '"Linux"';
    callback({ requestHeaders: details.requestHeaders });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
