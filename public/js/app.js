// WebAppGen Client Application Controller
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const form = document.getElementById('builder-form');
  const urlInput = document.getElementById('url-input');
  const frameworkSelect = document.getElementById('framework-select');
  const formatSelect = document.getElementById('format-select');
  const appTitleInput = document.getElementById('app-title-input');
  const customNameInput = document.getElementById('custom-name-input');
  const btnAutoTitle = document.getElementById('btn-auto-title');
  const btnAutoName = document.getElementById('btn-auto-name');
  const btnAutoIcon = document.getElementById('btn-auto-icon');
  const iconFileInput = document.getElementById('icon-file-input');
  const iconPreviewImg = document.getElementById('icon-preview-img');
  const iconSourceBadge = document.getElementById('icon-source-badge');
  const iconFileName = document.getElementById('icon-file-name');
  const btnResetIcon = document.getElementById('btn-reset-icon');
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
  let currentIconData = null;
  let cachedMetadata = { url: null, data: null };

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
      if (appTitleInput && chip.dataset.title) {
        appTitleInput.value = chip.dataset.title;
      }
      cachedMetadata = { url: null, data: null };
      urlInput.focus();
    });
  });

  // Helper to format file sizes
  function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  // Helper to fetch or use cached site metadata
  async function fetchSiteInfo(targetUrl) {
    let cleanUrl = targetUrl.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }

    if (cachedMetadata.url === cleanUrl && cachedMetadata.data) {
      return cachedMetadata.data;
    }

    const res = await fetch('/api/site-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cleanUrl })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Não foi possível extrair metadados do site.');
    }

    const data = await res.json();
    cachedMetadata = { url: cleanUrl, data };
    return data;
  }

  // Reset icon to default holograph icon
  function resetIcon() {
    currentIconData = null;
    if (iconPreviewImg) iconPreviewImg.src = 'assets/icon.png';
    if (iconSourceBadge) {
      iconSourceBadge.textContent = 'Padrão';
      iconSourceBadge.className = 'icon-source-badge';
    }
    if (iconFileName) iconFileName.textContent = 'Nenhum arquivo customizado';
    if (iconFileInput) iconFileInput.value = '';
    if (btnResetIcon) btnResetIcon.classList.add('hidden');
  }

  if (btnResetIcon) {
    btnResetIcon.addEventListener('click', resetIcon);
  }

  // Handle local icon file selection
  if (iconFileInput) {
    iconFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        alert('Por favor, selecione um arquivo de imagem válido (PNG, ICO, SVG, JPG, WebP).');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        currentIconData = event.target.result;
        if (iconPreviewImg) iconPreviewImg.src = currentIconData;
        if (iconSourceBadge) {
          iconSourceBadge.textContent = 'Arquivo';
          iconSourceBadge.className = 'icon-source-badge custom';
        }
        if (iconFileName) {
          iconFileName.textContent = `${file.name} (${formatBytes(file.size)})`;
        }
        if (btnResetIcon) btnResetIcon.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });
  }

  // Trigger flash animation on button
  function flashButton(btn, isSuccess = true) {
    btn.classList.remove('loading');
    if (isSuccess) {
      btn.classList.add('success');
      setTimeout(() => btn.classList.remove('success'), 1800);
    }
  }

  // Button: Auto Título (from page <title>)
  if (btnAutoTitle) {
    btnAutoTitle.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) {
        urlInput.focus();
        alert('Por favor, digite a URL do website primeiro.');
        return;
      }

      btnAutoTitle.classList.add('loading');
      btnAutoTitle.disabled = true;

      try {
        const data = await fetchSiteInfo(url);
        if (data.title && appTitleInput) {
          appTitleInput.value = data.title;
        }
        // If app name is currently empty, conveniently populate it with compact name too
        if (customNameInput && !customNameInput.value.trim() && data.compactName) {
          customNameInput.value = data.compactName;
        }
        flashButton(btnAutoTitle, true);
      } catch (err) {
        btnAutoTitle.classList.remove('loading');
        alert(err.message || 'Erro ao obter título do site.');
      } finally {
        btnAutoTitle.disabled = false;
      }
    });
  }

  // Button: Auto Nome (compact version of the title)
  if (btnAutoName) {
    btnAutoName.addEventListener('click', async () => {
      // If title is already filled in, derive compact version immediately
      const currentTitle = appTitleInput ? appTitleInput.value.trim() : '';
      const url = urlInput.value.trim();

      if (!currentTitle && !url) {
        urlInput.focus();
        alert('Por favor, digite a URL ou o título do aplicativo primeiro.');
        return;
      }

      btnAutoName.classList.add('loading');
      btnAutoName.disabled = true;

      try {
        if (url) {
          const data = await fetchSiteInfo(url);
          // If user modified the title, use derived compact or data compact
          if (customNameInput) {
            customNameInput.value = data.compactName || 'WebApp';
          }
        } else if (currentTitle) {
          // Quick fallback if only title is typed
          const simpleCompact = currentTitle.split(/[-|—–·:•\/]/)[0].trim().substring(0, 25);
          if (customNameInput) customNameInput.value = simpleCompact;
        }
        flashButton(btnAutoName, true);
      } catch (err) {
        btnAutoName.classList.remove('loading');
        alert(err.message || 'Erro ao gerar nome compacto.');
      } finally {
        btnAutoName.disabled = false;
      }
    });
  }

  // Button: Auto Ícone (Favicon from website)
  if (btnAutoIcon) {
    btnAutoIcon.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) {
        urlInput.focus();
        alert('Por favor, digite a URL do website primeiro.');
        return;
      }

      btnAutoIcon.classList.add('loading');
      btnAutoIcon.disabled = true;

      try {
        const data = await fetchSiteInfo(url);
        if (data.iconData) {
          currentIconData = data.iconData;
          if (iconPreviewImg) iconPreviewImg.src = data.iconData;
          if (iconSourceBadge) {
            iconSourceBadge.textContent = 'Favicon Site';
            iconSourceBadge.className = 'icon-source-badge site';
          }
          if (iconFileName) iconFileName.textContent = 'Favicon extraído do website';
          if (btnResetIcon) btnResetIcon.classList.remove('hidden');
          flashButton(btnAutoIcon, true);
        } else {
          btnAutoIcon.classList.remove('loading');
          alert('Nenhum favicon específico foi encontrado no website. Será utilizado o ícone padrão.');
        }
      } catch (err) {
        btnAutoIcon.classList.remove('loading');
        alert(err.message || 'Erro ao buscar favicon do site.');
      } finally {
        btnAutoIcon.disabled = false;
      }
    });
  }

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
    const customName = customNameInput ? customNameInput.value.trim() : '';
    const appTitle = appTitleInput ? appTitleInput.value.trim() : '';
    const iconData = currentIconData;

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
        body: JSON.stringify({ 
          url, 
          framework, 
          format, 
          customName: customName || null,
          appTitle: appTitle || null,
          iconData: iconData || null
        })
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
