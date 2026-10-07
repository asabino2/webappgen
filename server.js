const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { createBuild, getBuild, listRecentBuilds } = require('./lib/builder');
const { fetchSiteMetadata } = require('./lib/icon-helper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Extract site metadata (page title, compact name, favicon)
app.post('/api/site-metadata', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Uma URL válida é obrigatória.' });
  }

  try {
    const data = await fetchSiteMetadata(url);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao extrair metadados do website.' });
  }
});

app.get('/api/site-metadata', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Uma URL válida é obrigatória.' });
  }

  try {
    const data = await fetchSiteMetadata(url);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao extrair metadados do website.' });
  }
});

// Create build request
app.post('/api/build', (req, res) => {
  const { url, format, framework, customName, appTitle, iconData } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Uma URL válida é obrigatória.' });
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  try {
    new URL(normalizedUrl);
  } catch (_) {
    return res.status(400).json({ error: 'A URL informada possui formato inválido.' });
  }

  const validFormats = ['exe', 'dmg', 'AppImage', 'deb', 'rpm', 'apk', 'androidtv'];
  if (!format || !validFormats.includes(format)) {
    return res.status(400).json({ 
      error: `Formato inválido. Os formatos suportados são: ${validFormats.join(', ')}` 
    });
  }

  const validFrameworks = ['electron', 'tauri', 'capacitor'];
  const selectedFramework = framework && validFrameworks.includes(framework) ? framework : 'electron';

  if (selectedFramework === 'capacitor' && !['apk', 'androidtv'].includes(format)) {
    return res.status(400).json({
      error: 'Para o framework Capacitor, os formatos disponíveis são APK Android Mobile (apk) e Android TV (androidtv).'
    });
  }

  if (selectedFramework !== 'capacitor' && ['apk', 'androidtv'].includes(format)) {
    return res.status(400).json({
      error: 'Os formatos APK Android (apk) e Android TV (androidtv) estão disponíveis exclusivamente para o framework Capacitor.'
    });
  }

  const job = createBuild({
    url: normalizedUrl,
    framework: selectedFramework,
    format,
    customName: customName ? customName.trim() : null,
    appTitle: appTitle ? appTitle.trim() : null,
    iconData: iconData && typeof iconData === 'string' && iconData.length > 50 ? iconData : null
  });

  res.json({
    success: true,
    buildId: job.id,
    displayName: job.displayName,
    appTitle: job.appTitle,
    framework: job.framework,
    format: job.format,
    url: job.url
  });
});

// SSE endpoint for live logs and progress updates
app.get('/api/build/:id/events', (req, res) => {
  const job = getBuild(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Build não encontrado' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial snapshot
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('init', {
    id: job.id,
    status: job.status,
    progress: job.progress,
    displayName: job.displayName,
    framework: job.framework,
    format: job.format,
    logs: job.logs,
    artifact: job.artifact,
    error: job.error
  });

  // Listeners
  const onLog = (logItem) => sendEvent('log', logItem);
  const onProgress = (data) => sendEvent('progress', data);
  const onComplete = (data) => sendEvent('complete', data);
  const onError = (data) => sendEvent('build_error', data);

  job.on('log', onLog);
  job.on('progress', onProgress);
  job.on('complete', onComplete);
  job.on('error', onError);

  // Keep-alive ping every 15 seconds
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    job.removeListener('log', onLog);
    job.removeListener('progress', onProgress);
    job.removeListener('complete', onComplete);
    job.removeListener('error', onError);
  });
});

// Download endpoint
app.get('/api/download/:id', (req, res) => {
  const job = getBuild(req.params.id);
  if (!job || !job.artifact || !fs.existsSync(job.artifact.path)) {
    return res.status(404).send('Arquivo para download não encontrado ou ainda em compilação.');
  }

  res.download(job.artifact.path, job.artifact.filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).send('Erro ao realizar o download do arquivo.');
    }
  });
});

// Get status
app.get('/api/build/:id', (req, res) => {
  const job = getBuild(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Build não encontrado' });
  }
  res.json({
    id: job.id,
    url: job.url,
    framework: job.framework,
    format: job.format,
    displayName: job.displayName,
    status: job.status,
    progress: job.progress,
    artifact: job.artifact,
    error: job.error,
    createdAt: job.createdAt
  });
});

// List recent builds
app.get('/api/builds', (req, res) => {
  res.json(listRecentBuilds());
});

// Environment info
app.get('/api/info', (req, res) => {
  res.json({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    inDocker: fs.existsSync('/.dockerenv')
  });
});

// Fallback to SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 WebAppGen Server operacional em: http://localhost:${PORT}`);
  console.log(`💻 Plataforma: ${process.platform} (${process.arch})`);
});
