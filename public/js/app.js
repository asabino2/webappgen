// WebAppGen Client Application Controller
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const form = document.getElementById('builder-form');
  const urlInput = document.getElementById('url-input');
  const frameworkSelect = document.getElementById('framework-select');
  const formatSelect = document.getElementById('format-select');
  const customNameInput = document.getElementById('custom-name-input');
  const generateBtn = document.getElementById('generate-btn');
  const btnSpinner = document.getElementById('btn-spinner');
  
  const statusBadge = document.getElementById('build-status-badge');
  const stageDesc = document.getElementById('stage-desc');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-percentage-label');
  
  const downloadSection = document.getElementById('download-section');
  const downloadAppName = document.getElementById('download-app-name');
  const downloadFilename = document.getElementById('download-filename');
  const downloadFilesize = document.getElementById('download-filesize');
  const downloadBtn = document.getElementById('download-btn');
  
  const terminalLogs = document.getElementById('terminal-logs');
  const copyLogBtn = document.getElementById('copy-log-btn');
  const clearLogBtn = document.getElementById('clear-log-btn');
  const historyList = document.getElementById('history-list');
  const envBadgeText = document.getElementById('env-text');

  let currentEventSource = null;
  let allLogLines = [];

  // 1. Fetch system info
  async function loadSystemInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const info = await res.json();
        const osLabel = info.inDocker 
          ? 'Ambiente Docker (Linux x64)' 
          : `${info.platform === 'win32' ? 'Windows' : info.platform} (${info.arch})`;
        envBadgeText.textContent = `Online • ${osLabel}`;
      }
    } catch (_) {
      envBadgeText.textContent = 'Servidor Conectado';
    }
  }

  // 2. Load recent builds
  async function loadRecentBuilds() {
    try {
      const res = await fetch('/api/builds');
      if (res.ok) {
        const builds = await res.json();
        renderHistory(builds);
      }
    } catch (_) {}
  }

  function renderHistory(builds) {
    if (!builds || builds.length === 0) {
      historyList.innerHTML = '<p class="text-muted empty-history">Nenhum aplicativo gerado ainda nesta sessão.</p>';
      return;
    }

    historyList.innerHTML = builds.map(b => {
      const isSuccess = b.status === 'success' && b.artifact;
      const downloadBtnHtml = isSuccess
        ? `<a href="${b.artifact.downloadUrl}" class="btn btn-success" style="padding: 0.4rem 0.9rem; font-size: 0.85rem;" download>Baixar (${b.artifact.formattedSize})</a>`
        : `<span class="status-badge ${b.status}">${b.status === 'failed' ? 'Falhou' : 'Processando'}</span>`;

      const fwName = b.framework === 'tauri'
        ? 'Tauri'
        : (b.framework === 'capacitor' ? 'Capacitor' : 'Electron');

      return `
        <div class="history-item">
          <div class="history-details">
            <span class="history-framework-tag ${b.framework || 'electron'}">${fwName}</span>
            <span class="history-format-tag">${b.format}</span>
            <div>
              <div class="history-name">${escapeHtml(b.displayName)}</div>
              <div class="history-url">${escapeHtml(b.url)}</div>
            </div>
          </div>
          <div>${downloadBtnHtml}</div>
        </div>
      `;
    }).join('');
  }

  // Synchronize format combobox based on selected framework
  const desktopFormatOptions = [
    { value: 'exe', label: '🪟 Windows Executável (.exe portátil)' },
    { value: 'AppImage', label: '🐧 Linux AppImage (.AppImage universal)' },
    { value: 'deb', label: '📦 Instalador Debian / Ubuntu (.deb)' },
    { value: 'rpm', label: '🎩 Instalador Fedora / RHEL (.rpm)' }
  ];

  const androidFormatOptions = [
    { value: 'apk', label: '🤖 APK Android (.apk instalador)' }
  ];

  function updateFormatOptions() {
    const selectedFramework = frameworkSelect.value;
    const currentVal = formatSelect.value;
    formatSelect.innerHTML = '';

    if (selectedFramework === 'capacitor') {
      androidFormatOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        option.selected = true;
        formatSelect.appendChild(option);
      });
    } else {
      desktopFormatOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === currentVal && currentVal !== 'apk') {
          option.selected = true;
        }
        formatSelect.appendChild(option);
      });

      if (!desktopFormatOptions.some(opt => opt.value === formatSelect.value)) {
        formatSelect.value = desktopFormatOptions[0].value;
      }
    }
  }

  if (frameworkSelect) {
    frameworkSelect.addEventListener('change', updateFormatOptions);
    updateFormatOptions();
  }

  // 3. Quick preset chips handler
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      urlInput.value = chip.dataset.url;
      customNameInput.value = chip.dataset.name;
      urlInput.focus();
    });
  });

  // 4. Log appender
  function appendLog(item) {
    allLogLines.push(`[${item.timestamp}] ${item.message}`);
    const line = document.createElement('div');
    line.className = `log-line ${item.type || 'info'}`;
    
    line.innerHTML = `
      <span class="log-time">${item.timestamp}</span>
      <span class="log-msg">${escapeHtml(item.message)}</span>
    `;

    terminalLogs.appendChild(line);
    // Auto-scroll to bottom
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  function clearLogs() {
    terminalLogs.innerHTML = '';
    allLogLines = [];
  }

  // 5. Update progress UI
  function setProgress(percentage, message = null) {
    const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
    progressFill.style.width = `${clamped}%`;
    progressLabel.textContent = `${clamped}%`;
    if (message) {
      stageDesc.textContent = message;
    }
  }

  function setStatus(status, text) {
    statusBadge.className = `status-badge ${status}`;
    statusBadge.textContent = text;
  }

  // 6. Handle Build Generation
  generateBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    const framework = (frameworkSelect && frameworkSelect.value) || 'electron';
    const format = formatSelect.value;
    const customName = customNameInput.value.trim();

    if (!url) {
      urlInput.focus();
      alert('Por favor, informe a URL do website para gerar o aplicativo.');
      return;
    }

    // Close any previous SSE stream
    if (currentEventSource) {
      currentEventSource.close();
      currentEventSource = null;
    }

    // Reset UI State
    generateBtn.disabled = true;
    btnSpinner.classList.remove('hidden');
    downloadSection.classList.add('hidden');
    clearLogs();
    setProgress(5, 'Enviando requisição de compilação...');
    setStatus('running', 'Compilando');

    try {
      const response = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, framework, format, customName })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao iniciar compilação.');
      }

      // Connect to SSE stream for live updates
      listenToBuildEvents(data.buildId);

    } catch (err) {
      generateBtn.disabled = false;
      btnSpinner.classList.add('hidden');
      setStatus('failed', 'Erro');
      setProgress(0, 'Falha ao iniciar processo.');
      appendLog({
        timestamp: new Date().toLocaleTimeString('pt-BR'),
        message: err.message,
        type: 'error'
      });
    }
  });

  // 7. Server-Sent Events listener
  function listenToBuildEvents(buildId) {
    const es = new EventSource(`/api/build/${buildId}/events`);
    currentEventSource = es;

    es.addEventListener('init', (e) => {
      const data = JSON.parse(e.data);
      if (data.logs && data.logs.length > 0) {
        data.logs.forEach(l => appendLog(l));
      }
      setProgress(data.progress || 5);
    });

    es.addEventListener('log', (e) => {
      const logItem = JSON.parse(e.data);
      appendLog(logItem);
    });

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      setProgress(data.progress, data.message);
    });

    es.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      es.close();
      currentEventSource = null;

      generateBtn.disabled = false;
      btnSpinner.classList.add('hidden');
      setProgress(100, 'Compilação concluída com sucesso!');
      setStatus('success', 'Concluído');

      // Populate download card
      if (data.artifact) {
        downloadAppName.textContent = `${data.artifact.filename}`;
        downloadFilename.textContent = data.artifact.filename;
        downloadFilesize.textContent = data.artifact.formattedSize;
        downloadBtn.href = data.artifact.downloadUrl;
        downloadBtn.setAttribute('download', data.artifact.filename);
        downloadSection.classList.remove('hidden');

        // Scroll download button smoothly into view
        downloadSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      loadRecentBuilds();
    });

    es.addEventListener('build_error', (e) => {
      const data = JSON.parse(e.data);
      es.close();
      currentEventSource = null;

      generateBtn.disabled = false;
      btnSpinner.classList.add('hidden');
      setStatus('failed', 'Falhou');
      stageDesc.textContent = 'A compilação encontrou um erro.';
      loadRecentBuilds();
    });

    es.onerror = () => {
      // EventSource will auto-reconnect or if closed
    };
  }

  // 8. Terminal tools
  copyLogBtn.addEventListener('click', async () => {
    if (allLogLines.length === 0) return;
    try {
      await navigator.clipboard.writeText(allLogLines.join('\n'));
      const originalText = copyLogBtn.querySelector('span').textContent;
      copyLogBtn.querySelector('span').textContent = 'Copiado!';
      setTimeout(() => {
        copyLogBtn.querySelector('span').textContent = originalText;
      }, 2000);
    } catch (_) {}
  });

  clearLogBtn.addEventListener('click', () => {
    clearLogs();
  });

  // Helpers
  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize
  loadSystemInfo();
  loadRecentBuilds();
});
