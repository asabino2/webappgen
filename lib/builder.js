const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const sharp = require('sharp');
const { resolveAppIcon, processAndSavePng, generateAllAndroidTvBanners } = require('./icon-helper');

// Global build registry to track running builds and subscribers
const builds = new Map();

/**
 * Format bytes to readable string (e.g. 74.2 MB)
 */
function formatBytes(bytes, decimals = 1) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Copy files/directories recursively
 */
function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Scan nested bundle folders (.deb, .appimage, .rpm, .exe, .msi) and copy to dist root
 */
function copyBundleFilesToDist(bundleDir, distDir) {
  if (!fs.existsSync(bundleDir)) return;
  const validExts = ['.exe', '.msi', '.appimage', '.deb', '.rpm', '.dmg'];

  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else {
        const lower = entry.name.toLowerCase();
        if (validExts.some(ext => lower.endsWith(ext))) {
          const targetPath = path.join(distDir, entry.name);
          fs.copyFileSync(fullPath, targetPath);
        }
      }
    }
  }

  scan(bundleDir);
}

/**
 * Sanitize strings for valid package.json names and file names
 */
function sanitizeName(rawName) {
  let name = rawName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!name || name.length < 2) {
    name = 'webapp';
  }
  return name.slice(0, 30);
}

/**
 * Extract a reasonable display name from URL or user custom input
 */
