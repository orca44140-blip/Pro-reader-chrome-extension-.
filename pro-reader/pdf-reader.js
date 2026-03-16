// ===== PDF READER - Advanced TTS Reader with Regex WPM Highlighting =====

'use strict';

// ===== STATE =====
const state = {
  synth: window.speechSynthesis,
  utterance: null,
  isReading: false,
  isPaused: false,
  currentWordIndex: 0,
  wordSpans: [],
  allWords: [],
  totalPages: 0,
  highlightedSpan: null,
  lastHighlightedIndex: -1,
  wpmStartTime: null,
  wpmWordsAtStart: 0,
  wpmHistory: [],
  readingStartTime: null,
  fallbackInterval: null,
  voices: [],
  currentSettings: {
    speed: 1,
    voice: null,
    volume: 1,
    pitch: 1,
    chunkSize: 50,
    highlightStyle: 'background', // Options: background, outline, underline, glow, pulse, scale
    highlightColor: '#FFD700'     // Default gold color
  }
};

// ===== PDF.JS SETUP =====
async function setupPDFJS() {
  const lib = window.pdfjsLib || window.pdfjs || window.PDFJS;
  if (!lib) return null;

  try {
    if (!lib.GlobalWorkerOptions) return lib;

    // pdf.min.js is the main-thread library only; the worker bundle is separate.
    // MV3 CSP blocks loading external scripts as workerSrc directly, but we can
    // fetch() the CDN worker, wrap it in a blob: URL, and use that — which works.
    const version = lib.version || '3.11.174';
    const cdnUrls = [
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.js`,
      `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.js`,
    ];

    for (const url of cdnUrls) {
      try {
        const resp = await fetch(url, { cache: 'force-cache' });
        if (!resp.ok) continue;
        const code = await resp.text();
        const blob = new Blob([code], { type: 'application/javascript' });
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
        console.log('[PDF.js] Worker ready via blob URL from:', url);
        return lib;
      } catch (e) {
        console.warn('[PDF.js] Failed to fetch worker from', url, e.message);
      }
    }

    // All CDN attempts failed — this will likely cause a parse error,
    // but at least it won't hang indefinitely (withTimeout handles it).
    console.error('[PDF.js] No worker source available — PDF parsing will fail.');
  } catch (e) {
    console.warn('[PDF.js] Worker setup error:', e);
  }

  return lib;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out: ${label} (${ms}ms)`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ===== VOICES =====
function loadVoices() {
  const voices = state.synth.getVoices();
  if (voices.length > 0) {
    populateVoiceSelect(voices);
    state.voices = voices;
  }

  state.synth.onvoiceschanged = () => {
    const v = state.synth.getVoices();
    if (v.length > 0) {
      state.voices = v;
      populateVoiceSelect(v);
    }
  };
}

function populateVoiceSelect(voices) {
  const sel = document.getElementById('voice-select');
  if (!sel) return;

  const current = sel.value;
  sel.innerHTML = '';

  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${v.localService ? '📥' : '☁️'} ${v.name} (${v.lang})`;
    sel.appendChild(opt);
  });

  if (current && sel.querySelector(`[value="${current}"]`)) {
    sel.value = current;
  }
}

function getSelectedVoice() {
  const sel = document.getElementById('voice-select');
  if (!sel) return null;
  const idx = parseInt(sel.value);
  return (!isNaN(idx) && state.voices[idx]) ? state.voices[idx] : null;
}

function getSelectedSpeed() {
  const sel = document.getElementById('speed-select');
  return sel ? parseFloat(sel.value) || 1 : 1;
}

// ===== PDF LOADING =====
async function loadPDF() {
  showLoading('Retrieving PDF data…');

  let pdfRecord;
  try {
    const result = await chrome.storage.session.get(['pendingPDF']);
    pdfRecord = result.pendingPDF;
  } catch (e) {
    // Fallback to local storage
    try {
      const result2 = await chrome.storage.local.get(['pendingPDF']);
      pdfRecord = result2.pendingPDF;
    } catch (e2) {
      showError('Could not access storage: ' + e2.message);
      return;
    }
  }

  if (!pdfRecord || !pdfRecord.data) {
    hideLoading();
    document.getElementById('empty-state').style.display = 'block';
    return;
  }

  // Update title
  const title = pdfRecord.name || 'PDF Document';
  document.title = title + ' — Pro Reader';
  document.getElementById('pdf-title').textContent = '📄 ' + title;

  showLoading('Decoding PDF…');

  // Decode base64 to ArrayBuffer
  let arrayBuffer;
  try {
    const binaryStr = atob(pdfRecord.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    arrayBuffer = bytes.buffer;
  } catch (e) {
    showError('Failed to decode PDF data: ' + e.message);
    return;
  }

  showLoading('Loading PDF engine…');

  const pdfjsLib = await setupPDFJS();
  if (!pdfjsLib) {
    // PDF.js not available — try to read raw text if it was pre-extracted
    if (pdfRecord.text) {
      renderPlainText(pdfRecord.text, title);
    } else {
      showError('PDF.js library not loaded. Cannot parse PDF.');
    }
    return;
  }

  showLoading('Parsing PDF with PDF.js…');

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

    let pdf;
    try {
      pdf = await withTimeout(loadingTask.promise, 20000, 'PDF document load');
    } catch (loadErr) {
      if (loadingTask.destroy) { try { loadingTask.destroy(); } catch (_) {} }
      throw loadErr;
    }

    state.totalPages = pdf.numPages;
    document.getElementById('current-page-stat').textContent = '1 / ' + pdf.numPages;
    showLoading(`Extracting text from ${pdf.numPages} pages…`);

    const pageTexts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      setLoadingDetail(`Page ${p} of ${pdf.numPages}…`);
      try {
        const page = await withTimeout(pdf.getPage(p), 8000, `getPage(${p})`);
        const content = await withTimeout(page.getTextContent(), 8000, `getTextContent(${p})`);

        let pageStr = '';
        let lastY = null;

        for (const item of content.items) {
          if (!item.str) continue;
          if (lastY !== null && Math.abs((item.transform[5] || 0) - lastY) > 5) {
            pageStr += '\n';
          }
          pageStr += item.str;
          if (item.hasEOL) pageStr += '\n';
          else pageStr += ' ';
          lastY = item.transform[5] || 0;
        }

        pageTexts.push({ page: p, text: pageStr.trim() });
      } catch (pageErr) {
        console.warn(`Error extracting page ${p}:`, pageErr.message || pageErr);
        pageTexts.push({ page: p, text: '' });
      }

      // Yield to UI every 5 pages to prevent browser "unresponsive" warnings
      if (p % 5 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    hideLoading();
    renderTextPages(pageTexts);

  } catch (err) {
    showError('Failed to parse PDF: ' + (err.message || err) + '\n\nTry a text-based PDF (not a scanned image).');
  }
}

// ===== RENDER =====
function renderTextPages(pages) {
  const container = document.getElementById('text-content') || document.getElementById('text-container');
  container.innerHTML = '';
  state.wordSpans = [];
  state.allWords = [];
  let globalIndex = 0;

  let hasContent = false;

  pages.forEach(({ page, text }) => {
    if (!text.trim()) return;
    hasContent = true;

    const pageMarker = document.createElement('div');
    pageMarker.className = 'page-marker';
    pageMarker.textContent = `Page ${page}`;
    pageMarker.setAttribute('data-page', page);
    container.appendChild(pageMarker);

    // Split into paragraphs preserving structure
    const paragraphs = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);

    if (paragraphs.length === 0) {
      const paragraphs2 = [text.trim()];
      paragraphs.push(...paragraphs2);
    }

    paragraphs.forEach(paraText => {
      const p = document.createElement('p');
      p.className = 'text-paragraph';

      const words = paraText.split(/\s+/).filter(w => w.trim());

      words.forEach(rawWord => {
        const span = document.createElement('span');
        span.className = 'word-span';
        span.textContent = rawWord;
        span.setAttribute('data-word-index', globalIndex);

        const capturedIndex = globalIndex;
        span.addEventListener('click', () => jumpToWord(capturedIndex));

        p.appendChild(span);
        p.appendChild(document.createTextNode(' '));

        state.wordSpans.push(span);
        state.allWords.push(rawWord);
        globalIndex++;
      });

      container.appendChild(p);
    });
  });

  if (!hasContent) {
    document.getElementById('empty-state').style.display = 'block';
    return;
  }

  // Update stats
  document.getElementById('total-words-stat').textContent = state.allWords.length;
  document.getElementById('progress-label').textContent = '0%';

  // Set up progress bar click
  document.getElementById('progress-track').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const targetIndex = Math.floor(pct * state.allWords.length);
    jumpToWord(targetIndex);
  });

  // Auto-start reading
  setTimeout(() => handlePlay(), 800);
}

function renderPlainText(text, title) {
  const pages = [{ page: 1, text }];
  renderTextPages(pages);
}

// ===== WPM CALCULATION =====
function calculateWPM() {
  if (!state.wpmStartTime) return 0;
  const now = Date.now();
  const elapsedMin = (now - state.wpmStartTime) / 60000;
  const wordsRead = state.currentWordIndex - state.wpmWordsAtStart;
  if (elapsedMin <= 0 || wordsRead <= 0) return 0;

  const wpm = Math.round(wordsRead / elapsedMin);

  // Keep a rolling average
  state.wpmHistory.push(wpm);
  if (state.wpmHistory.length > 10) state.wpmHistory.shift();
  const avg = Math.round(state.wpmHistory.reduce((a, b) => a + b, 0) / state.wpmHistory.length);

  return avg;
}

function updateWPMDisplay() {
  const wpm = calculateWPM();
  const el = document.getElementById('wpm-display');
  if (!el) return;

  el.textContent = wpm + ' WPM';
  el.className = '';

  if (wpm === 0) {
    el.classList.add('wpm-normal');
  } else if (wpm < 150) {
    el.classList.add('wpm-slow');
  } else if (wpm <= 350) {
    el.classList.add('wpm-normal');
  } else {
    el.classList.add('wpm-fast');
  }
}

// ===== PDF HIGHLIGHT EFFECT STYLES - MODERN ADVANCED EFFECTS =====

function clearPDFHighlightStyles(span) {
  if (!span || !span.style) return;
  [
    'background', 'background-size', 'backgroundColor',
    'textDecoration', 'textDecorationColor', 'textDecorationThickness',
    'textUnderlineOffset', 'outline', 'boxShadow', 'textShadow',
    'transform', 'animation', 'filter', 'backdropFilter',
    'fontWeight', 'padding', 'borderRadius', 'display', 'letterSpacing',
    'color', 'borderLeft', 'borderBottom', 'backgroundClip', 'WebkitBackgroundClip',
    'WebkitTextStroke', 'textStroke', 'position', 'paddingBottom'
  ].forEach(p => {
    try { span.style[p] = ''; } catch (_) {}
  });
  try { span.style.removeProperty('--pdf-c1'); } catch (_) {}
  try { span.style.removeProperty('--pdf-c2'); } catch (_) {}
  try { span.style.removeProperty('--pdf-c3'); } catch (_) {}
  try { span.style.removeProperty('--pdf-c4'); } catch (_) {}
}

function applyPDFHighlightEffect(span, settings) {
  if (!span) return;

  const style = ((settings && settings.highlightStyle) || 'background').toLowerCase();
  const highlightColor = (settings && settings.highlightColor) || '#FFD700';

  const c1 = hexToRgbaColor(highlightColor, 1);
  const c2 = hexToRgbaColor(highlightColor, 0.65);
  const c3 = hexToRgbaColor(highlightColor, 0.35);
  const c4 = hexToRgbaColor(highlightColor, 0.15);
  const c5 = hexToRgbaColor(highlightColor, 0.07);

  clearPDFHighlightStyles(span);

  span.style.setProperty('--pdf-c1', c1);
  span.style.setProperty('--pdf-c2', c2);
  span.style.setProperty('--pdf-c3', c3);
  span.style.setProperty('--pdf-c4', c4);

  ensurePDFAnimations();

  switch (style) {
    case 'background':
      span.style.padding = '1px 6px';
      span.style.borderRadius = '5px';
      span.style.background = 'transparent';
      span.style.color = c1;
      span.style.fontWeight = '700';
      span.style.letterSpacing = '0.01em';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)';
      break;

    case 'outline':
      span.style.padding = '1px 5px';
      span.style.borderRadius = '5px';
      span.style.background = c5;
      span.style.boxShadow = `0 0 0 2px ${c1}, 0 0 10px ${c2}, 0 0 24px ${c3}`;
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-outline-breathe 2s ease-in-out 0.18s infinite';
      break;

    case 'underline':
      span.style.textDecoration = 'underline';
      span.style.textDecorationColor = c1;
      span.style.textDecorationThickness = '3px';
      span.style.textUnderlineOffset = '4px';
      span.style.fontWeight = '600';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-underline-glow 2s ease-in-out 0.18s infinite';
      break;

    case 'glow':
      span.style.background = `radial-gradient(ellipse at center, ${c4}, transparent 80%)`;
      span.style.textShadow = `0 0 4px ${c1}, 0 0 10px ${c1}, 0 0 20px ${c2}, 0 0 36px ${c3}`;
      span.style.filter = `brightness(1.1) drop-shadow(0 0 4px ${c2})`;
      span.style.fontWeight = '600';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-glow-breathe 2s ease-in-out 0.18s infinite';
      break;

    case 'pulse':
      span.style.padding = '1px 5px';
      span.style.borderRadius = '5px';
      span.style.background = `linear-gradient(135deg, ${c3}, ${c4})`;
      span.style.fontWeight = '600';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-pulse-beat 1.2s ease-in-out 0.18s infinite';
      break;

    case 'scale':
      span.style.padding = '1px 5px';
      span.style.borderRadius = '5px';
      span.style.display = 'inline-block';
      span.style.background = `linear-gradient(135deg, ${c3}, ${c4})`;
      span.style.boxShadow = `0 2px 12px ${c3}, 0 0 24px ${c4}`;
      span.style.fontWeight = '700';
      span.style.animation = 'pdf-scale-pop 0.28s cubic-bezier(0.34,1.56,0.64,1), pdf-float 2s ease-in-out 0.28s infinite';
      break;

    case 'text-color-only':
      span.style.color = c1;
      span.style.fontWeight = '700';
      break;

    case 'text-color-minimal':
      span.style.color = c1;
      span.style.fontWeight = '700';
      span.style.padding = '0px 2px';
      span.style.borderRadius = '3px';
      span.style.background = c5;
      break;

    case 'text-shadow':
      span.style.color = c1;
      span.style.fontWeight = '700';
      span.style.textShadow = `0 0 2px ${c1}, 0 0 4px ${c2}, 0 0 8px ${c3}`;
      break;

    case 'text-bold-dark':
      span.style.color = '#ffffff';
      span.style.fontWeight = '700';
      span.style.padding = '2px 6px';
      span.style.borderRadius = '4px';
      span.style.background = 'rgba(0, 0, 0, 0.7)';
      break;

    case 'wave-underline':
      span.style.textDecoration = 'underline wavy';
      span.style.textDecorationColor = c1;
      span.style.textDecorationThickness = '2px';
      span.style.textUnderlineOffset = '5px';
      span.style.fontWeight = '600';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-wave-pulse 2s ease-in-out 0.18s infinite';
      break;

    case 'box-shadow-only':
      span.style.padding = '2px 6px';
      span.style.borderRadius = '5px';
      span.style.boxShadow = `0 0 0 2px ${c1}, 0 0 12px ${c2}, inset 0 0 4px ${c5}`;
      span.style.fontWeight = '600';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-shadow-breathe 2s ease-in-out 0.18s infinite';
      break;

    case 'gradient-text':
      span.style.fontWeight = '700';
      span.style.background = `linear-gradient(90deg, ${c1} 0%, ${c2} 50%, ${c3} 100%)`;
      span.style.backgroundClip = 'text';
      span.style.WebkitBackgroundClip = 'text';
      span.style.color = 'transparent';
      span.style.letterSpacing = '0.02em';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-gradient-shift 3s ease-in-out 0.18s infinite';
      break;

    case 'neon-glow':
      span.style.color = c1;
      span.style.fontWeight = '700';
      span.style.textShadow = `0 0 4px ${c1}, 0 0 8px ${c1}, 0 0 12px ${c1}, 0 0 20px ${c2}, 0 0 32px ${c2}`;
      span.style.filter = `brightness(1.2) drop-shadow(0 0 8px ${c1})`;
      span.style.letterSpacing = '0.03em';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-neon-pulse 1.5s ease-in-out 0.18s infinite';
      break;

    case 'shimmer':
      span.style.fontWeight = '700';
      span.style.color = c1;
      span.style.padding = '2px 6px';
      span.style.borderRadius = '4px';
      span.style.background = `linear-gradient(110deg, transparent 0%, ${c4} 25%, ${c2} 50%, ${c4} 75%, transparent 100%)`;
      span.style.backgroundSize = '300% 100%';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-shimmer-wave 2s linear 0.18s infinite';
      break;

    case 'spotlight':
      span.style.fontWeight = '700';
      span.style.color = '#000000';
      span.style.padding = '3px 8px';
      span.style.borderRadius = '6px';
      span.style.background = `radial-gradient(ellipse at center, ${c1} 0%, ${c2} 50%, ${c3} 100%)`;
      span.style.boxShadow = `0 0 16px ${c2}, 0 0 32px ${c3}, inset 0 2px 8px rgba(255,255,255,0.3)`;
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-spotlight-pulse 2s ease-in-out 0.18s infinite';
      break;

    case 'double-underline':
      span.style.fontWeight = '600';
      span.style.paddingBottom = '4px';
      span.style.borderBottom = `2px solid ${c1}`;
      span.style.boxShadow = `0 3px 0 ${c2}`;
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-double-underline-glow 2s ease-in-out 0.18s infinite';
      break;

    case 'stroke-only':
      span.style.fontWeight = '700';
      span.style.color = 'transparent';
      span.style.WebkitTextStroke = `2px ${c1}`;
      span.style.textStroke = `2px ${c1}`;
      span.style.letterSpacing = '0.02em';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-stroke-pulse 2s ease-in-out 0.18s infinite';
      break;

    case 'color-fade':
      span.style.fontWeight = '700';
      span.style.padding = '2px 6px';
      span.style.borderRadius = '4px';
      span.style.background = c3;
      span.style.color = c1;
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-color-fade 3s ease-in-out 0.18s infinite';
      break;

    case 'rainbow':
      span.style.fontWeight = '700';
      span.style.padding = '2px 6px';
      span.style.borderRadius = '4px';
      span.style.background = `linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)`;
      span.style.backgroundSize = '400% 100%';
      span.style.WebkitBackgroundClip = 'text';
      span.style.backgroundClip = 'text';
      span.style.color = 'transparent';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-rainbow-shift 4s linear 0.18s infinite';
      break;

    case 'glitch':
      span.style.fontWeight = '700';
      span.style.color = c1;
      span.style.position = 'relative';
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-glitch-shake 3s ease-in-out 0.18s infinite';
      span.style.textShadow = `2px 0 ${c2}, -2px 0 ${c3}`;
      break;

    case 'blur-highlight':
      span.style.fontWeight = '700';
      span.style.color = '#000000';
      span.style.padding = '3px 8px';
      span.style.borderRadius = '6px';
      span.style.background = c2;
      span.style.backdropFilter = 'blur(4px)';
      span.style.WebkitBackdropFilter = 'blur(4px)';
      span.style.boxShadow = `0 0 20px ${c3}, inset 0 0 12px rgba(255,255,255,0.2)`;
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), pdf-blur-pulse 2.5s ease-in-out 0.18s infinite';
      break;

    case 'modern-minimal':
      span.style.color = c1;
      span.style.fontWeight = '600';
      span.style.padding = '1px 4px';
      span.style.borderRadius = '3px';
      span.style.background = 'rgba(0,0,0,0.03)';
      span.style.borderLeft = `3px solid ${c1}`;
      span.style.animation = 'pdf-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)';
      break;
  }
}

function ensurePDFAnimations() {
  if (document.querySelector('style[data-pdf-animations]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-pdf-animations', 'true');
  style.textContent = `
    @keyframes pdf-entry {
      0%   { transform: scale(0.75); opacity: 0.3; }
      60%  { transform: scale(1.07); }
      100% { transform: scale(1);    opacity: 1;   }
    }
    @keyframes pdf-scale-pop {
      0%   { transform: scale(0.6);  opacity: 0.4; }
      65%  { transform: scale(1.15); }
      100% { transform: scale(1);    opacity: 1;   }
    }
    @keyframes pdf-bg-sweep {
      0%   { background-position:  200% center; }
      100% { background-position: -200% center; }
    }
    @keyframes pdf-outline-breathe {
      0%, 100% { box-shadow: 0 0 0 2px var(--pdf-c1), 0 0 10px var(--pdf-c2), 0 0 22px var(--pdf-c3); }
      50%       { box-shadow: 0 0 0 2.5px var(--pdf-c1), 0 0 18px var(--pdf-c1), 0 0 38px var(--pdf-c2); }
    }
    @keyframes pdf-underline-glow {
      0%, 100% {
        text-decoration-thickness: 2px;
        text-underline-offset: 4px;
        filter: drop-shadow(0 2px 2px var(--pdf-c3));
      }
      50% {
        text-decoration-thickness: 3px;
        text-underline-offset: 5px;
        filter: drop-shadow(0 2px 7px var(--pdf-c1));
      }
    }
    @keyframes pdf-glow-breathe {
      0%, 100% {
        text-shadow: 0 0 3px var(--pdf-c1), 0 0 8px var(--pdf-c1), 0 0 18px var(--pdf-c2), 0 0 32px var(--pdf-c3);
        filter: brightness(1.08) drop-shadow(0 0 3px var(--pdf-c2));
      }
      50% {
        text-shadow: 0 0 5px var(--pdf-c1), 0 0 14px var(--pdf-c1), 0 0 26px var(--pdf-c1), 0 0 48px var(--pdf-c2);
        filter: brightness(1.18) drop-shadow(0 0 7px var(--pdf-c1));
      }
    }
    @keyframes pdf-pulse-beat {
      0%, 100% { transform: scale(1);    box-shadow: 0 0 0  0px var(--pdf-c2); filter: brightness(1);    }
      40%       { transform: scale(1.08); box-shadow: 0 0 0  6px var(--pdf-c3); filter: brightness(1.12); }
      60%       { transform: scale(1.04); box-shadow: 0 0 0 10px var(--pdf-c4); filter: brightness(1.06); }
    }
    @keyframes pdf-float {
      0%, 100% { transform: translateY(0)    scale(1);    box-shadow: 0 2px 12px var(--pdf-c3), 0 0 24px var(--pdf-c4); }
      50%       { transform: translateY(-2px) scale(1.05); box-shadow: 0 4px 20px var(--pdf-c2), 0 0 36px var(--pdf-c3); }
    }
    @keyframes pdf-wave-pulse {
      0%, 100% {
        text-decoration-thickness: 2px;
        text-underline-offset: 5px;
        filter: drop-shadow(0 1px 2px var(--pdf-c3));
      }
      50% {
        text-decoration-thickness: 3px;
        text-underline-offset: 6px;
        filter: drop-shadow(0 2px 6px var(--pdf-c1));
      }
    }
    @keyframes pdf-shadow-breathe {
      0%, 100% { box-shadow: 0 0 0 2px var(--pdf-c1), 0 0 12px var(--pdf-c2), inset 0 0 4px var(--pdf-c5); }
      50%       { box-shadow: 0 0 0 3px var(--pdf-c1), 0 0 20px var(--pdf-c1), inset 0 0 8px var(--pdf-c4); }
    }
    @keyframes pdf-gradient-shift {
      0%, 100% { filter: brightness(1) hue-rotate(0deg); }
      50%       { filter: brightness(1.15) hue-rotate(15deg); }
    }
    @keyframes pdf-neon-pulse {
      0%, 100% {
        text-shadow: 0 0 4px var(--pdf-c1), 0 0 8px var(--pdf-c1), 0 0 12px var(--pdf-c1), 0 0 20px var(--pdf-c2), 0 0 32px var(--pdf-c2);
        filter: brightness(1.2) drop-shadow(0 0 8px var(--pdf-c1));
      }
      50% {
        text-shadow: 0 0 6px var(--pdf-c1), 0 0 12px var(--pdf-c1), 0 0 18px var(--pdf-c1), 0 0 28px var(--pdf-c1), 0 0 42px var(--pdf-c2);
        filter: brightness(1.35) drop-shadow(0 0 12px var(--pdf-c1));
      }
    }
    @keyframes pdf-shimmer-wave {
      0%   { background-position: 200% center; }
      100% { background-position: -200% center; }
    }
    @keyframes pdf-spotlight-pulse {
      0%, 100% {
        box-shadow: 0 0 16px var(--pdf-c2), 0 0 32px var(--pdf-c3), inset 0 2px 8px rgba(255,255,255,0.3);
        filter: brightness(1);
      }
      50% {
        box-shadow: 0 0 24px var(--pdf-c1), 0 0 48px var(--pdf-c2), inset 0 2px 12px rgba(255,255,255,0.5);
        filter: brightness(1.1);
      }
    }
    @keyframes pdf-double-underline-glow {
      0%, 100% {
        box-shadow: 0 3px 0 var(--pdf-c2);
        filter: drop-shadow(0 3px 2px var(--pdf-c3));
      }
      50% {
        box-shadow: 0 3px 0 var(--pdf-c1);
        filter: drop-shadow(0 3px 6px var(--pdf-c1));
      }
    }
    @keyframes pdf-stroke-pulse {
      0%, 100% {
        filter: drop-shadow(0 0 2px var(--pdf-c2));
      }
      50% {
        filter: drop-shadow(0 0 8px var(--pdf-c1));
      }
    }
    @keyframes pdf-color-fade {
      0%, 100% {
        filter: brightness(1) saturate(1);
        opacity: 1;
      }
      50% {
        filter: brightness(1.15) saturate(1.2);
        opacity: 0.85;
      }
    }
    @keyframes pdf-rainbow-shift {
      0%   { background-position: 0% center; }
      100% { background-position: 400% center; }
    }
    @keyframes pdf-glitch-shake {
      0%, 90%, 100% {
        transform: translate(0, 0) skew(0deg);
        text-shadow: 2px 0 var(--pdf-c2), -2px 0 var(--pdf-c3);
      }
      92% {
        transform: translate(-2px, 1px) skew(-1deg);
        text-shadow: 3px 0 var(--pdf-c2), -3px 0 var(--pdf-c3);
      }
      94% {
        transform: translate(2px, -1px) skew(1deg);
        text-shadow: -3px 0 var(--pdf-c2), 3px 0 var(--pdf-c3);
      }
      96% {
        transform: translate(-1px, 0) skew(0.5deg);
        text-shadow: 2px 0 var(--pdf-c2), -2px 0 var(--pdf-c3);
      }
    }
    @keyframes pdf-blur-pulse {
      0%, 100% {
        box-shadow: 0 0 20px var(--pdf-c3), inset 0 0 12px rgba(255,255,255,0.2);
        filter: brightness(1);
      }
      50% {
        box-shadow: 0 0 32px var(--pdf-c2), inset 0 0 18px rgba(255,255,255,0.3);
        filter: brightness(1.1);
      }
    }
  `;
  if (document.head) document.head.appendChild(style);
}

function hexToRgbaColor(hex, alpha) {
  try {
    let h = (hex || '#FFD700').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16) || 255;
      const g = parseInt(h.slice(2, 4), 16) || 215;
      const b = parseInt(h.slice(4, 6), 16) || 0;
      return `rgba(${r},${g},${b},${Math.min(1, alpha || 0.8)})`;
    }
  } catch (_) {}
  return `rgba(255,215,0,${Math.min(1, alpha || 0.8)})`;
}

// ===== REGEX WORD MATCHING + HIGHLIGHTING =====
function buildWordRegex(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the word with optional trailing punctuation
  return new RegExp('^' + escaped + '[.,!?;:\'"\\-]*$', 'i');
}

function highlightWordByRegex(word, nominalIndex) {
  // Remove previous highlight
  if (state.highlightedSpan) {
    state.highlightedSpan.classList.remove('word-highlight', 'word-upcoming');
    clearPDFHighlightStyles(state.highlightedSpan);
    state.highlightedSpan = null;
  }

  if (nominalIndex < 0 || nominalIndex >= state.wordSpans.length) return;

  const regex = buildWordRegex(word);
  let targetSpan = state.wordSpans[nominalIndex];

  // Regex verification: if the span text doesn't match the expected word, search nearby
  if (targetSpan && !regex.test(targetSpan.textContent.trim())) {
    let found = false;
    for (let offset = 1; offset <= 20; offset++) {
      const below = nominalIndex - offset;
      const above = nominalIndex + offset;

      if (below >= 0 && state.wordSpans[below] && regex.test(state.wordSpans[below].textContent.trim())) {
        targetSpan = state.wordSpans[below];
        found = true;
        break;
      }
      if (above < state.wordSpans.length && state.wordSpans[above] && regex.test(state.wordSpans[above].textContent.trim())) {
        targetSpan = state.wordSpans[above];
        found = true;
        break;
      }
    }

    if (!found) {
      // Fallback: just use the nominal index even if text doesn't match
      targetSpan = state.wordSpans[nominalIndex];
    }
  }

  if (!targetSpan) return;

  targetSpan.classList.add('word-highlight');
  applyPDFHighlightEffect(targetSpan, state.currentSettings);
  state.highlightedSpan = targetSpan;

  // Highlight upcoming words subtly (lookahead)
  for (let i = 1; i <= 3; i++) {
    const upcoming = state.wordSpans[nominalIndex + i];
    if (upcoming) upcoming.classList.add('word-upcoming');
  }
  // Remove upcoming highlights from old positions
  if (nominalIndex > 0) {
    for (let i = 1; i <= 4; i++) {
      const old = state.wordSpans[nominalIndex - i];
      if (old) old.classList.remove('word-upcoming');
    }
  }

  // Auto-scroll to highlighted word (smooth, centered)
  try {
    const rect = targetSpan.getBoundingClientRect();
    const container = document.getElementById('text-container');
    const containerRect = container.getBoundingClientRect();
    const relativeTop = rect.top - containerRect.top + container.scrollTop;
    const targetScrollTop = relativeTop - (container.clientHeight / 2) + (rect.height / 2);

    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  } catch (e) {
    targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  updateWPMDisplay();
}

// ===== TTS ENGINE =====
function buildCharToWordMap(wordList, startIndex) {
  const map = [];
  let charPos = 0;

  for (let i = 0; i < wordList.length; i++) {
    const word = wordList[i];
    map.push({
      start: charPos,
      end: charPos + word.length,
      globalIndex: startIndex + i,
      word
    });
    charPos += word.length + 1; // +1 for space
  }

  return map;
}

function speakChunk(startIndex, endIndex) {
  if (!state.isReading || state.isPaused) return;

  const wordSlice = state.allWords.slice(startIndex, endIndex);
  if (wordSlice.length === 0) {
    handleStop();
    return;
  }

  const text = wordSlice.join(' ');
  const charMap = buildCharToWordMap(wordSlice, startIndex);

  const utterance = new SpeechSynthesisUtterance(text);
  state.utterance = utterance;

  utterance.rate = getSelectedSpeed();
  utterance.pitch = 1;
  utterance.volume = 1;

  const voice = getSelectedVoice();
  if (voice) utterance.voice = voice;

  let boundaryCount = 0;
  let chunkStartTime = null;
  let onendFired = false;

  utterance.onstart = () => {
    chunkStartTime = performance.now();
    boundaryCount = 0;
    onendFired = false;

    if (!state.wpmStartTime) {
      state.wpmStartTime = Date.now();
      state.wpmWordsAtStart = startIndex;
    }

    if (state.fallbackInterval) clearInterval(state.fallbackInterval);
    state.fallbackInterval = setInterval(() => {
      if (!state.isReading || state.isPaused) {
        clearInterval(state.fallbackInterval);
        state.fallbackInterval = null;
        return;
      }

      const elapsed = chunkStartTime ? performance.now() - chunkStartTime : 0;

      // ── onend watchdog: Chrome sometimes doesn't fire onend ───────────────
      if (!onendFired && elapsed > 800 && !state.synth.speaking && !state.synth.pending) {
        console.warn('[PDF speakChunk] onend not fired — advancing manually');
        onendFired = true;
        clearInterval(state.fallbackInterval);
        state.fallbackInterval = null;
        state.currentWordIndex = endIndex;
        if (endIndex < state.allWords.length) readNextChunk();
        else finishReading();
        return;
      }

      // ── Time-based highlight fallback ─────────────────────────────────────
      if (boundaryCount < 2 && elapsed > 400) {
        const msPerWord = 60000 / (220 * utterance.rate);
        const estimated = Math.floor(elapsed / msPerWord);
        const globalIdx = startIndex + Math.min(estimated, wordSlice.length - 1);

        if (globalIdx < endIndex && globalIdx !== state.lastHighlightedIndex) {
          highlightWordByRegex(state.allWords[globalIdx], globalIdx);
          state.lastHighlightedIndex = globalIdx;
          state.currentWordIndex = globalIdx;
          updateProgress(globalIdx);
        }
      }
    }, 40);
  };

  utterance.onboundary = (event) => {
    if (!state.isReading || event.name !== 'word') return;
    boundaryCount++;

    try {
      const charIndex = event.charIndex;

      // Find closest word in charMap using binary-like search
      let bestIdx = 0;
      let bestDist = Infinity;

      for (let i = 0; i < charMap.length; i++) {
        const dist = Math.abs(charIndex - charMap[i].start);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
        if (charIndex < charMap[i].start) break; // Past the char position
      }

      const globalIdx = charMap[bestIdx].globalIndex;
      const word = charMap[bestIdx].word;

      if (globalIdx !== state.lastHighlightedIndex) {
        highlightWordByRegex(word, globalIdx);
        state.lastHighlightedIndex = globalIdx;
        state.currentWordIndex = globalIdx;
        updateProgress(globalIdx);
      }
    } catch (e) {
      console.warn('Boundary event error:', e);
    }
  };

  utterance.onend = () => {
    onendFired = true;
    if (state.fallbackInterval) {
      clearInterval(state.fallbackInterval);
      state.fallbackInterval = null;
    }

    if (state.isReading && !state.isPaused) {
      state.currentWordIndex = endIndex;
      if (endIndex < state.allWords.length) {
        readNextChunk();
      } else {
        finishReading();
      }
    }
  };

  utterance.onerror = (event) => {
    if (state.fallbackInterval) {
      clearInterval(state.fallbackInterval);
      state.fallbackInterval = null;
    }

    if (event.error === 'interrupted') return;

    console.warn('TTS error:', event.error);
    if (state.isReading && !state.isPaused) {
      state.currentWordIndex = endIndex;
      setTimeout(readNextChunk, 50);
    }
  };

  try {
    state.synth.speak(utterance);
  } catch (e) {
    console.error('Speech synthesis error:', e);
    state.currentWordIndex = endIndex;
    setTimeout(readNextChunk, 100);
  }
}

function readNextChunk() {
  if (!state.isReading || state.isPaused) return;

  if (state.currentWordIndex >= state.allWords.length) {
    finishReading();
    return;
  }

  const chunkSize = state.currentSettings.chunkSize;
  const endIndex = Math.min(state.currentWordIndex + chunkSize, state.allWords.length);

  updateProgress(state.currentWordIndex);
  speakChunk(state.currentWordIndex, endIndex);
}

function finishReading() {
  state.isReading = false;
  state.isPaused = false;

  const playBtn = document.getElementById('play-btn');
  if (playBtn) { playBtn.textContent = '▶ Play'; playBtn.classList.remove('active'); }

  updateProgress(state.allWords.length);

  // Show completion toast
  showToast('✅ Finished reading!', 3000);
}

// ===== CONTROLS =====
function handlePlay() {
  if (state.allWords.length === 0) return;

  if (state.isPaused) {
    handleResume();
    return;
  }

  if (state.isReading) {
    handlePause();
    return;
  }

  state.isReading = true;
  state.isPaused = false;
  state.wpmStartTime = null;
  state.wpmHistory = [];
  state.lastHighlightedIndex = -1;
  state.readingStartTime = Date.now();

  const playBtn = document.getElementById('play-btn');
  if (playBtn) { playBtn.textContent = '⏸ Pause'; playBtn.classList.add('active'); }

  // Start stats timer
  startStatsTimer();

  // Cancel any pending speech, then wait briefly before speaking.
  // Chrome requires a gap between cancel() and speak() or the first onend may not fire.
  state.synth.cancel();
  setTimeout(readNextChunk, 120);
}

function handlePause() {
  if (!state.isReading || state.isPaused) return;

  state.isPaused = true;
  state.synth.pause();

  const playBtn = document.getElementById('play-btn');
  if (playBtn) { playBtn.textContent = '▶ Resume'; }

  if (state.fallbackInterval) {
    clearInterval(state.fallbackInterval);
    state.fallbackInterval = null;
  }
}

function handleResume() {
  if (!state.isPaused) return;

  state.isPaused = false;

  const playBtn = document.getElementById('play-btn');
  if (playBtn) { playBtn.textContent = '⏸ Pause'; }

  // Reset WPM tracking on resume
  state.wpmStartTime = Date.now();
  state.wpmWordsAtStart = state.currentWordIndex;

  // Resume or restart chunk
  if (state.synth.paused) {
    state.synth.resume();
  } else {
    state.synth.cancel();
    setTimeout(readNextChunk, 50);
  }
}

function handleStop() {
  state.isReading = false;
  state.isPaused = false;
  state.currentWordIndex = 0;
  state.lastHighlightedIndex = -1;
  state.wpmStartTime = null;
  state.wpmHistory = [];

  state.synth.cancel();

  if (state.fallbackInterval) {
    clearInterval(state.fallbackInterval);
    state.fallbackInterval = null;
  }

  if (state.highlightedSpan) {
    state.highlightedSpan.classList.remove('word-highlight', 'word-upcoming');
    clearPDFHighlightStyles(state.highlightedSpan);
    state.highlightedSpan = null;
  }

  // Remove all upcoming highlights
  document.querySelectorAll('.word-upcoming').forEach(s => s.classList.remove('word-upcoming'));

  const playBtn = document.getElementById('play-btn');
  if (playBtn) { playBtn.textContent = '▶ Play'; playBtn.classList.remove('active'); }

  updateProgress(0);
  updateWPMDisplay();
}

function jumpToWord(index) {
  state.synth.cancel();

  if (state.fallbackInterval) {
    clearInterval(state.fallbackInterval);
    state.fallbackInterval = null;
  }

  state.currentWordIndex = Math.max(0, Math.min(index, state.allWords.length - 1));
  state.lastHighlightedIndex = -1;
  state.wpmStartTime = Date.now();
  state.wpmWordsAtStart = state.currentWordIndex;
  state.wpmHistory = [];

  if (state.isReading && !state.isPaused) {
    setTimeout(readNextChunk, 50);
  } else if (!state.isReading) {
    // Start playing from this position
    state.isReading = true;
    state.isPaused = false;

    const playBtn = document.getElementById('play-btn');
    if (playBtn) { playBtn.textContent = '⏸ Pause'; playBtn.classList.add('active'); }

    setTimeout(readNextChunk, 50);
  }
}

// ===== PROGRESS & STATS =====
function updateProgress(wordIndex) {
  const total = state.allWords.length;
  if (total === 0) return;

  const pct = Math.round((wordIndex / total) * 100);
  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  const wordsEl = document.getElementById('words-read-stat');

  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = pct + '%';
  if (wordsEl) wordsEl.textContent = wordIndex;

  // Detect current page
  if (state.wordSpans[wordIndex]) {
    const span = state.wordSpans[wordIndex];
    const para = span.closest('.text-paragraph');
    if (para) {
      let sibling = para.previousElementSibling;
      while (sibling) {
        if (sibling.classList.contains('page-marker')) {
          const pageNum = sibling.getAttribute('data-page');
          if (pageNum) {
            document.getElementById('current-page-stat').textContent = pageNum + ' / ' + state.totalPages;
          }
          break;
        }
        sibling = sibling.previousElementSibling;
      }
    }
  }
}

let statsTimerInterval = null;
let _keepaliveTick = 0;
function startStatsTimer() {
  if (statsTimerInterval) clearInterval(statsTimerInterval);
  _keepaliveTick = 0;
  statsTimerInterval = setInterval(() => {
    if (!state.isReading || !state.readingStartTime) return;

    // Chrome keepalive: prevent background-tab synthesis from dying silently
    _keepaliveTick++;
    if (_keepaliveTick % 10 === 0 && state.synth.speaking && !state.isPaused) {
      try { state.synth.pause(); state.synth.resume(); } catch (_) {}
    }

    const elapsed = Math.floor((Date.now() - state.readingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeEl = document.getElementById('time-stat');
    if (timeEl) timeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

// ===== UI UTILITIES =====
function showLoading(msg) {
  const overlay = document.getElementById('loading-overlay');
  const text = overlay && overlay.querySelector('.loading-text');
  if (overlay) overlay.style.display = 'flex';
  if (text) text.textContent = msg;
}

function setLoadingDetail(detail) {
  const sub = document.getElementById('loading-detail');
  if (sub) sub.textContent = detail;
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.style.opacity = '1';
    }, 300);
  }
}

function showError(msg) {
  hideLoading();
  const el = document.getElementById('error-box');
  if (el) {
    el.style.display = 'block';
    el.textContent = '⚠️ ' + msg;
  }
}

function showToast(msg, duration = 2500) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: rgba(0,255,170,0.15); border: 1.5px solid var(--primary);
    color: var(--primary); padding: 10px 22px; border-radius: 24px;
    font-size: 14px; font-weight: 600; z-index: 9999;
    box-shadow: 0 0 20px rgba(0,255,170,0.3);
    animation: fadeIn 0.3s ease;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== HIGHLIGHT COLOR =====
function applyHighlightColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  const root = document.documentElement;
  root.style.setProperty('--highlight-bg', hex);
  root.style.setProperty('--highlight-text', brightness > 128 ? '#000' : '#fff');
  root.style.setProperty('--highlight-glow', `0 0 14px rgba(${r},${g},${b},0.7)`);

  let dynStyle = document.getElementById('pdf-dynamic-highlight');
  if (!dynStyle) {
    dynStyle = document.createElement('style');
    dynStyle.id = 'pdf-dynamic-highlight';
    document.head.appendChild(dynStyle);
  }
  dynStyle.textContent = `.word-upcoming { background: rgba(${r},${g},${b},0.12) !important; }`;

  const picker = document.getElementById('highlight-color-input');
  if (picker && picker.value !== hex) picker.value = hex;
}

// ===== EVENT LISTENERS =====
function setupControls() {
  const playBtn = document.getElementById('play-btn');
  const stopBtn = document.getElementById('stop-btn');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const speedSel = document.getElementById('speed-select');

  if (playBtn) playBtn.addEventListener('click', handlePlay);
  if (stopBtn) stopBtn.addEventListener('click', handleStop);

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const newIdx = Math.max(0, state.currentWordIndex - 30);
      jumpToWord(newIdx);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const newIdx = Math.min(state.allWords.length - 1, state.currentWordIndex + 30);
      jumpToWord(newIdx);
    });
  }

  if (speedSel) {
    speedSel.addEventListener('change', () => {
      state.currentSettings.speed = parseFloat(speedSel.value);
      // If reading, restart current chunk at new speed
      if (state.isReading && !state.isPaused) {
        state.synth.cancel();
        setTimeout(readNextChunk, 50);
      }
    });
  }

  const colorInput = document.getElementById('highlight-color-input');
  if (colorInput) {
    colorInput.addEventListener('input', () => {
      applyHighlightColor(colorInput.value);
      state.currentSettings.highlightColor = colorInput.value;
      // Re-apply effect to current highlighted span
      if (state.highlightedSpan) {
        applyPDFHighlightEffect(state.highlightedSpan, state.currentSettings);
      }
      try {
        chrome.storage.local.get(['readerSettings'], (r) => {
          const s = Object.assign({}, r && r.readerSettings);
          s.highlightColor = colorInput.value;
          chrome.storage.local.set({ readerSettings: s });
        });
      } catch (_) {}
    });
  }

  // Highlight style selector
  const styleSelect = document.getElementById('highlight-style-select');
  if (styleSelect) {
    styleSelect.addEventListener('change', () => {
      state.currentSettings.highlightStyle = styleSelect.value;
      // Re-apply effect to current highlighted span
      if (state.highlightedSpan) {
        applyPDFHighlightEffect(state.highlightedSpan, state.currentSettings);
      }
      try {
        chrome.storage.local.get(['readerSettings'], (r) => {
          const s = Object.assign({}, r && r.readerSettings);
          s.highlightStyle = styleSelect.value;
          chrome.storage.local.set({ readerSettings: s });
        });
      } catch (_) {}
    });
  }

  // Load settings from storage
  chrome.storage.local.get(['readerSettings'], (result) => {
    if (result && result.readerSettings) {
      const s = result.readerSettings;
      if (speedSel && s.speed) speedSel.value = String(s.speed);
      state.currentSettings.speed = s.speed || 1;
      if (s.highlightColor) {
        applyHighlightColor(s.highlightColor);
        state.currentSettings.highlightColor = s.highlightColor;
        if (colorInput) colorInput.value = s.highlightColor;
      }
      if (s.highlightStyle) {
        state.currentSettings.highlightStyle = s.highlightStyle;
        if (styleSelect) styleSelect.value = s.highlightStyle;
      }
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        handlePlay();
        break;
      case 'Escape':
        handleStop();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        jumpToWord(Math.max(0, state.currentWordIndex - 30));
        break;
      case 'ArrowRight':
        e.preventDefault();
        jumpToWord(Math.min(state.allWords.length - 1, state.currentWordIndex + 30));
        break;
    }
  });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadVoices();
  setupControls();
  loadPDF();
});
