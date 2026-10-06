/**
 * WebAppGen - Android TV Remote Control & Joystick Controller
 * Provides full TV navigation compatibility for web apps loaded on Android TV:
 * - D-pad directional spatial navigation with glowing TV focus ring
 * - Gamepad & Joystick engine: Left stick virtual cursor, Right stick smooth scrolling
 * - Primary click on Button A / Remote OK / Enter
 * - Remote Back button history navigation
 * - Virtual mouse cursor with edge auto-scrolling
 */
(function () {
  if (window.__TV_CONTROLLER_INITIALIZED__) return;
  window.__TV_CONTROLLER_INITIALIZED__ = true;

  // 1. Inject TV styling
  const style = document.createElement('style');
  style.id = 'tv-controller-styles';
  style.textContent = `
    /* High-contrast TV Focus Outline */
    .tv-focus-element, :focus-visible {
      outline: 3px solid #38bdf8 !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 22px rgba(56, 189, 248, 0.85) !important;
      border-radius: 4px !important;
      transition: outline 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease !important;
    }

    /* Virtual Mouse Cursor */
    #tv-virtual-cursor {
      position: fixed;
      top: 0;
      left: 0;
      width: 28px;
      height: 28px;
      z-index: 2147483647;
      pointer-events: none;
      transform: translate3d(-100px, -100px, 0);
      transition: opacity 0.3s ease;
      filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.8));
      opacity: 0;
      will-change: transform, opacity;
    }

    #tv-virtual-cursor.visible {
      opacity: 1;
    }

    #tv-virtual-cursor.clicking {
      filter: drop-shadow(0 0 14px #38bdf8);
      transform: translate3d(var(--cx, 0), var(--cy, 0), 0) scale(0.9);
    }

    /* Subtle TV Mode Toast Notification */
    #tv-mode-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(15, 23, 42, 0.94);
      color: #f8fafc;
      border: 1px solid rgba(56, 189, 248, 0.4);
      box-shadow: 0 10px 35px rgba(0, 0, 0, 0.6);
      border-radius: 12px;
      padding: 12px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 2147483646;
      pointer-events: none;
      backdrop-filter: blur(12px);
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.4s ease, transform 0.4s ease;
    }

    #tv-mode-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  // 2. DOM Elements (Virtual Cursor & Toast)
  const cursor = document.createElement('div');
  cursor.id = 'tv-virtual-cursor';
  cursor.innerHTML = `
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 3L10.07 20.97L13.58 13.58L20.97 10.07L3 3Z" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="13.58" cy="13.58" r="2.2" fill="#ffffff" />
    </svg>
  `;
  (document.body || document.documentElement).appendChild(cursor);

  const toast = document.createElement('div');
  toast.id = 'tv-mode-toast';
  toast.innerHTML = `
    <span>🎮</span>
    <span><strong>Modo Android TV Ativo</strong> • Controle Remoto &amp; Joystick habilitados</span>
  `;
  (document.body || document.documentElement).appendChild(toast);

  let toastTimer = null;
  function showToast(htmlText, duration = 3500) {
    if (htmlText) toast.innerHTML = htmlText;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  setTimeout(() => showToast(), 800);

  // State
  let cursorX = window.innerWidth / 2;
  let cursorY = window.innerHeight / 2;
  let isCursorActive = false;
  let lastCursorActivity = 0;
  let currentlyFocusedElement = null;

  function updateCursorPos(newX, newY) {
    cursorX = Math.max(0, Math.min(window.innerWidth - 1, newX));
    cursorY = Math.max(0, Math.min(window.innerHeight - 1, newY));
    cursor.style.setProperty('--cx', cursorX + 'px');
    cursor.style.setProperty('--cy', cursorY + 'px');
    cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
    cursor.classList.add('visible');
    isCursorActive = true;
    lastCursorActivity = performance.now();

    const elem = document.elementFromPoint(cursorX, cursorY);
    if (elem && elem !== currentlyFocusedElement && isInteractive(elem)) {
      setFocusedElement(elem);
    }
  }

  function hideCursor() {
    cursor.classList.remove('visible');
    isCursorActive = false;
  }

  function simulateClickAt(x, y) {
    const elem = document.elementFromPoint(x, y);
    if (!elem) return;

    cursor.classList.add('clicking');
    setTimeout(() => cursor.classList.remove('clicking'), 150);

    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y
    };

    elem.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
    elem.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    elem.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    elem.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    elem.click();

    if (elem.focus) {
      elem.focus();
    }
  }

  // 3. Focus and Spatial Navigation
  function isInteractive(elem) {
    if (!elem || elem.nodeType !== 1) return false;
    const tag = elem.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'video', 'audio'].includes(tag)) {
      return true;
    }
    if (elem.hasAttribute('tabindex') && elem.getAttribute('tabindex') !== '-1') {
      return true;
    }
    const role = elem.getAttribute('role');
    if (['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch'].includes(role)) {
      return true;
    }
    if (elem.onclick || elem.hasAttribute('onclick')) {
      return true;
    }
    return false;
  }

  function getFocusableElements() {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], video, audio';
    const list = Array.from(document.querySelectorAll(selector));
    return list.filter(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    });
  }

  function setFocusedElement(elem) {
    if (currentlyFocusedElement && currentlyFocusedElement !== elem) {
      currentlyFocusedElement.classList.remove('tv-focus-element');
    }
    currentlyFocusedElement = elem;
    if (elem) {
      elem.classList.add('tv-focus-element');
      try { elem.focus({ preventScroll: true }); } catch (_) {}
      elem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  function navigateDirection(dir) {
    hideCursor();
    const focusables = getFocusableElements();
    if (focusables.length === 0) {
      const scrollStep = 180;
      if (dir === 'down') window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      else if (dir === 'up') window.scrollBy({ top: -scrollStep, behavior: 'smooth' });
      else if (dir === 'left') window.scrollBy({ left: -scrollStep, behavior: 'smooth' });
      else if (dir === 'right') window.scrollBy({ left: scrollStep, behavior: 'smooth' });
      return;
    }

    if (!currentlyFocusedElement || !document.contains(currentlyFocusedElement)) {
      const inView = focusables.find(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
      setFocusedElement(inView || focusables[0]);
      return;
    }

    const currentRect = currentlyFocusedElement.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };

    let bestCandidate = null;
    let minDistance = Infinity;

    for (const el of focusables) {
      if (el === currentlyFocusedElement) continue;
      const r = el.getBoundingClientRect();
      const center = {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2
      };

      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;

      let isValidDirection = false;
      let primaryDiff = 0;
      let secondaryDiff = 0;

      if (dir === 'up' && dy < -5) {
        isValidDirection = true;
        primaryDiff = Math.abs(dy);
        secondaryDiff = Math.abs(dx);
      } else if (dir === 'down' && dy > 5) {
        isValidDirection = true;
        primaryDiff = Math.abs(dy);
        secondaryDiff = Math.abs(dx);
      } else if (dir === 'left' && dx < -5) {
        isValidDirection = true;
        primaryDiff = Math.abs(dx);
        secondaryDiff = Math.abs(dy);
      } else if (dir === 'right' && dx > 5) {
        isValidDirection = true;
        primaryDiff = Math.abs(dx);
        secondaryDiff = Math.abs(dy);
      }

      if (isValidDirection) {
        const dist = primaryDiff * 1.0 + secondaryDiff * 2.2;
        if (dist < minDistance) {
          minDistance = dist;
          bestCandidate = el;
        }
      }
    }

    if (bestCandidate) {
      setFocusedElement(bestCandidate);
    } else {
      const scrollStep = 180;
      if (dir === 'down') window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      else if (dir === 'up') window.scrollBy({ top: -scrollStep, behavior: 'smooth' });
      else if (dir === 'left') window.scrollBy({ left: -scrollStep, behavior: 'smooth' });
      else if (dir === 'right') window.scrollBy({ left: scrollStep, behavior: 'smooth' });
    }
  }

  // 4. Remote Control Key Event Listeners
  window.addEventListener('keydown', (e) => {
    const key = e.key;
    const keyCode = e.keyCode;

    // DPAD Arrow Keys
    if (key === 'ArrowUp' || keyCode === 19 || keyCode === 38) {
      e.preventDefault();
      navigateDirection('up');
    } else if (key === 'ArrowDown' || keyCode === 20 || keyCode === 40) {
      e.preventDefault();
      navigateDirection('down');
    } else if (key === 'ArrowLeft' || keyCode === 21 || keyCode === 37) {
      e.preventDefault();
      navigateDirection('left');
    } else if (key === 'ArrowRight' || keyCode === 22 || keyCode === 39) {
      e.preventDefault();
      navigateDirection('right');
    } else if (key === 'Enter' || key === 'Select' || keyCode === 13 || keyCode === 23 || keyCode === 66) {
      if (isCursorActive) {
        e.preventDefault();
        simulateClickAt(cursorX, cursorY);
      } else if (currentlyFocusedElement) {
        e.preventDefault();
        currentlyFocusedElement.click();
      }
    } else if (key === 'Escape' || key === 'GoBack' || keyCode === 27 || keyCode === 4) {
      if (window.history.length > 1) {
        e.preventDefault();
        window.history.back();
      }
    }
  });

  // 5. Gamepad / Joystick Loop
  const prevButtonStates = {};

  function handleGamepadInput() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        break;
      }
    }

    if (gp) {
      const deadzone = 0.18;
      const leftStickX = gp.axes[0] || 0;
      const leftStickY = gp.axes[1] || 0;
      const rightStickX = gp.axes[2] || 0;
      const rightStickY = gp.axes[3] || 0;

      // Virtual Cursor Movement with Left Analog Stick
      if (Math.abs(leftStickX) > deadzone || Math.abs(leftStickY) > deadzone) {
        const factor = 18;
        const cursorSpeedX = (Math.abs(leftStickX) > deadzone ? leftStickX : 0) * factor;
        const cursorSpeedY = (Math.abs(leftStickY) > deadzone ? leftStickY : 0) * factor;
        updateCursorPos(cursorX + cursorSpeedX, cursorY + cursorSpeedY);

        // Edge scrolling when cursor touches edge
        const edgeThreshold = 45;
        if (cursorY < edgeThreshold) window.scrollBy({ top: -14, behavior: 'auto' });
        else if (cursorY > window.innerHeight - edgeThreshold) window.scrollBy({ top: 14, behavior: 'auto' });
        if (cursorX < edgeThreshold) window.scrollBy({ left: -14, behavior: 'auto' });
        else if (cursorX > window.innerWidth - edgeThreshold) window.scrollBy({ left: 14, behavior: 'auto' });
      }

      // Smooth Page Scroll with Right Analog Stick
      if (Math.abs(rightStickY) > deadzone || Math.abs(rightStickX) > deadzone) {
        const scrollFactor = 22;
        const scrollY = (Math.abs(rightStickY) > deadzone ? rightStickY : 0) * scrollFactor;
        const scrollX = (Math.abs(rightStickX) > deadzone ? rightStickX : 0) * scrollFactor;
        window.scrollBy({ left: scrollX, top: scrollY, behavior: 'auto' });
      }

      const isButtonPressed = (btnIndex) => {
        const btn = gp.buttons[btnIndex];
        return btn && (typeof btn === 'object' ? btn.pressed : btn > 0.5);
      };

      const checkJustPressed = (btnIndex) => {
        const pressed = isButtonPressed(btnIndex);
        const wasPressed = !!prevButtonStates[btnIndex];
        prevButtonStates[btnIndex] = pressed;
        return pressed && !wasPressed;
      };

      // Button 0 (A / X): Click / Select
      if (checkJustPressed(0)) {
        if (isCursorActive) {
          simulateClickAt(cursorX, cursorY);
        } else if (currentlyFocusedElement) {
          currentlyFocusedElement.click();
        } else {
          updateCursorPos(window.innerWidth / 2, window.innerHeight / 2);
          simulateClickAt(cursorX, cursorY);
        }
      }

      // Button 1 (B / Circle): Back
      if (checkJustPressed(1)) {
        if (window.history.length > 1) {
          window.history.back();
        }
      }

      // Button 2 (X / Square): Toggle Cursor / Focus Mode
      if (checkJustPressed(2)) {
        if (isCursorActive) {
          hideCursor();
          showToast('<span>🎯</span><span><strong>Modo Foco Direcional</strong> ativo</span>', 2000);
        } else {
          updateCursorPos(window.innerWidth / 2, window.innerHeight / 2);
          showToast('<span>🖱️</span><span><strong>Modo Ponteiro Virtual</strong> ativo</span>', 2000);
        }
      }

      // Button 3 (Y / Triangle): Scroll to Top
      if (checkJustPressed(3)) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // Gamepad DPAD Buttons (12: Up, 13: Down, 14: Left, 15: Right)
      if (checkJustPressed(12)) navigateDirection('up');
      if (checkJustPressed(13)) navigateDirection('down');
      if (checkJustPressed(14)) navigateDirection('left');
      if (checkJustPressed(15)) navigateDirection('right');
    }

    if (isCursorActive && performance.now() - lastCursorActivity > 4500) {
      hideCursor();
    }

    requestAnimationFrame(handleGamepadInput);
  }

  requestAnimationFrame(handleGamepadInput);
})();
