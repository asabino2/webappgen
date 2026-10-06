const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Normalizes relative URLs to absolute URLs using origin/base
 */
function resolveUrl(relativeOrAbsolute, baseUrl) {
  try {
    return new URL(relativeOrAbsolute, baseUrl).toString();
  } catch (_) {
    return null;
  }
}

/**
 * Scrapes HTML looking for <link rel="apple-touch-icon">, <link rel="icon">, etc.
 */
function extractIconsFromHtml(html, baseUrl) {
  const iconCandidates = [];
  const linkRegex = /<link\s+[^>]*rel=["']?([^"'>\s]+)[^>]*>/gi;
  const hrefRegex = /href=["']([^"']+)["']/i;
  const sizesRegex = /sizes=["']([^"']+)["']/i;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const rel = match[1].toLowerCase();

    if (rel.includes('icon')) {
      const hrefMatch = fullTag.match(hrefRegex);
      if (hrefMatch && hrefMatch[1]) {
        const fullUrl = resolveUrl(hrefMatch[1].trim(), baseUrl);
        if (fullUrl) {
          const sizesMatch = fullTag.match(sizesRegex);
          let priority = 10;
          
          if (rel.includes('apple-touch-icon')) {
            priority = 100; // Apple touch icons are usually high resolution (180x180 or 192x192)
          } else if (sizesMatch && sizesMatch[1]) {
            const size = parseInt(sizesMatch[1].split('x')[0], 10);
            priority = isNaN(size) ? 20 : size;
          }

          iconCandidates.push({ url: fullUrl, priority, rel });
        }
      }
    }
  }

  // Sort by highest priority / largest size first
  iconCandidates.sort((a, b) => b.priority - a.priority);
  return iconCandidates;
}

/**
 * Converts any image buffer (WebP, SVG, ICO, JPG, PNG) into a high-res 512x512 PNG
 */
async function processAndSavePng(imageBuffer, destinationFile) {
  try {
    await sharp(imageBuffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ quality: 100 })
      .toFile(destinationFile);
    return true;
  } catch (err) {
    // Sharp might fail if buffer is corrupt or HTML 404 page
    return false;
  }
}

/**
 * Downloads and prepares high-resolution icons (PNG and ICO) for the target web app.
 * @param {string} webUrl 
 * @param {string} destinationFile 
 */
