
/* =====================================================
   ADVANCED PARAGRAPH-LEVEL READING SYSTEM  v4.0
   ─────────────────────────────────────────────────────
   • Fixed-position floating button (no DOM injection bugs)
   • 2-second hover delay → icon appears
   • 6-second auto-hide
   • Red glowing pulsing play button (34px, neon effect)
   • Smart content scoring — skips nav/ads/menus
   • Sequential auto-read (reads whole page para-by-para)
   • Alt+P  → read hovered paragraph
   • Alt+[/] → jump prev/next paragraph
   • Alt+Shift+P → toggle Paragraph Navigator panel
   • Auto-scroll to active reading paragraph
   • Tooltip: preview + reading time estimate
   • Progress ring arc (SVG stroke-dashoffset)
   • Reading history (visited paragraphs this session)
   • Paragraph counter badge
   • Watchdog: resumes auto-sequence if TTS stops early
   • MutationObserver paused during reading
   • window.prDebug() for diagnostics
   ===================================================== */

const _PRM_ATTR          = 'data-tts-para-id';
const _PRM_EXCLUDED_TAGS = new Set([
  'SCRIPT','STYLE','NOSCRIPT','IFRAME','SVG','CODE','PRE',
  'NAV','HEADER','FOOTER','ASIDE','MENU','DIALOG','BUTTON',
  'SELECT','TEXTAREA','INPUT','LABEL','FORM','FIGURE',
  'VIDEO','AUDIO','CANVAS','OBJECT','EMBED'
]);
const _PRM_EXCLUDE_ROLES = new Set([
  'navigation','banner','contentinfo','complementary',
  'search','dialog','alert','status','menubar','toolbar','menu'
]);
const _PRM_EXCLUDE_CLS = /\b(nav|menu|sidebar|footer|header|advertisement|ad[-_]|cookie|tooltip|popup|modal|dropdown|breadcrumb|widget|social|share|comment.*header|author.*bio|tag-cloud|pagination|related|suggested|promo)\b/i;

const _PRM_AVG_WPM = 200;

class ParagraphReaderManager {
  constructor() {
    this.paragraphs        = new Map();
    this._hoverTimer       = null;
    this._hideTimer        = null;
    this._muteTimer        = null;
    this._scanTimer        = null;
    this._watchdogTimer    = null;
    this._observer         = null;
    this._scrollRAF        = null;
    this._btn              = null;
    this._rings            = null;
    this._tooltip          = null;
    this._counter          = null;
    this._navPanel         = null;
    this._activeId         = null;
    this._hoveredEl        = null;
    this._readingParaIndex = -1;
    this._autoSeqActive    = false;
    this._isInitialized    = false;
    this._observerPaused   = false;
    this._visitedIds       = new Set();
    this._lastReadingEnd   = null;
    this._readingActive    = false;

    this.config = {
      hoverDelayMs:   2000,   // 2 seconds before icon appears
      visibilityMs:   6000,   // 6 seconds auto-hide
      minTextLen:     20,
      scanDebounceMs: 1500,
      avgWPM:         _PRM_AVG_WPM,
      iconSize:       34,     // px — compact but visible
    };
  }

  initialize() {
    if (this._isInitialized) return;
    this._isInitialized = true;
    this._injectStyles();
    this._buildUI();
    this._scan();
    this._attachEvents();
    this._attachDblClickToRead();
    this._watchDOM();
    console.log('[PRM] v4.0 initialized — paragraphs found:', this.paragraphs.size);
  }

  destroy() {
    [this._hoverTimer, this._hideTimer, this._muteTimer, this._scanTimer, this._watchdogTimer]
      .forEach(t => t && clearTimeout(t));
    if (this._scrollRAF) cancelAnimationFrame(this._scrollRAF);
    if (this._observer)  this._observer.disconnect();
    [this._btn, this._rings, this._tooltip, this._counter, this._navPanel]
      .forEach(el => el && el.remove());
    this.paragraphs.forEach(({ element }) => {
      try { delete element.dataset.ttsParaId; } catch (_) {}
    });
    this.paragraphs.clear();
    this._visitedIds.clear();
    this._isInitialized = false;
  }

  rescan() { this._scan(); }