function getDisplayName(url, customName) {
  if (customName && customName.trim()) {
    return customName.trim();
  }
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.replace(/^www\./, '').split('.');
    const base = hostParts[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch (_) {
    return 'WebApp';
  }
}

class BuildJob extends EventEmitter {
  constructor(id, { url, format, framework, customName, appTitle, iconData }) {
    super();
    this.id = id;
    this.url = url;
    if (framework === 'capacitor') {
      this.framework = 'capacitor';
      this.format = format === 'androidtv' ? 'androidtv' : 'apk';
    } else if (framework === 'tauri') {
      this.framework = 'tauri';
      this.format = format;
    } else {
      this.framework = 'electron';
      this.format = format;
    }
    this.appTitle = appTitle && appTitle.trim() ? appTitle.trim() : null;
    this.customName = customName && customName.trim() ? customName.trim() : null;
    this.displayName = this.appTitle || getDisplayName(url, this.customName);
    this.packageName = sanitizeName(this.customName || this.displayName);
    this.iconData = iconData || null;
    this.status = 'queued'; // 'queued', 'running', 'success', 'failed'
    this.progress = 0;
    this.logs = [];
    this.artifact = null;
    this.error = null;
    this.createdAt = new Date().toISOString();
    this.workDir = path.resolve(__dirname, '..', 'builds', this.id);
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logItem = { timestamp, message, type };
    this.logs.push(logItem);
    this.emit('log', logItem);
  }

  updateProgress(percentage, message = null) {
    this.progress = percentage;
    if (message) {
      this.log(message, 'stage');
    }
    this.emit('progress', { progress: this.progress, message });
  }

  async start() {
    this.status = 'running';

    if (this.format === 'dmg' && process.platform !== 'darwin') {
      throw new Error('A compilação de pacotes macOS (.dmg) só pode ser realizada quando o servidor estiver rodando no macOS.');
    }

    const fwLabel = this.framework === 'capacitor'
      ? (this.format === 'androidtv' ? 'Capacitor (Android TV)' : 'Capacitor (Android)')
      : (this.framework === 'tauri' ? 'Tauri (Rust)' : 'Electron');
    this.updateProgress(5, `Iniciando geração para ${this.displayName} via ${fwLabel}...`);

    try {
      // 1. Create workspace directories
      const srcDir = path.join(this.workDir, 'src');
      const distDir = path.join(this.workDir, 'dist');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });

      // 2. Resolve application icon
      this.updateProgress(20, 'Configurando ícone da aplicação...');
      const iconPath = path.join(srcDir, 'icon.png');
      
      let iconApplied = false;
      if (this.iconData) {
        try {
          const base64Data = this.iconData.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          if (buffer.length > 50) {
            const saved = await processAndSavePng(buffer, iconPath);
            if (saved) {
              this.log('Ícone personalizado aplicado com sucesso.', 'info');
              iconApplied = true;
            }
          }
        } catch (err) {
          this.log(`Aviso ao aplicar ícone customizado: ${err.message}`, 'tip');
        }
      }

      if (!iconApplied) {
        this.updateProgress(22, 'Buscando ícone de alta resolução do website...');
        const iconResult = await resolveAppIcon(this.url, iconPath);
        if (iconResult.success) {
          this.log(`Ícone obtido com sucesso via [${iconResult.source}]`, 'info');
        } else {
          this.log('Usando ícone padrão holográfico.', 'info');
        }
      }

      if (this.framework === 'capacitor') {
        // Fluxo de geração e compilação do Capacitor (Android)
        await this.buildCapacitor(srcDir, distDir, iconPath);
      } else if (this.framework === 'tauri') {
        // Fluxo de geração e compilação do Tauri
        await this.buildTauri(srcDir, distDir, iconPath);
      } else {
        // Fluxo padrão do Electron
        await this.buildElectron(srcDir, distDir);
      }

      // 6. Find generated artifact
      this.updateProgress(95, 'Localizando arquivo compilado e calculando tamanho...');
      const artifact = this.findArtifact(distDir);

      if (!artifact) {
        throw new Error('O compilador finalizou mas nenhum arquivo instalador foi gerado na pasta de saída.');
      }

      this.artifact = artifact;
      this.status = 'success';
      this.updateProgress(100, `Sucesso! Aplicativo gerado: ${artifact.filename} (${artifact.formattedSize})`);

      this.emit('complete', {
        id: this.id,
        status: 'success',
        artifact: this.artifact
      });

    } catch (err) {
      this.status = 'failed';
      this.error = err.message || String(err);
      this.log(`ERRO: ${this.error}`, 'error');
      
      // Provide helpful tips for host cross-platform restrictions
      if (process.platform === 'win32' && ['AppImage', 'deb', 'rpm'].includes(this.format)) {
        this.log('💡 DICA: Para compilar formatos Linux (AppImage, deb, rpm) com todas as dependências nativas, execute o projeto usando Docker: `docker compose up`', 'tip');
      } else if (process.platform === 'win32' && this.format === 'dmg') {
        this.log('💡 DICA: A compilação de pacotes macOS (.dmg) para Electron/Tauri é otimizada em ambientes macOS ou contêineres Docker/Linux (`docker compose up`).', 'tip');
      } else if (this.framework === 'capacitor') {
        this.log('💡 DICA: Para compilar APKs Android com Capacitor (com JDK 17 e Android SDK pré-instalados), execute o projeto usando Docker: `docker compose up --build`', 'tip');
      }

      this.emit('error', {
        id: this.id,
        status: 'failed',
        error: this.error
      });
    } finally {
      // Save metadata
      try {
        const metadata = {
          id: this.id,
          url: this.url,
          framework: this.framework,
          format: this.format,
          displayName: this.displayName,
          appTitle: this.appTitle,
          customName: this.customName,
          packageName: this.packageName,
          status: this.status,
          artifact: this.artifact,
          error: this.error,
          createdAt: this.createdAt,
          finishedAt: new Date().toISOString()
        };
        fs.writeFileSync(path.join(this.workDir, 'info.json'), JSON.stringify(metadata, null, 2));
      } catch (_) {}
    }
  }

  async buildElectron(srcDir, distDir) {
    // 3. Prepare Electron templates
    this.updateProgress(35, 'Injetando templates e configurações do Electron...');
    const mainTemplatePath = path.join(__dirname, 'templates', 'main.js');
    const preloadTemplatePath = path.join(__dirname, 'templates', 'preload.js');

    let mainContent = fs.readFileSync(mainTemplatePath, 'utf8');
    mainContent = mainContent
      .replace(/___TARGET_URL___/g, this.url)
      .replace(/___APP_NAME___/g, this.displayName);

    fs.writeFileSync(path.join(srcDir, 'main.js'), mainContent, 'utf8');
    fs.copyFileSync(preloadTemplatePath, path.join(srcDir, 'preload.js'));

    // 4. Generate package.json for electron-builder
    this.updateProgress(50, `Configurando alvos do Electron Builder para formato [${this.format}]...`);
    
    const targetConfig = this.getTargetConfig();
    
    const appPackage = {
      name: this.packageName,
      productName: this.displayName,
      version: '1.0.0',
      description: `Aplicativo Desktop para ${this.url}`,
      main: 'main.js',
      author: 'WebAppGen <webappgen@local>',
      devDependencies: {
        electron: '33.2.1'
      },
      build: {
        appId: `com.webappgen.${this.packageName}`,
        electronVersion: '33.2.1',
        directories: {
          output: distDir
        },
        files: ['main.js', 'preload.js', 'icon.png'],
        ...targetConfig
      }
    };

    fs.writeFileSync(
      path.join(srcDir, 'package.json'),
      JSON.stringify(appPackage, null, 2),
      'utf8'
    );

    // 5. Execute electron-builder
    this.updateProgress(65, 'Executando compilação do pacote nativo...');
    await this.runElectronBuilder(srcDir);
  }

  async buildTauri(srcDir, distDir, iconPath) {
    this.updateProgress(35, 'Injetando templates e configurações do Tauri...');

    const webDistDir = path.join(srcDir, 'dist-web');
    fs.mkdirSync(webDistDir, { recursive: true });

    // Criar index.html fallback caso o webview precise carregar offline ou inicial
    const htmlFallback = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.displayName}</title>
  <meta http-equiv="refresh" content="0; url=${this.url}">
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #fff; }
  </style>
