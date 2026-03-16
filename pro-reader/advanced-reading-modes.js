class AdvancedReadingModes {
  constructor() {
    this.modes = {
      NORMAL: 'normal',
      SPEED: 'speed',
      FOCUS: 'focus',
      IMMERSIVE: 'immersive'
    };
    this.currentMode = this.modes.NORMAL;
    this.rsvpOverlay = null;
    this.focusOverlay = null;
  }

  enableSpeedMode() {
    if (this.rsvpOverlay) return;

    this.currentMode = this.modes.SPEED;
    console.log('🚀 Speed Reading Mode Activated');

    this.rsvpOverlay = document.createElement('div');
    this.rsvpOverlay.id = 'tts-rsvp-overlay';
    this.rsvpOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.95);
      z-index: 999999998;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      animation: fadeIn 0.3s ease;
    `;

    const wordDisplay = document.createElement('div');
    wordDisplay.id = 'tts-rsvp-word';
    wordDisplay.style.cssText = `
      font-size: 72px;
      font-weight: 700;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      text-align: center;
      min-width: 500px;
      min-height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      letter-spacing: 2px;
      text-shadow: 0 0 30px rgba(79, 70, 229, 0.8);
    `;
    wordDisplay.textContent = 'SPEED MODE';

    const progressBar = document.createElement('div');
    progressBar.id = 'tts-rsvp-progress';
    progressBar.style.cssText = `
      width: 80%;
      max-width: 600px;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      margin-top: 40px;
      border-radius: 2px;
      overflow: hidden;
    `;

    const progressFill = document.createElement('div');
    progressFill.id = 'tts-rsvp-progress-fill';
    progressFill.style.cssText = `
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #4F46E5, #7C3AED);
      transition: width 0.2s ease;
    `;
    progressBar.appendChild(progressFill);

    const controls = document.createElement('div');
    controls.style.cssText = `
      margin-top: 30px;
      color: rgba(255, 255, 255, 0.7);
      font-size: 14px;
      text-align: center;
    `;
    controls.innerHTML = 'Press ESC to exit • SPACE to pause';

    this.rsvpOverlay.appendChild(wordDisplay);
    this.rsvpOverlay.appendChild(progressBar);
    this.rsvpOverlay.appendChild(controls);

    safeAppendToBody(this.rsvpOverlay);
  }

  enableFocusMode() {
    if (this.focusOverlay) return;

    this.currentMode = this.modes.FOCUS;
    console.log('🎯 Focus Mode Activated');

    this.focusOverlay = document.createElement('div');
    this.focusOverlay.id = 'tts-focus-overlay';
    this.focusOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.7);
      z-index: 999999997;
      pointer-events: none;
      animation: fadeIn 0.4s ease;
    `;

    safeAppendToBody(this.focusOverlay);

    const badge = document.createElement('div');
    badge.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      background: rgba(79, 70, 229, 0.9);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      z-index: 999999999;
      animation: slideInLeft 0.4s ease;
    `;
    badge.textContent = '🎯 FOCUS MODE';
    this.focusOverlay.appendChild(badge);
  }

  updateRSVP(word, progress) {
    if (!this.rsvpOverlay) return;

    const wordDisplay = document.getElementById('tts-rsvp-word');
    const progressFill = document.getElementById('tts-rsvp-progress-fill');

    if (wordDisplay) {
      const orp = Math.floor(word.length / 3);
      const before = word.slice(0, orp);
      const focus = word.charAt(orp);
      const after = word.slice(orp + 1);

      wordDisplay.innerHTML = `
        <span style="opacity: 0.8;">${before}</span><span style="color: #4F46E5; font-size: 1.2em;">${focus}</span><span style="opacity: 0.8;">${after}</span>
      `;

      wordDisplay.style.transform = 'scale(1.05)';
      setTimeout(() => {
        wordDisplay.style.transform = 'scale(1)';
      }, 100);
    }

    if (progressFill) {
      progressFill.style.width = `${progress}%`;
    }
  }

  disableAllModes() {
    if (this.rsvpOverlay) {
      this.rsvpOverlay.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => {
        if (this.rsvpOverlay && this.rsvpOverlay.parentNode) {
          this.rsvpOverlay.remove();
        }
        this.rsvpOverlay = null;
      }, 300);
    }

    if (this.focusOverlay) {
      this.focusOverlay.style.animation = 'fadeOut 0.4s ease';
      setTimeout(() => {
        if (this.focusOverlay && this.focusOverlay.parentNode) {
          this.focusOverlay.remove();
        }
        this.focusOverlay = null;
      }, 400);
    }

    this.currentMode = this.modes.NORMAL;
  }

  getCurrentMode() {
    return this.currentMode;
  }
}

window.AdvancedReadingModes = AdvancedReadingModes;