  // ──────────────────────────────────────────────────
  //  STYLES
  // ──────────────────────────────────────────────────
  _injectStyles() {
    if (document.getElementById('_tts_para_styles')) return;
    const s = document.createElement('style');
    s.id = '_tts_para_styles';
    s.textContent = `
      @keyframes _prm_pulse_ring {
        0%   { transform: scale(1);    opacity: .7; }
        100% { transform: scale(2.1);  opacity: 0;  }
      }
      @keyframes _prm_pulse_ring2 {
        0%   { transform: scale(1);    opacity: .5; }
        100% { transform: scale(1.8);  opacity: 0;  }
      }
      @keyframes _prm_btn_in {
        0%   { transform: scale(.5) rotate(-10deg); opacity: 0; }
        70%  { transform: scale(1.12) rotate(2deg); opacity: 1; }
        100% { transform: scale(1)   rotate(0deg);  opacity: 1; }
      }
      @keyframes _prm_btn_out {
        0%   { transform: scale(1);   opacity: 1; }
        100% { transform: scale(.55); opacity: 0; }
      }
      @keyframes _prm_icon_float {
        0%, 100% { transform: translateY(0px); }
        50%       { transform: translateY(-3px); }
      }
      @keyframes _prm_glow_breathe {
        0%, 100% { filter: drop-shadow(0 0 8px rgba(220,38,38,.9)) drop-shadow(0 0 16px rgba(220,38,38,.5)); }
        50%       { filter: drop-shadow(0 0 18px rgba(255,60,60,1)) drop-shadow(0 0 32px rgba(220,38,38,.7)) drop-shadow(0 0 48px rgba(220,38,38,.3)); }
      }
      @keyframes _prm_seq_pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(0,255,170,.7); }
        50%      { box-shadow: 0 0 0 8px rgba(0,255,170,0); }
      }
      @keyframes _prm_visited_fade {
        from { background: rgba(0,255,170,.1); }
        to   { background: transparent; }
      }
      #_tts_para_btn[data-seq="1"] {
        animation: _prm_seq_pulse 1.4s ease-in-out infinite !important;
      }
      #_tts_nav_panel::-webkit-scrollbar { width: 4px; }
      #_tts_nav_panel::-webkit-scrollbar-track { background: rgba(255,255,255,.04); }
      #_tts_nav_panel::-webkit-scrollbar-thumb { background: rgba(0,255,170,.3); border-radius: 4px; }
      [data-tts-para-id]:hover { outline: 1px dashed rgba(220,38,38,.25) !important; border-radius: 2px !important; outline-offset: 1px !important; }
      [data-tts-para-id].paragraph-reading {
        background: rgba(0,255,170,.05) !important;
        border-left: 3px solid rgba(0,255,170,.55) !important;
        padding-left: 10px !important;
        box-shadow: inset 3px 0 8px rgba(0,255,170,.08) !important;
      }
      [data-tts-para-id].paragraph-visited { animation: _prm_visited_fade 1.8s ease forwards !important; }
      @media (prefers-reduced-motion: reduce) {
        #_tts_para_btn, #_tts_para_rings { transition: opacity .1s linear !important; animation: none !important; }
      }
      @media (max-width: 600px) {
        #_tts_para_btn  { width: 28px !important; height: 28px !important; }
        #_tts_nav_panel { display: none !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // ──────────────────────────────────────────────────
  //  UI CREATION
  // ──────────────────────────────────────────────────
  _buildUI() {
    const root = document.documentElement;
    const S = this.config.iconSize;

    // ── Pulse rings (behind button) ──
    const rings = document.createElement('div');
    rings.id = '_tts_para_rings';
    rings.style.cssText = `
      all:initial!important;
      position:fixed!important;
      width:${S}px!important;height:${S}px!important;
      pointer-events:none!important;
      z-index:2147483644!important;
      opacity:0!important;
      transition:opacity .2s ease!important;
    `;
    rings.innerHTML = `
      <div style="all:initial!important;position:absolute!important;inset:0!important;border-radius:50%!important;border:2px solid rgba(220,38,38,.6)!important;animation:_prm_pulse_ring 1.8s ease-out infinite!important;"></div>
      <div style="all:initial!important;position:absolute!important;inset:0!important;border-radius:50%!important;border:2px solid rgba(220,38,38,.45)!important;animation:_prm_pulse_ring2 1.8s ease-out .6s infinite!important;"></div>
    `;
    root.appendChild(rings);
    this._rings = rings;

    // ── Play button ──
    const btn = document.createElement('div');
    btn.id = '_tts_para_btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Read from this paragraph (Alt+P)');
    btn.setAttribute('tabindex', '0');
    btn.style.cssText = `
      all:initial!important;
      font-family:system-ui,sans-serif!important;
      position:fixed!important;
      width:${S}px!important;height:${S}px!important;
      border-radius:50%!important;
      cursor:pointer!important;
      z-index:2147483647!important;
      display:flex!important;
      align-items:center!important;justify-content:center!important;
      opacity:0!important;
      pointer-events:none!important;
      transform:scale(.5)!important;
      transition:opacity .2s ease,transform .25s cubic-bezier(.34,1.56,.64,1)!important;
      will-change:transform,opacity,top,left!important;
      background:transparent!important;border:none!important;
      padding:0!important;margin:0!important;
      animation:_prm_glow_breathe 2.2s ease-in-out infinite, _prm_icon_float 3s ease-in-out infinite!important;
      filter:drop-shadow(0 0 10px rgba(220,38,38,.85))!important;
    `;
    btn.innerHTML = this._buildSVG(0);
    root.appendChild(btn);
    this._btn = btn;

    btn.addEventListener('mouseenter', () => {
      btn.style.setProperty('transform', 'scale(1.22)', 'important');
      if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
      this._showTooltip();
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.setProperty('transform', 'scale(1)', 'important');
      this._hideTooltip();
      this._scheduleHide();
    });
    btn.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      console.log(`[PRM] Play button clicked, activeId=${this._activeId}`);
      if (this._activeId) {
        console.log(`[PRM] Button click: Calling _startReading with autoSeq=true`);
        this._startReading(this._activeId, true);
      } else {
        console.warn(`[PRM] Button click: No activeId set!`);
      }
    });
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        console.log(`[PRM] Play button keyboard activated, activeId=${this._activeId}`);
        if (this._activeId) {
          console.log(`[PRM] Keyboard: Calling _startReading with autoSeq=true`);
          this._startReading(this._activeId, true);
        }
      }
    });

    // ── Tooltip ──
    const tt = document.createElement('div');
    tt.id = '_tts_para_tooltip';
    tt.style.cssText = `
      all:initial!important;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;
      position:fixed!important;
      max-width:260px!important;
      background:rgba(6,12,12,.97)!important;
      color:#fff!important;
      font-size:11px!important;line-height:1.5!important;
      padding:9px 13px!important;
      border-radius:10px!important;
      border:1px solid rgba(220,38,38,.35)!important;
      box-shadow:0 6px 28px rgba(0,0,0,.65),0 0 0 1px rgba(220,38,38,.12),0 0 18px rgba(220,38,38,.15)!important;
      z-index:2147483646!important;
      opacity:0!important;pointer-events:none!important;
      transition:opacity .15s ease!important;
      white-space:normal!important;word-break:break-word!important;
    `;
    root.appendChild(tt);
    this._tooltip = tt;

    // ── Counter badge ──
    const ctr = document.createElement('div');
    ctr.id = '_tts_para_counter';
    ctr.style.cssText = `
      all:initial!important;
      font-family:'SF Mono','Fira Code',monospace!important;
      position:fixed!important;
      bottom:18px!important;right:18px!important;
      background:rgba(6,12,12,.94)!important;
      color:#00ffaa!important;
      border:1px solid rgba(0,255,170,.3)!important;
      border-radius:20px!important;
      padding:5px 14px!important;
      font-size:11px!important;font-weight:700!important;
      z-index:2147483645!important;
      opacity:0!important;pointer-events:none!important;
      transition:opacity .2s ease!important;
      letter-spacing:.5px!important;
      box-shadow:0 2px 14px rgba(0,0,0,.5),0 0 10px rgba(0,255,170,.1)!important;
    `;
    root.appendChild(ctr);
    this._counter = ctr;

    this._buildNavPanel(root);
  }

  _buildNavPanel(root) {
    const panel = document.createElement('div');
    panel.id = '_tts_nav_panel';
    panel.style.cssText = `
      all:initial!important;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;
      position:fixed!important;
      top:60px!important;right:18px!important;
      width:250px!important;max-height:400px!important;
      background:rgba(6,12,12,.98)!important;
      border:1px solid rgba(0,255,170,.2)!important;
      border-radius:12px!important;
      box-shadow:0 10px 40px rgba(0,0,0,.7),0 0 20px rgba(0,255,170,.05)!important;
      z-index:2147483644!important;
      display:none!important;
      flex-direction:column!important;
      overflow:hidden!important;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      all:initial!important;
      display:flex!important;align-items:center!important;
      justify-content:space-between!important;
      padding:11px 14px!important;
      border-bottom:1px solid rgba(0,255,170,.12)!important;
      font-size:11px!important;font-weight:700!important;
      color:#00ffaa!important;letter-spacing:.5px!important;
      font-family:inherit!important;
    `;
    header.textContent = '¶ PARAGRAPH NAVIGATOR';

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'cursor:pointer!important;color:rgba(255,255,255,.5)!important;font-size:13px!important;';
    closeBtn.addEventListener('click', () => this._toggleNavPanel(false));
    header.appendChild(closeBtn);

    const list = document.createElement('div');
    list.id = '_tts_nav_list';
    list.style.cssText = `
      all:initial!important;
      overflow-y:auto!important;flex:1!important;
      max-height:350px!important;
      display:block!important;
      font-family:inherit!important;
    `;

    panel.appendChild(header);
    panel.appendChild(list);
    root.appendChild(panel);
    this._navPanel = panel;
  }

  _buildSVG(pct = 0) {
    const S   = this.config.iconSize;
    const cx  = S / 2;
    const r   = cx - 3;
    const R   = cx - 1;
    const circ = 2 * Math.PI * r;
    const dash  = circ * (1 - pct / 100);
    // Play triangle scaled to icon
    const tx1 = Math.round(S * 0.34), ty1 = Math.round(S * 0.25);
    const tx2 = Math.round(S * 0.34), ty2 = Math.round(S * 0.75);
    const tx3 = Math.round(S * 0.74), ty3 = Math.round(S * 0.5);
    return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="_prm_g1" cx="35%" cy="28%" r="72%">
          <stop offset="0%" stop-color="#FF6060"/>
          <stop offset="60%" stop-color="#DC2626"/>
          <stop offset="100%" stop-color="#991010"/>
        </radialGradient>
        <radialGradient id="_prm_g2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(255,255,255,.18)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cx}" r="${R}" fill="rgba(220,38,38,.13)"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="url(#_prm_g1)"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="url(#_prm_g2)"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
      <polygon points="${tx1},${ty1} ${tx2},${ty2} ${tx3},${ty3}" fill="white" opacity=".96"/>
    </svg>`;
  }