</head>
<body>
  <p>Carregando ${this.displayName}...</p>
</body>
</html>`;
    fs.writeFileSync(path.join(webDistDir, 'index.html'), htmlFallback, 'utf8');

    // Inicializar o projeto com tauri init
    this.updateProgress(45, 'Inicializando estrutura do projeto Tauri...');
    await this.initTauriProject(srcDir);

    // Customizar tauri.conf.json
    const tauriConfPath = path.join(srcDir, 'src-tauri', 'tauri.conf.json');
    if (fs.existsSync(tauriConfPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
        config.productName = this.displayName;
        config.identifier = `com.webappgen.${this.packageName}`;
        
        // Remove build hooks desnecessários para app estático
        if (config.build) {
          delete config.build.beforeDevCommand;
          delete config.build.beforeBuildCommand;
        }

        // Configura janela principal para carregar o site web diretamente
        if (config.app && config.app.windows && config.app.windows[0]) {
          config.app.windows[0].title = this.displayName;
          config.app.windows[0].url = this.url;
        }

        fs.writeFileSync(tauriConfPath, JSON.stringify(config, null, 2), 'utf8');
      } catch (err) {
        this.log(`Aviso ao ajustar tauri.conf.json: ${err.message}`, 'tip');
      }
    }

    // Copiar ícone se disponível
    if (iconPath && fs.existsSync(iconPath)) {
      try {
        const iconsDir = path.join(srcDir, 'src-tauri', 'icons');
        if (fs.existsSync(iconsDir)) {
          fs.copyFileSync(iconPath, path.join(iconsDir, 'icon.png'));
        }
      } catch (_) {}
    }

    this.updateProgress(60, 'Executando compilação do pacote nativo Tauri...');
    await this.runTauriBuilder(srcDir, distDir);
  }

  async resolveTauriCli() {
    const hasTauri = await this.checkToolExists('tauri');
    if (hasTauri) {
      return process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
    }
    const hasNpx = await this.checkToolExists('npx');
    if (hasNpx) {
      return process.platform === 'win32' ? 'npx.cmd' : 'npx';
    }
    return null;
  }

  checkToolExists(cmd) {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const checkTool = isWin ? 'where.exe' : 'which';
      const child = spawn(checkTool, [cmd], { shell: true, stdio: 'ignore' });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  async initTauriProject(srcDir) {
    const cli = await this.resolveTauriCli();
    if (!cli) {
      throw new Error('Tauri CLI ou npx não foram encontrados no ambiente.');
    }

    const isNpx = cli.startsWith('npx');
    const baseArgs = isNpx ? ['@tauri-apps/cli', 'init'] : ['init'];
    const args = [
      ...baseArgs,
      '--force',
      '--app-name', this.packageName,
      '--window-title', this.displayName,
      '--frontend-dist', '../dist-web',
      '--ci'
    ];

    this.log(`Inicializando projeto: ${cli} ${args.join(' ')}`, 'info');

    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const child = spawn(cli, args, {
        cwd: srcDir,
        shell: true,
        env: {
          ...process.env,
          PATH: (process.env.PATH || '') + (isWin ? '' : ':/usr/local/cargo/bin')
        }
      });

      child.stdout.on('data', (d) => {
        const text = d.toString().trim();
        if (text) this.log(text, 'stdout');
      });
      child.stderr.on('data', (d) => {
        const text = d.toString().trim();
        if (text) this.log(text, 'stderr');
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Falha ao inicializar projeto Tauri (código ${code})`));
      });
      child.on('error', (err) => reject(err));
    });
  }

  async runTauriBuilder(srcDir, distDir) {
    const cli = await this.resolveTauriCli();
    if (!cli) {
      throw new Error('Tauri CLI não encontrado no ambiente.');
    }

    const isNpx = cli.startsWith('npx');
    const baseArgs = isNpx ? ['@tauri-apps/cli', 'build'] : ['build'];
    const args = [...baseArgs];

    if (this.format === 'deb') {
      args.push('--bundles', 'deb');
    } else if (this.format === 'AppImage') {
      args.push('--bundles', 'appimage');
    } else if (this.format === 'rpm') {
      args.push('--bundles', 'rpm');
    } else if (this.format === 'dmg') {
      args.push('--bundles', 'dmg');
    }

    this.log(`Executando: ${cli} ${args.join(' ')}`, 'info');

    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const child = spawn(cli, args, {
        cwd: srcDir,
        shell: true,
        env: {
          ...process.env,
          CARGO_HOME: process.env.CARGO_HOME || (isWin ? undefined : '/usr/local/cargo'),
          RUSTUP_HOME: process.env.RUSTUP_HOME || (isWin ? undefined : '/usr/local/rustup'),
          PATH: (process.env.PATH || '') + (isWin ? '' : ':/usr/local/cargo/bin')
        }
      });

      let simulatedProgress = 60;

      child.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (const line of lines) {
          this.log(line, 'stdout');
          if (simulatedProgress < 92) {
            simulatedProgress += 1;
            this.updateProgress(simulatedProgress);
          }
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (const line of lines) {
          this.log(line, 'stderr');
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          // Copiar arquivos compilados da pasta bundle para distDir
          const bundleDir = path.join(srcDir, 'src-tauri', 'target', 'release', 'bundle');
          copyBundleFilesToDist(bundleDir, distDir);
          resolve();
        } else {
          reject(new Error(`O compilador Tauri encerrou com código de saída ${code}`));
        }
      });

      child.on('error', (err) => reject(err));
    });
  }

  async buildCapacitor(srcDir, distDir, iconPath) {
    this.updateProgress(30, 'Injetando templates e configurações do Capacitor...');

    // 1. Criar diretório www com página de fallback e redirecionamento
    const webDir = path.join(srcDir, 'www');
    fs.mkdirSync(webDir, { recursive: true });

    let tvScriptTag = '';
    if (this.format === 'androidtv') {
      const tvTemplate = path.join(__dirname, 'templates', 'tv-controller.js');
      if (fs.existsSync(tvTemplate)) {
        fs.copyFileSync(tvTemplate, path.join(webDir, 'tv-controller.js'));
        tvScriptTag = '  <script src="tv-controller.js"></script>\n';
      }
    }

    const htmlFallback = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${this.displayName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: #0f172a;
      color: #fff;
      text-align: center;
      padding: 24px;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(255, 255, 255, 0.15);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 20px;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }
    h1 { font-size: 1.35rem; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 0.9rem; color: #94a3b8; }
  </style>
${tvScriptTag}  <script>
    window.location.replace(${JSON.stringify(this.url)});
  </script>
</head>
<body>
  <div class="spinner"></div>
  <h1>${this.displayName}</h1>
  <p>Conectando ao aplicativo web...</p>
</body>
</html>`;

    fs.writeFileSync(path.join(webDir, 'index.html'), htmlFallback, 'utf8');

    // 2. Configurações do Capacitor e identificador de pacote Android válido
    const rawId = this.packageName.replace(/[^a-zA-Z0-9_]/g, '');
    const safePackageId = 'com.webappgen.' + (rawId || 'app');

    const capConfig = {
      appId: safePackageId,
      appName: this.displayName,
      webDir: 'www',
      server: {
        url: this.url,
        cleartext: true
      },
      android: {
        allowMixedContent: true
      }
    };

    fs.writeFileSync(
      path.join(srcDir, 'capacitor.config.json'),
      JSON.stringify(capConfig, null, 2),
      'utf8'
    );

    const appPackage = {
      name: this.packageName,
      version: '1.0.0',
      description: `Aplicativo Android para ${this.url}`,
      private: true,
      dependencies: {
        '@capacitor/core': '^6.2.0',
        '@capacitor/android': '^6.2.0'
      }
    };

    fs.writeFileSync(
      path.join(srcDir, 'package.json'),
      JSON.stringify(appPackage, null, 2),
      'utf8'
    );

    // 3. Inicializar / sincronizar plataforma Android
    this.updateProgress(45, 'Adicionando estrutura nativa Android com Capacitor...');
    await this.initCapacitorAndroid(srcDir);

    // 4. Copiar e redimensionar ícones se disponíveis
    if (iconPath && fs.existsSync(iconPath)) {
      await this.applyAndroidIcons(srcDir, iconPath);
    }

    // Se for formato Android TV, aplicar customizações adicionais (Banner 16:9, Manifest e suporte a Controle/Joystick)
    if (this.format === 'androidtv') {
      await this.applyAndroidTvModifications(srcDir, iconPath);
    }

    // 5. Compilar APK com Gradle
    this.updateProgress(65, 'Compilando APK Android com Gradle wrapper...');
    await this.runGradleAssemble(srcDir, distDir);
  }

  async applyAndroidTvModifications(srcDir, iconPath) {
    this.updateProgress(50, 'Configurando suporte nativo a Android TV (Banner, Controle e Joystick)...');
    const androidDir = path.join(srcDir, 'android');
    const resDir = path.join(androidDir, 'app', 'src', 'main', 'res');
    const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
    const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets');
    const tvControllerTemplate = path.join(__dirname, 'templates', 'tv-controller.js');

    // 1. Gerar Banners do Android TV com o ícone indicado
    try {
      if (fs.existsSync(resDir)) {
        await generateAllAndroidTvBanners(resDir, iconPath);
        this.log('Banners Android TV (16:9) gerados com sucesso nas pastas de recursos.', 'info');
      }
    } catch (err) {
      this.log(`Aviso ao gerar banner Android TV: ${err.message}`, 'tip');
    }

    // 2. Copiar script do controlador de TV para assets nativos e www
    try {
      const publicAssetsDir = path.join(assetsDir, 'public');
      fs.mkdirSync(publicAssetsDir, { recursive: true });
      if (fs.existsSync(tvControllerTemplate)) {
        fs.copyFileSync(tvControllerTemplate, path.join(assetsDir, 'tv-controller.js'));
        fs.copyFileSync(tvControllerTemplate, path.join(publicAssetsDir, 'tv-controller.js'));
        const webDir = path.join(srcDir, 'www');
        if (fs.existsSync(webDir)) {
          fs.copyFileSync(tvControllerTemplate, path.join(webDir, 'tv-controller.js'));
        }
        this.log('Módulo de controle para TV e Joystick copiado para os assets.', 'info');
      }
    } catch (err) {
      this.log(`Aviso ao copiar script tv-controller: ${err.message}`, 'tip');
    }

    // 3. Modificar AndroidManifest.xml
    try {
      if (fs.existsSync(manifestPath)) {
        let manifestContent = fs.readFileSync(manifestPath, 'utf8');

        // Adicionar features de TV antes de <application
        const tvFeatures = `
    <!-- Recursos e compatibilidade com Android TV / Smart TV / Joystick -->
    <uses-feature android:name="android.software.leanback" android:required="false" />
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
    <uses-feature android:name="android.hardware.gamepad" android:required="false" />
    <uses-feature android:name="android.hardware.faketouch" android:required="false" />
`;
        if (!manifestContent.includes('android.software.leanback')) {
          manifestContent = manifestContent.replace('<application', `${tvFeatures}\n    <application`);
        }

        // Adicionar android:banner="@drawable/banner" ao <application
        if (!manifestContent.includes('android:banner=')) {
          manifestContent = manifestContent.replace('<application', '<application\n        android:banner="@drawable/banner"');
        }

        // Configurar activity para landscape
        if (!manifestContent.includes('android:screenOrientation=')) {
          manifestContent = manifestContent.replace('<activity', '<activity\n            android:screenOrientation="sensorLandscape"');
        }

        // Adicionar categoria LEANBACK_LAUNCHER
        if (!manifestContent.includes('android.intent.category.LEANBACK_LAUNCHER')) {
          const leanbackIntentFilter = `
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>`;
          manifestContent = manifestContent.replace('</intent-filter>', `</intent-filter>\n${leanbackIntentFilter}`);
        }

        fs.writeFileSync(manifestPath, manifestContent, 'utf8');
        this.log('AndroidManifest.xml adaptado para Android TV (Leanback launcher, banner e orientação).', 'info');
      }
    } catch (err) {
      this.log(`Aviso ao atualizar AndroidManifest.xml: ${err.message}`, 'tip');
    }

    // 4. Adaptar MainActivity.java para foco no WebView, navegação e injeção do controlador
    try {
      const javaDir = path.join(androidDir, 'app', 'src', 'main', 'java');
      const mainActivityPath = this.findMainActivityFile(javaDir);

      if (mainActivityPath && fs.existsSync(mainActivityPath)) {
        let activityContent = fs.readFileSync(mainActivityPath, 'utf8');
        const packageMatch = activityContent.match(/package\s+([^;]+);/);
        const pkgName = packageMatch ? packageMatch[1] : 'com.webappgen.app';

        const updatedActivity = `package ${pkgName};

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Habilita foco no WebView para controle remoto
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
            webView.requestFocus();
        }

        // Listener para injetar script de controle remoto e joystick em todas as páginas
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView loadedView) {
                    injectTvController(loadedView);
                }
            });
        }
    }

    private void injectTvController(WebView targetWebView) {
        if (targetWebView == null) return;
        try {
            InputStream is = null;
            try {
                is = getAssets().open("public/tv-controller.js");
            } catch (Exception ex) {
                is = getAssets().open("tv-controller.js");
            }
            if (is != null) {
                byte[] buffer = new byte[is.available()];
                is.read(buffer);
                is.close();
                String script = new String(buffer, "UTF-8");
                targetWebView.evaluateJavascript(script, null);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Navegação amigável de retorno com o controle remoto
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_DOWN) {
            WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            if (wv != null && wv.canGoBack()) {
                wv.goBack();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
`;
        fs.writeFileSync(mainActivityPath, updatedActivity, 'utf8');
        this.log('MainActivity.java otimizado com suporte nativo a controle remoto, back navigation e joystick.', 'info');
      }
    } catch (err) {
      this.log(`Aviso ao atualizar MainActivity.java: ${err.message}`, 'tip');
    }
  }

  findMainActivityFile(dir) {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = this.findMainActivityFile(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name === 'MainActivity.java') {
        return fullPath;
      }
    }
    return null;
  }

  async initCapacitorAndroid(srcDir) {
    const isWin = process.platform === 'win32';
    const npxCmd = isWin ? 'npx.cmd' : 'npx';
    const androidDir = path.join(srcDir, 'android');
    const action = fs.existsSync(androidDir) ? 'sync' : 'add';

    this.log(`Executando Capacitor CLI: ${npxCmd} cap ${action} android`, 'info');

    return new Promise((resolve, reject) => {
      const child = spawn(npxCmd, ['cap', action, 'android'], {
        cwd: srcDir,
        shell: true,
        env: {
          ...process.env
        }
      });

      child.stdout.on('data', (d) => {
        const text = d.toString().trim();
        if (text) {
          text.split(/\r?\n/).forEach(line => this.log(line, 'stdout'));
        }
      });

      child.stderr.on('data', (d) => {
        const text = d.toString().trim();
        if (text) {
          text.split(/\r?\n/).forEach(line => this.log(line, 'stderr'));
        }
      });

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Capacitor CLI (${action} android) encerrou com código de saída ${code}`));
      });

      child.on('error', (err) => reject(err));
    });
  }

  async applyAndroidIcons(srcDir, iconPath) {
    const resDir = path.join(srcDir, 'android', 'app', 'src', 'main', 'res');
    if (!fs.existsSync(resDir)) return;

    const iconSizes = [
      { folder: 'mipmap-mdpi', size: 48 },
      { folder: 'mipmap-hdpi', size: 72 },
      { folder: 'mipmap-xhdpi', size: 96 },
      { folder: 'mipmap-xxhdpi', size: 144 },
      { folder: 'mipmap-xxxhdpi', size: 192 }
    ];

    try {
      for (const item of iconSizes) {
        const folderPath = path.join(resDir, item.folder);
        if (fs.existsSync(folderPath)) {
          const destFile = path.join(folderPath, 'ic_launcher.png');
          const destRound = path.join(folderPath, 'ic_launcher_round.png');
          const destForeground = path.join(folderPath, 'ic_launcher_foreground.png');

          await sharp(iconPath)
            .resize(item.size, item.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(destFile);

          if (fs.existsSync(destRound)) {
            fs.copyFileSync(destFile, destRound);
          }
          if (fs.existsSync(destForeground)) {
            fs.copyFileSync(destFile, destForeground);
          }
        }
      }
      this.log('Ícones Android adaptados com sucesso para múltiplas densidades de tela.', 'info');
    } catch (err) {
      this.log(`Aviso ao ajustar ícones do Android: ${err.message}`, 'tip');
    }
  }

  async runGradleAssemble(srcDir, distDir) {
    const isWin = process.platform === 'win32';
    const androidDir = path.join(srcDir, 'android');
    const gradlewScript = isWin ? 'gradlew.bat' : './gradlew';

    if (!isWin) {
      try {
        fs.chmodSync(path.join(androidDir, 'gradlew'), '755');
      } catch (_) {}
    }

    this.log(`Executando compilação do APK: ${gradlewScript} assembleDebug`, 'info');

    return new Promise((resolve, reject) => {
      const child = spawn(gradlewScript, ['assembleDebug'], {
        cwd: androidDir,
        shell: true,
        env: {
          ...process.env,
          JAVA_HOME: process.env.JAVA_HOME || (isWin ? undefined : '/usr/lib/jvm/java-17-openjdk'),
          ANDROID_HOME: process.env.ANDROID_HOME || (isWin ? undefined : '/opt/android-sdk'),
          ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || (isWin ? undefined : '/opt/android-sdk')
        }
      });

      let simulatedProgress = 65;

      child.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (const line of lines) {
          this.log(line, 'stdout');
          if (simulatedProgress < 92) {
            simulatedProgress += 1;
            this.updateProgress(simulatedProgress);
          }
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (const line of lines) {
          this.log(line, 'stderr');
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          const apkFound = this.copyGeneratedApk(androidDir, distDir);
          if (apkFound) {
            resolve();
          } else {
            reject(new Error('A compilação do Gradle concluiu com sucesso, mas o arquivo APK não foi encontrado.'));
          }
        } else {
          reject(new Error(`O Gradle encerrou a compilação com código de saída ${code}`));
        }
      });

      child.on('error', (err) => reject(err));
    });
  }

  copyGeneratedApk(androidDir, distDir) {
    const apkBaseDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk');
    if (!fs.existsSync(apkBaseDir)) return false;

    let foundApk = null;

    function scanForApk(currentDir) {
      if (foundApk) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          scanForApk(full);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.apk')) {
          foundApk = full;
          return;
        }
      }
    }

    scanForApk(apkBaseDir);

    if (foundApk) {
      const suffix = this.format === 'androidtv' ? '_AndroidTV' : '';
      const targetName = `${this.displayName.replace(/[^a-zA-Z0-9_-]/g, '_')}${suffix}.apk`;
      const targetPath = path.join(distDir, targetName);
      fs.copyFileSync(foundApk, targetPath);
      this.log(`APK copiado para o diretório de download: ${targetName}`, 'info');
      return true;
    }

    return false;
  }

  getTargetConfig() {
    const iconFile = 'icon.png';

    switch (this.format) {
      case 'exe':
        return {
          win: {
            target: ['portable'],
            icon: iconFile
          },
          portable: {
            artifactName: '${productName}-${version}-Portable.${ext}'
          }
        };
      case 'dmg':
        return {
          mac: {
            target: ['dmg'],
            category: 'public.app-category.utilities',
            icon: iconFile
          },
          dmg: {
            artifactName: '${productName}-${version}.${ext}'
          }
        };
      case 'AppImage':
        return {
          linux: {
            target: ['AppImage'],
            category: 'Network',
            icon: iconFile
          },
          appImage: {
            artifactName: '${productName}-${version}.${ext}'
          }
        };
      case 'deb':
        return {
          linux: {
            target: ['deb'],
            category: 'Network',
            icon: iconFile
          },
          deb: {
            artifactName: '${productName}_${version}_amd64.${ext}'
          }
        };
      case 'rpm':
        return {
          linux: {
            target: ['rpm'],
            category: 'Network',
            icon: iconFile
          },
          rpm: {
            artifactName: '${productName}-${version}.x86_64.${ext}'
          }
        };
      default:
        throw new Error(`Formato desconhecido: ${this.format}`);
    }
  }

  runElectronBuilder(srcDir) {
    return new Promise((resolve, reject) => {
      // Find electron-builder cli script
      const builderCli = path.resolve(__dirname, '..', 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

      const args = [
        builderCli,
        'build',
        '--project', srcDir,
        '-c.electronVersion=33.2.1',
        '--x64'
      ];

      // Format-specific flags
      if (this.format === 'exe') {
        args.push('--win', 'portable');
      } else if (this.format === 'AppImage') {
        args.push('--linux', 'AppImage');
      } else if (this.format === 'deb') {
        args.push('--linux', 'deb');
      } else if (this.format === 'rpm') {
        args.push('--linux', 'rpm');
      } else if (this.format === 'dmg') {
        args.push('--mac', 'dmg');
      }

      this.log(`Comando: node ${path.basename(builderCli)} ${args.slice(1).join(' ')}`, 'info');

      const child = spawn(process.execPath, args, {
        cwd: srcDir,
        env: {
          ...process.env,
          // electron-builder configs
          ELECTRON_BUILDER_CACHE: path.resolve(__dirname, '..', '.electron-cache'),
          USE_SYSTEM_XORRISO: 'true'
        }
      });

      let simulatedProgress = 65;

      child.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (const line of lines) {
          this.log(line, 'stdout');
          // Bump progress smoothly on events
          if (simulatedProgress < 90) {
            simulatedProgress += 1;
            this.updateProgress(simulatedProgress);
          }
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (const line of lines) {
          this.log(line, 'stderr');
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`O Electron-Builder encerrou com código de saída ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  findArtifact(distDir) {
    if (!fs.existsSync(distDir)) return null;

    const files = fs.readdirSync(distDir);
    const extMap = {
      apk: ['.apk'],
      androidtv: ['.apk'],
      exe: ['.exe', '.msi'],
      dmg: ['.dmg'],
      AppImage: ['.appimage'],
      deb: ['.deb'],
      rpm: ['.rpm']
    };

    const targetExts = extMap[this.format] || ['.apk', '.exe', '.msi', '.dmg', '.appimage', '.deb', '.rpm'];

    for (const file of files) {
      const lower = file.toLowerCase();
      // Ignore blockmaps and builder internal files
      if (lower.endsWith('.blockmap') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
        continue;
      }
      for (const ext of targetExts) {
        if (lower.endsWith(ext)) {
          const filePath = path.join(distDir, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            path: filePath,
            size: stats.size,
            formattedSize: formatBytes(stats.size),
            downloadUrl: `/api/download/${this.id}`
          };
        }
      }
    }

    return null;
  }
}

function createBuild(data) {
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
  const job = new BuildJob(id, data);
  builds.set(id, job);
  // Asynchronously trigger execution
  setTimeout(() => job.start(), 100);
  return job;
}

function getBuild(id) {
  return builds.get(id) || null;
}

function listRecentBuilds() {
  const result = [];
  for (const [id, job] of builds.entries()) {
    result.push({
      id,
      url: job.url,
      framework: job.framework,
      format: job.format,
      displayName: job.displayName,
      appTitle: job.appTitle,
      status: job.status,
      progress: job.progress,
      artifact: job.artifact,
      createdAt: job.createdAt
    });
  }
  return result.reverse().slice(0, 10);
}

module.exports = {
  createBuild,
  getBuild,
  listRecentBuilds
};
