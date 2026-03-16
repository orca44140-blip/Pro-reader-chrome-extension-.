

// ============================================================
//  WordHighlighter  – advanced, robust word highlighting module
//  for Advanced Text Reader Pro
//
//  Key guarantees:
//   • Exact word matching  (no vowel-fuzzing from legacy code)
//   • Colors ALWAYS come from runtime settings — never from CSS
//   • applyColor() re-paints the live span instantly when the
//     user changes settings without jumping to a different word
//   • clearAll() wipes every trace of highlight on stop/reset
// ============================================================

class WordHighlighter {
  constructor() {
    this._activeSpan       = null;
    this._sentenceCtx      = [];
    this._lastScrollTime   = 0;
    this._regexCache       = new Map();
    this._colorCache       = new Map();
    this._lastSettings     = null;
    this._maxCacheSize     = 800;
    this._performanceStats = { matches: 0, cacheHits: 0 };
    this._lastChosenIdx    = -1;   // monotonic guard — prevents large backward jumps
    this._chosenHistory    = [];   // circular buffer of last 6 chosen indices
  }

  // ── Internal utilities ────────────────────────────────────────────────────

  _normalize(s) {
    try {
      return (s || '').trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2018\u2019\u201c\u201d\u2013\u2014]/g, (c) =>
          c === '\u2018' || c === '\u2019' ? "'" : c === '\u201c' || c === '\u201d' ? '"' : '-'
        )
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
        .toLowerCase();
    } catch (_) {
      return (s || '').trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    }
  }

  /**
   * Light English stemmer — strips common suffixes so TTS phonetic form
   * can match the written token even when they differ in inflection.
   * e.g. "running" → "run", "played" → "play", "books" → "book"
   * NOT a full Porter stemmer — only strips the outermost suffix once.
   */
  _stem(w) {
    if (!w || w.length < 4) return w;
    // -ing (running→run, making→make)
    if (w.length > 5 && w.endsWith('ing')) {
      const base = w.slice(0, -3);
      if (base.length >= 3) {
        // doubled consonant: running → runn → run
        if (base.length >= 4 && base[base.length - 1] === base[base.length - 2]) return base.slice(0, -1);
        return base;
      }
    }
    // -tion / -sion → normalize to base
    if (w.endsWith('tion') || w.endsWith('sion')) return w.slice(0, -3);
    // -ed (played→play, stopped→stop)
    if (w.length > 4 && w.endsWith('ed')) {
      const base = w.slice(0, -2);
      if (base.length >= 3) {
        if (base[base.length - 1] === base[base.length - 2]) return base.slice(0, -1);
        return base;
      }
    }
    // -ly (quickly→quick)
    if (w.length > 5 && w.endsWith('ly')) return w.slice(0, -2);
    // -er / -est (faster→fast, fastest→fast)
    if (w.length > 5 && w.endsWith('est')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('er')) return w.slice(0, -2);
    // -s / -es / -ies (books→book, boxes→box, tries→try)
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  _hexToRgba(color, alpha) {
    try {
      const a = Math.max(0, Math.min(1, isNaN(alpha) ? 1 : Number(alpha)));
      const val = (color || '').toString().trim();
      
      // Check cache first
      const cacheKey = `${val}|${a}`;
      if (this._colorCache.has(cacheKey)) {
        this._performanceStats.cacheHits++;
        return this._colorCache.get(cacheKey);
      }

      let result = 'rgba(255,215,0,1)'; // Default gold fallback
      
      if (val.startsWith('#')) {
        let h = val.slice(1);
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (h.length >= 6) {
          const r = parseInt(h.slice(0, 2), 16) || 0;
          const g = parseInt(h.slice(2, 4), 16) || 0;
          const b = parseInt(h.slice(4, 6), 16) || 0;
          result = `rgba(${r},${g},${b},${a})`;
        }
      } else if (val.startsWith('rgb')) {
        // Already in rgb format, just append alpha
        const match = val.match(/rgba?\(([^)]+)\)/i);
        if (match) {
          const nums = match[1].split(',').slice(0, 3);
          result = `rgba(${nums.join(',')},${a})`;
        }
      } else {
        // Try CSS color name or other format
        const probe = document.createElement('span');
        probe.style.cssText = 'display:none!important;color:' + val;
        document.body && document.body.appendChild(probe);
        try {
          const cs = getComputedStyle(probe).color || 'rgb(255,215,0)';
          const nums = cs.match(/rgba?\(([^)]+)\)/i);
          if (nums) {
            const [r, g, b] = nums[1].split(',').slice(0, 3).map(n => parseInt(n.trim()));
            result = `rgba(${r},${g},${b},${a})`;
          }
        } finally {
          if (probe.parentNode) probe.parentNode.removeChild(probe);
        }
      }

      // Cache result and manage size
      if (this._colorCache.size >= this._maxCacheSize) {
        const firstKey = this._colorCache.keys().next().value;
        this._colorCache.delete(firstKey);
      }
      this._colorCache.set(cacheKey, result);
      return result;
    } catch (_) { return 'rgba(255,215,0,1)'; }
  }

  _contrastColor(hexColor) {
    try {
      let h = (hexColor || '').replace('#', '').trim();
      if (!h) return '#000000';
      
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      if (h.length < 6) return '#000000';
      
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      
      if (isNaN(r) || isNaN(g) || isNaN(b)) return '#000000';
      
      // Improved luminance formula (W3C WCAG 2.0)
      const [rs, gs, bs] = [r, g, b].map(v => {
        v = v / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      const lum = 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      
      return lum > 0.179 ? '#000000' : '#ffffff';
    } catch (_) { return '#000000'; }
  }

  /**
   * Validate color format and return safe CSS-compatible color
   * @param {string} color - Color value (hex, rgb, or name)
   * @returns {string} - Validated RGBA color or safe fallback
   */
  _validateColor(color) {
    try {
      if (!color) return 'rgba(255,215,0,1)';
      const val = color.toString().trim().toLowerCase();
      
      // If already RGBA, validate and return
      if (val.startsWith('rgba(') && val.endsWith(')')) {
        const match = val.match(/rgba?\(([^)]+)\)/i);
        if (match && match[1].split(',').length >= 3) {
          return val; // Already valid RGBA
        }
      }
      
      // If hex color, convert to RGBA with full opacity
      if (val.startsWith('#')) {
        return this._hexToRgba(color, 1);
      }
      
      // If RGB, convert to RGBA
      if (val.startsWith('rgb(')) {
        return this._hexToRgba(color, 1);
      }
      
      // For named colors or other formats, try conversion
      return this._hexToRgba(color, 1);
    } catch (_) {
      return 'rgba(255,215,0,1)'; // Safe fallback
    }
  }

  _clearInlineStyles(el) {
    if (!el || !el.style) return;
    [
      'background', 'background-color', 'background-image', 'background-size',
      'text-decoration', 'text-decoration-color', 'text-decoration-thickness',
      'outline', 'box-shadow', 'color', 'text-shadow',
      'border-bottom', 'border-radius', 'border', 'display',
      'transform-origin', 'transform', 'animation', 'filter',
      'backdrop-filter', 'padding', 'letter-spacing', 'font-weight',
      'text-underline-offset', 'text-decoration-skip-ink',
      '--wh-c1', '--wh-c2', '--wh-c3', '--wh-c4'
    ].forEach(p => el.style.removeProperty(p));
  }

  _removeClasses(el) {
    if (!el || !el.classList) return;
    el.classList.remove(
      'tts-word-highlight',
      'tts-word-highlight-outline',
      'tts-word-highlight-underline',
      'tts-word-highlight-glow',
      'tts-word-highlight-pulse',
      'tts-word-highlight-scale',
      'tts-word-highlight-text-color',
      'tts-word-highlight-text-minimal',
      'tts-word-highlight-text-shadow',
      'tts-word-highlight-text-dark',
      'tts-word-highlight-wave',
      'tts-word-highlight-box-shadow',
      'tts-word-highlight-gradient',
      'tts-word-highlight-neon',
      'tts-word-highlight-shimmer',
      'tts-word-highlight-spotlight',
      'tts-word-highlight-double-underline',
      'tts-word-highlight-stroke',
      'tts-word-highlight-colorfade',
      'tts-word-highlight-rainbow',
      'tts-word-highlight-glitch',
      'tts-word-highlight-blur',
      'tts-word-highlight-modern'
    );
  }

  _getOp(settings) {
    const v = Number((settings && settings.highlightOpacity) != null ? settings.highlightOpacity : 1);
    return isNaN(v) ? 1 : Math.max(0, Math.min(1, v));
  }

  // ── Matching ──────────────────────────────────────────────────────────────

  /**
   * Levenshtein edit distance between two strings (capped at maxDist).
   * Returns distance or Infinity if above cap.
   */
  _editDistance(a, b, maxDist = 3) {
    if (!a || !b) return Math.max((a || '').length, (b || '').length);
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > maxDist) return Infinity;
    const row = Array.from({ length: lb + 1 }, (_, i) => i);
    for (let i = 1; i <= la; i++) {
      let prev = i;
      for (let j = 1; j <= lb; j++) {
        const val = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(prev, row[j], row[j - 1]);
        row[j - 1] = prev;
        prev = val;
      }
      row[lb] = prev;
    }
    return row[lb];
  }

  /**
   * Phonetic prefix score: percentage of the longer word's prefix shared (0-1).
   */
  _prefixScore(a, b) {
    if (!a || !b) return 0;
    const min = Math.min(a.length, b.length);
    let shared = 0;
    for (let i = 0; i < min; i++) {
      if (a[i] === b[i]) shared++;
      else break;
    }
    return shared / Math.max(a.length, b.length);
  }

  /**
   * Build an EXACT-match regex for `word`.
   * Strips surrounding punctuation from span text but matches the word characters exactly.
   * No vowel-fuzzing — "better" will never match "bitter".
   * Uses LRU-style cache eviction to prevent unbounded growth.
   */
  _buildRegex(word) {
    if (this._regexCache.has(word)) {
      // Move to end for LRU behavior
      const rx = this._regexCache.get(word);
      this._regexCache.delete(word);
      this._regexCache.set(word, rx);
      return rx;
    }
    
    const norm = this._normalize(word);
    let rx;
    if (!norm) {
      rx = /^$/;
    } else {
      const esc = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rx = new RegExp('^[^a-z0-9]*' + esc + '[^a-z0-9]*$', 'i');
    }
    
    // LRU eviction: remove oldest if cache is full
    if (this._regexCache.size >= this._maxCacheSize) {
      const oldestKey = this._regexCache.keys().next().value;
      this._regexCache.delete(oldestKey);
    }
    
    this._regexCache.set(word, rx);
    return rx;
  }

  /**
   * Returns true when `span` contains `word`.
   * Uses multiple tiers so contractions, punctuation, and diacritics all work.
   * Includes fuzzy (Levenshtein + prefix) tiers as final fallbacks.
   *
   * @param {Element}     span
   * @param {string}      normalizedWord   – this._normalize(word)
   * @param {RegExp}      exactRx          – this._buildRegex(word)
   * @param {string|null} exactMapWord     – raw token from charToWordMap (most precise)
   * @returns {number}  match score: 0 = no match, >0 = match (higher = stronger)
   */
  _spanMatches(span, normalizedWord, exactRx, exactMapWord) {
    const rawText = (span.textContent || '').trim();
    if (!rawText) return 0;

    const spanNorm = this._normalize(rawText);
    this._performanceStats.matches++;

    // Tier 1 – exact match against the charToWordMap token (best precision)
    if (exactMapWord) {
      const mapNorm = this._normalize(exactMapWord);
      if (spanNorm === mapNorm) return 100;
      // Also try map word stripped of apostrophes
      if (spanNorm.replace(/'/g, '') === mapNorm.replace(/'/g, '')) return 95;
    }

    // Tier 2 – regex exact boundary match
    if (exactRx && exactRx.test(rawText)) return 90;

    // Tier 3 – plain normalized equality
    if (normalizedWord && spanNorm === normalizedWord) return 88;

    // Tier 4 – hyphenated compounds  e.g. "mother-in-law"
    if (normalizedWord && (
      spanNorm.startsWith(normalizedWord + '-') ||
      spanNorm.endsWith('-' + normalizedWord)
    )) return 80;

    // Tier 5 – contraction / possessive: "don't"→"dont", "it's"→"its"
    if (normalizedWord) {
      const stripped = spanNorm.replace(/['\u2019\u2018]/g, '');
      const normStripped = normalizedWord.replace(/['\u2019\u2018]/g, '');
      if (stripped === normStripped) return 78;
    }

    // Tier 6 – numeric equivalence: "1,000" vs "1000", "$50" vs "50"
    if (normalizedWord) {
      const spanDigits = spanNorm.replace(/[^0-9]/g, '');
      const wordDigits = normalizedWord.replace(/[^0-9]/g, '');
      if (spanDigits && wordDigits && spanDigits === wordDigits) return 72;
    }

    // Tier 7 – prefix match (≥82% shared prefix, min 5 chars — raised to avoid false positives)
    if (normalizedWord && normalizedWord.length >= 5 && spanNorm.length >= 5) {
      const ps = this._prefixScore(spanNorm, normalizedWord);
      if (ps >= 0.82) return Math.round(50 + ps * 20);
    }

    // Tier 8 – stem matching: reduce both sides to root form and compare
    if (normalizedWord && normalizedWord.length >= 5 && spanNorm.length >= 5) {
      const stemW = this._stem(normalizedWord);
      const stemS = this._stem(spanNorm);
      if (stemW && stemS && stemW === stemS && stemW.length >= 3) return 60;
      // Stem of spoken word matches full span (e.g. TTS says "running", span has "run")
      if (stemW && stemW === spanNorm && stemW.length >= 3) return 58;
      // Full spoken word matches stem of span (e.g. TTS says "run", span has "running")
      if (stemS && stemS === normalizedWord && stemS.length >= 3) return 58;
    }

    // Tier 9 – Levenshtein fuzzy (words ≥6 chars, max edit dist proportional to length)
    if (normalizedWord && normalizedWord.length >= 6 && spanNorm.length >= 5) {
      const maxDist = normalizedWord.length <= 6 ? 1 : normalizedWord.length <= 10 ? 2 : 3;
      const dist = this._editDistance(spanNorm, normalizedWord, maxDist);
      if (dist <= maxDist) return Math.max(10, 45 - dist * 14);
    }

    // Tier 10 – Stem + Levenshtein combined (last resort for inflected fuzzy matches)
    if (normalizedWord && normalizedWord.length >= 6 && spanNorm.length >= 4) {
      const stemW = this._stem(normalizedWord);
      const stemS = this._stem(spanNorm);
      if (stemW && stemS && stemW.length >= 4) {
        const dist = this._editDistance(stemS, stemW, 2);
        if (dist <= 1) return 20;
      }
    }

    return 0;
  }

  // ── Core API ──────────────────────────────────────────────────────────────

  /**
   * Highlight the word at `wordIndex` in `wrappedSpans`.
   *
   * @param {string}      word          – from words[] array
   * @param {number}      wordIndex     – index into words[] / wrappedSpans[]
   * @param {string|null} exactMapWord  – raw token from charToWordMap (optional but greatly improves accuracy)
   * @param {Element[]}   wrappedSpans  – the span array
   * @param {object}      settings      – currentSettings
   * @param {string[]}    words         – full words array (for sentence context)
   * @param {number}      [minIdx=0]
   * @param {number}      [maxIdx=Infinity]
   * @returns {number} index of chosen span, or -1 on failure
   */
  highlight(word, wordIndex, exactMapWord, wrappedSpans, settings, words, minIdx = 0, maxIdx = Infinity) {
    try {
      if (!Array.isArray(wrappedSpans) || wrappedSpans.length === 0) return -1;

      const lo = Math.max(0, minIdx);
      const hi = Math.min(wrappedSpans.length - 1, maxIdx);
      const inRange = i => i >= lo && i <= hi;

      const normWord = this._normalize(word);
      const exactRx  = word ? this._buildRegex(word) : null;

      // Monotonic guard: tightened to 4 backward positions.
      // This stops charIndex browser glitches from re-highlighting words far behind.
      const monoLo = this._lastChosenIdx > 0
        ? Math.max(lo, this._lastChosenIdx - 4)
        : lo;

      const scoreAt = (i, relaxMono = false) => {
        if (!inRange(i) || (!relaxMono && i < monoLo) || !wrappedSpans[i]) return 0;
        return this._spanMatches(wrappedSpans[i], normWord, exactRx, exactMapWord);
      };

      let chosen   = -1;
      let bestScore = 0;

      // ── 0. Fast path: direct index + high-confidence exactMapWord (≥95) — skip search
      if (exactMapWord && inRange(wordIndex) && wordIndex >= monoLo) {
        const ds = scoreAt(wordIndex);
        if (ds >= 95) { chosen = wordIndex; bestScore = ds; }
      }

      // ── 1. Direct index hit
      if (chosen === -1) {
        const ds = scoreAt(wordIndex);
        if (ds > 0) { chosen = wordIndex; bestScore = ds; }
      }

      // ── 2a. Tight window ±4 first (prefer nearby, high-score match)
      if (bestScore < 88) {
        const wLo = Math.max(monoLo, wordIndex - 4);
        const wHi = Math.min(hi, wordIndex + 4);
        for (let i = wLo; i <= wHi; i++) {
          if (i === wordIndex) continue;
          const s = scoreAt(i);
          if (s > bestScore) { bestScore = s; chosen = i; }
          // forward tie-break: prefer i > lastChosen when scores are equal
          else if (s === bestScore && s > 0 && i > this._lastChosenIdx && chosen <= this._lastChosenIdx) {
            chosen = i;
          }
        }
      }

      // ── 2b. Wider window ±10 if still not a strong match
      if (bestScore < 88) {
        const wLo = Math.max(monoLo, wordIndex - 10);
        const wHi = Math.min(hi, wordIndex + 10);
        for (let i = wLo; i <= wHi; i++) {
          if (i === wordIndex || (i >= wordIndex - 4 && i <= wordIndex + 4)) continue;
          const s = scoreAt(i);
          if (s > bestScore) { bestScore = s; chosen = i; }
        }
      }

      // ── 3. Forward recovery +30 (only if nothing found yet)
      if (chosen === -1) {
        const cap = Math.min(hi, wordIndex + 30);
        for (let i = Math.max(monoLo, wordIndex + 1); i <= cap; i++) {
          const s = scoreAt(i);
          if (s > 0) { chosen = i; bestScore = s; break; }
        }
      }

      // ── 4. Relax monotonic guard (fall back to ±16 ignoring monoLo)
      if (chosen === -1) {
        const wLo2 = Math.max(lo, wordIndex - 16);
        const wHi2 = Math.min(hi, wordIndex + 16);
        for (let i = wLo2; i <= wHi2; i++) {
          if (!inRange(i) || !wrappedSpans[i]) continue;
          const s = this._spanMatches(wrappedSpans[i], normWord, exactRx, exactMapWord);
          if (s > bestScore) { bestScore = s; chosen = i; }
        }
      }

      // ── 5. Hard fallback – use the index directly (avoids silent skip)
      if (chosen === -1 && inRange(wordIndex) && wordIndex >= monoLo) chosen = wordIndex;
      if (chosen === -1 && inRange(wordIndex)) chosen = wordIndex;
      if (!inRange(chosen)) return -1;

      // Update monotonic tracker
      this._lastChosenIdx = chosen;
      this._chosenHistory.push(chosen);
      if (this._chosenHistory.length > 6) this._chosenHistory.shift();

      // ── Clear old highlight
      this._clearActiveSpan();
      this._clearSentenceCtx(wrappedSpans);

      const span = wrappedSpans[chosen];
      if (!span) return -1;

      // ── Apply new highlight (colors only from settings, never from CSS)
      this._applyStyles(span, settings);
      this._activeSpan  = span;
      this._lastSettings = settings ? Object.assign({}, settings) : null;

      // ── Sentence context
      if (settings && settings.sentenceHighlight && Array.isArray(words) && words.length > 0) {
        this._applySentenceCtx(chosen, wrappedSpans, settings, words, inRange);
      }

      // ── Auto-scroll (throttled at 250ms for smooth tracking)
      if (settings && settings.autoScroll) {
        const now = Date.now();
        if (now - this._lastScrollTime > 250) {
          this._lastScrollTime = now;
          try {
            const rect = span.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            // Only scroll when word is in top 20% or bottom 20% of viewport
            if (rect.top < vh * 0.2 || rect.bottom > vh * 0.8) {
              span.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            }
          } catch (_) {
            try { span.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (__) {}
          }
        }
      }

      return chosen;
    } catch (e) {
      console.warn('[WordHighlighter] highlight error:', e);
      return -1;
    }
  }

  /**
   * Re-paint the currently active span with new settings.
   * Call this when the user changes color/style/opacity while reading —
   * it updates the visual immediately without advancing to a different word.
   */
  applyColor(settings) {
    if (!this._activeSpan) return;
    try {
      this._applyStyles(this._activeSpan, settings);
      this._lastSettings = settings ? Object.assign({}, settings) : null;
      if (this._sentenceCtx.length > 0 && settings) {
        const color = settings.highlightColor || '#FFD700';
        const op    = this._getOp(settings);
        const ctxBg        = this._hexToRgba(color, op * 0.15);
        const ctxUnderline = this._hexToRgba(color, op * 0.35);
        for (const span of this._sentenceCtx) {
          if (!span || !span.style) continue;
          this._clearInlineStyles(span);
          span.style.setProperty('background-color', ctxBg, 'important');
          span.style.setProperty('border-bottom', `1px solid ${ctxUnderline}`, 'important');
          span.style.setProperty('border-radius', '2px', 'important');
        }
      }
    } catch (e) {
      console.warn('[WordHighlighter] applyColor error:', e);
    }
  }

  /**
   * Remove all highlights. Call on stop / reset.
   */
  clearAll(wrappedSpans) {
    this._clearActiveSpan();
    this._clearSentenceCtx(wrappedSpans);
    this._lastChosenIdx = -1;
    this._chosenHistory = [];
  }

  /**
   * Get current performance statistics (for debugging).
   * Returns matched word count and cache hit statistics.
   */
  getStats() {
    return {
      matches: this._performanceStats.matches,
      cacheHits: this._performanceStats.cacheHits,
      regexCacheSize: this._regexCache.size,
      colorCacheSize: this._colorCache.size
    };
  }

  /**
   * Reset performance statistics.
   */
  resetStats() {
    this._performanceStats = { matches: 0, cacheHits: 0 };
  }

  /**
   * Clear all caches (useful when switching contexts).
   */
  clearCaches() {
    this._regexCache.clear();
    this._colorCache.clear();
    this._sentenceCtx = [];
    this._activeSpan = null;
    this._lastChosenIdx = -1;
    this._chosenHistory = [];
  }

  /**
   * Reset the monotonic position tracker to a specific index.
   * Call this on seek/rewind so the guard doesn't block backward navigation.
   * @param {number} [idx=-1] – word index to reset to (-1 = full reset)
   */
  resetPosition(idx = -1) {
    this._lastChosenIdx = idx;
    this._chosenHistory = idx >= 0 ? [idx] : [];
  }

  /**
   * Preload and cache regex patterns for all words in the document.
   * Call this when the document loads to optimize highlighting performance.
   *
   * @param {string[]} words – Array of words extracted from document
   * @returns {number} Number of regexes preloaded
   */
  preloadWordRegexes(words) {
    if (!Array.isArray(words)) return 0;
    
    let count = 0;
    const startTime = performance.now();
    
    try {
      // Deduplicate words (case-insensitive normalized form)
      const seen = new Set();
      for (const word of words) {
        if (!word || typeof word !== 'string') continue;
        
        const norm = this._normalize(word);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          // Build and cache the regex
          this._buildRegex(word);
          count++;
        }
      }
      
      const elapsed = performance.now() - startTime;
      console.log(`[WordHighlighter] Preloaded ${count} word regexes in ${elapsed.toFixed(2)}ms`);
      return count;
    } catch (e) {
      console.warn('[WordHighlighter] Error preloading regexes:', e);
      return count;
    }
  }

  /**
   * Extract and preload text from DOM for highlighting.
   * Called when document loads to prepare for word-by-word highlighting.
   *
   * @param {Element} [container] – Optional container element (defaults to document.body)
   * @returns {object} { text: string, words: string[], regexCount: number }
   */
  initializeFromDocument(container = null) {
    try {
      const el = container || document.body || document.documentElement;
      if (!el) return { text: '', words: [], regexCount: 0 };

      // Extract clean text (skip scripts, styles, and hidden elements)
      const text = this._extractCleanText(el);
      const words = text.trim().split(/\s+/).filter(w => w.length > 0);
      
      if (words.length === 0) {
        console.log('[WordHighlighter] No words found in document');
        return { text: '', words: [], regexCount: 0 };
      }

      // Preload regexes for all unique words
      const regexCount = this.preloadWordRegexes(words);

      console.log(`[WordHighlighter] Document initialized: ${words.length} words, ${regexCount} unique patterns`);
      return { text, words, regexCount };
    } catch (e) {
      console.warn('[WordHighlighter] Error initializing from document:', e);
      return { text: '', words: [], regexCount: 0 };
    }
  }

  /**
   * Extract clean text from a DOM element (skip hidden/script/style content).
   * Used internally for document initialization.
   *
   * @param {Element} el – DOM element to extract from
   * @returns {string} Clean text content
   */
  _extractCleanText(el) {
    try {
      const clone = el.cloneNode(true);
      
      // Remove script, style, nav, header, footer, etc.
      const unwantedSelectors = [
        'script', 'style', 'noscript', 'nav', 'header', 'footer',
        'aside', 'iframe', '[aria-hidden="true"]', '[style*="display:none"]',
        '.sr-only', '.visually-hidden', '[role="complementary"]'
      ];
      
      unwantedSelectors.forEach(selector => {
        try {
          clone.querySelectorAll(selector).forEach(node => node.remove());
        } catch (_) {}
      });

      const text = (clone.textContent || clone.innerText || '').trim();
      // Normalize whitespace
      return text.replace(/\s+/g, ' ');
    } catch (e) {
      console.warn('[WordHighlighter] Error extracting text:', e);
      return '';
    }
  }

  /**
   * Build a complete word-to-regex map for the document.
   * Useful for batch operations or debugging.
   *
   * @param {string[]} words – Array of words
   * @returns {Map} Map<word, regex>
   */
  buildWordRegexMap(words) {
    const map = new Map();
    if (!Array.isArray(words)) return map;

    try {
      for (const word of words) {
        if (!word || typeof word !== 'string') continue;
        const norm = this._normalize(word);
        if (norm && !map.has(norm)) {
          map.set(norm, this._buildRegex(word));
        }
      }
    } catch (e) {
      console.warn('[WordHighlighter] Error building word regex map:', e);
    }

    return map;
  }

  // ── Style engine ──────────────────────────────────────────────────────────

  _applyStyles(span, settings) {
    if (!span || !span.style) return;

    this._clearInlineStyles(span);
    this._removeClasses(span);
    this._ensureBaseStyles();

    const color = (settings && settings.highlightColor) || '#FFD700';
    const op    = this._getOp(settings);
    const style = ((settings && settings.highlightStyle) || 'background').toLowerCase();

    const c1 = this._hexToRgba(color, op);
    const c2 = this._hexToRgba(color, op * 0.65);
    const c3 = this._hexToRgba(color, op * 0.35);
    const c4 = this._hexToRgba(color, op * 0.15);
    const c5 = this._hexToRgba(color, op * 0.07);

    span.style.setProperty('--wh-c1', c1);
    span.style.setProperty('--wh-c2', c2);
    span.style.setProperty('--wh-c3', c3);
    span.style.setProperty('--wh-c4', c4);

    switch (style) {
      case 'underline':
        try {
          span.style.setProperty('text-decoration', 'underline', 'important');
          span.style.setProperty('text-decoration-color', c1, 'important');
          span.style.setProperty('text-decoration-thickness', '3px', 'important');
          span.style.setProperty('text-underline-offset', '4px', 'important');
          span.style.setProperty('text-decoration-skip-ink', 'none', 'important');
          span.style.setProperty('font-weight', '600', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-underline-glow 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          try { span.style.setProperty('text-decoration', 'underline solid ' + c1, 'important'); }
          catch (__) { span.style.textDecoration = 'underline'; }
        }
        span.classList && span.classList.add('tts-word-highlight-underline');
        this._ensureUnderlineAnimation();
        break;

      case 'outline':
        try {
          span.style.setProperty('padding', '1px 5px', 'important');
          span.style.setProperty('border-radius', '5px', 'important');
          span.style.setProperty('background', c5, 'important');
          span.style.setProperty('box-shadow', `0 0 0 2px ${c1}, 0 0 10px ${c2}, 0 0 24px ${c3}`, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-outline-breathe 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          try { span.style.setProperty('background', c4, 'important'); }
          catch (__) {}
        }
        span.classList && span.classList.add('tts-word-highlight-outline');
        this._ensureOutlineAnimation();
        break;

      case 'glow': {
        try {
          span.style.setProperty('background', `radial-gradient(ellipse at center, ${c4}, transparent 80%)`, 'important');
          span.style.setProperty('text-shadow', `0 0 4px ${c1}, 0 0 10px ${c1}, 0 0 20px ${c2}, 0 0 36px ${c3}`, 'important');
          span.style.setProperty('filter', `brightness(1.1) drop-shadow(0 0 4px ${c2})`, 'important');
          span.style.setProperty('font-weight', '600', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-glow-breathe 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.setProperty('background', c4, 'important');
        }
        span.classList && span.classList.add('tts-word-highlight-glow');
        this._ensureGlowAnimation();
        break;
      }

      case 'pulse':
        try {
          span.style.setProperty('padding', '1px 5px', 'important');
          span.style.setProperty('border-radius', '5px', 'important');
          span.style.setProperty('background', `linear-gradient(135deg, ${c3}, ${c4})`, 'important');
          span.style.setProperty('font-weight', '600', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-pulse-beat 1.2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.setProperty('background', c3, 'important');
        }
        span.classList && span.classList.add('tts-word-highlight-pulse');
        this._ensurePulseAnimation();
        break;

      case 'scale':
        try {
          span.style.setProperty('padding', '1px 5px', 'important');
          span.style.setProperty('border-radius', '5px', 'important');
          span.style.setProperty('display', 'inline-block', 'important');
          span.style.setProperty('transform-origin', 'center bottom', 'important');
          span.style.setProperty('background', `linear-gradient(135deg, ${c3}, ${c4})`, 'important');
          span.style.setProperty('box-shadow', `0 2px 12px ${c3}, 0 0 24px ${c4}`, 'important');
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('animation', 'wh-scale-pop 0.28s cubic-bezier(0.34,1.56,0.64,1), wh-float 2s ease-in-out 0.28s infinite', 'important');
        } catch (_) {
          span.style.setProperty('background', c3, 'important');
        }
        span.classList && span.classList.add('tts-word-highlight-scale');
        this._ensureScaleAnimation();
        break;

      case 'text-color-only':
        try {
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)', 'important');
        } catch (_) {
          span.style.color = c1;
        }
        span.classList && span.classList.add('tts-word-highlight-text-color');
        break;

      case 'text-color-minimal':
        try {
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('padding', '0px 2px', 'important');
          span.style.setProperty('border-radius', '3px', 'important');
          span.style.setProperty('background', c5, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)', 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.background = c5;
        }
        span.classList && span.classList.add('tts-word-highlight-text-minimal');
        break;

      case 'text-shadow':
        try {
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('text-shadow', `0 0 2px ${c1}, 0 0 4px ${c2}, 0 0 8px ${c3}`, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)', 'important');
        } catch (_) {
          span.style.color = c1;
        }
        span.classList && span.classList.add('tts-word-highlight-text-shadow');
        break;

      case 'text-bold-dark':
        try {
          span.style.setProperty('color', '#ffffff', 'important');
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('padding', '2px 6px', 'important');
          span.style.setProperty('border-radius', '4px', 'important');
          span.style.setProperty('background', `rgba(0, 0, 0, 0.7)`, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)', 'important');
        } catch (_) {
          span.style.background = 'rgba(0, 0, 0, 0.7)';
        }
        span.classList && span.classList.add('tts-word-highlight-text-dark');
        break;

      case 'wave-underline':
        try {
          span.style.setProperty('text-decoration', 'underline wavy', 'important');
          span.style.setProperty('text-decoration-color', c1, 'important');
          span.style.setProperty('text-decoration-thickness', '2px', 'important');
          span.style.setProperty('text-underline-offset', '5px', 'important');
          span.style.setProperty('font-weight', '600', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-wave-pulse 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          try { span.style.setProperty('text-decoration', 'underline solid ' + c1, 'important'); }
          catch (__) { span.style.textDecoration = 'underline'; }
        }
        span.classList && span.classList.add('tts-word-highlight-wave');
        this._ensureWaveAnimation();
        break;

      case 'box-shadow-only':
        try {
          span.style.setProperty('padding', '2px 6px', 'important');
          span.style.setProperty('border-radius', '5px', 'important');
          span.style.setProperty('box-shadow', `0 0 0 2px ${c1}, 0 0 12px ${c2}, inset 0 0 4px ${c5}`, 'important');
          span.style.setProperty('font-weight', '600', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-shadow-breathe 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.setProperty('box-shadow', `0 0 0 2px ${c1}`, 'important');
        }
        span.classList && span.classList.add('tts-word-highlight-box-shadow');
        this._ensureBoxShadowAnimation();
        break;

      case 'gradient-text':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('background', `linear-gradient(90deg, ${c1} 0%, ${c2} 50%, ${c3} 100%)`, 'important');
          span.style.setProperty('background-clip', 'text', 'important');
          span.style.setProperty('-webkit-background-clip', 'text', 'important');
          span.style.setProperty('color', 'transparent', 'important');
          span.style.setProperty('letter-spacing', '0.02em', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-gradient-shift 3s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.fontWeight = '700';
        }
        span.classList && span.classList.add('tts-word-highlight-gradient');
        this._ensureGradientAnimation();
        break;

      case 'neon-glow':
        try {
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('text-shadow', `0 0 4px ${c1}, 0 0 8px ${c1}, 0 0 12px ${c1}, 0 0 20px ${c2}, 0 0 32px ${c2}`, 'important');
          span.style.setProperty('filter', `brightness(1.2) drop-shadow(0 0 8px ${c1})`, 'important');
          span.style.setProperty('letter-spacing', '0.03em', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-neon-pulse 1.5s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.fontWeight = '700';
        }
        span.classList && span.classList.add('tts-word-highlight-neon');
        this._ensureNeonAnimation();
        break;

      case 'shimmer':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('padding', '2px 6px', 'important');
          span.style.setProperty('border-radius', '4px', 'important');
          span.style.setProperty('background', `linear-gradient(110deg, transparent 0%, ${c4} 25%, ${c2} 50%, ${c4} 75%, transparent 100%)`, 'important');
          span.style.setProperty('background-size', '300% 100%', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-shimmer-wave 2s linear 0.18s infinite', 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.fontWeight = '700';
        }
        span.classList && span.classList.add('tts-word-highlight-shimmer');
        this._ensureShimmerAnimation();
        break;

      case 'spotlight':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('color', '#000000', 'important');
          span.style.setProperty('padding', '3px 8px', 'important');
          span.style.setProperty('border-radius', '6px', 'important');
          span.style.setProperty('background', `radial-gradient(ellipse at center, ${c1} 0%, ${c2} 50%, ${c3} 100%)`, 'important');
          span.style.setProperty('box-shadow', `0 0 16px ${c2}, 0 0 32px ${c3}, inset 0 2px 8px rgba(255,255,255,0.3)`, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-spotlight-pulse 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.background = c1;
        }
        span.classList && span.classList.add('tts-word-highlight-spotlight');
        this._ensureSpotlightAnimation();
        break;

      case 'double-underline':
        try {
          span.style.setProperty('font-weight', '600', 'important');
          span.style.setProperty('padding-bottom', '4px', 'important');
          span.style.setProperty('border-bottom', `2px solid ${c1}`, 'important');
          span.style.setProperty('box-shadow', `0 3px 0 ${c2}`, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-double-underline-glow 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.borderBottom = `2px solid ${c1}`;
        }
        span.classList && span.classList.add('tts-word-highlight-double-underline');
        this._ensureDoubleUnderlineAnimation();
        break;

      case 'stroke-only':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('color', 'transparent', 'important');
          span.style.setProperty('-webkit-text-stroke', `2px ${c1}`, 'important');
          span.style.setProperty('text-stroke', `2px ${c1}`, 'important');
          span.style.setProperty('letter-spacing', '0.02em', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-stroke-pulse 2s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.fontWeight = '700';
        }
        span.classList && span.classList.add('tts-word-highlight-stroke');
        this._ensureStrokeAnimation();
        break;

      case 'color-fade':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('padding', '2px 6px', 'important');
          span.style.setProperty('border-radius', '4px', 'important');
          span.style.setProperty('background', c3, 'important');
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-color-fade 3s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.background = c3;
        }
        span.classList && span.classList.add('tts-word-highlight-colorfade');
        this._ensureColorFadeAnimation();
        break;

      case 'rainbow':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('padding', '2px 6px', 'important');
          span.style.setProperty('border-radius', '4px', 'important');
          span.style.setProperty('background', `linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)`, 'important');
          span.style.setProperty('background-size', '400% 100%', 'important');
          span.style.setProperty('-webkit-background-clip', 'text', 'important');
          span.style.setProperty('background-clip', 'text', 'important');
          span.style.setProperty('color', 'transparent', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-rainbow-shift 4s linear 0.18s infinite', 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.fontWeight = '700';
        }
        span.classList && span.classList.add('tts-word-highlight-rainbow');
        this._ensureRainbowAnimation();
        break;

      case 'glitch':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('position', 'relative', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-glitch-shake 3s ease-in-out 0.18s infinite', 'important');
          span.style.setProperty('text-shadow', `2px 0 ${c2}, -2px 0 ${c3}`, 'important');
        } catch (_) {
          span.style.color = c1;
          span.style.fontWeight = '700';
        }
        span.classList && span.classList.add('tts-word-highlight-glitch');
        this._ensureGlitchAnimation();
        break;

      case 'blur-highlight':
        try {
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('color', '#000000', 'important');
          span.style.setProperty('padding', '3px 8px', 'important');
          span.style.setProperty('border-radius', '6px', 'important');
          span.style.setProperty('background', c2, 'important');
          span.style.setProperty('backdrop-filter', 'blur(4px)', 'important');
          span.style.setProperty('-webkit-backdrop-filter', 'blur(4px)', 'important');
          span.style.setProperty('box-shadow', `0 0 20px ${c3}, inset 0 0 12px rgba(255,255,255,0.2)`, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1), wh-blur-pulse 2.5s ease-in-out 0.18s infinite', 'important');
        } catch (_) {
          span.style.background = c2;
        }
        span.classList && span.classList.add('tts-word-highlight-blur');
        this._ensureBlurAnimation();
        break;

      case 'modern-minimal':
        try {
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('font-weight', '600', 'important');
          span.style.setProperty('padding', '1px 4px', 'important');
          span.style.setProperty('border-radius', '3px', 'important');
          span.style.setProperty('background', 'rgba(0,0,0,0.03)', 'important');
          span.style.setProperty('border-left', `3px solid ${c1}`, 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)', 'important');
        } catch (_) {
          span.style.color = c1;
        }
        span.classList && span.classList.add('tts-word-highlight-modern');
        break;

      default: { // 'background'
        try {
          span.style.setProperty('padding', '1px 6px', 'important');
          span.style.setProperty('border-radius', '5px', 'important');
          span.style.setProperty('background', 'transparent', 'important');
          span.style.setProperty('color', c1, 'important');
          span.style.setProperty('font-weight', '700', 'important');
          span.style.setProperty('letter-spacing', '0.01em', 'important');
          span.style.setProperty('animation', 'wh-entry 0.18s cubic-bezier(0.34,1.56,0.64,1)', 'important');
        } catch (_) {
          span.style.color = c1;
        }
        span.classList && span.classList.add('tts-word-highlight');
        break;
      }
    }
  }

  // ── Animation helpers ─────────────────────────────────────────────────────
  
  _ensureBaseStyles() {
    if (document.querySelector('style[data-wh-base]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-base', 'true');
    style.textContent = `
      .tts-word-highlight,
      .tts-word-highlight-outline,
      .tts-word-highlight-underline,
      .tts-word-highlight-glow,
      .tts-word-highlight-pulse,
      .tts-word-highlight-scale,
      .tts-word-highlight-text-color,
      .tts-word-highlight-text-minimal,
      .tts-word-highlight-text-shadow,
      .tts-word-highlight-text-dark,
      .tts-word-highlight-wave,
      .tts-word-highlight-box-shadow,
      .tts-word-highlight-gradient,
      .tts-word-highlight-neon,
      .tts-word-highlight-shimmer,
      .tts-word-highlight-spotlight,
      .tts-word-highlight-double-underline,
      .tts-word-highlight-stroke,
      .tts-word-highlight-colorfade,
      .tts-word-highlight-rainbow,
      .tts-word-highlight-glitch,
      .tts-word-highlight-blur,
      .tts-word-highlight-modern {
        will-change: transform, opacity !important;
      }
      @keyframes wh-entry {
        0%   { transform: scale(0.75); opacity: 0.3; }
        60%  { transform: scale(1.07); }
        100% { transform: scale(1);    opacity: 1;   }
      }
      @keyframes wh-scale-pop {
        0%   { transform: scale(0.6);  opacity: 0.4; }
        65%  { transform: scale(1.15); }
        100% { transform: scale(1);    opacity: 1;   }
      }
      @keyframes wh-float {
        0%, 100% { transform: translateY(0)     scale(1);    }
        50%      { transform: translateY(-1.5px) scale(1.04); }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureBackgroundAnimation() {
    if (document.querySelector('style[data-wh-bg-shimmer]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-bg-shimmer', 'true');
    style.textContent = `
      @keyframes wh-bg-sweep {
        0%   { background-position:  200% center; }
        100% { background-position: -200% center; }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureUnderlineAnimation() {
    if (document.querySelector('style[data-wh-underline]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-underline', 'true');
    style.textContent = `
      @keyframes wh-underline-glow {
        0%, 100% {
          text-decoration-thickness: 2px;
          text-underline-offset: 4px;
          filter: drop-shadow(0 2px 2px var(--wh-c3));
        }
        50% {
          text-decoration-thickness: 3px;
          text-underline-offset: 5px;
          filter: drop-shadow(0 2px 7px var(--wh-c1));
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureOutlineAnimation() {
    if (document.querySelector('style[data-wh-outline-glow]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-outline-glow', 'true');
    style.textContent = `
      @keyframes wh-outline-breathe {
        0%, 100% { box-shadow: 0 0 0 2px var(--wh-c1), 0 0 10px var(--wh-c2), 0 0 22px var(--wh-c3); }
        50%       { box-shadow: 0 0 0 2.5px var(--wh-c1), 0 0 18px var(--wh-c1), 0 0 38px var(--wh-c2); }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureGlowAnimation() {
    if (document.querySelector('style[data-wh-glow-pulse]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-glow-pulse', 'true');
    style.textContent = `
      @keyframes wh-glow-breathe {
        0%, 100% {
          text-shadow: 0 0 3px var(--wh-c1), 0 0 8px var(--wh-c1), 0 0 18px var(--wh-c2), 0 0 32px var(--wh-c3);
          filter: brightness(1.08) drop-shadow(0 0 3px var(--wh-c2));
        }
        50% {
          text-shadow: 0 0 5px var(--wh-c1), 0 0 14px var(--wh-c1), 0 0 26px var(--wh-c1), 0 0 48px var(--wh-c2);
          filter: brightness(1.18) drop-shadow(0 0 7px var(--wh-c1));
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensurePulseAnimation() {
    if (document.querySelector('style[data-wh-pulse]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-pulse', 'true');
    style.textContent = `
      @keyframes wh-pulse-beat {
        0%, 100% { transform: scale(1);    box-shadow: 0 0 0  0px var(--wh-c2); filter: brightness(1);    }
        40%       { transform: scale(1.08); box-shadow: 0 0 0  6px var(--wh-c3); filter: brightness(1.12); }
        60%       { transform: scale(1.04); box-shadow: 0 0 0 10px var(--wh-c4); filter: brightness(1.06); }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureScaleAnimation() {
    if (document.querySelector('style[data-wh-scale]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-scale', 'true');
    style.textContent = `
      @keyframes wh-float {
        0%, 100% { transform: translateY(0)     scale(1);    box-shadow: 0 2px 12px var(--wh-c3), 0 0 24px var(--wh-c4); }
        50%       { transform: translateY(-2px)  scale(1.05); box-shadow: 0 4px 20px var(--wh-c2), 0 0 36px var(--wh-c3); }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureWaveAnimation() {
    if (document.querySelector('style[data-wh-wave]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-wave', 'true');
    style.textContent = `
      @keyframes wh-wave-pulse {
        0%, 100% {
          text-decoration-thickness: 2px;
          text-underline-offset: 5px;
          filter: drop-shadow(0 1px 2px var(--wh-c3));
        }
        50% {
          text-decoration-thickness: 3px;
          text-underline-offset: 6px;
          filter: drop-shadow(0 2px 6px var(--wh-c1));
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureBoxShadowAnimation() {
    if (document.querySelector('style[data-wh-box-shadow]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-box-shadow', 'true');
    style.textContent = `
      @keyframes wh-shadow-breathe {
        0%, 100% { box-shadow: 0 0 0 2px var(--wh-c1), 0 0 12px var(--wh-c2), inset 0 0 4px var(--wh-c5); }
        50%       { box-shadow: 0 0 0 3px var(--wh-c1), 0 0 20px var(--wh-c1), inset 0 0 8px var(--wh-c4); }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureGradientAnimation() {
    if (document.querySelector('style[data-wh-gradient]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-gradient', 'true');
    style.textContent = `
      @keyframes wh-gradient-shift {
        0%, 100% { filter: brightness(1) hue-rotate(0deg); }
        50%       { filter: brightness(1.15) hue-rotate(15deg); }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureNeonAnimation() {
    if (document.querySelector('style[data-wh-neon]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-neon', 'true');
    style.textContent = `
      @keyframes wh-neon-pulse {
        0%, 100% {
          text-shadow: 0 0 4px var(--wh-c1), 0 0 8px var(--wh-c1), 0 0 12px var(--wh-c1), 0 0 20px var(--wh-c2), 0 0 32px var(--wh-c2);
          filter: brightness(1.2) drop-shadow(0 0 8px var(--wh-c1));
        }
        50% {
          text-shadow: 0 0 6px var(--wh-c1), 0 0 12px var(--wh-c1), 0 0 18px var(--wh-c1), 0 0 28px var(--wh-c1), 0 0 42px var(--wh-c2);
          filter: brightness(1.35) drop-shadow(0 0 12px var(--wh-c1));
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureShimmerAnimation() {
    if (document.querySelector('style[data-wh-shimmer]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-shimmer', 'true');
    style.textContent = `
      @keyframes wh-shimmer-wave {
        0%   { background-position: 200% center; }
        100% { background-position: -200% center; }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureSpotlightAnimation() {
    if (document.querySelector('style[data-wh-spotlight]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-spotlight', 'true');
    style.textContent = `
      @keyframes wh-spotlight-pulse {
        0%, 100% {
          box-shadow: 0 0 16px var(--wh-c2), 0 0 32px var(--wh-c3), inset 0 2px 8px rgba(255,255,255,0.3);
          filter: brightness(1);
        }
        50% {
          box-shadow: 0 0 24px var(--wh-c1), 0 0 48px var(--wh-c2), inset 0 2px 12px rgba(255,255,255,0.5);
          filter: brightness(1.1);
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureDoubleUnderlineAnimation() {
    if (document.querySelector('style[data-wh-double-underline]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-double-underline', 'true');
    style.textContent = `
      @keyframes wh-double-underline-glow {
        0%, 100% {
          box-shadow: 0 3px 0 var(--wh-c2);
          filter: drop-shadow(0 3px 2px var(--wh-c3));
        }
        50% {
          box-shadow: 0 3px 0 var(--wh-c1);
          filter: drop-shadow(0 3px 6px var(--wh-c1));
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureStrokeAnimation() {
    if (document.querySelector('style[data-wh-stroke]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-stroke', 'true');
    style.textContent = `
      @keyframes wh-stroke-pulse {
        0%, 100% {
          filter: drop-shadow(0 0 2px var(--wh-c2));
        }
        50% {
          filter: drop-shadow(0 0 8px var(--wh-c1));
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureColorFadeAnimation() {
    if (document.querySelector('style[data-wh-color-fade]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-color-fade', 'true');
    style.textContent = `
      @keyframes wh-color-fade {
        0%, 100% {
          filter: brightness(1) saturate(1);
          opacity: 1;
        }
        50% {
          filter: brightness(1.15) saturate(1.2);
          opacity: 0.85;
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureRainbowAnimation() {
    if (document.querySelector('style[data-wh-rainbow]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-rainbow', 'true');
    style.textContent = `
      @keyframes wh-rainbow-shift {
        0%   { background-position: 0% center; }
        100% { background-position: 400% center; }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureGlitchAnimation() {
    if (document.querySelector('style[data-wh-glitch]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-glitch', 'true');
    style.textContent = `
      @keyframes wh-glitch-shake {
        0%, 90%, 100% {
          transform: translate(0, 0) skew(0deg);
          text-shadow: 2px 0 var(--wh-c2), -2px 0 var(--wh-c3);
        }
        92% {
          transform: translate(-2px, 1px) skew(-1deg);
          text-shadow: 3px 0 var(--wh-c2), -3px 0 var(--wh-c3);
        }
        94% {
          transform: translate(2px, -1px) skew(1deg);
          text-shadow: -3px 0 var(--wh-c2), 3px 0 var(--wh-c3);
        }
        96% {
          transform: translate(-1px, 0) skew(0.5deg);
          text-shadow: 2px 0 var(--wh-c2), -2px 0 var(--wh-c3);
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  _ensureBlurAnimation() {
    if (document.querySelector('style[data-wh-blur]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-wh-blur', 'true');
    style.textContent = `
      @keyframes wh-blur-pulse {
        0%, 100% {
          box-shadow: 0 0 20px var(--wh-c3), inset 0 0 12px rgba(255,255,255,0.2);
          filter: brightness(1);
        }
        50% {
          box-shadow: 0 0 32px var(--wh-c2), inset 0 0 18px rgba(255,255,255,0.3);
          filter: brightness(1.1);
        }
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  // ── Sentence context ──────────────────────────────────────────────────────

  _applySentenceCtx(chosen, wrappedSpans, settings, words, inRange) {
    const color  = (settings && settings.highlightColor) || '#FFD700';
    const op     = this._getOp(settings);
    const ctxBg  = this._hexToRgba(color, op * 0.15);
    const ctxUnderline = this._hexToRgba(color, op * 0.35);
    const isEnd  = w => /[.!?]["')\]]?$/.test((w || '').trim());

    let sIdx = chosen;
    while (sIdx > 0 && !isEnd(words[sIdx - 1])) sIdx--;
    let eIdx = chosen;
    while (eIdx < words.length - 1 && !isEnd(words[eIdx])) eIdx++;

    const ctxSpans = [];
    for (let i = sIdx; i <= eIdx; i++) {
      if (i === chosen || !inRange(i)) continue;
      const s = wrappedSpans[i];
      if (!s) continue;
      this._clearInlineStyles(s);
      s.style.setProperty('background-color', ctxBg, 'important');
      s.style.setProperty('border-bottom', `1px solid ${ctxUnderline}`, 'important');
      s.style.setProperty('border-radius', '2px', 'important');
      ctxSpans.push(s);
    }
    this._sentenceCtx = ctxSpans;
  }

  // ── Cleanup helpers ───────────────────────────────────────────────────────

  /**
   * Clear inline styles and animation from an element.
   * Safe to call on null/undefined elements.
   */
  _clearAnimationAndStyles(el) {
    if (!el || !el.style) return;
    try {
      el.style.removeProperty('animation');
      el.style.removeProperty('animation-duration');
      el.style.removeProperty('animation-timing-function');
      el.style.removeProperty('animation-delay');
      el.style.removeProperty('animation-iteration-count');
    } catch (_) {}
    this._clearInlineStyles(el);
  }

  _clearActiveSpan() {
    if (!this._activeSpan) return;
    try {
      this._clearAnimationAndStyles(this._activeSpan);
      this._removeClasses(this._activeSpan);
    } catch (_) {}
    this._activeSpan = null;
  }

  _clearSentenceCtx(wrappedSpans) {
    for (const s of this._sentenceCtx) {
      if (!s) continue;
      try {
        this._clearInlineStyles(s);
        this._removeClasses(s);
      } catch (_) {}
    }
    this._sentenceCtx = [];
  }
}

window.WordHighlighter = WordHighlighter;

// ============================================================
// Performance & Debugging
//
// INITIALIZATION (call when document loads):
//   const result = wordHighlighter.initializeFromDocument();
//   console.log(result);  // { text, words, regexCount }
//
// OR preload specific words:
//   const count = wordHighlighter.preloadWordRegexes(wordsArray);
//
// RUNTIME STATISTICS (check cache performance):
//   wordHighlighter.getStats()
//
// RESET/CLEANUP:
//   wordHighlighter.resetStats()
//   wordHighlighter.clearCaches()
//
// BUILD WORD MAP (for debugging):
//   const map = wordHighlighter.buildWordRegexMap(wordsArray);
// ============================================================