  // ──────────────────────────────────────────────────
  //  PARAGRAPH SCANNING
  // ──────────────────────────────────────────────────
  _scan() {
    try {
      this.paragraphs.forEach(({ element }) => {
        try { delete element.dataset.ttsParaId; } catch (_) {}
        element.classList && element.classList.remove('paragraph-reading', 'paragraph-visited');
      });
      this.paragraphs.clear();

      const candidates = document.querySelectorAll(
        'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, dt, dd, article, section, [role="article"], [itemprop="articleBody"] > *'
      );

      let idx = 0;
      candidates.forEach(el => {
        if (!this._isReadable(el)) return;
        // Skip if already nested inside another detected para
        const existing = el.closest('[data-tts-para-id]');
        if (existing && existing !== el) return;

        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text.length < this.config.minTextLen) return;
        if (this._contentScore(el, text) < 2) return;

        const id       = `_prm_${idx++}`;
        el.dataset.ttsParaId = id;
        const wordCount = text.split(/\s+/).length;
        const etaSecs   = Math.ceil((wordCount / this.config.avgWPM) * 60);
        this.paragraphs.set(id, { element: el, text, index: idx - 1, wordCount, etaSecs });
      });

      this._refreshNavPanel();
      console.log('[PRM] Scan complete — paragraphs:', this.paragraphs.size);
    } catch (e) {
      console.warn('[PRM] scan error:', e);
    }
  }

  _contentScore(el, text) {
    let score = 0;
    const tag = el.tagName;
    const wc  = text.split(/\s+/).length;

    if (/^H[1-6]$/.test(tag)) score += 3;
    if (tag === 'P')           score += 1;
    if (wc >= 6)               score++;
    if (wc >= 20)              score++;
    if (/[.!?]/.test(text))    score++;
    if (/[,;:]/.test(text))    score++;

    const linkText = Array.from(el.querySelectorAll('a'))
      .reduce((s, a) => s + (a.textContent || '').length, 0);
    if (linkText / Math.max(text.length, 1) > 0.7) score -= 3;

    // Penalise very short or all-caps (likely headings/labels)
    if (wc < 3 && !/^H[1-6]$/.test(tag)) score -= 2;

    return score;
  }

  _isReadable(el) {
    if (_PRM_EXCLUDED_TAGS.has(el.tagName)) return false;
    const role = el.getAttribute('role');
    if (role && _PRM_EXCLUDE_ROLES.has(role)) return false;
    if (_PRM_EXCLUDE_CLS.test(el.className || '')) return false;

    let ancestor = el.parentElement;
    let depth = 0;
    while (ancestor && depth < 8) {
      if (_PRM_EXCLUDED_TAGS.has(ancestor.tagName)) return false;
      const aRole = ancestor.getAttribute && ancestor.getAttribute('role');
      if (aRole && _PRM_EXCLUDE_ROLES.has(aRole)) return false;
      if (_PRM_EXCLUDE_CLS.test(ancestor.className || '')) return false;
      ancestor = ancestor.parentElement;
      depth++;
    }
    try {
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
      if (parseInt(st.height) === 0 && parseInt(st.width) === 0) return false;
    } catch (_) {}
    return true;
  }

  // ──────────────────────────────────────────────────
  //  NAVIGATOR PANEL
  // ──────────────────────────────────────────────────
  _refreshNavPanel() {
    const list = document.getElementById('_tts_nav_list');
    if (!list || !this._navPanel) return;
    list.innerHTML = '';

    if (this.paragraphs.size === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'all:initial!important;padding:14px 14px!important;color:rgba(255,255,255,.3)!important;font-size:11px!important;font-family:inherit!important;';
      empty.textContent = 'No readable paragraphs detected.';
      list.appendChild(empty);
      return;
    }

    this.paragraphs.forEach((para, id) => {
      const item = document.createElement('div');
      item.setAttribute('data-nav-id', id);
      const isRead   = this._visitedIds.has(id);
      const isActive = id === this._activeId;
      item.style.cssText = `
        all:initial!important;
        display:block!important;
        padding:7px 12px!important;
        font-size:10.5px!important;line-height:1.45!important;
        color:${isActive ? '#00ffaa' : isRead ? 'rgba(0,255,170,.5)' : 'rgba(255,255,255,.75)'}!important;
        border-bottom:1px solid rgba(255,255,255,.05)!important;
        cursor:pointer!important;
        font-family:inherit!important;
        border-left:3px solid ${isActive ? '#DC2626' : isRead ? 'rgba(0,255,170,.4)' : 'transparent'}!important;
        background:${isActive ? 'rgba(220,38,38,.07)' : 'transparent'}!important;
        box-sizing:border-box!important;
      `;
      const num = document.createElement('span');
      num.style.cssText = 'font-size:9px!important;color:rgba(0,255,170,.5)!important;font-weight:700!important;margin-right:5px!important;font-family:monospace!important;';
      num.textContent = `¶${para.index + 1}`;
      const preview = document.createElement('span');
      preview.style.cssText = 'font-family:inherit!important;';
      preview.textContent = para.text.substring(0, 70) + (para.text.length > 70 ? '…' : '');
      item.appendChild(num);
      item.appendChild(preview);

      item.addEventListener('mouseenter', () => item.style.setProperty('background', 'rgba(255,255,255,.04)', 'important'));
      item.addEventListener('mouseleave', () => item.style.setProperty('background', isActive ? 'rgba(220,38,38,.07)' : 'transparent', 'important'));
      item.addEventListener('click', () => {
        para.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this._activeId = id;
        this._showBtn(id, para.element);
        setTimeout(() => this._startReading(id, true), 300);
      });
      list.appendChild(item);
    });
  }

  _toggleNavPanel(forceState) {
    if (!this._navPanel) return;
    const show = forceState !== undefined ? forceState : this._navPanel.style.display === 'none';
    this._navPanel.style.setProperty('display', show ? 'flex' : 'none', 'important');
    if (show) this._refreshNavPanel();
  }

  // ──────────────────────────────────────────────────
  //  EVENTS
  // ──────────────────────────────────────────────────
  _attachEvents() {
    document.addEventListener('mouseover', e => {
      const para = this._closestPara(e.target);
      if (!para) {
        if (!this._isOverBtn(e.target) && !this._isOverNav(e.target)) this._onParaLeave();
        return;
      }
      const id = para.dataset.ttsParaId;
      if (id === this._activeId && parseFloat(this._btn.style.opacity) > 0) return;
      this._onParaEnter(id, para);
    }, { passive: true });

    document.addEventListener('mouseout', e => {
      if (!e.relatedTarget) { this._onParaLeave(); return; }
      const para = this._closestPara(e.relatedTarget);
      const id   = para && para.dataset.ttsParaId;
      if (!id || id !== this._activeId) {
        if (!this._isOverBtn(e.relatedTarget) && !this._isOverNav(e.relatedTarget)) this._onParaLeave();
      }
    }, { passive: true });

    const onScroll = () => {
      if (this._scrollRAF) cancelAnimationFrame(this._scrollRAF);
      this._scrollRAF = requestAnimationFrame(() => {
        if (this._activeId && parseFloat(this._btn.style.opacity) > 0) {
          const para = this.paragraphs.get(this._activeId);
          if (para) this._positionBtn(para.element);
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });

    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        const id = this._activeId || this._hoveredParaId();
        if (id) this._startReading(id, true);
      }
      if (e.altKey && e.key === '[') { e.preventDefault(); this._jumpRelative(-1); }
      if (e.altKey && e.key === ']') { e.preventDefault(); this._jumpRelative(1); }
      if (e.altKey && e.shiftKey && e.key === 'P') { e.preventDefault(); this._toggleNavPanel(); }
      if (e.key === 'Escape') { this._stopAutoSeq(); this._hideBtn(); }
    });

    document.addEventListener('mousemove', e => { this._hoveredEl = e.target; }, { passive: true });
  }

  _hoveredParaId() {
    if (!this._hoveredEl) return null;
    const para = this._closestPara(this._hoveredEl);
    return para ? para.dataset.ttsParaId : null;
  }

  _attachDblClickToRead() {
    // Double-click should read from the selected word/selection.
    // This uses existing reading engine APIs (handleRead/readFromClickPoint) without changing them.
    document.addEventListener('dblclick', e => {
      try {
        // Cancel any pending single-click read in content.js to prevent double-fire
        if (typeof window._cancelPendingClick === 'function') window._cancelPendingClick();

        const t = e.target;
        // Don't interfere with form fields / editable areas
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

        const sel = window.getSelection && window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        const text = (sel.toString() || '').trim();
        if (!text) return;

        // Ensure selection is inside a readable paragraph when possible
        const anchorNode = sel.anchorNode && (sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement);
        const paraEl = this._closestPara(anchorNode);
        if (paraEl && paraEl.dataset && paraEl.dataset.ttsParaId) {
          this._activeId = paraEl.dataset.ttsParaId;
          // Keep the button location in sync (but don't force show/hide)
          this._positionBtn(paraEl);
          this._positionRings(paraEl);
        }

        const range = sel.getRangeAt(0);
        
        // Ensure settings object has required properties - copy from window.currentSettings
        let settingsToUse = window.currentSettings ? Object.assign({}, window.currentSettings) : {};
        console.log(`[dblclick] window.currentSettings before defaults:`, settingsToUse);
        if (!settingsToUse.sentenceCount || settingsToUse.sentenceCount < 1) settingsToUse.sentenceCount = 2;
        if (!settingsToUse.repeatCount || settingsToUse.repeatCount < 1) settingsToUse.repeatCount = 1;
        if (!settingsToUse.speed) settingsToUse.speed = 1;
        console.log(`[dblclick] settingsToUse after defaults:`, settingsToUse);

        // Prefer readFromClickPoint(range) since content.js supports range→word-index mapping
        if (typeof window.readFromClickPoint === 'function') {
          window.readFromClickPoint(range, settingsToUse);
          return;
        }

        // Fallback to handleRead('selection')
        if (typeof window.handleRead === 'function') {
          window.handleRead('selection', settingsToUse);
        }
      } catch (err) {
        console.warn('[PRM] dblclick read failed:', err);
      }
    }, { passive: true });
  }

  _jumpRelative(delta) {
    const ids     = Array.from(this.paragraphs.keys());
    const baseIdx = this._readingParaIndex >= 0 ? this._readingParaIndex
      : (this._activeId ? (this.paragraphs.get(this._activeId) || {}).index || 0 : 0);
    const next = ids[Math.max(0, Math.min(ids.length - 1, baseIdx + delta))];
    if (!next) return;
    const para = this.paragraphs.get(next);
    if (!para) return;
    this._activeId = next;
    para.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this._showBtn(next, para.element);
  }

  _closestPara(el) {
    if (!el || el === document.documentElement || el === document.body) return null;
    let node = el, d = 0;
    while (node && d < 10) {
      if (node.dataset && node.dataset.ttsParaId) return node;
      node = node.parentElement;
      d++;
    }
    return null;
  }

  _isOverBtn(el) { return el && this._btn && (this._btn === el || this._btn.contains(el)); }
  _isOverNav(el) { return el && this._navPanel && this._navPanel.contains(el); }

  // ──────────────────────────────────────────────────
  //  HOVER STATE MACHINE
  // ──────────────────────────────────────────────────
  _onParaEnter(id, el) {
    if (this._hoverTimer) { clearTimeout(this._hoverTimer); this._hoverTimer = null; }
    const para = this.paragraphs.get(id);
    if (!para) return;
    console.log(`[PRM] Para hover: ${para.index}, text: "${para.text.substring(0, 40)}..."`);
    this._activeId = id;
    // 2-second hover delay before icon appears
    this._hoverTimer = setTimeout(() => this._showBtn(id, para.element), this.config.hoverDelayMs);
  }

  _onParaLeave() {
    if (this._hoverTimer) { clearTimeout(this._hoverTimer); this._hoverTimer = null; }
    this._scheduleHide();
  }

  // ──────────────────────────────────────────────────
  //  BUTTON SHOW / HIDE / POSITION
  // ──────────────────────────────────────────────────
  _showBtn(id, el) {
    this._positionBtn(el);

    this._btn.style.setProperty('opacity', '1', 'important');
    this._btn.style.setProperty('transform', 'scale(1)', 'important');
    this._btn.style.setProperty('pointer-events', 'auto', 'important');

    this._rings.style.setProperty('opacity', '1', 'important');
    this._positionRings(el);

    this._updateBtnProgress();
    this._updateCounter(id);
    this._scheduleHide();
  }

  _hideBtn() {
    this._btn.style.setProperty('opacity', '0', 'important');
    this._btn.style.setProperty('transform', 'scale(.5)', 'important');
    this._btn.style.setProperty('pointer-events', 'none', 'important');
    this._rings.style.setProperty('opacity', '0', 'important');
    this._hideTooltip();
    this._updateCounter(null);
  }

  _scheduleHide() {
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (!this._autoSeqActive) this._hideBtn();
    }, this.config.visibilityMs);
  }

  _positionBtn(el) {
    const rect = el.getBoundingClientRect();
    const S = this.config.iconSize;
    const vw = window.innerWidth, vh = window.innerHeight;
    const gap = 8;

    let left = rect.left - S - gap;
    let top  = rect.top + Math.min(12, Math.max(0, (rect.height - S) * 0.15));

    if (left < 4)            left = rect.right + gap;
    if (left + S > vw - 4)  left = rect.left + 4;
    top  = Math.max(4, Math.min(top, vh - S - 4));
    left = Math.max(4, left);

    this._btn.style.setProperty('top',  `${Math.round(top)}px`,  'important');
    this._btn.style.setProperty('left', `${Math.round(left)}px`, 'important');
  }

  _positionRings(el) {
    const rect = el.getBoundingClientRect();
    const S = this.config.iconSize;
    const vw = window.innerWidth, vh = window.innerHeight;
    const gap = 8;

    let left = rect.left - S - gap;
    let top  = rect.top + Math.min(12, Math.max(0, (rect.height - S) * 0.15));
    if (left < 4)            left = rect.right + gap;
    if (left + S > vw - 4)  left = rect.left + 4;
    top  = Math.max(4, Math.min(top, vh - S - 4));
    left = Math.max(4, left);

    this._rings.style.setProperty('top',  `${Math.round(top)}px`,  'important');
    this._rings.style.setProperty('left', `${Math.round(left)}px`, 'important');
  }

  _updateBtnProgress() {
    const total = this.paragraphs.size;
    if (!total) return;
    const pct = Math.round((this._visitedIds.size / total) * 100);
    this._btn.innerHTML = this._buildSVG(pct);
    this._autoSeqActive
      ? this._btn.setAttribute('data-seq', '1')
      : this._btn.removeAttribute('data-seq');
  }

  // ──────────────────────────────────────────────────
  //  TOOLTIP
  // ──────────────────────────────────────────────────
  _showTooltip() {
    const para = this._activeId && this.paragraphs.get(this._activeId);
    if (!para) return;

    const num   = para.index + 1;
    const total = this.paragraphs.size;
    const eta   = para.etaSecs < 60 ? `~${para.etaSecs}s` : `~${Math.ceil(para.etaSecs / 60)}m`;

    this._tooltip.innerHTML = '';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-weight:700;color:#ef4444;margin-bottom:4px;font-size:10px;letter-spacing:.5px;display:flex;justify-content:space-between;align-items:center;';
    hdr.innerHTML = `<span>▶ ¶${num} / ${total}</span><span style="color:rgba(0,255,170,.8);font-weight:600;font-size:9.5px;">${eta} read</span>`;

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:9px;color:rgba(0,255,170,.55);margin-bottom:5px;letter-spacing:.3px;';
    hint.textContent = 'Click ·  Alt+P ·  Alt+[ / ] navigate';

    const body = document.createElement('div');
    body.style.cssText = 'color:rgba(255,255,255,.78);font-size:10.5px;line-height:1.5;';
    body.textContent = para.text.substring(0, 110) + (para.text.length > 110 ? '…' : '');

    this._tooltip.appendChild(hdr);
    this._tooltip.appendChild(hint);
    this._tooltip.appendChild(body);

    const btnRect = this._btn.getBoundingClientRect();
    let ttLeft = btnRect.right + 12;
    let ttTop  = btnRect.top - 4;
    if (ttLeft + 270 > window.innerWidth) ttLeft = btnRect.left - 276;
    if (ttLeft < 4) ttLeft = 4;
    if (ttTop + 140 > window.innerHeight) ttTop = window.innerHeight - 145;

    this._tooltip.style.setProperty('left',    `${ttLeft}px`, 'important');
    this._tooltip.style.setProperty('top',     `${ttTop}px`,  'important');
    this._tooltip.style.setProperty('opacity', '1',           'important');
  }

  _hideTooltip() {
    this._tooltip.style.setProperty('opacity', '0', 'important');
  }

  // ──────────────────────────────────────────────────
  //  COUNTER BADGE
  // ──────────────────────────────────────────────────
  _updateCounter(id) {
    if (!id) { this._counter.style.setProperty('opacity', '0', 'important'); return; }
    const para  = this.paragraphs.get(id);
    if (!para) return;
    const total = this.paragraphs.size;
    const read  = this._visitedIds.size;

    let text;
    if (this._autoSeqActive && this._readingParaIndex >= 0) {
      const remSecs = Array.from(this.paragraphs.values())
        .slice(this._readingParaIndex)
        .reduce((s, p) => s + p.etaSecs, 0);
      const remStr = remSecs < 60 ? `${remSecs}s` : `${Math.ceil(remSecs / 60)}m`;
      text = `▶ ¶${this._readingParaIndex + 1}/${total}  ·  ${read} read  ·  ~${remStr}`;
    } else {
      text = `¶ ${para.index + 1} / ${total}${read ? `  ·  ${read} read` : ''}`;
    }

    this._counter.textContent = text;
    this._counter.style.setProperty('opacity', '1', 'important');
    if (this._muteTimer) clearTimeout(this._muteTimer);
    if (!this._autoSeqActive) {
      this._muteTimer = setTimeout(() => {
        this._counter.style.setProperty('opacity', '0', 'important');
      }, 5000);
    }
  }

  // ──────────────────────────────────────────────────
  //  READING
  // ──────────────────────────────────────────────────
  _startReading(id, autoSeq = false) {
    const para = this.paragraphs.get(id);
    if (!para) return;

    console.log(`[PRM] _startReading: paragraph ${para.index} (autoSeq=${autoSeq}), text: "${para.text.substring(0, 60)}..."`);
    
    // Stop any previous reading first
    this._stopAutoSeq();
    
    // CRITICAL: Reset content.js repeat counters when switching paragraphs
    try {
      if (typeof window.resetRepeatCounters === 'function') {
        window.resetRepeatCounters();
        console.log(`[PRM] Reset repeat counters for new paragraph`);
      }
    } catch (e) {
      console.warn('[PRM] Could not reset repeat counters:', e);
    }
    
    this._autoSeqActive    = autoSeq;
    this._readingParaIndex = para.index;
    this._visitedIds.add(id);
    this._readingActive = true;

    this._flashElement(para.element);
    para.element.classList.add('paragraph-reading');
    this._hideBtn();
    this._pauseObserver();

    if (autoSeq) {
      this._btn.style.setProperty('opacity', '1', 'important');
      this._btn.style.setProperty('pointer-events', 'auto', 'important');
      this._btn.setAttribute('data-seq', '1');
      this._updateCounter(id);
    }

    this._doRead(para.element, () => {
      console.log(`[PRM] Reading callback triggered for paragraph ${para.index}`);
      this._readingActive = false;
      para.element.classList.remove('paragraph-reading');
      para.element.classList.add('paragraph-visited');
      this._lastReadingEnd = id;

      // CRITICAL: Reset repeat state before moving to next paragraph
      try {
        if (typeof window.resetRepeatCounters === 'function') {
          window.resetRepeatCounters();
          console.log(`[PRM] Reset repeat counters after paragraph read complete`);
        }
      } catch (e) {
        console.warn('[PRM] Could not reset repeat counters at end:', e);
      }

      if (autoSeq) {
        const ids  = Array.from(this.paragraphs.keys());
        const next = ids[para.index + 1];
        console.log(`[PRM] AutoSeq callback: current=${para.index}, next=${next ? para.index + 1 : 'none'}, autoSeqActive=${this._autoSeqActive}`);
        if (next && this._autoSeqActive) {
          // Increased delay ensures previous TTS fully stops before next starts
          console.log(`[PRM] Moving to next paragraph ${para.index + 1} after 250ms delay`);
          setTimeout(() => this._startReading(next, true), 250);
        } else {
          console.log(`[PRM] AutoSeq complete or stopped`);
          this._stopAutoSeq();
          this._resumeObserver();
        }
      } else {
        this._autoSeqActive    = false;
        this._readingParaIndex = -1;
        this._resumeObserver();
        this._refreshNavPanel();
      }
    });
  }

  _stopAutoSeq() {
    console.log(`[PRM] _stopAutoSeq called, was autoSeqActive=${this._autoSeqActive}`);
    this._autoSeqActive    = false;
    this._readingActive    = false;
    this._btn.removeAttribute('data-seq');
    if (this._watchdogTimer) { 
      console.log(`[PRM] Clearing watchdog timer`);
      clearTimeout(this._watchdogTimer); 
      this._watchdogTimer = null; 
    }
    try { if (typeof window.handleStop === 'function') window.handleStop(); } catch (_) {}
  }

  _doRead(el, onDone) {
    console.log(`[PRM] _doRead: Starting to read element`);
    
    // Clear any existing text selection to avoid issues
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        sel.removeAllRanges();
        console.log(`[PRM] Cleared existing text selection`);
      }
    } catch (_) {}
    
    // Stop previous reading gracefully
    try {
      if (typeof window.handleStop === 'function') {
        console.log(`[PRM] Calling handleStop before reading new paragraph`);
        window.handleStop();
      }
    } catch (e) {
      console.warn(`[PRM] handleStop error:`, e);
    }

    // Scroll element into view
    console.log(`[PRM] Scrolling paragraph into view`);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Wait for content.js to be ready and then start reading
    let readyChecks = 0;
    const checkReady = () => {
      readyChecks++;
      
      // Check if functions are available
      const hasHandleRead = typeof window.handleRead === 'function';
      const hasReadFromClickPoint = typeof window.readFromClickPoint === 'function';
      
      if (!hasHandleRead && !hasReadFromClickPoint) {
        if (readyChecks <= 50) { // Try for up to 5 seconds (50 * 100ms)
          console.log(`[PRM] Waiting for content.js... (attempt ${readyChecks})`);
          setTimeout(checkReady, 100);
          return;
        } else {
          console.error('[PRM] ✗✗✗ TIMEOUT: content.js functions never became available');
          if (onDone) setTimeout(onDone, 200);
          return;
        }
      }
      
      // Functions are ready - proceed with reading
      console.log(`[PRM] ✓ content.js functions ready after ${readyChecks * 100}ms`);
      
      setTimeout(() => {
        try {
          let readingStarted = false;
          
          // DON'T select text - this removes styling. Instead use readFromClickPoint or pure handleRead
          // Clear any existing selection to avoid interference
          try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              sel.removeAllRanges();
            }
          } catch (_) {}
          
          // Get settings - ensure all required properties
          const settingsToUse = window.currentSettings ? Object.assign({}, window.currentSettings) : {};
          if (!settingsToUse.sentenceCount || settingsToUse.sentenceCount < 1) settingsToUse.sentenceCount = 2;
          if (!settingsToUse.repeatCount || settingsToUse.repeatCount < 1) settingsToUse.repeatCount = 1;
          if (typeof settingsToUse.speed !== 'number' || settingsToUse.speed < 0.25) settingsToUse.speed = 1;
          
          console.log(`[PRM] Settings prepared:`, { sentenceCount: settingsToUse.sentenceCount, repeatCount: settingsToUse.repeatCount, speed: settingsToUse.speed });
          
          // PREFERRED: Try readFromClickPoint first (no text selection needed)
          if (typeof window.readFromClickPoint === 'function') {
            try {
              console.log(`[PRM] Using readFromClickPoint (no selection)`);
              const range = this._buildRange(el);
              if (range) {
                window.readFromClickPoint(range, settingsToUse);
                readingStarted = true;
                console.log(`[PRM] ✓ readFromClickPoint call successful (no text selected)`);
              } else {
                console.warn(`[PRM] _buildRange returned null, falling back to handleRead`);
              }
            } catch (e) {
              console.error('[PRM] readFromClickPoint error:', e);
            }
          }
          
          // FALLBACK: If readFromClickPoint didn't work, try handleRead WITHOUT selecting text
          if (!readingStarted && typeof window.handleRead === 'function') {
            try {
              console.log(`[PRM] Fallback: Using handleRead('page') - no selection`);
              window.handleRead('page', settingsToUse);
              readingStarted = true;
              console.log(`[PRM] ✓ handleRead('page') call successful (no text selected)`);
            } catch (e) {
              console.error('[PRM] handleRead error:', e);
            }
          }
          
          if (!readingStarted) {
            console.error(`[PRM] ✗✗✗ FAILED: Neither method worked. readFromClickPoint=${typeof window.readFromClickPoint}, handleRead=${typeof window.handleRead}`);
          } else {
            console.log(`[PRM] ✓✓✓ Reading started successfully with NO text selection!`);
          }

          // Install watchdog to detect when reading completes
          if (onDone) {
            console.log(`[PRM] Installing watchdog for completion detection`);
            this._watchdogTimer = this._installOnDone(el, onDone);
          }
        } catch (e) {
          console.error('[PRM] Critical error in reading:', e);
          if (onDone) setTimeout(onDone, 200);
        }

        // Resume observer after reading completes
        setTimeout(() => this._resumeObserver(), 2500);
      }, 80);
    };
    
    // Start checking for readiness after scroll completes
    setTimeout(checkReady, 180);
  }

  _buildRange(el) {
    try {
      // If the user already has a selection inside this element, use it (best for word-level starts)
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        const within = el.contains(r.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
        if (within && (sel.toString() || '').trim()) return r;
      }

      // Otherwise create a caret-like range at the start of the element's first non-empty text node.
      const range  = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.textContent || '').trim().length > 0
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      });
      const firstText = walker.nextNode();
      if (!firstText) return null;
      range.setStart(firstText, 0);
      range.setEnd(firstText, 0);
      return range;
    } catch (_) {
      return null;
    }
  }

  _installOnDone(el, onDone) {
    // PRIMARY: event-driven — content.js fires 'tts-paragraph-complete' when all
    // sentence groups are done and isReading is set to false.
    // FALLBACK: polling every 120ms with 5 consecutive silent checks (600ms) required.
    let fired = false;

    const fire = (reason) => {
      if (fired) return;
      fired = true;
      window.removeEventListener('tts-paragraph-complete', eventHandler);
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
      console.log(`[PRM Watchdog] Done — ${reason}`);
      onDone();
    };

    const eventHandler = () => fire('tts-paragraph-complete event');
    window.addEventListener('tts-paragraph-complete', eventHandler, { once: true });

    // Polling fallback — handles edge cases where the event never fires
    // (e.g. word-by-word branch, errors, or old content.js without event dispatch)
    let checks = 0;
    let silentChecks = 0;
    const SILENT_CONFIRM = 5;    // 5 × 120ms = 600ms of confirmed silence
    const maxChecks      = 1200; // ~144s absolute timeout

    const poll = () => {
      if (fired) return;
      checks++;

      const isReadingFlag = (typeof window.isReading !== 'undefined') ? !!window.isReading : false;
      const isSpeaking    = !!(window.speechSynthesis && window.speechSynthesis.speaking);
      const stillReading  = isReadingFlag || isSpeaking;

      if (!stillReading) {
        silentChecks++;
      } else {
        silentChecks = 0;
      }

      if (checks % 25 === 0) {
        console.log(`[PRM Watchdog] #${checks}: isReading=${isReadingFlag}, speaking=${isSpeaking}, silentChecks=${silentChecks}`);
      }

      if (silentChecks >= SILENT_CONFIRM || checks > maxChecks) {
        const reason = silentChecks >= SILENT_CONFIRM
          ? `confirmed silence (${SILENT_CONFIRM * 120}ms)`
          : 'max checks exceeded';
        fire(reason);
        return;
      }

      this._watchdogTimer = setTimeout(poll, 120);
    };

    console.log(`[PRM] Watchdog installed — event-driven + polling fallback (need ${SILENT_CONFIRM} silent polls)`);
    return setTimeout(poll, 400);
  }

  _flashElement(el) {
    const prev = el.style.outline;
    el.style.outline = '2px solid rgba(220,38,38,.8)';
    el.style.outlineOffset = '2px';
    el.style.transition = 'outline 0.3s ease';
    setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = '';
    }, 1200);
  }

  // ──────────────────────────────────────────────────
  //  DOM OBSERVER
  // ──────────────────────────────────────────────────
  _watchDOM() {
    const ignoredClasses = /tts-word-span|tts-word-highlight|paragraph-reading|paragraph-visited|_tts_/;

    this._observer = new MutationObserver(mutations => {
      if (this._observerPaused) return;

      const structural = mutations.some(m => {
        if (m.type !== 'childList') return false;
        return Array.from(m.addedNodes).some(n =>
          n.nodeType === Node.ELEMENT_NODE &&
          !ignoredClasses.test(n.className || '') &&
          !['SPAN', 'MARK'].includes(n.tagName)
        );
      });

      if (!structural) return;

      clearTimeout(this._scanTimer);
      this._scanTimer = setTimeout(() => {
        if (!this._observerPaused && !this._readingActive) this._scan();
      }, this.config.scanDebounceMs);
    });

    this._observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  _pauseObserver() {
    this._observerPaused = true;
  }

  _resumeObserver() {
    setTimeout(() => { this._observerPaused = false; }, 2000);
  }
}

// ──────────────────────────────────────────────────────────
//  BOOT
// ──────────────────────────────────────────────────────────
if (!window.paragraphReaderManager) {
  const prm = new ParagraphReaderManager();
  window.paragraphReaderManager = prm;

  const boot = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(() => prm.initialize(), 400));
    } else {
      setTimeout(() => prm.initialize(), 400);
    }
  };
  boot();

  window.prDebug = () => {
    console.group('[PRM] Debug State');
    console.log('Paragraphs:', prm.paragraphs.size);
    console.log('Active ID:', prm._activeId);
    console.log('Reading:', prm._readingActive);
    console.log('AutoSeq:', prm._autoSeqActive);
    console.log('Visited:', prm._visitedIds.size);
    console.log('Config:', prm.config);
    console.groupEnd();
  };
}
