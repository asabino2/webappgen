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

module.exports = { resolveAppIcon };
