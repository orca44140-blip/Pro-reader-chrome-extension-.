class AdvancedVocabWidget {
  constructor() {
    this.widget = null;
    this.isExpanded = false;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.currentWord = null;
    this.searchResults = [];
    this.favorites = new Set();
    this.history = [];
    this.maxHistory = 100;
    this.position = { x: null, y: null };
    this._pointerMoved = false;
    this.loadFavorites();
  }

  async loadFavorites() {
    try {
      const result = await chrome.storage.local.get(['vocabFavorites']);
      if (result.vocabFavorites) {
        this.favorites = new Set(result.vocabFavorites);
      }
    } catch (e) {}
  }

  async saveFavorites() {
    try {
      await chrome.storage.local.set({ vocabFavorites: Array.from(this.favorites) });
    } catch (e) {}
  }

  create() {
    if (this.widget) return;

    this.injectStyles();
    this.widget = document.createElement('div');
    this.widget.id = 'tts-advanced-vocab-widget';
    this.widget.className = 'vocab-widget';

    this.loadPosition().then(savedPos => {
      if (savedPos) {
        this.position = savedPos;
        this.applyPosition();
      }
    }).catch(() => {});

    this.widget.innerHTML = `
      <div class="vw-header" id="vocab-drag-handle">
        <div class="vw-header-left">
          <div class="vw-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <span class="vw-title">Vocabulary</span>
        </div>
        <div class="vw-header-right">
          <button class="vw-icon-btn" id="vocab-expand-btn" title="Expand / Collapse">
            <svg class="vw-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <button class="vw-icon-btn vw-close-btn" id="vocab-close-btn" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="vw-body" id="vocab-body">
        <div class="vw-search-section">
          <div class="vw-search-bar">
            <svg class="vw-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              id="vocab-search-input"
              class="vw-search-input"
              placeholder="Search a word…"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="vw-search-go" id="vocab-search-btn" title="Search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>
          <div class="vw-autocomplete" id="vocab-search-results"></div>
        </div>

        <div class="vw-word-card">
          <div class="vw-word-top">
            <div class="vw-word-left">
              <h2 class="vw-word-text" id="vocab-word">···</h2>
              <div class="vw-word-meta">
                <span class="vw-pos-badge" id="vocab-pos"></span>
                <span class="vw-phonetic" id="vocab-phonetic"></span>
              </div>
            </div>
            <div class="vw-word-actions">
              <button class="vw-action-btn" id="vocab-speak-btn" title="Pronounce">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
              </button>
              <button class="vw-action-btn vw-fav-btn" id="vocab-favorite-btn" title="Favourite">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="vw-divider"></div>

          <div class="vw-meaning-container">
            <p class="vw-definition" id="vocab-meaning">Look up a word to see its definition here.</p>
            <button class="vw-action-btn" id="vocab-speak-meaning-btn" title="Pronounce meaning">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              </svg>
            </button>
          </div>
          <div class="vw-extras" id="vocab-details"></div>
          <div class="vw-examples" id="vocab-examples"></div>
        </div>

        <div class="vw-nav-bar">
          <button class="vw-nav-btn" id="vocab-prev-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
            Prev
          </button>
          <span class="vw-counter" id="vocab-counter">— / —</span>
          <button class="vw-nav-btn" id="vocab-next-btn">
            Next
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>

        <div class="vw-tabs">
          <button class="vw-tab active" data-tab="rotation">Rotate</button>
          <button class="vw-tab" data-tab="favorites">Saved</button>
          <button class="vw-tab" data-tab="history">History</button>
        </div>

        <div class="vw-list-area" id="vocab-tab-content">
          <div class="vw-list" id="vocab-list"></div>
        </div>
      </div>
    `;

    this.applyPosition();

    const attach = () => {
      document.body.appendChild(this.widget);
      this.setupEventListeners();
    };

    if (document.body) {
      attach();
    } else {
      const wait = () => document.body ? attach() : setTimeout(wait, 100);
      wait();
    }
  }

  injectStyles() {
    if (document.getElementById('vocab-widget-styles')) return;

    const style = document.createElement('style');
    style.id = 'vocab-widget-styles';
    style.textContent = `
      /* ── Root widget — Dark & Purple Theme ─────────────────── */
      #tts-advanced-vocab-widget.vocab-widget {
        position: fixed !important;
        top: 50px !important;
        right: 14px !important;
        left: auto !important;
        bottom: auto !important;
        width: 300px !important;
        max-width: calc(100vw - 28px) !important;
        background: #0f0a1a !important;
        border: 1px solid rgba(168,85,247,0.22) !important;
        border-radius: 14px !important;
        box-shadow: 0 0 0 1px rgba(168,85,247,0.06), 0 8px 32px rgba(0,0,0,0.7), 0 0 20px rgba(168,85,247,0.08) !important;
        z-index: 2147483640 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 13px !important;
        color: rgba(168,85,247,0.9) !important;
        overflow: hidden !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        animation: vw-slide-in 0.28s cubic-bezier(0.22,1,0.36,1) both !important;
      }

      @keyframes vw-slide-in {
        from { transform: translateX(calc(100% + 20px)); opacity: 0; }
        to   { transform: translateX(0); opacity: 1; }
      }
      @keyframes vw-slide-out {
        to { transform: translateX(calc(100% + 20px)); opacity: 0; }
      }

      /* ── Scan-line overlay ─────────────────────────────────── */
      #tts-advanced-vocab-widget.vocab-widget::before {
        content: '';
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
          0deg, transparent, transparent 2px,
          rgba(168,85,247,0.018) 2px, rgba(168,85,247,0.018) 4px
        );
        pointer-events: none;
        z-index: 0;
        border-radius: 14px;
      }

      /* ── Header ───────────────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px 10px;
        background: rgba(168,85,247,0.06);
        border-bottom: 1px solid rgba(168,85,247,0.15);
        cursor: grab;
        user-select: none;
        position: relative;
        z-index: 1;
      }
      #tts-advanced-vocab-widget .vw-header:active { cursor: grabbing; }

      #tts-advanced-vocab-widget .vw-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      #tts-advanced-vocab-widget .vw-logo {
        width: 26px;
        height: 26px;
        background: rgba(168,85,247,0.1);
        border: 1px solid rgba(168,85,247,0.25);
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #a855f7;
        flex-shrink: 0;
        box-shadow: 0 0 8px rgba(168,85,247,0.15);
      }

      #tts-advanced-vocab-widget .vw-title {
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: #a855f7;
        text-shadow: 0 0 8px rgba(168,85,247,0.5);
      }

      #tts-advanced-vocab-widget .vw-header-right {
        display: flex;
        gap: 4px;
      }

      #tts-advanced-vocab-widget .vw-icon-btn {
        width: 26px;
        height: 26px;
        border: 1px solid rgba(168,85,247,0.18);
        background: transparent;
        color: rgba(168,85,247,0.7);
        border-radius: 7px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.1s;
        outline: none;
      }
      #tts-advanced-vocab-widget .vw-icon-btn:hover {
        background: rgba(168,85,247,0.12);
        border-color: rgba(168,85,247,0.5);
        color: #a855f7;
        box-shadow: 0 0 8px rgba(168,85,247,0.25);
        transform: scale(1.08);
      }
      #tts-advanced-vocab-widget .vw-icon-btn:active { transform: scale(0.92); }

      #tts-advanced-vocab-widget .vw-close-btn:hover {
        background: rgba(239,68,68,0.15) !important;
        border-color: rgba(239,68,68,0.5) !important;
        color: #ef4444 !important;
        box-shadow: 0 0 8px rgba(239,68,68,0.2) !important;
      }

      #tts-advanced-vocab-widget .vw-chevron {
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
      }
      #tts-advanced-vocab-widget.vocab-widget.expanded .vw-chevron {
        transform: rotate(180deg);
      }

      /* ── Body ─────────────────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-body {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1);
        position: relative;
        z-index: 1;
      }
      #tts-advanced-vocab-widget.vocab-widget.expanded .vw-body {
        max-height: 520px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: rgba(168,85,247,0.2) transparent;
      }
      #tts-advanced-vocab-widget.vocab-widget.expanded .vw-body::-webkit-scrollbar { width: 3px; }
      #tts-advanced-vocab-widget.vocab-widget.expanded .vw-body::-webkit-scrollbar-thumb {
        background: rgba(168,85,247,0.25);
        border-radius: 99px;
      }

      /* ── Search ───────────────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-search-section {
        padding: 10px 10px 8px;
        border-bottom: 1px solid rgba(168,85,247,0.08);
      }

      #tts-advanced-vocab-widget .vw-search-bar {
        display: flex;
        align-items: center;
        background: rgba(168,85,247,0.04);
        border: 1px solid rgba(168,85,247,0.15);
        border-radius: 9px;
        padding: 0 8px;
        gap: 6px;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      #tts-advanced-vocab-widget .vw-search-bar:focus-within {
        border-color: rgba(168,85,247,0.5);
        box-shadow: 0 0 0 2px rgba(168,85,247,0.1);
        background: rgba(168,85,247,0.06);
      }

      #tts-advanced-vocab-widget .vw-search-icon { color: rgba(168,85,247,0.4); flex-shrink: 0; }

      #tts-advanced-vocab-widget .vw-search-input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-size: 12px;
        padding: 8px 0;
        color: rgba(168,85,247,0.9);
        min-width: 0;
        caret-color: #a855f7;
      }
      #tts-advanced-vocab-widget .vw-search-input::placeholder { color: rgba(168,85,247,0.3); }

      #tts-advanced-vocab-widget .vw-search-go {
        width: 24px;
        height: 24px;
        border: 1px solid rgba(168,85,247,0.3);
        background: rgba(168,85,247,0.1);
        border-radius: 6px;
        color: #a855f7;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background 0.15s, box-shadow 0.15s, transform 0.1s;
        outline: none;
      }
      #tts-advanced-vocab-widget .vw-search-go:hover {
        background: rgba(168,85,247,0.2);
        box-shadow: 0 0 8px rgba(168,85,247,0.3);
        transform: scale(1.06);
      }

      #tts-advanced-vocab-widget .vw-autocomplete {
        margin-top: 5px;
        border-radius: 8px;
        overflow: hidden;
        background: transparent;
      }

      #tts-advanced-vocab-widget .vw-ac-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 7px;
        font-size: 12px;
        transition: background 0.12s;
      }
      #tts-advanced-vocab-widget .vw-ac-item:hover { background: rgba(168,85,247,0.08); }
      #tts-advanced-vocab-widget .vw-ac-word { font-weight: 700; color: #a855f7; }
      #tts-advanced-vocab-widget .vw-ac-hint {
        color: rgba(168,85,247,0.45);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
      }

      /* ── Word card ────────────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-word-card {
        margin: 10px 10px 0;
        background: rgba(168,85,247,0.04);
        border: 1px solid rgba(168,85,247,0.12);
        border-radius: 10px;
        padding: 12px 12px 10px;
        position: relative;
        overflow: hidden;
      }
      #tts-advanced-vocab-widget .vw-word-card::after {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 2px;
        background: linear-gradient(90deg, transparent, #a855f7, transparent);
        opacity: 0.35;
      }

      #tts-advanced-vocab-widget .vw-word-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
      }

      #tts-advanced-vocab-widget .vw-word-left { flex: 1; min-width: 0; }

      #tts-advanced-vocab-widget .vw-word-text {
        font-size: 20px;
        font-weight: 800;
        margin: 0 0 4px;
        color: #a855f7;
        letter-spacing: -0.3px;
        line-height: 1.2;
        word-break: break-word;
        text-shadow: 0 0 12px rgba(168,85,247,0.35);
      }

      #tts-advanced-vocab-widget .vw-word-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      #tts-advanced-vocab-widget .vw-pos-badge {
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        padding: 2px 7px;
        border-radius: 99px;
        background: rgba(168,85,247,0.12);
        border: 1px solid rgba(168,85,247,0.25);
        color: rgba(168,85,247,0.8);
        display: none;
      }
      #tts-advanced-vocab-widget .vw-pos-badge:not(:empty) { display: inline-block; }

      #tts-advanced-vocab-widget .vw-phonetic {
        font-size: 11.5px;
        font-style: italic;
        color: rgba(168,85,247,0.45);
      }

      #tts-advanced-vocab-widget .vw-word-actions {
        display: flex;
        gap: 5px;
        flex-shrink: 0;
      }

      #tts-advanced-vocab-widget .vw-action-btn {
        width: 30px;
        height: 30px;
        border: 1px solid rgba(168,85,247,0.2);
        background: rgba(168,85,247,0.05);
        color: rgba(168,85,247,0.65);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        outline: none;
      }
      #tts-advanced-vocab-widget .vw-action-btn:hover {
        background: rgba(168,85,247,0.15);
        border-color: rgba(168,85,247,0.5);
        color: #a855f7;
        box-shadow: 0 0 10px rgba(168,85,247,0.25);
        transform: scale(1.08);
      }
      #tts-advanced-vocab-widget .vw-action-btn:active { transform: scale(0.93); }

      #tts-advanced-vocab-widget .vw-fav-btn.active svg {
        fill: #fbbf24;
        stroke: #fbbf24;
      }
      #tts-advanced-vocab-widget .vw-fav-btn.active {
        background: rgba(251,191,36,0.1);
        border-color: rgba(251,191,36,0.4);
        color: #fbbf24;
        box-shadow: 0 0 10px rgba(251,191,36,0.2);
      }

      #tts-advanced-vocab-widget .vw-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(168,85,247,0.15), transparent);
        margin: 10px 0;
      }

      #tts-advanced-vocab-widget .vw-meaning-container {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 8px;
      }

      #tts-advanced-vocab-widget .vw-definition {
        font-size: 12.5px;
        line-height: 1.65;
        color: rgba(168,85,247,0.75);
        margin: 0;
        flex: 1;
        word-wrap: break-word;
      }

      #tts-advanced-vocab-widget #vocab-speak-meaning-btn {
        flex-shrink: 0;
        margin-top: 2px;
      }

      #tts-advanced-vocab-widget .vw-extras { margin-bottom: 6px; }

      #tts-advanced-vocab-widget .vw-other-label,
      #tts-advanced-vocab-widget .vw-example-label {
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: rgba(168,85,247,0.38);
        margin-bottom: 5px;
      }

      #tts-advanced-vocab-widget .vw-def-item {
        display: flex;
        gap: 7px;
        padding: 6px 9px;
        background: rgba(168,85,247,0.04);
        border-left: 2px solid rgba(168,85,247,0.25);
        border-radius: 0 7px 7px 0;
        margin-bottom: 4px;
        font-size: 12px;
        line-height: 1.5;
        color: rgba(168,85,247,0.65);
      }

      #tts-advanced-vocab-widget .vw-def-num {
        font-weight: 700;
        color: rgba(168,85,247,0.5);
        flex-shrink: 0;
      }

      #tts-advanced-vocab-widget .vw-example-text {
        padding: 7px 10px;
        background: rgba(168,85,247,0.04);
        border-left: 2px solid rgba(168,85,247,0.2);
        border-radius: 0 7px 7px 0;
        font-size: 12px;
        font-style: italic;
        color: rgba(168,85,247,0.6);
        line-height: 1.5;
      }

      /* ── Navigation ───────────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-nav-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-top: 1px solid rgba(168,85,247,0.08);
        border-bottom: 1px solid rgba(168,85,247,0.08);
        margin-top: 8px;
      }

      #tts-advanced-vocab-widget .vw-nav-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 10px;
        background: rgba(168,85,247,0.06);
        border: 1px solid rgba(168,85,247,0.18);
        border-radius: 7px;
        color: rgba(168,85,247,0.75);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        outline: none;
      }
      #tts-advanced-vocab-widget .vw-nav-btn:hover {
        background: rgba(168,85,247,0.14);
        border-color: rgba(168,85,247,0.45);
        color: #a855f7;
        box-shadow: 0 0 8px rgba(168,85,247,0.2);
        transform: translateY(-1px);
      }
      #tts-advanced-vocab-widget .vw-nav-btn:active { transform: translateY(0); }

      #tts-advanced-vocab-widget .vw-counter {
        font-size: 11px;
        font-weight: 600;
        color: rgba(168,85,247,0.4);
        letter-spacing: 0.5px;
        font-variant-numeric: tabular-nums;
      }

      /* ── Tabs ─────────────────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-tabs {
        display: flex;
        padding: 0 10px;
        gap: 2px;
        background: rgba(168,85,247,0.02);
        border-bottom: 1px solid rgba(168,85,247,0.08);
      }

      #tts-advanced-vocab-widget .vw-tab {
        flex: 1;
        padding: 8px 4px;
        border: none;
        background: transparent;
        font-size: 11px;
        font-weight: 600;
        color: rgba(168,85,247,0.38);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.18s;
        letter-spacing: 0.3px;
        text-transform: uppercase;
        outline: none;
      }
      #tts-advanced-vocab-widget .vw-tab:hover { color: rgba(168,85,247,0.7); }
      #tts-advanced-vocab-widget .vw-tab.active {
        color: #a855f7;
        border-bottom-color: #a855f7;
        text-shadow: 0 0 8px rgba(168,85,247,0.4);
      }

      /* ── List area ────────────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-list-area {
        padding: 6px 10px 10px;
      }

      #tts-advanced-vocab-widget .vw-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      #tts-advanced-vocab-widget .vw-list-item {
        display: flex;
        flex-direction: column;
        padding: 8px 10px;
        background: rgba(168,85,247,0.03);
        border: 1px solid rgba(168,85,247,0.08);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
      }
      #tts-advanced-vocab-widget .vw-list-item:hover {
        background: rgba(168,85,247,0.08);
        border-color: rgba(168,85,247,0.25);
        transform: translateX(2px);
        box-shadow: -2px 0 0 rgba(168,85,247,0.4);
      }

      #tts-advanced-vocab-widget .vw-list-word {
        font-weight: 700;
        font-size: 12.5px;
        color: rgba(168,85,247,0.9);
        margin-bottom: 2px;
      }

      #tts-advanced-vocab-widget .vw-list-hint {
        font-size: 11px;
        color: rgba(168,85,247,0.42);
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      #tts-advanced-vocab-widget .vw-empty {
        text-align: center;
        padding: 18px 10px;
        color: rgba(168,85,247,0.3);
        font-size: 12px;
      }

      #tts-advanced-vocab-widget .vw-empty-icon {
        font-size: 24px;
        display: block;
        margin-bottom: 6px;
        opacity: 0.45;
      }

      /* ── Loading spinner ──────────────────────────────────── */
      #tts-advanced-vocab-widget .vw-loading {
        display: flex;
        align-items: center;
        gap: 7px;
        color: rgba(168,85,247,0.5);
        font-size: 12px;
        padding: 4px 0;
      }

      #tts-advanced-vocab-widget .vw-spinner {
        width: 13px;
        height: 13px;
        border: 2px solid rgba(168,85,247,0.12);
        border-top-color: rgba(168,85,247,0.7);
        border-radius: 50%;
        animation: vw-spin 0.7s linear infinite;
        flex-shrink: 0;
      }

      @keyframes vw-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    const expandBtn   = this.widget.querySelector('#vocab-expand-btn');
    const closeBtn    = this.widget.querySelector('#vocab-close-btn');
    const searchBtn   = this.widget.querySelector('#vocab-search-btn');
    const searchInput = this.widget.querySelector('#vocab-search-input');
    const speakBtn    = this.widget.querySelector('#vocab-speak-btn');
    const speakMeaningBtn = this.widget.querySelector('#vocab-speak-meaning-btn');
    const favoriteBtn = this.widget.querySelector('#vocab-favorite-btn');
    const prevBtn     = this.widget.querySelector('#vocab-prev-btn');
    const nextBtn     = this.widget.querySelector('#vocab-next-btn');
    const dragHandle  = this.widget.querySelector('#vocab-drag-handle');
    const tabs        = this.widget.querySelectorAll('.vw-tab');

    if (expandBtn) expandBtn.addEventListener('click', () => this.toggleExpand());
    if (closeBtn)  closeBtn.addEventListener('click',  () => this.close());
    if (searchBtn) searchBtn.addEventListener('click', () => this.performSearch());

    if (searchInput) {
      searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
          this.performSearch();
        } else {
          this.autocomplete(e.target.value);
        }
      });
    }

    if (speakBtn)    speakBtn.addEventListener('click',    () => this.speakCurrentWord());
    if (speakMeaningBtn) speakMeaningBtn.addEventListener('click', () => this.speakCurrentMeaning());
    if (favoriteBtn) favoriteBtn.addEventListener('click', () => this.toggleFavorite());
    if (prevBtn)     prevBtn.addEventListener('click',     () => this.navigatePrev());
    if (nextBtn)     nextBtn.addEventListener('click',     () => this.navigateNext());

    if (dragHandle) {
      dragHandle.addEventListener('pointerdown', (e) => this.startDrag(e));
    }

    tabs.forEach(tab => tab.addEventListener('click', () => this.switchTab(tab.dataset.tab)));

    document.addEventListener('pointermove', (e) => this.onDrag(e));
    document.addEventListener('pointerup',   ()  => this.stopDrag());
  }

  toggleExpand() {
    this.isExpanded = !this.isExpanded;
    this.widget.classList.toggle('expanded', this.isExpanded);
    if (this.isExpanded) {
      this.switchTab('rotation');
    }
  }

  close() {
    if (this.widget) {
      this.widget.style.animation = 'vw-slide-out 0.25s ease both';
      this.widget.style.setProperty('--vw-slide-out', 'translateX(110%) scale(0.92)');
      const style = document.createElement('style');
      style.textContent = `@keyframes vw-slide-out { to { transform: translateX(110%) scale(0.92); opacity: 0; } }`;
      document.head.appendChild(style);
      setTimeout(() => {
        if (this.widget && this.widget.parentNode) this.widget.remove();
        this.widget = null;
      }, 260);
    }
  }

  async performSearch() {
    const input = this.widget && this.widget.querySelector('#vocab-search-input');
    const word = input?.value?.trim();
    if (!word) return;

    this._showSearchLoading();
    const definition = await this.lookupWord(word);
    if (definition) {
      this.displayWord(definition);
      this.addToHistory(definition);
      this.hideSearchResults();
    } else {
      this._showSearchError(word);
    }
  }

  _showSearchLoading() {
    const meaningEl = this.widget && this.widget.querySelector('#vocab-meaning');
    if (meaningEl) {
      meaningEl.innerHTML = `<span class="vw-loading"><span class="vw-spinner"></span>Looking up…</span>`;
    }
  }

  _showSearchError(word) {
    const meaningEl = this.widget && this.widget.querySelector('#vocab-meaning');
    if (meaningEl) meaningEl.textContent = `No definition found for "${word}".`;
  }

  autocomplete(query) {
    if (!query || query.length < 2) { this.hideSearchResults(); return; }

    const results = (window.vocabCache || []).filter(word =>
      word.word && word.word.toLowerCase().startsWith(query.toLowerCase())
    ).slice(0, 5);

    this.showSearchResults(results);
  }

  showSearchResults(results) {
    const container = this.widget && this.widget.querySelector('#vocab-search-results');
    if (!container) return;

    if (results.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = results.map(word => `
      <div class="vw-ac-item" data-word="${word.word}">
        <span class="vw-ac-word">${word.word}</span>
        <span class="vw-ac-hint">${(word.meaning || '').substring(0, 45)}…</span>
      </div>
    `).join('');

    container.querySelectorAll('.vw-ac-item').forEach(item => {
      item.addEventListener('click', () => {
        const wordText = item.dataset.word;
        const wordData = (window.vocabCache || []).find(w => w.word === wordText);
        if (wordData) {
          this.displayWord(wordData);
          this.hideSearchResults();
          const inp = this.widget.querySelector('#vocab-search-input');
          if (inp) inp.value = '';
        }
      });
    });
  }

  hideSearchResults() {
    const container = this.widget && this.widget.querySelector('#vocab-search-results');
    if (container) container.innerHTML = '';
  }

  async lookupWord(word) {
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data[0]) {
          const entry = data[0];
          const meaning = entry.meanings && entry.meanings[0];
          return {
            word: entry.word,
            phonetic: entry.phonetic || (entry.phonetics && entry.phonetics[0] && entry.phonetics[0].text) || '',
            partOfSpeech: meaning?.partOfSpeech || '',
            meaning: meaning?.definitions[0]?.definition || '',
            example: meaning?.definitions[0]?.example || '',
            synonyms: meaning?.synonyms || [],
            definitions: meaning?.definitions || []
          };
        }
      }
      return (window.vocabCache || []).find(w => w.word && w.word.toLowerCase() === word.toLowerCase()) || null;
    } catch (e) {
      return (window.vocabCache || []).find(w => w.word && w.word.toLowerCase() === word.toLowerCase()) || null;
    }
  }

  displayWord(wordData) {
    if (!wordData || !this.widget) return;

    this.currentWord = wordData;

    const wordEl     = this.widget.querySelector('#vocab-word');
    const posEl      = this.widget.querySelector('#vocab-pos');
    const phoneticEl = this.widget.querySelector('#vocab-phonetic');
    const meaningEl  = this.widget.querySelector('#vocab-meaning');
    const detailsEl  = this.widget.querySelector('#vocab-details');
    const examplesEl = this.widget.querySelector('#vocab-examples');
    const favBtn     = this.widget.querySelector('#vocab-favorite-btn');

    if (wordEl)     wordEl.textContent     = wordData.word || '···';
    if (posEl)      posEl.textContent      = wordData.partOfSpeech || '';
    if (phoneticEl) phoneticEl.textContent = wordData.phonetic || '';
    if (meaningEl)  meaningEl.textContent  = wordData.meaning || '';

    if (detailsEl) {
      if (wordData.definitions && wordData.definitions.length > 1) {
        detailsEl.innerHTML = `
          <div class="vw-other-label">Other meanings</div>
          ${wordData.definitions.slice(1, 3).map((def, i) => `
            <div class="vw-def-item">
              <span class="vw-def-num">${i + 2}.</span>
              <span>${def.definition}</span>
            </div>
          `).join('')}
        `;
      } else {
        detailsEl.innerHTML = '';
      }
    }

    if (examplesEl) {
      if (wordData.example) {
        examplesEl.innerHTML = `
          <div class="vw-example-label">Example</div>
          <div class="vw-example-text">"${wordData.example}"</div>
        `;
      } else {
        examplesEl.innerHTML = '';
      }
    }

    if (favBtn) {
      const isFav = this.favorites.has(wordData.word);
      favBtn.classList.toggle('active', isFav);
    }
  }

  speakCurrentWord() {
    if (!this.currentWord || !this.currentWord.word) return;
    try {
      const u = new SpeechSynthesisUtterance(this.currentWord.word);
      u.rate = 0.8; u.pitch = 1; u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  speakCurrentMeaning() {
    if (!this.currentWord || !this.currentWord.meaning) return;
    try {
      const u = new SpeechSynthesisUtterance(this.currentWord.meaning);
      u.rate = 0.8; u.pitch = 1; u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  toggleFavorite() {
    if (!this.currentWord || !this.currentWord.word) return;
    const word = this.currentWord.word;
    const favBtn = this.widget && this.widget.querySelector('#vocab-favorite-btn');

    if (this.favorites.has(word)) {
      this.favorites.delete(word);
      if (favBtn) favBtn.classList.remove('active');
    } else {
      this.favorites.add(word);
      if (favBtn) favBtn.classList.add('active');
    }
    this.saveFavorites();
  }

  navigatePrev() {
    const cache = window.vocabCache || [];
    if (!cache.length) {
      console.warn('[Vocab] No words in cache for prev navigation');
      return;
    }
    window.currentVocabIndex = ((window.currentVocabIndex || 0) - 1 + cache.length) % cache.length;
    console.log(`[Vocab] Navigated prev to index ${window.currentVocabIndex}: ${cache[window.currentVocabIndex]?.word}`);
    this.displayWord(cache[window.currentVocabIndex]);
    this.updateCounter();
  }

  navigateNext() {
    const cache = window.vocabCache || [];
    if (!cache.length) {
      console.warn('[Vocab] No words in cache for next navigation');
      return;
    }
    window.currentVocabIndex = ((window.currentVocabIndex || 0) + 1) % cache.length;
    console.log(`[Vocab] Navigated next to index ${window.currentVocabIndex}: ${cache[window.currentVocabIndex]?.word}`);
    this.displayWord(cache[window.currentVocabIndex]);
    this.updateCounter();
  }

  updateCounter() {
    const counter = this.widget && this.widget.querySelector('#vocab-counter');
    const cache = window.vocabCache || [];
    if (counter && cache.length > 0) {
      counter.textContent = `${(window.currentVocabIndex || 0) + 1} / ${cache.length}`;
    }
  }

  addToHistory(wordData) {
    this.history = this.history.filter(w => w.word !== wordData.word);
    this.history.unshift(wordData);
    if (this.history.length > this.maxHistory) this.history.pop();
  }

  switchTab(tabName) {
    this.widget.querySelectorAll('.vw-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    const listContainer = this.widget.querySelector('#vocab-list');
    if (!listContainer) return;

    let items = [];
    if (tabName === 'favorites') {
      items = (window.vocabCache || []).filter(w => this.favorites.has(w.word));
    } else if (tabName === 'history') {
      items = this.history;
    } else {
      items = (window.vocabCache || []).slice(0, 20);
    }

    if (items.length === 0) {
      const labels = { rotation: 'No vocabulary loaded', favorites: 'No saved words yet', history: 'No history yet' };
      listContainer.innerHTML = `
        <div class="vw-empty">
          <span class="vw-empty-icon">${tabName === 'favorites' ? '⭐' : tabName === 'history' ? '🕐' : '📖'}</span>
          ${labels[tabName] || 'Nothing here yet'}
        </div>`;
      return;
    }

    listContainer.innerHTML = items.map(word => `
      <div class="vw-list-item" data-word="${word.word}">
        <div class="vw-list-word">${word.word}</div>
        <div class="vw-list-hint">${word.meaning || ''}</div>
      </div>
    `).join('');

    listContainer.querySelectorAll('.vw-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const wordData = items.find(w => w.word === item.dataset.word);
        if (wordData) this.displayWord(wordData);
      });
    });
  }

  startDrag(e) {
    if (e.target.closest('.vw-icon-btn, .vw-search-bar, .vw-action-btn, .vw-nav-btn, .vw-tab, .vw-list-item, .vw-ac-item, input, button')) return;
    this.isDragging = true;
    this._pointerMoved = false;
    this.dragOffset = {
      x: e.clientX - this.widget.offsetLeft,
      y: e.clientY - this.widget.offsetTop
    };
    this.widget.setPointerCapture(e.pointerId);
    this.widget.style.transition = 'none';
    this.widget.style.userSelect = 'none';
  }

  onDrag(e) {
    if (!this.isDragging) return;
    this._pointerMoved = true;
    const x = Math.max(0, Math.min(window.innerWidth  - this.widget.offsetWidth,  e.clientX - this.dragOffset.x));
    const y = Math.max(0, Math.min(window.innerHeight - this.widget.offsetHeight, e.clientY - this.dragOffset.y));
    this.widget.style.left  = `${x}px`;
    this.widget.style.top   = `${y}px`;
    this.widget.style.right = 'auto';
    this.position = { x, y };
  }

  stopDrag() {
    if (this.isDragging) {
      this.isDragging = false;
      this.widget.style.transition = '';
      this.widget.style.userSelect = '';
      if (this._pointerMoved) this.savePosition();
    }
  }

  savePosition() {
    try { chrome.storage.local.set({ vocabWidgetPosition: this.position }); } catch (e) {}
  }

  async loadPosition() {
    try {
      const r = await chrome.storage.local.get(['vocabWidgetPosition']);
      return r.vocabWidgetPosition || null;
    } catch (e) { return null; }
  }

  applyPosition() {
    if (!this.widget) return;
    if (this.position && this.position.x !== null) {
      this.widget.style.left  = `${this.position.x}px`;
      this.widget.style.top   = `${this.position.y}px`;
      this.widget.style.right = 'auto';
    }
  }
}

window.AdvancedVocabWidget = AdvancedVocabWidget;
