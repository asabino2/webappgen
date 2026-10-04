const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { resolveAppIcon } = require('./icon-helper');

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
  constructor(id, { url, format, framework, customName }) {
    super();
    this.id = id;
    this.url = url;
    this.format = format; // 'exe', 'AppImage', 'deb', 'rpm'
    this.framework = framework === 'tauri' ? 'tauri' : 'electron';
    this.displayName = getDisplayName(url, customName);
    this.packageName = sanitizeName(this.displayName);
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
    const fwLabel = this.framework === 'tauri' ? 'Tauri (Rust)' : 'Electron';
    this.updateProgress(5, `Iniciando geração para ${this.displayName} via ${fwLabel}...`);

    try {
      // 1. Create workspace directories
      const srcDir = path.join(this.workDir, 'src');
      const distDir = path.join(this.workDir, 'dist');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });

      // 2. Resolve application icon
      this.updateProgress(20, 'Buscando ícone de alta resolução do website...');
      const iconPath = path.join(srcDir, 'icon.png');
      const iconResult = await resolveAppIcon(this.url, iconPath);
      if (iconResult.success) {
        this.log(`Ícone obtido com sucesso via [${iconResult.source}]`, 'info');
      } else {
        this.log('Usando ícone padrão holográfico.', 'info');
      }

      if (this.framework === 'tauri') {
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
    this.updateProgress(35, 'Injetando templates e configurações do Tauri (Rust)...');

    const tauriDir = path.join(srcDir, 'src-tauri');
    const tauriSrcDir = path.join(tauriDir, 'src');
    const tauriIconsDir = path.join(tauriDir, 'icons');
    const webDistDir = path.join(srcDir, 'dist-web');

    fs.mkdirSync(tauriSrcDir, { recursive: true });
    fs.mkdirSync(tauriIconsDir, { recursive: true });
    fs.mkdirSync(webDistDir, { recursive: true });

    // Copiar ícone se existir
    if (fs.existsSync(iconPath)) {
      try {
        fs.copyFileSync(iconPath, path.join(tauriIconsDir, 'icon.png'));
      } catch (_) {}
    }

    // Criar index.html estático fallback
    const htmlFallback = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.displayName}</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #fff; }
  </style>
</head>
<body>
  <p>Carregando ${this.displayName}...</p>
  <script>window.location.href = "${this.url}";</script>
</body>
</html>`;
    fs.writeFileSync(path.join(webDistDir, 'index.html'), htmlFallback, 'utf8');

    // Criar Cargo.toml
    const cargoToml = `[package]
name = "${this.packageName}"
version = "1.0.0"
description = "Aplicativo Desktop ${this.displayName} para ${this.url}"
edition = "2021"

[build-dependencies]
tauri-build = { version = "1.5", features = [] }

[dependencies]
tauri = { version = "1.5", features = [ "shell-open" ] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
`;
    fs.writeFileSync(path.join(tauriDir, 'Cargo.toml'), cargoToml, 'utf8');

    // Criar build.rs
    const buildRs = `fn main() {
  tauri_build::build()
}
`;
    fs.writeFileSync(path.join(tauriDir, 'build.rs'), buildRs, 'utf8');

    // Criar main.rs
    const mainRs = `// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
`;
    fs.writeFileSync(path.join(tauriSrcDir, 'main.rs'), mainRs, 'utf8');

    // Criar tauri.conf.json
    const tauriConfig = {
      "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/tooling/cli/schema.json",
      "build": {
        "distDir": "../dist-web",
        "devPath": this.url
      },
      "package": {
        "productName": this.displayName,
        "version": "1.0.0"
      },
      "tauri": {
        "windows": [
          {
            "title": this.displayName,
            "url": this.url,
            "width": 1280,
            "height": 800,
            "resizable": true,
            "fullscreen": false
          }
        ],
        "bundle": {
          "active": true,
          "targets": "all",
          "identifier": `com.webappgen.${this.packageName}`,
          "icon": ["icons/icon.png"]
        },
        "security": {
          "csp": null
        }
      }
    };
    fs.writeFileSync(path.join(tauriDir, 'tauri.conf.json'), JSON.stringify(tauriConfig, null, 2), 'utf8');

    this.log(`Estrutura do projeto Tauri configurada em: ${path.relative(process.cwd(), tauriDir)}`, 'info');
    this.updateProgress(50, 'Verificando toolchain Rust / Cargo no ambiente...');

    const hasCargo = await this.checkCargoAvailable();

    if (!hasCargo) {
      this.log('ℹ️ O compilador Rust (cargo) não foi detectado no PATH do ambiente.', 'tip');
      this.log('💡 Para compilar executáveis nativos com Tauri, instale a toolchain Rust oficial (https://rustup.rs).', 'tip');
      this.log(`📁 O código fonte Tauri completo foi preparado e está disponível em: ${tauriDir}`, 'info');
      throw new Error('Rust/Cargo não encontrado no sistema. Para compilar com Tauri, instale o Rust (https://rustup.rs) ou utilize o framework Electron (padrão).');
    }

    this.updateProgress(65, 'Executando compilação do pacote nativo Tauri...');
    await this.runTauriBuilder(tauriDir, distDir);
  }

  checkCargoAvailable() {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const checkTool = isWin ? 'where.exe' : 'which';
      const child = spawn(checkTool, ['cargo'], { shell: true, stdio: 'ignore' });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  runTauriBuilder(tauriDir, distDir) {
    return new Promise((resolve, reject) => {
      this.log('Executando cargo tauri build...', 'info');
      const isWin = process.platform === 'win32';
      const child = spawn(isWin ? 'cargo.exe' : 'cargo', ['tauri', 'build'], {
        cwd: tauriDir,
        shell: true,
        env: {
          ...process.env
        }
      });

      child.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (const line of lines) {
          this.log(line, 'stdout');
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
          const bundleDir = path.join(tauriDir, 'target', 'release', 'bundle');
          if (fs.existsSync(bundleDir)) {
            copyRecursiveSync(bundleDir, distDir);
          }
          resolve();
        } else {
          reject(new Error(`O compilador Tauri encerrou com código de saída ${code}`));
        }
      });

      child.on('error', (err) => reject(err));
    });
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
      exe: ['.exe', '.msi'],
      AppImage: ['.appimage'],
      deb: ['.deb'],
      rpm: ['.rpm']
    };

    const targetExts = extMap[this.format] || ['.exe', '.msi', '.appimage', '.deb', '.rpm'];

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