async function resolveAppIcon(webUrl, destinationFile) {
  const fallbackIcon = path.join(__dirname, '..', 'assets', 'default.png');
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
  };

  try {
    const parsedUrl = new URL(webUrl);
    const domain = parsedUrl.hostname;
    const origin = parsedUrl.origin;

    // 1. Try to fetch the page HTML and extract explicit icon links
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(webUrl, { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const html = await res.text();
        const candidates = extractIconsFromHtml(html, webUrl);

        for (const candidate of candidates) {
          try {
            const imgRes = await fetch(candidate.url, { headers });
            if (imgRes.ok) {
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              if (buffer.length > 300) {
                const saved = await processAndSavePng(buffer, destinationFile);
                if (saved) {
                  return { success: true, source: `html_${candidate.rel}`, url: candidate.url };
                }
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    // 2. Try standard direct favicon locations on the origin
    const directPaths = [
      `${origin}/apple-touch-icon.png`,
      `${origin}/apple-touch-icon-precomposed.png`,
      `${origin}/favicon.ico`,
      `${origin}/favicon.png`
    ];

    for (const directUrl of directPaths) {
      try {
        const imgRes = await fetch(directUrl, { headers });
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          if (buffer.length > 300) {
            const saved = await processAndSavePng(buffer, destinationFile);
            if (saved) {
              return { success: true, source: 'direct_favicon', url: directUrl };
            }
          }
        }
      } catch (_) {}
    }

    // 3. Fallback to external favicon APIs
    const apiUrls = [
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`,
      `https://icon.horse/icon/${encodeURIComponent(domain)}`,
      `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
    ];

    for (const apiUrl of apiUrls) {
      try {
        const apiRes = await fetch(apiUrl, { headers });
        if (apiRes.ok) {
          const buffer = Buffer.from(await apiRes.arrayBuffer());
          if (buffer.length > 500) {
            const saved = await processAndSavePng(buffer, destinationFile);
            if (saved) {
              return { success: true, source: 'favicon_service', url: apiUrl };
            }
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    // URL or networking error
  }

  // 4. Default fallback icon
  if (fs.existsSync(fallbackIcon)) {
    try {
      const buffer = fs.readFileSync(fallbackIcon);
      await processAndSavePng(buffer, destinationFile);
      return { success: true, source: 'fallback_default' };
    } catch (_) {
      fs.copyFileSync(fallbackIcon, destinationFile);
      return { success: true, source: 'fallback_default' };
    }
  }

  return { success: false };
}

/**
 * Decodes HTML entities into normal UTF-8 characters
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Generates a clean, compact version of an app title suitable for identifiers/package names
 */
function generateCompactName(title, url) {
  if (!title || typeof title !== 'string') {
    if (url) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        const base = host.split('.')[0];
        return base.charAt(0).toUpperCase() + base.slice(1);
      } catch (_) {}
    }
    return 'WebApp';
  }

  // Remove common notification prefixes like "(2) " or "[New] "
  let cleaned = title.replace(/^\(\d+\)\s*/, '').replace(/^\[[^\]]+\]\s*/, '').trim();

  // Split on common page title separators
  const separators = [' - ', ' | ', ' — ', ' – ', ' · ', ' : ', ' • ', ' / '];
  let segments = [cleaned];

  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      segments = cleaned.split(sep).map(s => s.trim()).filter(Boolean);
      break;
    }
  }

  let chosen = segments[0];
  if (segments.length > 1) {
    const first = segments[0];
    const last = segments[segments.length - 1];
    // If last segment looks like the brand name and first is a lengthy page title
    if (last.length <= 18 && first.length > 20) {
      chosen = last;
    } else {
      chosen = first;
    }
  }

  // Remove problematic symbols, keep letters, numbers, spaces, underscores and hyphens
  chosen = chosen.replace(/[^\p{L}\p{N}\s_\-]/gu, '').replace(/\s+/g, ' ').trim();

  // If still long, take the first 2-3 words (up to 25 chars)
  if (chosen.length > 25) {
    const words = chosen.split(/\s+/);
    if (words.length > 1) {
      let short = words[0];
      for (let i = 1; i < words.length; i++) {
        if ((short + ' ' + words[i]).length <= 25) {
          short += ' ' + words[i];
        } else {
          break;
        }
      }
      chosen = short;
    } else {
      chosen = chosen.substring(0, 25);
    }
  }

  return chosen || 'WebApp';
}

/**
 * Fetches page metadata (title, compact name, favicon) from a web URL
 */
async function fetchSiteMetadata(webUrl) {
  let normalizedUrl = webUrl.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch (e) {
    throw new Error('URL inválida.');
  }

  const domain = parsedUrl.hostname;
  const origin = parsedUrl.origin;
  const fallbackHostTitle = domain.replace(/^www\./, '').split('.')[0];
  const defaultTitle = fallbackHostTitle.charAt(0).toUpperCase() + fallbackHostTitle.slice(1);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
  };

  let pageTitle = '';
  let html = '';

  // 1. Fetch HTML
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(normalizedUrl, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      html = await res.text();
      
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        pageTitle = decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();
      }

      if (!pageTitle) {
        const ogMatch = html.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                        html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
        if (ogMatch && ogMatch[1]) {
          pageTitle = decodeHtmlEntities(ogMatch[1]).replace(/\s+/g, ' ').trim();
        }
      }
    }
  } catch (_) {}

  if (!pageTitle) {
    pageTitle = defaultTitle;
  }

  const compactName = generateCompactName(pageTitle, normalizedUrl);

  // 2. Fetch and prepare icon preview
  let iconData = null;
  let iconUrl = null;

  const candidates = [];
  if (html) {
    const htmlIcons = extractIconsFromHtml(html, normalizedUrl);
    candidates.push(...htmlIcons.map(c => c.url));
  }

  candidates.push(
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
    `${origin}/favicon.ico`,
    `${origin}/favicon.png`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`
  );

  const uniqueUrls = [...new Set(candidates.filter(Boolean))];

  for (const candidateUrl of uniqueUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const imgRes = await fetch(candidateUrl, { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (imgRes.ok) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        if (buffer.length > 200) {
          try {
            const pngBuf = await sharp(buffer)
              .resize(128, 128, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
              })
              .png()
              .toBuffer();

            iconData = `data:image/png;base64,${pngBuf.toString('base64')}`;
            iconUrl = candidateUrl;
            break;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // If candidate images couldn't be loaded, try local default icon as fallback preview
  if (!iconData) {
    const fallbackIcon = path.join(__dirname, '..', 'assets', 'default.png');
    if (fs.existsSync(fallbackIcon)) {
      try {
        const buf = fs.readFileSync(fallbackIcon);
        const pngBuf = await sharp(buf).resize(128, 128, { fit: 'contain' }).png().toBuffer();
        iconData = `data:image/png;base64,${pngBuf.toString('base64')}`;
      } catch (_) {}
    }
  }

  return {
    success: true,
    title: pageTitle,
    compactName,
    iconUrl,
    iconData
  };
}

/**
 * Generates an Android TV 16:9 banner (e.g. 320x180 standard xhdpi)
 * using the application icon, custom dark gradient, glowing aura, and TV framing.
 *
 * @param {string} iconPath Path to the application icon (PNG)
 * @param {string} destinationFile Target banner file (PNG)
 * @param {number} [width=320]
 * @param {number} [height=180]
 */
async function generateTvBanner(iconPath, destinationFile, width = 320, height = 180) {
  try {
    const dir = path.dirname(destinationFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const bgSvg = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="tvBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a0f1d" />
            <stop offset="50%" stop-color="#1e293b" />
            <stop offset="100%" stop-color="#0b1120" />
          </linearGradient>
          <radialGradient id="tvGlow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35" />
            <stop offset="60%" stop-color="#38bdf8" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="${width}" height="${height}" rx="12" fill="url(#tvBg)" />
        <rect width="${width}" height="${height}" rx="12" fill="url(#tvGlow)" />
        <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="11" fill="none" stroke="rgba(255, 255, 255, 0.14)" stroke-width="1.5" />
      </svg>
    `);

    // Determine icon dimensions (approx 55% of banner height)
    const iconSize = Math.max(48, Math.round(height * 0.55));
    let iconBuffer = null;

    if (iconPath && fs.existsSync(iconPath)) {
      try {
        iconBuffer = await sharp(iconPath)
          .resize(iconSize, iconSize, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .png()
          .toBuffer();
      } catch (_) {}
    }

    if (!iconBuffer) {
      const fallbackIcon = path.join(__dirname, '..', 'assets', 'default.png');
      if (fs.existsSync(fallbackIcon)) {
        try {
          iconBuffer = await sharp(fallbackIcon)
            .resize(iconSize, iconSize, {
              fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toBuffer();
        } catch (_) {}
      }
    }

    let pipeline = sharp(bgSvg);
    if (iconBuffer) {
      pipeline = pipeline.composite([
        {
          input: iconBuffer,
          top: Math.round((height - iconSize) / 2),
          left: Math.round((width - iconSize) / 2)
        }
      ]);
    }

    await pipeline.png({ quality: 100 }).toFile(destinationFile);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Generates Android TV banners across standard drawable density folders
 * @param {string} resDir Android res directory (android/app/src/main/res)
 * @param {string} iconPath Path to the application icon
 */
async function generateAllAndroidTvBanners(resDir, iconPath) {
  const densities = [
    { folder: 'drawable', width: 320, height: 180 },
    { folder: 'drawable-xhdpi', width: 320, height: 180 },
    { folder: 'drawable-hdpi', width: 240, height: 135 },
    { folder: 'drawable-mdpi', width: 160, height: 90 },
    { folder: 'drawable-xxhdpi', width: 480, height: 270 },
    { folder: 'drawable-xxxhdpi', width: 640, height: 360 }
  ];

  let success = false;
  for (const item of densities) {
    const targetDir = path.join(resDir, item.folder);
    const targetFile = path.join(targetDir, 'banner.png');
    const ok = await generateTvBanner(iconPath, targetFile, item.width, item.height);
    if (ok) success = true;
  }

  return success;
}

module.exports = { 
  resolveAppIcon,
  processAndSavePng,
  extractIconsFromHtml,
  resolveUrl,
  fetchSiteMetadata,
  generateCompactName,
  decodeHtmlEntities,
  generateTvBanner,
  generateAllAndroidTvBanners
};

