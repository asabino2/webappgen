// Preload script for injected web app
// Ensures maximum compatibility with websites checking client headers (like WhatsApp Web)
const CHROME_VERSION = "131.0.0.0";
const CHROME_MAJOR = "131";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

try {
  // Override navigator.userAgent and appVersion to hide Electron footprint
  Object.defineProperty(navigator, 'userAgent', {
    get: () => CHROME_UA,
    configurable: true
  });

  Object.defineProperty(navigator, 'appVersion', {
    get: () => CHROME_UA.replace('Mozilla/', ''),
    configurable: true
  });

  // Emulate navigator.userAgentData for modern Chromium feature detection
  if (navigator.userAgentData) {
    const brands = [
      { brand: 'Google Chrome', version: CHROME_MAJOR },
      { brand: 'Chromium', version: CHROME_MAJOR },
      { brand: 'Not_A Brand', version: '24' }
    ];

    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands,
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: async () => ({
          architecture: 'x86',
          bitness: '64',
          brands,
          mobile: false,
          model: '',
          platform: 'Windows',
          platformVersion: '15.0.0',
          uaFullVersion: CHROME_VERSION
        })
      }),
      configurable: true
    });
  }
} catch (_) {}
