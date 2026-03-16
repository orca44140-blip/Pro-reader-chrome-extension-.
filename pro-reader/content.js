console.log('Advanced Text Reader content script loading at:', new Date().toISOString());
console.log('Current URL:', window.location.href);
console.log('Online status:', navigator.onLine);

// ===== SAFE STATUS UPDATE FALLBACK =====
if (typeof window.sendStatusUpdate !== 'function') {
  window.sendStatusUpdate = function(message, percent) {
    try {
      if (typeof percent === 'number') {
        const fill = document.getElementById('player-progress-fill');
        if (fill) {
          const p = Math.max(0, Math.min(100, percent));
          fill.style.width = p + '%';
        }
      }
    } catch (_) {}
    try { if (message) console.log(String(message)); } catch (_) {}
  };
}

// ===== SAFE LEGACY HIGHLIGHT CLASS STRIPPER =====
// Some sites (and older versions of this extension) may leave a `.tts-word-highlight` class
// that can carry !important CSS and interfere with inline styling. This removes it safely.
if (typeof window.stripLegacyHighlightClasses !== 'function') {
  window.stripLegacyHighlightClasses = function() {
    try {
      document.querySelectorAll('.tts-word-highlight').forEach(el => {
        try { el.classList.remove('tts-word-highlight'); } catch (_) {}
      });
    } catch (_) {}
  };
}

// Also expose as a local function name for existing calls in this file
// Use var (not const/let) so re-injection doesn't throw "already declared"
var stripLegacyHighlightClasses = window.stripLegacyHighlightClasses;

// ===== MESSAGE LISTENER - ALWAYS SET UP (OUTSIDE GUARD) =====
// This MUST run even on reloads to ensure messages can be received
if (!window.__TTSMessageListenerReady) {
  console.log('⏳ Setting up message listener...');
  
  const messageQueue = [];
  
  (function setupPrimaryListener() {
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        try {
          // Respond immediately for diagnostic messages
          if (request.action === 'ping') {
            console.log('✅ Content script is alive');
            sendResponse({ pong: true, timestamp: Date.now() });
            return false;
          }
          
          // Queue message if handlers aren't ready yet
          if (typeof handleRead === 'undefined') {
            console.log('📋 Handlers not ready yet, queuing message:', request.action);
            messageQueue.push({ request, sendResponse });
            return true;
          }
          
          // Process message directly if handlers are ready
          if (request.action === 'read') {
            console.log('▶️ Content script: Starting reading', request.type);
            handleRead(request.type, request.settings, request.text || null);
            sendResponse({ success: true, action: 'read', type: request.type });
          } else if (request.action === 'pause') {
            try { if (typeof handlePause === 'function') handlePause(); } catch (e) { console.warn('handlePause error:', e); }
            sendResponse({ success: true, action: 'pause' });
          } else if (request.action === 'resume') {
            try { if (typeof handleResume === 'function') handleResume(); } catch (e) { console.warn('handleResume error:', e); }
            sendResponse({ success: true, action: 'resume' });
          } else if (request.action === 'stop') {
            try { if (typeof handleStop === 'function') handleStop(); } catch (e) { console.warn('handleStop error:', e); }
            sendResponse({ success: true, action: 'stop' });
          } else if (request.action === 'play') {
            try { if (typeof handleResume === 'function') handleResume(); } catch (e) { console.warn('handleResume error:', e); }
            sendResponse({ success: true, action: 'play' });
          } else if (request.action === 'togglePause') {
            if (isReading && !isPaused) {
              try { if (typeof handlePause === 'function') handlePause(); } catch (e) { console.warn('handlePause error:', e); }
            } else if (isPaused) {
              try { if (typeof handleResume === 'function') handleResume(); } catch (e) { console.warn('handleResume error:', e); }
            }
            sendResponse({ success: true, action: 'togglePause' });
          } else if (request.action === 'updateSettings') {
            try {
              const oldSettings = Object.assign({}, currentSettings || {});
              currentSettings = Object.assign(currentSettings || {}, request.settings || {});
              window.currentSettings = currentSettings;  // Keep window reference in sync
              
              // Sync auto-scroll delay from settings
              if (currentSettings.autoScrollDelay && currentSettings.autoScrollDelay > 0) {
                autoScrollDelay = currentSettings.autoScrollDelay;
                console.log('⚙️ Auto-scroll delay updated to:', autoScrollDelay, 'ms');
              }
              
              // Check if highlight-related settings changed
              const highlightChanged = oldSettings.highlightColor !== currentSettings.highlightColor ||
                                      oldSettings.highlightStyle !== currentSettings.highlightStyle ||
                                      oldSettings.highlightOpacity !== currentSettings.highlightOpacity;
              
              // Re-paint the active span with new color/style immediately (no word jump)
              if (highlightChanged) {
                try { wordHighlighter.applyColor(currentSettings); } catch (_) {}
              }
            } catch (_) {}
            sendResponse({ success: true, action: 'updateSettings' });
          } else if (request.action === 'jumpByWords') {
            try {
              const n = Number(request.count);
              if (Number.isFinite(n) && n !== 0) jumpByWords(n);
              sendResponse({ success: true, action: 'jumpByWords', moved: n || 0 });
            } catch (e) {
              sendResponse({ success: false, error: e.message || 'jump failed' });
            }
          } else if (request.action === 'forward') {
            try {
              const amount = Number(request.amount) || 5000;
              console.log('⏭️ Forward skip:', amount, 'ms');
              skipForward(amount);
              sendResponse({ success: true, action: 'forward', amount });
            } catch (e) {
              sendResponse({ success: false, error: e.message || 'forward failed' });
            }
          } else if (request.action === 'rewind') {
            try {
              const amount = Number(request.amount) || 5000;
              console.log('⏮️ Rewind skip:', amount, 'ms');
              skipBackward(amount);
              sendResponse({ success: true, action: 'rewind', amount });
            } catch (e) {
              sendResponse({ success: false, error: e.message || 'rewind failed' });
            }
          } else if (request.action === 'seekToPercentage') {
            try {
              const pct = Number(request.percentage) || 0;
              if (Array.isArray(words) && words.length > 0) {
                const idx = Math.floor((pct / 100) * words.length);
                const targetIdx = Math.max(0, Math.min(idx, words.length - 1));
                console.log('🎯 Seeking to', pct.toFixed(1) + '% → word index', targetIdx);
                seekToWordIndex(targetIdx);
                sendResponse({ success: true, action: 'seekToPercentage', percentage: pct });
              } else {
                sendResponse({ success: false, error: 'No words loaded' });
              }
            } catch (e) {
              sendResponse({ success: false, error: e.message || 'seek failed' });
            }
          } else if (request.action === 'setLoopIntensity') {
            try {
              const ok = setLoopIntensity(request.value);
              sendResponse({ success: ok, action: 'setLoopIntensity' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setLoopDelay') {
            try {
              const ok = setLoopDelay(Number(request.value));
              sendResponse({ success: ok, action: 'setLoopDelay' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'enableFadeEffect') {
            try {
              const ok = enableLoopFadeEffect(request.value);
              sendResponse({ success: ok, action: 'enableFadeEffect' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setInfiniteLoop') {
            try {
              const ok = setInfiniteLoop(request.value);
              sendResponse({ success: ok, action: 'setInfiniteLoop' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setClickToRead') {
            try {
              clickToReadEnabled = Boolean(request.value);
              chrome.storage.local.set({ clickToReadEnabled });
              sendResponse({ success: true, action: 'setClickToRead', value: clickToReadEnabled });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setAutoScroll') {
            try {
              autoScrollEnabled = Boolean(request.value);
              sendResponse({ success: true, action: 'setAutoScroll' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'launchVocabWidget') {
            try {
              if (typeof window._ttsVocabFunctions !== 'undefined') window._ttsVocabFunctions.launch();
              sendResponse({ success: true, action: 'launchVocabWidget' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setVocabVisibility') {
            try {
              if (typeof window._ttsVocabFunctions !== 'undefined') window._ttsVocabFunctions.setVisibility(request.value);
              sendResponse({ success: true, action: 'setVocabVisibility' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setVocabRefreshInterval') {
            try {
              if (typeof window._ttsVocabFunctions !== 'undefined') window._ttsVocabFunctions.setRefreshInterval(request.value);
              sendResponse({ success: true, action: 'setVocabRefreshInterval' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setVocabAutoRefresh') {
            try {
              if (typeof window._ttsVocabFunctions !== 'undefined') window._ttsVocabFunctions.setAutoRefresh(request.value);
              sendResponse({ success: true, action: 'setVocabAutoRefresh' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'setSelectionRepeatCount') {
            try {
              selectionRepeatCount = request.value === 'unlimited' ? Infinity : (Number(request.value) || 1);
              sendResponse({ success: true, action: 'setSelectionRepeatCount' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'extractContent') {
            try {
              extractAndCleanContent();
              sendResponse({ success: true, action: 'extractContent' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'refreshVocab') {
            try {
              fetchVocabFromAPI();
              sendResponse({ success: true, action: 'refreshVocab' });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'getTextForAudio') {
            try {
              const text = readingText || (words && words.length > 0 ? words.join(' ') : '');
              sendResponse({ success: true, text: text || null });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else if (request.action === 'getStatus') {
            try {
              const totalWords = Array.isArray(words) ? words.length : 0;
              const curIdx = typeof currentWordIndex === 'number' ? currentWordIndex : 0;
              const pct = totalWords > 0 ? Math.round((curIdx / totalWords) * 100) : 0;
              const measuredWpm = (typeof _wpmHistory !== 'undefined' && Array.isArray(_wpmHistory) && _wpmHistory.length > 0)
                ? Math.round(_wpmHistory.reduce((a, b) => a + b, 0) / _wpmHistory.length)
                : (typeof currentSettings === 'object' ? Math.round(150 * (currentSettings.speed || 1)) : 150);
              sendResponse({
                success: true,
                isReading: !!isReading,
                isPaused: !!isPaused,
                currentWordIndex: curIdx,
                totalWords,
                progress: pct,
                wpm: measuredWpm
              });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
          } else {
            console.log('ℹ️ Content script received message:', request.action);
            sendResponse({ success: false, error: 'Unknown action' });
          }
        } catch (e) {
          console.error('❌ Error processing message:', e);
          try {
            sendResponse({ success: false, error: e.message });
          } catch (e2) {
            console.warn('⚠️ Could not send error response:', e2.message);
          }
        }
        return false;
      });
      console.log('✅ Message listener set up successfully');
      window.__TTSMessageListenerReady = true;
    } catch (e) {
      console.error('❌ Failed to set up message listener:', e);
    }
  })();
  
  // Process queued messages once handlers are ready
  window.processMessageQueue = function() {
    console.log(`📨 Processing ${messageQueue.length} queued messages...`);
    while (messageQueue.length > 0) {
      const { request, sendResponse } = messageQueue.shift();
      try {
        if (request.action === 'read' && typeof handleRead !== 'undefined') {
          handleRead(request.type, request.settings, request.text || null);
          sendResponse({ success: true });
        }
      } catch (e) {
        console.error('❌ Error processing queued message:', e);
        sendResponse({ success: false, error: e.message });
      }
    }
  };
}

// ===== PREVENT DUPLICATE SCRIPT INITIALIZATION =====
// Only initialize handlers/features once
if (window.__TTSReaderLoaded) {
  console.log('⚠️ Content script features already initialized, skipping  duplicate setup');
}

if (!window.__TTSReaderLoaded) {
  window.__TTSReaderLoaded = true;
  console.log('[GUARD] ✓ Guard opened, initializing reader features...');


// Call processMessageQueue() to handle any early messages when handlers are ready


// Initialize license manager
const licenseManager = window.LicenseManager ? new window.LicenseManager() : null;

// Check license on load
if (licenseManager) {
  licenseManager.checkLicense();
}

// Listen for license changes from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'licenseChanged') {
    if (licenseManager) {
      licenseManager.isPro = request.isPaid;
      console.log('License status updated:', licenseManager.isPro ? 'Pro' : 'Free');
    }
    sendResponse({ success: true });
  }
});

// Update in-page highlight styles immediately if settings change in storage
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    try {
      if (area !== 'local' && area !== 'sync') return;
      let updated = false;
      if (changes.readerSettings && changes.readerSettings.newValue) {
        currentSettings = Object.assign(currentSettings || {}, changes.readerSettings.newValue);
        updated = true;
      }
      if (changes.appConfig && changes.appConfig.newValue && changes.appConfig.newValue.settings) {
        currentSettings = Object.assign(currentSettings || {}, changes.appConfig.newValue.settings);
        updated = true;
      }
      if (changes.clickToReadEnabled !== undefined) {
        clickToReadEnabled = Boolean(changes.clickToReadEnabled.newValue);
      }
      if (updated) {
        try { wordHighlighter.applyColor(currentSettings); } catch (_) {}
        try { window.currentSettings = currentSettings; } catch (_) {} // Keep window reference in sync
      }
    } catch (_) {}
  });
} catch (_) {}


// Initialize state manager — guard against missing dep when re-injected without dependencies
const stateManager = (typeof TTSStateManager !== 'undefined')
  ? new TTSStateManager()
  : { subscribe: () => {}, getState: () => ({}), setState: () => {}, update: () => {}, on: () => {} };

// Check offline status immediately
const isOfflineMode = !navigator.onLine || window.location.protocol === 'file:';
console.log('Offline mode:', isOfflineMode);

const synth = window.speechSynthesis;
let utterance = null;
let words = [];
let currentWordIndex = 0;
let isPaused = false;
let isReading = false;
// Expose isReading to other content scripts (e.g. paragraph-reader.js watchdog)
Object.defineProperty(window, 'isReading', { get() { return isReading; }, set(v) { isReading = v; }, configurable: true });
let _wpmHistory = [];  // WPM tracking - MUST be early to avoid "before initialization" errors
let currentSettings = {
  speed: 1, 
  pitch: 1, 
  volume: 1, 
  voice: null,
  sentenceCount: 2,
  repeatCount: 1,
  autoScrollDelay: 8000,
  highlightColor: '#FFD700', 
  highlightStyle: 'background', 
  highlightOpacity: 1,
  syncHighlight: true, 
  autoScroll: true
};
let readingText = ''; // Store the full text being read
let isOffline = !navigator.onLine; // Track offline state

// Auto-load settings from storage so alt+click / left-click have correct settings
try {
  chrome.storage.local.get(['readerSettings', 'vocabTimerSettings', 'clickToReadEnabled'], (result) => {
    if (result && result.readerSettings) {
      currentSettings = Object.assign(currentSettings, result.readerSettings);
      window.currentSettings = currentSettings;
    }
    if (typeof result.clickToReadEnabled === 'boolean') {
      clickToReadEnabled = result.clickToReadEnabled;
    }
    if (result && result.vocabTimerSettings) {
      const vt = result.vocabTimerSettings;
      if (typeof vt.vocabRefreshInterval === 'number' && vt.vocabRefreshInterval >= 1000) {
        vocabRefreshInterval = vt.vocabRefreshInterval;
      }
      if (typeof vt.vocabAutoRefresh === 'boolean') {
        vocabAutoRefresh = vt.vocabAutoRefresh;
      }
    } else if (result && result.readerSettings) {
      // Fallback: read from readerSettings if vocabTimerSettings not yet set
      if (typeof result.readerSettings.vocabRefreshInterval === 'number') {
        vocabRefreshInterval = result.readerSettings.vocabRefreshInterval;
      }
      if (typeof result.readerSettings.vocabAutoRefresh === 'boolean') {
        vocabAutoRefresh = result.readerSettings.vocabAutoRefresh;
      }
    }
  });
} catch (e) {
  console.warn('Could not auto-load settings:', e);
}

// Sync state manager with legacy variables (for backward compatibility)
stateManager.subscribe('isReading', (newVal) => { isReading = newVal; });
stateManager.subscribe('isPaused', (newVal) => { isPaused = newVal; });
stateManager.subscribe('currentWordIndex', (newVal) => { currentWordIndex = newVal; });
stateManager.subscribe('words', (newVal) => { words = newVal; });
stateManager.subscribe('readingText', (newVal) => { readingText = newVal; });
stateManager.subscribe('isOffline', (newVal) => { isOffline = newVal; });


// Initialize reading modes
const readingModes = new AdvancedReadingModes();


// Initialize progress manager
const progressManager = new ReadingProgressManager();

// Advanced highlighting state
let highlightedSpan = null;
const wordHighlighter = new WordHighlighter();
let wordPositionsCache = new Map(); // Cache for word positions in DOM
let highlightIndicator = null; // Visual progress indicator
let watchdogTimer = null; // Watchdog to keep reading alive
let lastSpeechActivityTime = Date.now(); // Updated on every boundary/utterance-start; used by all watchdogs
let selectedNodes = []; // Nodes containing selected text
let lastSentenceContext = [];

// Listen for offline/online events
window.addEventListener('offline', () => {
  isOffline = true;
  console.log('Extension went offline');
  if (isReading) {
    console.log('Continuing to read offline...');
  }
});

window.addEventListener('online', () => {
  isOffline = false;
  console.log('Extension back online');
});

// Message listener is already set up at the top of this file (outside guard)
// It was moved there to ensure it's always available, even on script reload

// ===== ADVANCED KEYBOARD SHORTCUTS =====

// WPM tracking utilities (ensure defined before any usage)
let _wpmStartTime = null;
let _wpmWordsAtStart = 0;
function trackWPM(wordIndex) {
  try {
    if (typeof wordIndex !== 'number' || isNaN(wordIndex)) return;
    if (!_wpmStartTime) {
      _wpmStartTime = Date.now();
      _wpmWordsAtStart = wordIndex;
      return;
    }
    const elapsedMin = Math.max(0.001, (Date.now() - _wpmStartTime) / 60000);
    const wordsRead = Math.max(0, wordIndex - _wpmWordsAtStart);
    const wpm = Math.round(wordsRead / elapsedMin);
    const wpmEl = document.getElementById('player-wpm');
    if (wpmEl) wpmEl.textContent = `WPM: ${wpm}`;
  } catch (_) {}
}
function resetWPM() {
  _wpmStartTime = null;
  _wpmWordsAtStart = 0;
  const wpmEl = document.getElementById('player-wpm');
  if (wpmEl) wpmEl.textContent = 'WPM: 0';
}

document.addEventListener('keydown', (e) => {
  // Only respond if not typing in an input field
  if (e.target.matches('input, textarea, [contenteditable="true"]')) {
    return;
  }
  
  // F - Toggle Focus Mode (when reading) - PRO FEATURE
  if (e.key === 'f' && isReading && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (licenseManager && !licenseManager.canUseFocusMode()) {
      return;
    }
    
    if (readingModes.getCurrentMode() === 'focus') {
      readingModes.disableAllModes();
      console.log('Focus mode disabled via keyboard');
    } else {
      readingModes.disableAllModes();
      readingModes.enableFocusMode();
      console.log('Focus mode enabled via keyboard');
    }
  }
  
  // R - Toggle RSVP Speed Mode (when reading) - PRO FEATURE
  if (e.key === 'r' && isReading && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (licenseManager && !licenseManager.canUseSpeedMode()) {
      return;
    }
    
    if (readingModes.getCurrentMode() === 'speed') {
      readingModes.disableAllModes();
      console.log('Speed mode disabled via keyboard');
    } else {
      readingModes.disableAllModes();
      readingModes.enableSpeedMode();
      console.log('Speed mode enabled via keyboard');
    }
  }
  
  // ESC - Exit all special modes
  if (e.key === 'Escape') {
    if (readingModes.getCurrentMode() !== 'normal') {
      e.preventDefault();
      readingModes.disableAllModes();
      console.log('All reading modes disabled via ESC');
    }
  }

  // Ctrl+Shift+PageDown/ArrowRight → jump forward 1000 words
  if (e.ctrlKey && e.shiftKey && (e.key === 'PageDown' || e.key === 'ArrowRight')) {
    e.preventDefault();
    jumpForward1000();
    return;
  }
  // Ctrl+Shift+PageUp/ArrowLeft → jump backward 1000 words
  if (e.ctrlKey && e.shiftKey && (e.key === 'PageUp' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    jumpBackward1000();
    return;
  }
  
  // A-Z letter keys - Jump to next word starting with that letter
  if (/^[a-zA-Z]$/.test(e.key) && isReading && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const targetLetter = e.key.toLowerCase();
    jumpToNextLetterWord(targetLetter);
    return;
  }
  
  // Shift+A-Z - Jump to next word matching regex pattern
  if (/^[a-zA-Z]$/.test(e.key) && e.shiftKey && isReading && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const targetLetter = e.key.toLowerCase();
    jumpToNextRegexWord(targetLetter);
    return;
  }
  
  // S - Save progress (when reading) - PRO FEATURE
  if (e.key === 's' && isReading && e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (licenseManager && !licenseManager.canSaveProgress()) {
      return;
    }
    
    const url = window.location.href;
    progressManager.saveProgress(url, currentWordIndex, words.length);
    
    // Show save confirmation
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(25, 25, 26, 0.95);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      z-index: 999999999;
      animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2.7s;
      box-shadow: 0 4px 12px rgba(18, 49, 23, 0.3);
    `;
    toast.textContent = '💾 Progress Saved!';
    safeAppendToBody(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}, true);

let wrappedSpans = []; // Array of wrapped word spans
let readingContainer = null; // The container being read
let originalNodeBackup = []; // Backup of original nodes before wrapping
let originalTextBackup = ''; // Backup of original text content
let sentenceGroups = [];
let currentSentenceGroupIndex = 0;
let currentRepeatIteration = 0;

let vocabWidget = null;
let vocabRotationTimer = null;
let vocabCache = [];
let currentVocabIndex = 0;
const VOCAB_CACHE_SIZE_LIMIT = 10 * 1024 * 1024;
let autoScrollEnabled = true;  // Auto-scroll is enabled
let autoScrollDelay = 8000;  // 8 seconds delay between auto-scrolls for smooth behavior
let lastScrollTime = 0;  // Track last scroll time to enforce delay
let showVocabWidget = true;
let sentencePlayButtons = new Map(); // Map to store play buttons for each sentence
let hoveredSentenceElement = null; // Track currently hovered sentence
let selectionRepeatCount = 1; // Track selection repeat count
let isReadingSelection = false; // Track if reading selected text
let selectionStartIndex = -1; // Track selection start index
let selectionEndIndex = -1; // Track selection end index

// ===== ENHANCED LOOP FEATURES =====
let loopSettings = {
  delayBetweenRepeats: 0, // Delay in ms between repeats (0 = no delay)
  infiniteLoop: false, // If true, loop endlessly
  loopIntensity: 'normal', // 'gentle' (long delay), 'normal' (short delay), 'intense' (no delay)
  fadeEffect: false, // Enable fade-in effect for repeats
  skipToNextRepeat: false, // Flag to skip current repeat early
  loopHistorySize: 100 // Store repeat history
};
let loopHistory = []; // Track what's been repeated and when
let isScrolling = false; // Track if user is scrolling
let scrollTimeout = null; // Timeout for scroll detection
let vocabRefreshInterval = 15000; // Default vocab refresh interval (15 seconds)
let vocabAutoRefresh    = true;  // Whether to auto-rotate vocab words
let sentencePlayButtonsVisible = new Map(); // Track which play buttons are visible

// Visibility Guardian - Enhanced protection against text disappearing
let visibilityGuardian = null;
let visibilityCheckInterval = null;

// ===== REMOVE HIGHLIGHT FUNCTION =====
// Moved here to ensure it's defined before handleRead() calls it
function removeHighlight() {
  console.log('🧹 Advanced removeHighlight called');
  
  try {
    if (highlightIndicator) {
      try {
        highlightIndicator.remove();
      } catch (e) {
        console.warn('Error removing indicator:', e);
      }
      highlightIndicator = null;
    }
    
    const allWrappedSpans = document.querySelectorAll('.tts-word-span');
    console.log(`Found ${allWrappedSpans.length} wrapped spans to remove`);
    
    if (allWrappedSpans.length === 0) {
      console.log('No wrapped spans to remove');
      return;
    }
    
    // Convert to array and process each span individually to avoid DOM conflicts
    let removedCount = 0;
    let errorCount = 0;
    let textPreserved = [];
    
    Array.from(allWrappedSpans).forEach((span, index) => {
      try {
        // Verify span still exists in DOM
        if (!span || !span.parentNode || !document.body.contains(span)) {
          return;
        }
        
        // Get the text content before removing
        const textContent = span.textContent || '';
        if (textContent.length > 0) {
          textPreserved.push(textContent);
        }
        
        // Create text node with the content
        const textNode = document.createTextNode(textContent);
        
        // Replace span with text node
        const parent = span.parentNode;
        parent.replaceChild(textNode, span);
        removedCount++;
        
      } catch (e) {
        errorCount++;
        console.warn(`Error removing span ${index}:`, e);
        
        // Fallback: try to preserve text by extracting it and removing span
        try {
          if (span && span.parentNode) {
            const text = span.textContent || '';
            const parent = span.parentNode;
            
            // Get next sibling to help with reconstruction
            const nextSibling = span.nextSibling;
            
            // Try to remove the span while preserving text
            if (parent.removeChild) {
              parent.removeChild(span);
              
              // If sibling is also a text node, merge content
              if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
                nextSibling.nodeValue = text + (nextSibling.nodeValue || '');
              } else if (text.length > 0) {
                // Create and insert text node
                const newText = document.createTextNode(text);
                if (nextSibling) {
                  parent.insertBefore(newText, nextSibling);
                } else {
                  parent.appendChild(newText);
                }
              }
              removedCount++;
            }
          }
        } catch (e2) {
          console.error(`Critical error removing span ${index}:`, e2);
        }
      }
    });
    
    console.log(`✅ Removed ${removedCount} spans successfully, ${errorCount} errors`);
    
    wrappedSpans = [];

    // Merge adjacent text nodes left by span removal to clean up the DOM
    try { document.body && document.body.normalize(); } catch (_) {}

    
  } catch (e) {
    console.error('Error in removeHighlight:', e);
  }
}

function ensureWrappedSpansVisible() {
  try {
    const allSpans = document.querySelectorAll('.tts-word-span');
    let fixedCount = 0;
    
    // Batch updates to minimize reflows
    const spansToFix = [];
    
    allSpans.forEach(span => {
      if (span && span.parentNode && document.body.contains(span)) {
        try {
          const wasHidden = span.style.display === 'none' || 
                           span.style.visibility === 'hidden' || 
                           span.style.opacity === '0';
          
          if (wasHidden) {
            spansToFix.push(span);
            fixedCount++;
          }
        } catch (e) {
          console.warn('Error checking span visibility:', e);
        }
      }
    });
    
    // Apply fixes in batch to avoid multiple reflows
    if (spansToFix.length > 0) {
      // Use a single CSS update instead of inline style modifications
      spansToFix.forEach(span => {
        span.style.display = 'inline';
        span.style.visibility = 'visible';
        span.style.opacity = '1';
      });
      console.log(`✓ Fixed visibility of ${fixedCount} spans`);
    }
    
    return allSpans.length;
  } catch (e) {
    console.error('Error in ensureWrappedSpansVisible:', e);
    return 0;
  }
}

// Start visibility guardian to continuously monitor and protect text visibility
// Lightweight visibility check - run once only, no observers to prevent mutation spiral
function startVisibilityGuardian() {
  // Single non-blocking check after a short delay to allow DOM to settle
  if (visibilityGuardian) {
    return; // Already scheduled
  }
  
  visibilityGuardian = true; // Mark as started
  console.log('🛡️ Single visibility check scheduled');
  
  // Use a single timeout instead of continuous polling/observation
  setTimeout(() => {
    try {
      if (isReading) {
        ensureWrappedSpansVisible();
      }
    } catch (e) {
      console.warn('Error in visibility check:', e);
    }
    // Don't repeat - single check only
  }, 50);
}

// Stop visibility guardian
function stopVisibilityGuardian() {
  visibilityGuardian = null;
  
  if (visibilityCheckInterval) {
    clearInterval(visibilityCheckInterval);
    visibilityCheckInterval = null;
  }
  console.log('🛡️ Visibility guardian stopped');
}

function handleRead(type, settings, importedText) {
  console.log('handleRead called with type:', type, 'isReading:', isReading);
  
  // Ensure player exists and show it
  createFloatingPlayer(settings);
  const _existingPlayer = document.getElementById('tts-floating-player');
  if (_existingPlayer) {
    if (document.body && document.body.classList.contains('dark-mode')) {
      _existingPlayer.classList.add('dark-mode');
    } else {
      _existingPlayer.classList.remove('dark-mode');
    }
    _existingPlayer.style.display = 'flex';
    _existingPlayer.style.animation = 'ttsSlideDown 0.3s cubic-bezier(0.4,0,0.2,1) forwards';
    console.log('🎵 Floating player shown via inline style');
  }
  
  // Always clean up existing wrapped spans first
  const existingWraps = document.querySelectorAll('.tts-word-span');
  if (existingWraps.length > 0) {
    console.log('Cleaning up', existingWraps.length, 'existing wrapped spans before reading');
    removeHighlight();
    
    // Wait a moment for cleanup to complete
    setTimeout(() => {
      continueHandleRead(type, settings, importedText);
    }, 50);
    return;
  }
  
  continueHandleRead(type, settings, importedText);
}

// ===== FLOATING PLAYER =====
function createFloatingPlayer(settings) {
  // Don't create multiple players
  if (document.getElementById('tts-floating-player')) {
    return;
  }
  
  // Inject CSS for floating player (top navbar style) — only once
  if (!document.getElementById('tts-floating-player-style')) {
  const style = document.createElement('style');
  style.id = 'tts-floating-player-style';
  style.textContent = `
    /* ── TTS Navbar Player — Black & Green ── */
    #tts-floating-player {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      height: 40px !important;
      background: #080e08 !important;
      border-bottom: 1px solid rgba(0,230,118,0.25) !important;
      box-shadow: 0 0 24px rgba(0,230,118,0.12), 0 2px 8px rgba(0,0,0,0.8) !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      color: #00e676 !important;
      display: none;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 0 10px !important;
      box-sizing: border-box !important;
      transform: translateZ(0) !important;
      will-change: transform, opacity !important;
      overflow: hidden !important;
      margin: 0 !important;
      border-top: none !important;
      border-left: none !important;
      border-right: none !important;
      border-radius: 0 !important;
    }

    /* green scan-line shimmer */
    #tts-floating-player::before {
      content: '' !important;
      position: absolute !important;
      inset: 0 !important;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0,230,118,0.02) 2px,
        rgba(0,230,118,0.02) 4px
      ) !important;
      pointer-events: none !important;
      z-index: 0 !important;
    }

    /* ── 3-column layout ── */
    #tts-floating-player .player-left {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      flex: 1 !important;
      min-width: 0 !important;
      z-index: 1 !important;
    }
    #tts-floating-player .player-center {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 auto !important;
      padding: 0 16px !important;
      z-index: 1 !important;
    }
    #tts-floating-player .player-right {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-end !important;
      gap: 6px !important;
      flex: 1 !important;
      z-index: 1 !important;
    }

    /* brand */
    #tts-floating-player .player-title {
      display: flex !important;
      align-items: center !important;
      gap: 5px !important;
      font-size: 10px !important;
      font-weight: 800 !important;
      letter-spacing: 2px !important;
      text-transform: uppercase !important;
      white-space: nowrap !important;
      color: #00e676 !important;
      flex-shrink: 0 !important;
      text-shadow: 0 0 8px rgba(0,230,118,0.6) !important;
      padding-right: 10px !important;
      border-right: 1px solid rgba(0,230,118,0.2) !important;
    }

    /* controls + word inside center — side by side */
    #tts-floating-player .player-center {
      gap: 8px !important;
    }

    /* controls group — always centered */
    #tts-floating-player .player-controls {
      display: flex !important;
      align-items: center !important;
      gap: 2px !important;
    }

    #tts-floating-player .player-btn {
      width: 30px !important;
      height: 30px !important;
      background: transparent !important;
      border: 1px solid rgba(0,230,118,0.15) !important;
      border-radius: 6px !important;
      color: rgba(0,230,118,0.7) !important;
      cursor: pointer !important;
      font-size: 12px !important;
      transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s, box-shadow 0.15s !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      outline: none !important;
    }
    #tts-floating-player .player-btn:hover {
      background: rgba(0,230,118,0.12) !important;
      border-color: rgba(0,230,118,0.5) !important;
      color: #00e676 !important;
      box-shadow: 0 0 8px rgba(0,230,118,0.3) !important;
      transform: scale(1.08) !important;
    }
    #tts-floating-player .player-btn:active { transform: scale(0.93) !important; }

    /* play/pause — glowing circle */
    #tts-floating-player #player-play {
      width: 34px !important;
      height: 34px !important;
      background: rgba(0,230,118,0.12) !important;
      border: 1.5px solid rgba(0,230,118,0.55) !important;
      border-radius: 50% !important;
      font-size: 14px !important;
      color: #00e676 !important;
      box-shadow: 0 0 12px rgba(0,230,118,0.25) !important;
      margin: 0 4px !important;
    }
    #tts-floating-player #player-play:hover {
      background: rgba(0,230,118,0.22) !important;
      border-color: #00e676 !important;
      box-shadow: 0 0 20px rgba(0,230,118,0.5) !important;
    }

    /* time */
    #tts-floating-player .player-time {
      display: flex !important;
      align-items: center !important;
      gap: 2px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      letter-spacing: 0.5px !important;
      white-space: nowrap !important;
      color: rgba(0,230,118,0.7) !important;
      font-variant-numeric: tabular-nums !important;
    }
    #tts-floating-player .player-time-sep { opacity: 0.4 !important; }

    /* WPM badge */
    #tts-floating-player .player-wpm {
      font-size: 10px !important;
      font-weight: 700 !important;
      white-space: nowrap !important;
      padding: 2px 8px !important;
      background: rgba(0,230,118,0.08) !important;
      border: 1px solid rgba(0,230,118,0.2) !important;
      border-radius: 999px !important;
      color: rgba(0,230,118,0.85) !important;
      letter-spacing: 0.3px !important;
    }

    /* close button */
    #tts-floating-player .player-close {
      width: 22px !important;
      height: 22px !important;
      background: transparent !important;
      border: 1px solid rgba(0,230,118,0.2) !important;
      border-radius: 50% !important;
      color: rgba(0,230,118,0.5) !important;
      cursor: pointer !important;
      font-size: 10px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s !important;
      outline: none !important;
    }
    #tts-floating-player .player-close:hover {
      background: rgba(239,68,68,0.2) !important;
      border-color: rgba(239,68,68,0.6) !important;
      color: #ef4444 !important;
      transform: scale(1.1) !important;
    }
    #tts-floating-player .player-close:active { transform: scale(0.9) !important; }

    /* progress bar — bottom edge */
    #tts-floating-player .player-progress {
      position: absolute !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: 2px !important;
      background: rgba(0,230,118,0.1) !important;
      cursor: pointer !important;
      z-index: 2 !important;
    }
    #tts-floating-player .player-progress-bar {
      position: absolute !important;
      inset: 0 !important;
      background: transparent !important;
      cursor: pointer !important;
    }
    #tts-floating-player .player-progress-fill {
      height: 100% !important;
      background: linear-gradient(90deg, #00c853, #00e676) !important;
      width: 0% !important;
      transition: width 0.25s cubic-bezier(0.4,0,0.2,1) !important;
      box-shadow: 0 0 8px rgba(0,230,118,0.8) !important;
      border-radius: 0 2px 2px 0 !important;
    }

    #tts-floating-player .player-stats { display: none !important; }

    @keyframes ttsSlideDown {
      from { opacity: 0; transform: translateY(-40px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes slideDown {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(20px); opacity: 0; }
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes slideInLeft {
      from { transform: translateX(-100px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideInRight {
      from { transform: translateX(100px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @media (max-width: 600px) {
      #tts-floating-player .player-right { gap: 4px !important; }
      #tts-floating-player .player-time,
      #tts-floating-player .player-wpm { display: none !important; }
      #tts-floating-player #player-current-word { max-width: 80px !important; }
      #tts-floating-player .player-center { padding: 0 8px !important; }
    }
  `;
  
  if (document.head) {
    document.head.appendChild(style);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.head) document.head.appendChild(style);
    });
  }
  } // end style injection guard
  
  // Create floating player HTML — slim top navbar layout
  const player = document.createElement('div');
  player.id = 'tts-floating-player';
  player.className = (document.body && document.body.classList.contains('dark-mode')) ? 'dark-mode' : '';
  player.style.cssText = 'display:none;';
  player.innerHTML = `
    <div class="player-left">
      <div class="player-title">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        </svg>
        Pro Reader
      </div>
    </div>
    <div class="player-center">
      <div class="player-controls">
        <button class="player-btn" title="Skip back ~5s" id="player-prev">⏮</button>
        <button class="player-btn" title="Play / Pause" id="player-play">⏸</button>
        <button class="player-btn" title="Stop" id="player-stop">⏹</button>
        <button class="player-btn" title="Skip forward ~5s" id="player-next">⏭</button>
      </div>
    </div>
    <div class="player-right">
      <div class="player-time">
        <span id="player-current-time">0:00</span>
        <span class="player-time-sep">/</span>
        <span id="player-total-time">0:00</span>
      </div>
      <div class="player-wpm" id="player-wpm">— WPM</div>
      <button class="player-close" title="Close">✕</button>
    </div>
    <div class="player-progress">
      <div class="player-progress-bar">
        <div class="player-progress-fill" id="player-progress-fill"></div>
      </div>
    </div>
    <div class="player-stats"></div>
  `;
  
  document.documentElement.appendChild(player);
  console.log('🎵 Floating player created and mounted on <html> (hidden)');
  
  // Add event listeners
  const closeBtn = player.querySelector('.player-close');
  const playBtn = player.querySelector('#player-play');
  const stopBtn = player.querySelector('#player-stop');
  const prevBtn = player.querySelector('#player-prev');
  const nextBtn = player.querySelector('#player-next');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      player.style.display = 'none';
      try { if (typeof handleStop === 'function') handleStop(); } catch (e) { console.warn('handleStop error:', e); }
    });
  }
  
  if (playBtn) {
    // Set initial button state: show pause icon if currently reading without pause
    playBtn.textContent = (isReading && !isPaused) ? '⏸' : '▶';
    
    playBtn.addEventListener('click', () => {
      if (isPaused) {
        try { if (typeof handleResume === 'function') handleResume(); } catch (e) { console.warn('handleResume error:', e); }
        playBtn.textContent = '⏸';
      } else {
        try { if (typeof handlePause === 'function') handlePause(); } catch (e) { console.warn('handlePause error:', e); }
        playBtn.textContent = '▶';
      }
    });
  }
  
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      try { if (typeof handleStop === 'function') handleStop(); } catch (e) { console.warn('handleStop error:', e); }
      player.style.display = 'none';
    });
  }
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      skipBackward(5000);
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      skipForward(5000);
    });
  }
  
  // Progress bar click handler - seek to position
  const progressBar = player.querySelector('.player-progress-bar');
  if (progressBar) {
    progressBar.addEventListener('click', (e) => {
      if (!isReading && !isPaused) {
        console.warn('Not reading, cannot seek');
        return;
      }
      
      // Calculate click position as percentage
      const rect = progressBar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
      
      // Calculate target word index
      const targetWordIndex = Math.floor((percentage / 100) * words.length);
      console.log(`Progress bar seek: ${percentage.toFixed(1)}% → word ${Math.max(0, Math.min(targetWordIndex, words.length - 1))}`);
      sendStatusUpdate(`Seeking to ${percentage.toFixed(0)}%...`, Math.round(percentage));
      // Reliable seek
      try { seekToWordIndex(targetWordIndex); } catch (_) {}
    });
  }
  
  console.log('Floating player created');
}

// ===== SEEK & HIGHLIGHT HELPERS =====
function seekToWordIndex(targetIndex) {
  try {
    if (!Array.isArray(words) || words.length === 0) return;
    const idx = Math.max(0, Math.min(typeof targetIndex === 'number' ? targetIndex : 0, words.length - 1));
    try { wordHighlighter.clearAll(wrappedSpans); } catch (_) {}
    try { wordHighlighter.resetPosition(idx); } catch (_) {}
    highlightedSpan = null;
    // Reset grouping so absolute seek is honored
    try { sentenceGroups = []; } catch (_) {}
    // Cancel current utterance if any
    try { if (synth && synth.speaking) synth.cancel(); } catch (_) {}
    currentWordIndex = idx;
    isReading = true;
    isPaused = false;
    try {
      if (typeof readNextChunk === 'function') {
        readNextChunk();
      } else {
        setTimeout(() => {
          try {
            if (typeof readNextChunk === 'function' && isReading && !isPaused) {
              readNextChunk();
            }
          } catch (err2) {
            console.warn('Deferred readNextChunk error:', err2);
          }
        }, 50);
      }
    } catch (err) {
      console.warn('Deferred readNextChunk failed:', err);
    }
  } catch (e) {
    console.warn('seekToWordIndex error:', e);
  }
}

function skipByMs(ms) {
  if (!Array.isArray(words) || words.length === 0) return;
  const speed = (currentSettings && currentSettings.speed) ? currentSettings.speed : 1;
  const wps = 3.0 * Math.max(0.25, Math.min(4, speed)); // heuristic
  const wordsToMove = Math.max(1, Math.round((ms / 1000) * wps));
  return wordsToMove;
}

function skipForward(ms) {
  const step = skipByMs(ms || 5000);
  seekToWordIndex((currentWordIndex || 0) + step);
}

function skipBackward(ms) {
  const step = skipByMs(ms || 5000);
  seekToWordIndex((currentWordIndex || 0) - step);
}

// Jump helpers (word-based)
function jumpByWords(count) {
  if (!Number.isFinite(count) || !Array.isArray(words) || words.length === 0) return;
  const target = (currentWordIndex || 0) + Math.trunc(count);
  seekToWordIndex(target);
}
function jumpForward1000() { jumpByWords(1000); }
function jumpBackward1000() { jumpByWords(-1000); }

function jumpToNextLetterWord(letter) {
  if (!Array.isArray(words) || words.length === 0) return;
  
  const searchLetter = letter.toLowerCase();
  let nextIndex = -1;
  
  // Search starting from the word after current position
  for (let i = (currentWordIndex || 0) + 1; i < words.length; i++) {
    const word = words[i];
    if (word && word.length > 0) {
      const firstLetter = word.charAt(0).toLowerCase();
      if (firstLetter === searchLetter) {
        nextIndex = i;
        break;
      }
    }
  }
  
  // If not found in forward direction, wrap around to beginning
  if (nextIndex === -1) {
    for (let i = 0; i <= (currentWordIndex || 0); i++) {
      const word = words[i];
      if (word && word.length > 0) {
        const firstLetter = word.charAt(0).toLowerCase();
        if (firstLetter === searchLetter) {
          nextIndex = i;
          break;
        }
      }
    }
  }
  
  // Jump to found word or show notification if not found
  if (nextIndex !== -1) {
    console.log(`📌 Jump to letter '${letter}': word index ${nextIndex} (${words[nextIndex]})`);
    seekToWordIndex(nextIndex);
  } else {
    console.log(`❌ No words starting with '${letter}' found`);
    // Show toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(20, 20, 22, 0.95);
      color: #ff6b6b;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      z-index: 999999999;
      border: 1px solid rgba(255, 107, 107, 0.3);
      animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2.7s;
      box-shadow: 0 4px 12px rgba(255, 107, 107, 0.2);
    `;
    toast.textContent = `No words starting with "${letter}"`;
    safeAppendToBody(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

function jumpToNextRegexWord(letter) {
  if (!Array.isArray(words) || words.length === 0) return;
  
  // Define regex patterns for each letter (Shift + letter)
  const regexPatterns = {
    'a': /^[aeiou]/i,           // Words starting with vowels
    'b': /[aeiou]/i,             // Words containing vowels
    'c': /^[bcdfghjklmnpqrstvwxyz]/i, // Words starting with consonants
    'd': /\d/,                   // Words containing digits
    'e': /ed$/i,                 // Words ending with 'ed'
    'f': /^[a-z]{1,2}$/i,        // Short words (1-2 letters)
    'g': /^[a-z]{3,}$/i,         // Long words (3+ letters)
    'h': /^[A-Z]/,               // Words starting with uppercase (capitalized)
    'i': /[aeiou]{2,}/i,         // Words with multiple vowels
    'j': /ing$/i,                // Words ending with 'ing'
    'k': /tion$/i,               // Words ending with 'tion'
    'l': /ly$/i,                 // Words ending with 'ly'
    'm': /^[a-z]$/i,             // Single letter words
    'n': /[!?,.;:'"]/,           // Words with punctuation
    'o': /^[a-z]$/i,             // Single letter words (alternative)
    'p': /^[pP]/,                // Words starting with P
    'q': /^[qQ]/,                // Words starting with Q
    'r': /^[rR]/,                // Words starting with R
    's': /^[sS]/,                // Words starting with S
    't': /^[tT]/,                // Words starting with T
    'u': /^[uU]/,                // Words starting with U
    'v': /^[vV]/,                // Words starting with V
    'w': /^[wW]/,                // Words starting with W
    'x': /^[xX]/,                // Words starting with X
    'y': /^[yY]/,                // Words starting with Y
    'z': /^[zZ]/,                // Words starting with Z
  };
  
  const regex = regexPatterns[letter.toLowerCase()];
  if (!regex) {
    console.warn(`No regex pattern defined for letter '${letter}'`);
    return;
  }
  
  let nextIndex = -1;
  
  // Search starting from the word after current position
  for (let i = (currentWordIndex || 0) + 1; i < words.length; i++) {
    const word = words[i];
    if (word && word.length > 0) {
      try {
        if (regex.test(word)) {
          nextIndex = i;
          break;
        }
      } catch (e) {
        console.warn('Regex test error:', e);
      }
    }
  }
  
  // If not found in forward direction, wrap around to beginning
  if (nextIndex === -1) {
    for (let i = 0; i <= (currentWordIndex || 0); i++) {
      const word = words[i];
      if (word && word.length > 0) {
        try {
          if (regex.test(word)) {
            nextIndex = i;
            break;
          }
        } catch (e) {
          console.warn('Regex test error:', e);
        }
      }
    }
  }
  
  // Jump to found word or show notification
  if (nextIndex !== -1) {
    const patternDesc = {
      'a': 'vowel-starting word',
      'b': 'word with vowels',
      'c': 'consonant-starting word',
      'd': 'word with digits',
      'e': 'word ending in "ed"',
      'f': 'short word (1-2 letters)',
      'g': 'long word (3+ letters)',
      'h': 'capitalized word',
      'i': 'word with multiple vowels',
      'j': 'word ending in "ing"',
      'k': 'word ending in "tion"',
      'l': 'word ending in "ly"',
      'm': 'single letter',
      'n': 'word with punctuation',
      'p': 'word starting with P',
      'q': 'word starting with Q',
      'r': 'word starting with R',
      's': 'word starting with S',
      't': 'word starting with T',
      'u': 'word starting with U',
      'v': 'word starting with V',
      'w': 'word starting with W',
      'x': 'word starting with X',
      'y': 'word starting with Y',
      'z': 'word starting with Z',
    };
    const desc = patternDesc[letter.toLowerCase()] || `regex pattern (${letter})`;
    console.log(`🎯 Jump to next ${desc}: word index ${nextIndex} (${words[nextIndex]})`);
    seekToWordIndex(nextIndex);
  } else {
    const patternDesc = {
      'a': 'vowel-starting words',
      'b': 'words with vowels',
      'c': 'consonant-starting words',
      'd': 'words with digits',
      'e': 'words ending in "ed"',
      'f': 'short words',
      'g': 'long words',
      'h': 'capitalized words',
      'i': 'words with multiple vowels',
      'j': 'words ending in "ing"',
      'k': 'words ending in "tion"',
      'l': 'words ending in "ly"',
      'm': 'single letters',
      'n': 'words with punctuation',
    };
    const desc = patternDesc[letter.toLowerCase()] || `regex pattern`;
    console.log(`❌ No ${desc} found`);
    // Show toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(20, 20, 22, 0.95);
      color: #ff6b6b;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      z-index: 999999999;
      border: 1px solid rgba(255, 107, 107, 0.3);
      animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2.7s;
      box-shadow: 0 4px 12px rgba(255, 107, 107, 0.2);
    `;
    toast.textContent = `No ${desc}`;
    safeAppendToBody(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

function buildHighlightWordRegex(word) {
  return wordHighlighter._buildRegex(word || '');
}

function highlightCurrentWordFlex(word, wordIndex, minIdx = 0, maxIdx = Number.MAX_SAFE_INTEGER, exactMapWord = null) {
  try {
    const chosen = wordHighlighter.highlight(
      word, wordIndex, exactMapWord, wrappedSpans, currentSettings, words, minIdx, maxIdx
    );
    if (typeof chosen === 'number' && chosen >= 0) {
      highlightedSpan = wordHighlighter._activeSpan;
      try { if (typeof trackWPM === 'function') trackWPM(chosen); } catch (_) {}

      
      // Auto-scroll to highlighted word (same logic as highlightCurrentWord)
      if (autoScrollEnabled && highlightedSpan) {
        try {
          const now = Date.now();
          const rect = highlightedSpan.getBoundingClientRect();
          
          // Detect if word is near or out of view (50px margin)
          const margin = 50;
          const isNearOrOutOfView = rect.top < margin || rect.bottom > (window.innerHeight - margin) || 
                                    rect.left < margin || rect.right > (window.innerWidth - margin);
          
          // Only scroll if delay has elapsed
          const timeSinceLastScroll = now - lastScrollTime;
          
          if (isNearOrOutOfView && timeSinceLastScroll >= autoScrollDelay) {
            lastScrollTime = now;  // Update last scroll time
            
            // Try multiple scroll approaches
            try {
              highlightedSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (e1) {
              try {
                highlightedSpan.scrollIntoView(true);
              } catch (e2) {
                try {
                  const topOffset = highlightedSpan.offsetTop;
                  const windowCenter = window.innerHeight / 2;
                  window.scrollBy({ top: topOffset - windowCenter, behavior: 'smooth' });
                } catch (e3) {
                  try {
                    window.scroll(0, highlightedSpan.offsetTop - window.innerHeight / 2);
                  } catch (e4) {
                    // Scrolling blocked - silently fail
                  }
                }
              }
            }
          }
        } catch (e) {
          // Auto-scroll error - don't log, just silently fail
        }
      }
    }
    return chosen;
  } catch (e) {
    console.warn('Flexible highlight error:', e);
    return -1;
  }
}

// ===== CONFIGURATION SYSTEM =====
let appConfig = {
  version: '2.1',
  lastUpdated: Date.now(),
  userId: null,
  settings: {
    voice: null,
    speed: 1,
    pitch: 1,
    volume: 1,
    sentenceCount: 1,
    repeatCount: 1,
    selectionRepeatCount: 1,
    autoScroll: true,
    autoScrollDelay: 8000,  // 8 seconds for smooth scrolling
    showVocab: true,
    highlightColor: '#00ff00',
    highlightStyle: 'background',
    highlightOpacity: 1,
    syncHighlight: true
  },
  loopSettings: {
    delayBetweenRepeats: 0,
    infiniteLoop: false,
    loopIntensity: 'normal',
    fadeEffect: false
  },
  performance: {
    maxParallelWraps: 5,
    chunkSize: 1000,
    enableOffscreenCanvas: true
  }
};

async function saveConfig() {
  try {
    appConfig.lastUpdated = Date.now();
    const configString = JSON.stringify(appConfig);
    const configSize = new Blob([configString]).size;
    
    if (configSize > 5 * 1024 * 1024) {
      console.warn('Config size exceeds 5MB limit, trimming history...');
      // Trim if needed
    }
    
    await chrome.storage.local.set({ 
      appConfig: appConfig,
      lastConfigUpdate: Date.now()
    });
    console.log('✓ Configuration saved:', configSize, 'bytes');
  } catch (e) {
    console.warn('Could not save config:', e);
  }
}

async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['appConfig']);
    if (result.appConfig) {
      appConfig = Object.assign(appConfig, result.appConfig);
      console.log('✓ Configuration loaded from storage');
      return appConfig;
    }
  } catch (e) {
    console.warn('Could not load config:', e);
  }
  
  // Initialize default config if not found
  await saveConfig();
  return appConfig;
}

// Auto-save config on any setting change
function updateConfig(section, key, value) {
  try {
    if (appConfig[section] && typeof appConfig[section] === 'object') {
      appConfig[section][key] = value;
    } else {
      appConfig[key] = value;
    }
    
    // Debounced save to avoid excessive writes
    clearTimeout(configSaveTimeout);
    configSaveTimeout = setTimeout(() => {
      saveConfig();
    }, 1000);
    
    console.log(`Config updated: ${section}.${key} = ${value}`);
  } catch (e) {
    console.error('Error updating config:', e);
  }
}

let configSaveTimeout = null;

// Add click-to-speak functionality with Alt+Click (NON-BLOCKING)
let enableClickToSpeak = true;
let clickToSpeakActive = false;
let clickToReadEnabled = false;
let clickToSpeakDebounce = null;
let isProcessingClick = false;

// Visual cursor indicator for click-to-speak
document.addEventListener('keydown', (e) => {
  if (e.altKey || (e.ctrlKey && e.shiftKey)) {
    document.body.style.cursor = 'crosshair';
  }
});

document.addEventListener('keyup', () => {
  document.body.style.cursor = '';
});

// Helper function to get caret range from point
function _getCaretRange(x, y) {
  try {
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      r.setEnd(pos.offsetNode, pos.offset);
      return r;
    }
  } catch (e) {
    console.warn('caretRange error:', e);
  }
  return null;
}

// Optimized Alt+Click handler (non-blocking) - IMPROVED VERSION
document.addEventListener('click', (e) => {
  // Alt+Click or Ctrl+Shift+Click to start reading from cursor
  if ((e.altKey || (e.ctrlKey && e.shiftKey)) && !e.target.closest('#tts-floating-player')) {
    e.preventDefault();
    e.stopPropagation();
    
    // Prevent rapid successive clicks
    if (isProcessingClick) {
      console.log('Click processing in progress, ignoring duplicate click');
      return;
    }
    
    clickToSpeakActive = true;
    isProcessingClick = true;
    
    // Store click coordinates
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    // Show enhanced click indicator with ripple effect
    const indicator = document.createElement('div');
    indicator.style.cssText = `
      position: fixed;
      left: ${clientX}px;
      top: ${clientY}px;
      width: 50px;
      height: 50px;
      border: 4px solid #4F46E5;
      border-radius: 50%;
      pointer-events: none;
      z-index: 999999999;
      animation: clickPulse 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 0 20px rgba(79, 70, 229, 0.5);
      transform: translate(-50%, -50%);
    `;
    document.body.appendChild(indicator);
    
    // Create inner pulse
    const innerPulse = document.createElement('div');
    innerPulse.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 8px;
      height: 8px;
      background: #4F46E5;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: innerPulse 0.6s ease-out;
    `;
    indicator.appendChild(innerPulse);
    
    setTimeout(() => {
      try {
        indicator.remove();
      } catch (e) {
        console.warn('Could not remove indicator:', e);
      }
    }, 600);
    
    // Process click with improved timing and error handling
    const processClick = () => {
      try {
        // Check license for alt+click reading (PRO FEATURE)
        if (licenseManager && !licenseManager.canUseAltClickReading()) {
          isProcessingClick = false;
          return;
        }
        
        // Get range from click point - use safe method that works across browsers
        let range = null;
        try {
          if (typeof _getCaretRange === 'function') {
            range = _getCaretRange(clientX, clientY);
          } else if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(clientX, clientY);
          } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(clientX, clientY);
            if (pos) {
              range = document.createRange();
              range.setStart(pos.offsetNode, pos.offset);
              range.setEnd(pos.offsetNode, pos.offset);
            }
          }
        } catch (e) {
          console.warn('Error getting caret range:', e);
        }
        
        if (!range) {
          console.warn('Could not get range from click point');
          isProcessingClick = false;
          return;
        }
        
        // Store the cursor position for reading (non-invasive)
        window.__altClickRange = {
          container: range.startContainer,
          offset: range.startOffset
        };

        // Start reading from exactly the clicked position
        if (!isReading) {
          setTimeout(() => {
            try {
              ensureWrappedSpansVisible();
              // Use readFromClickPoint directly with the captured range
              if (typeof readFromClickPoint === 'function') {
                readFromClickPoint(range, currentSettings);
                setTimeout(() => { ensureWrappedSpansVisible(); }, 100);
              }
            } catch (readError) {
              console.error('Error starting read from alt+click:', readError);
            } finally {
              isProcessingClick = false;
              window.__altClickRange = null;
            }
          }, 10);
        } else if (isPaused) {
          // Alt+click while paused: resume from clicked position
          try { if (typeof handleStop === 'function') handleStop(); } catch (_) {}
          setTimeout(() => {
            try {
              if (typeof readFromClickPoint === 'function') {
                readFromClickPoint(range, currentSettings);
              }
            } catch (e) {
              console.error('Error resuming from alt+click:', e);
            } finally {
              isProcessingClick = false;
              window.__altClickRange = null;
            }
          }, 50);
        } else {
          // Alt+click while reading → stop and restart from new position
          try { if (typeof handleStop === 'function') handleStop(); } catch (_) {}
          setTimeout(() => {
            try {
              if (typeof readFromClickPoint === 'function') {
                readFromClickPoint(range, currentSettings);
              }
            } catch (e) {
              console.error('Error restarting from alt+click:', e);
            } finally {
              isProcessingClick = false;
              window.__altClickRange = null;
            }
          }, 80);
        }
        
      } catch (e) {
        console.error('Error processing alt+click:', e);
        isProcessingClick = false;
      }
    };
    
    // Use requestAnimationFrame for better timing
    requestAnimationFrame(() => {
      requestAnimationFrame(processClick);
    });
  }
}, true);

// Add animations for click indicator (enhanced)
if (!document.querySelector('style[data-click-pulse]')) {
  const style = document.createElement('style');
  style.setAttribute('data-click-pulse', 'true');
  style.textContent = `
    @keyframes clickPulse {
      0% {
        transform: translate(-50%, -50%) scale(0.2);
        opacity: 1;
      }
      50% {
        opacity: 0.8;
      }
      100% {
        transform: translate(-50%, -50%) scale(2.5);
        opacity: 0;
      }
    }
    
    @keyframes innerPulse {
      0% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
      }
      100% {
        transform: translate(-50%, -50%) scale(0.5);
        opacity: 0;
      }
    }
  `;
  
  if (document.head) {
    document.head.appendChild(style);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.head) document.head.appendChild(style);
    });
  }
}

function findMainContentContainer() {
  const candidates = [
    'article',
    'main',
    '[role="main"]',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.story-body',
    '.article-body',
    '.content-body',
    '#article-body',
    '#content',
    '#main-content',
    '.main-content',
    '.post-body',
    '.page-content',
    '[itemprop="articleBody"]',
    '.td-post-content',
    '.entry',
    '.single-content'
  ];
  for (const sel of candidates) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text.length > 200) {
          console.log(`Smart container found: ${sel} (${text.length} chars)`);
          return el;
        }
      }
    } catch (_) {}
  }
  return null;
}

function continueHandleRead(type, settings, importedText) {
  try {
    if (isReading) {
      handleStop();
    }
    
    // CRITICAL FIX: Merge settings instead of replacing to preserve all properties
    if (settings) {
      currentSettings = Object.assign({}, currentSettings, settings);
    }
    selectedNodes = []; // Reset selected nodes
    readingContainer = null;
    originalNodeBackup = []; // Reset backup
    originalTextBackup = '';
    
    if (type === 'imported' && importedText && importedText.trim().length > 0) {
      console.log('Reading imported text, length:', importedText.length);
      currentWordIndex = 0;
      isReading = true;
      lastScrollTime = 0;  // Reset scroll timer for immediate scrolling
      isPaused = false;
      wordPositionsCache.clear();
      wrappedSpans = [];
      words = importedText.trim().split(/\s+/).filter(w => w.length > 0);
      readingText = importedText.trim();
      sentenceGroups = [];
      currentSentenceGroupIndex = 0;
      currentRepeatIteration = 0;
      sendStatusUpdate(`Reading imported text: ${words.length} words`, 0);
      try { buildSentenceGroups(); } catch (e) { sentenceGroups = []; }
      try { createHighlightIndicator(); } catch (_) {}
      setTimeout(() => { if (isReading && !isPaused) readNextChunk(); }, 120);
      return;
    }
    
    if (type === 'selection') {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      
      if (!text) {
        sendStatusUpdate('No text selected', 0);
        return;
      }
      
      console.log('Reading selection:', text.substring(0, 50) + '...');
      
      // Store the range for wrapping
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        readingContainer = range.commonAncestorContainer;
        
        if (readingContainer && readingContainer.nodeType === Node.TEXT_NODE) {
          readingContainer = readingContainer.parentElement;
        }
        
        if (readingContainer) {
          console.log('Reading container:', readingContainer.tagName || readingContainer.nodeName);
        }
      }
    } else if (type === 'page' || type === 'cursor') {
      // Smart reading: check if cursor exists and start from there
      const selection = window.getSelection();
      readingContainer = findMainContentContainer() || document.body || document.documentElement;
      
      if (!readingContainer) {
        console.error('Critical: No reading container available');
        sendStatusUpdate('Error: Page structure unavailable', 0);
        return;
      }
      
      // If cursor/selection exists, we'll read from cursor onwards
      if (selection && selection.rangeCount > 0) {
        try {
          const range = selection.getRangeAt(0);
          const startNode = range.endContainer;
          const startOffset = range.endOffset;
          
          // Use smart cursor-aware reading
          currentWordIndex = 0;
          isReading = true;
          lastScrollTime = 0;  // Reset scroll timer for immediate scrolling
          isPaused = false;
          wordPositionsCache.clear();
          wrappedSpans = [];
          words = [];
          
          // Wrap words from cursor position
          wrapWordsFromNode(startNode, startOffset);
          
          if (words.length === 0) {
            // If no words from cursor, wrap entire page with callback
            wrappedSpans = [];
            words = [];
            wrapAllWords(() => startReadingAfterWrapping());
            return;
          }
        } catch (e) {
          console.warn('Error with cursor reading, falling back to page read:', e);
          wrappedSpans = [];
          words = [];
          wrapAllWords(() => startReadingAfterWrapping());
          return;
        }
      } else {
        // No cursor, read entire page normally
        currentWordIndex = 0;
        isReading = true;
        lastScrollTime = 0;  // Reset scroll timer for immediate scrolling
        isPaused = false;
        wordPositionsCache.clear();
        wrappedSpans = [];
        words = [];
        
        wrapAllWords(() => startReadingAfterWrapping());
        return;
      }
    } else {
      readingContainer = document.body || document.documentElement;
    }
    
    if (!isReading) {
      currentWordIndex = 0;
      isReading = true;
      isPaused = false;
      wordPositionsCache.clear();
      wrappedSpans = [];
      words = [];
      
      // Wrap all words with callback to start reading when complete
      wrapAllWords(() => {
        // This callback fires when wrapping is complete
        startReadingAfterWrapping();
      });
      return;
    }
    
    // If we reach here, wrapping should be complete
    if (words.length === 0) {
      console.warn('No words extracted - attempting fallback extraction');
      
      // FALLBACK: Try extracting text directly if wrapping failed
      try {
        const pageText = (document.body.innerText || document.body.textContent || '').trim();
        if (pageText.length > 50) {
          console.log(`Fallback: Extracted ${pageText.length} characters from page`);
          words = pageText.split(/\s+/).filter(w => w.length > 0);
          wrappedSpans = words.map((w, i) => ({
            textContent: w,
            nodeIndex: i,
            isVirtual: true,
            _node: null
          }));
        }
      } catch (e) {
        console.warn('Fallback extraction error:', e);
      }
      
      if (words.length === 0) {
        sendStatusUpdate('No text found on page', 0);
        isReading = false;
        console.error('No words extracted from page - all methods failed');
        return;
      }
    }

    console.log(`Total words to read: ${words.length}`);
    console.log(`Total wrapped spans: ${wrappedSpans.length}`);
    
    // Remove any legacy CSS classes that could override inline highlight
    try { stripLegacyHighlightClasses(); } catch (e) { console.warn('Strip class error:', e); }

    // Ensure all wrapped spans are visible (fix for text disappearing)
    try {
      ensureWrappedSpansVisible();
    } catch (e) {
      console.warn('Error ensuring spans visible:', e);
    }
    
    // Start visibility guardian to continuously protect text visibility
    try {
      startVisibilityGuardian();
    } catch (e) {
      console.warn('Error starting visibility guardian:', e);
    }
    
    readingText = words.join(' ');
    
    // Build sentence groups
    try {
      buildSentenceGroups();
    } catch (e) {
      console.warn('Error building sentence groups:', e);
    }
    currentSentenceGroupIndex = 0;
    currentRepeatIteration = 0;
    
    // Create visual indicator
    try {
      createHighlightIndicator();
    } catch (e) {
      console.warn('Error creating highlight indicator:', e);
    }
    
    // Enhanced watchdog timer - detect and recover from stuck speech
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    
    let keepaliveCounter = 0;
    let synthIdleStart = null;

    watchdogTimer = setInterval(() => {
      try {
        if (!isReading || isPaused) { synthIdleStart = null; return; }

        keepaliveCounter++;
        if (keepaliveCounter % 13 === 0 && synth && synth.speaking) {
          try { synth.pause(); synth.resume(); } catch (_) {}
        }

        const synthIdle = synth && !synth.speaking && !synth.pending;
        if (synthIdle) {
          if (synthIdleStart === null) synthIdleStart = Date.now();
          const idleMs = Date.now() - synthIdleStart;
          const silentMs = Date.now() - lastSpeechActivityTime;
          if (idleMs >= 2000 && silentMs >= 2000) {
            synthIdleStart = null;
            try {
              synth.cancel();
              setTimeout(() => { if (isReading && !isPaused) readNextChunk(); }, 80);
            } catch (e) { console.error('[Watchdog] Recovery error:', e); }
          }
        } else {
          synthIdleStart = null;
        }
      } catch (e) { console.warn('[Watchdog] Error:', e); }
    }, 800);
    
    readNextChunk();
  } catch (e) {
    console.error('Error in continueHandleRead:', e);
    sendStatusUpdate('Error starting reading: ' + (e.message || 'Unknown error'), 0);
    isReading = false;
  }
}

// Helper function called when word wrapping is complete
function startReadingAfterWrapping() {
  try {
    console.log(`✓ Wrapping complete! Total words: ${words.length}, Total spans: ${wrappedSpans.length}`);

    // Ensure counts align; if not, rebuild wrapping for reliable highlighting
    if (Array.isArray(words) && Array.isArray(wrappedSpans) && words.length !== wrappedSpans.length) {
      console.warn(`Words/Spans length mismatch (${words.length} vs ${wrappedSpans.length}). Rebuilding wrapping...`);
      removeHighlight();
      setTimeout(() => {
        try {
          wrappedSpans = [];
          words = [];
          wrapAllWords(() => startReadingAfterWrapping());
        } catch (e) {
          console.error('Error rebuilding wrapping:', e);
        }
      }, 10);
      return;
    }
    
    if (words.length === 0) {
      console.warn('No words extracted from page after wrapping - attempting fallback extraction');
      
      // FALLBACK 1: Try to extract text directly from dominant text nodes
      try {
        const bodyText = (document.body.innerText || document.body.textContent || '').trim();
        if (bodyText.length > 50) {
          console.log(`✓ Fallback: Extracted ${bodyText.length} chars from page text`);
          words = bodyText.split(/\s+/).filter(w => w.length > 0);
          
          // Create simple wrapping for fallback words (no DOM wrapping, just split)
          wrappedSpans = words.map((w, i) => {
            // Create a virtual span object for tracking (not inserted into DOM)
            const span = {
              textContent: w,
              nodeIndex: i,
              isVirtual: true, // Mark as fallback
              _node: null
            };
            return span;
          });
          
          console.log(`✓ Fallback: Created ${words.length} words from page text`);
        }
      } catch (e) {
        console.warn('Fallback text extraction failed:', e);
      }
      
      // If still no words, try search-specific extraction for Google/Bing
      if (words.length === 0) {
        try {
          console.log('Attempting search result specific extraction...');
          // Try to extract from search result divs (Google/Bing specific)
          const searchResults = document.querySelectorAll('[data-sokoban-container], .g, .s, .algoresult, [data-component-type="organic"]');
          let searchText = '';
          
          searchResults.forEach(result => {
            const text = (result.innerText || result.textContent || '').trim();
            if (text.length > 20) {
              searchText += ' ' + text;
            }
          });
          
          if (searchText.length > 100) {
            console.log(`✓ Search extraction: Found ${searchText.length} chars`);
            words = searchText.trim().split(/\s+/).filter(w => w.length > 0);
            wrappedSpans = words.map((w, i) => ({
              textContent: w,
              nodeIndex: i,
              isVirtual: true,
              _node: null
            }));
          }
        } catch (e) {
          console.warn('Search extraction failed:', e);
        }
      }
      
      // Last resort: show error with helpful message
      if (words.length === 0) {
        sendStatusUpdate(`No readable text found on page (${window.location.hostname})`, 0);
        isReading = false;
        console.error('All extraction methods failed - no words available');
        return;
      }
    }

    // Post-wrap guard: advance past leading skip-nav phrases that slipped through DOM filtering.
    // Check a short window of the first words; if joined text matches skip-nav pattern, skip them.
    try {
      const skipNavRx = /^(skip\s+(to\s+)?(main\s+)?(content|navigation|nav|link)|jump\s+to\s+(main|content)|go\s+to\s+main\s+content)/i;
      const window20 = words.slice(0, 20).join(' ');
      const skipMatch = skipNavRx.exec(window20);
      if (skipMatch) {
        const skipWordCount = skipMatch[0].trim().split(/\s+/).length;
        console.log(`Post-wrap: skipping ${skipWordCount} leading skip-nav words: "${skipMatch[0]}"`);
        currentWordIndex = skipWordCount;
      }
    } catch (_) {}

    // Remove any legacy CSS classes that could override inline highlight
    try { stripLegacyHighlightClasses(); } catch (e) { console.warn('Strip class error:', e); }

    // Ensure all wrapped spans are visible (fix for text disappearing)
    try {
      ensureWrappedSpansVisible();
    } catch (e) {
      console.warn('Error ensuring spans visible:', e);
    }
    
    // Start visibility guardian to continuously protect text visibility
    try {
      startVisibilityGuardian();
    } catch (e) {
      console.warn('Error starting visibility guardian:', e);
    }
    
    readingText = words.join(' ');
    
    // Build sentence groups
    try {
      buildSentenceGroups();
    } catch (e) {
      console.warn('Error building sentence groups:', e);
    }
    currentSentenceGroupIndex = 0;
    currentRepeatIteration = 0;
    
    // Create visual indicator
    try {
      createHighlightIndicator();
    } catch (e) {
      console.warn('Error creating highlight indicator:', e);
    }
    
    // Enhanced watchdog timer - detect and recover from stuck speech
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    
    let keepaliveCounter2 = 0;
    let synthIdleStart2 = null;

    watchdogTimer = setInterval(() => {
      try {
        if (!isReading || isPaused) { synthIdleStart2 = null; return; }

        keepaliveCounter2++;
        if (keepaliveCounter2 % 13 === 0 && synth && synth.speaking) {
          try { synth.pause(); synth.resume(); } catch (_) {}
        }

        const synthIdle = synth && !synth.speaking && !synth.pending;
        if (synthIdle) {
          if (synthIdleStart2 === null) synthIdleStart2 = Date.now();
          const idleMs = Date.now() - synthIdleStart2;
          const silentMs = Date.now() - lastSpeechActivityTime;
          if (idleMs >= 2000 && silentMs >= 2000) {
            synthIdleStart2 = null;
            try {
              synth.cancel();
              setTimeout(() => { if (isReading && !isPaused) readNextChunk(); }, 80);
            } catch (e) { console.error('[Watchdog] Recovery error:', e); }
          }
        } else {
          synthIdleStart2 = null;
        }
      } catch (e) { console.warn('[Watchdog] Error:', e); }
    }, 800);
    
    // NOW that wrapping is complete, start reading
    readNextChunk();
  } catch (e) {
    console.error('Error in startReadingAfterWrapping:', e);
    isReading = false;
    sendStatusUpdate('Error starting reading: ' + (e.message || 'Unknown error'), 0);
  }
}

function extractPageText() {
  const article = document.querySelector('article');
  const main = document.querySelector('main');
  const content = document.querySelector('[role="main"]');
  
  let element = article || main || content || document.body;
  
  const clone = element.cloneNode(true);
  
  const unwantedSelectors = [
    'script', 'style', 'nav', 'header', 'footer', 
    'aside', 'iframe', 'noscript', '.ad', '.ads',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]'
  ];
  
  unwantedSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  let text = clone.textContent || clone.innerText || '';
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Fallback extraction for search results and special page types
function extractPageTextFallback() {
  try {
    let result = '';
    
    // Try search result containers (Google, Bing, DuckDuckGo)
    const searchContainers = document.querySelectorAll(
      '[data-sokoban-container], .g, .hnwb3, .algo, .web-result, [data-component-type="organic"], .search-result'
    );
    
    if (searchContainers.length > 0) {
      console.log(`Found ${searchContainers.length} search result containers`);
      searchContainers.forEach(container => {
        const text = (container.innerText || container.textContent || '').trim();
        if (text.length > 20) {
          result += ' ' + text;
        }
      });
    }
    
    // If no search results, try article/content divs
    if (result.length < 100) {
      const articles = document.querySelectorAll('article, [role="article"], .post, .entry, [itemprop="articleBody"]');
      articles.forEach(article => {
        const text = (article.innerText || article.textContent || '').trim();
        if (text.length > 50) {
          result += ' ' + text;
        }
      });
    }
    
    return result.replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.warn('Fallback extraction error:', e);
    return '';
  }
}

function readNextChunk() {
  try {
    console.log(`[readNextChunk] Called (isReading=${isReading}, isPaused=${isPaused})`);
    
    // if (!isReading || isPaused) {
    //   return;
    // }
    
    console.log(`[readNextChunk ENTRY] currentSentenceGroupIndex=${currentSentenceGroupIndex}, sentenceGroups=${Array.isArray(sentenceGroups) ? sentenceGroups.length : 'NOT_ARRAY'}, isReading=${isReading}, isPaused=${isPaused}`);
    
    // ===== COMPREHENSIVE STATE VALIDATION =====
    // Ensure all critical variables are in valid states
    // Words array - MUST be initialized and non-empty to read
    if (typeof words === 'undefined' || words === null) {
      words = [];
    }
    if (!Array.isArray(words) || words.length === 0) {
      console.warn('readNextChunk: words array is not initialized or empty');
      isReading = false;
      sendStatusUpdate('No words to read', 0);
      return;
    }
    
    // Wrapped spans - MUST be initialized
    if (typeof wrappedSpans === 'undefined' || wrappedSpans === null) {
      wrappedSpans = [];
    }
    if (!Array.isArray(wrappedSpans)) {
      console.warn('readNextChunk: wrappedSpans is not an array, re-initializing');
      wrappedSpans = [];
    }
    
    // Sentence groups - Should be initialized but may be empty
    if (typeof sentenceGroups === 'undefined' || sentenceGroups === null) {
      console.warn('readNextChunk: sentenceGroups is undefined, initializing empty array');
      sentenceGroups = [];
    }
    if (!Array.isArray(sentenceGroups)) {
      console.warn('readNextChunk: sentenceGroups is not an array type, resetting to array');
      sentenceGroups = [];
    }
    
    // If not initialized, rebuild sentence groups
    if (sentenceGroups.length === 0 && words.length > 0) {
      try {
        buildSentenceGroups();
        console.log(`[readNextChunk] After buildSentenceGroups: ${sentenceGroups.length} groups created, words.length=${words.length}, sentenceCount=${currentSettings.sentenceCount}`);
        if (sentenceGroups.length <= 1 && words.length > 20) {
          console.warn(`[readNextChunk] WARNING: Only 1 group created for ${words.length} words! This will only read once.`);
        }
      } catch (e) {
        console.warn('Error rebuilding sentence groups:', e);
        sentenceGroups = [];
      }
    }
    
    // BRANCH 1: Use sentence groups if available
    if (sentenceGroups.length > 0) {
      const repeatCount = Math.max(1, Number(currentSettings.repeatCount) ); // Ensure minimum 1
      
      // DEFENSIVE CHECK: If indices somehow got out of sync, fix them
      if (currentSentenceGroupIndex < 0) currentSentenceGroupIndex = 0;
      if (currentRepeatIteration < 0) currentRepeatIteration = 0;
      if (isNaN(currentSentenceGroupIndex)) currentSentenceGroupIndex = 0;
      if (isNaN(currentRepeatIteration)) currentRepeatIteration = 0;
      
      console.log(`[ReadNextChunk] repeatCount=${repeatCount}, currentSentenceGroupIndex=${currentSentenceGroupIndex}, currentRepeatIteration=${currentRepeatIteration}, totalGroups=${sentenceGroups.length}`);
      
      // Check if we've finished all groups and all repetitions
      if (currentSentenceGroupIndex >= sentenceGroups.length) {
        console.log(`[Sentence Complete] Finished reading all ${sentenceGroups.length} groups - ending paragraph`);
        currentSentenceGroupIndex = 0;
        currentRepeatIteration = 0;
        
        try { wordHighlighter.clearAll(wrappedSpans); } catch (_) {}
        try { wordHighlighter.resetPosition(); } catch (_) {}
        highlightedSpan = null;
        
        // Signal end of paragraph reading (important for paragraph reader loop)
        isReading = false;
        console.log('[Sentence Complete] Set isReading=false to signal end of paragraph');
        try { window.dispatchEvent(new CustomEvent('tts-paragraph-complete')); } catch (_) {}
        
        try {
          const messagePromise = chrome.runtime.sendMessage({ action: 'restarting' });
          if (messagePromise && typeof messagePromise.catch === 'function') {
            messagePromise.catch(err => {
              console.log('Restart message failed (extension may be reloading):', err ? err.message : 'unknown');
            });
          }
        } catch (e) {
          console.log('Could not send restart message (extension context invalid)');
        }

        // Don't automatically restart - let the paragraph reader handle the next paragraph
        return;
      }
      
      // Safety: bounds check before accessing array
      if (currentSentenceGroupIndex < 0 || currentSentenceGroupIndex >= sentenceGroups.length) {
        console.warn(`Invalid sentence group index: ${currentSentenceGroupIndex} (array length: ${sentenceGroups.length})`);
        // Reset and rebuild sentence groups as fallback
        currentSentenceGroupIndex = 0;
        currentRepeatIteration = 0;
        try {
          buildSentenceGroups();
          console.log(`[Fallback] Rebuilt ${sentenceGroups.length} sentence groups`);
        } catch (e) {
          console.error('[Fallback] Failed to rebuild sentence groups:', e);
          isReading = false;
          return;
        }
      }
      
      const currentGroup = sentenceGroups[currentSentenceGroupIndex];
      if (!currentGroup || !Array.isArray(currentGroup) || currentGroup.length === 0) {
        console.warn('Invalid sentence group structure at index:', currentSentenceGroupIndex);
        // Fallback: rebuild sentence groups
        try {
          currentSentenceGroupIndex = 0;
          currentRepeatIteration = 0;
          buildSentenceGroups();
          console.log(`[Fallback] Rebuilt sentence groups after detection of invalid group`);
          if (sentenceGroups.length > 0) {
            readNextChunk(); // Retry with rebuilt groups
          } else {
            isReading = false;
          }
        } catch (e) {
          console.error('[Fallback] Error rebuilding sentence groups:', e);
          isReading = false;
        }
        return;
      }
      
      const startWordIndex = currentGroup[0];
      const endWordIndex = currentGroup[currentGroup.length - 1] + 1;
      
      const groupWords = [];
      for (let i = startWordIndex; i < endWordIndex; i++) {
        groupWords.push(words[i]);
      }
      const chunk = groupWords.join(' ');
      
      console.log(`[ReadNextChunk DETAILED] Group ${currentSentenceGroupIndex}: words[${startWordIndex}...${endWordIndex-1}] = "${chunk.substring(0, 80)}..."`);
      console.log(`[ReadNextChunk DETAILED] Settings: repeatCount=${currentSettings.repeatCount}, sentenceCount=${currentSettings.sentenceCount}`);
      console.log(`[ReadNextChunk DETAILED] currentRepeatIteration=${currentRepeatIteration}, willRepeat=${currentRepeatIteration < (Math.max(1, Number(currentSettings.repeatCount)))}`);
      
      // Defensive check: ensure sentenceGroups still exists
      if (!sentenceGroups || !Array.isArray(sentenceGroups) || sentenceGroups.length === 0) {
        console.warn('[ReadNextChunk DETAILED] sentenceGroups became invalid after group extraction, falling back to word-by-word reading');
        currentWordIndex = endWordIndex;
        setTimeout(() => {
          if (isReading && !isPaused) {
            readNextChunk();
          }
        }, 10);
        return;
      }
      
      const progress = Math.round((currentSentenceGroupIndex / sentenceGroups.length) * 100);
      sendStatusUpdate(`Reading... Group ${currentSentenceGroupIndex + 1}/${sentenceGroups.length} (Repeat ${currentRepeatIteration + 1}/${repeatCount})`, progress);
      
      console.log(`[Sentence Speak] About to speak group ${currentSentenceGroupIndex}: "${chunk.substring(0, 50)}..."`);
      
      updateFloatingPlayer(progress, currentSentenceGroupIndex, sentenceGroups.length);
      
      speakChunk(chunk, startWordIndex, endWordIndex, () => {
        console.log(`[speakChunk Callback] Entered callback for group ${currentSentenceGroupIndex}`);
        try {
          // CRITICAL SANITY CHECK: Prevent callback from running multiple times
          // If isReading is false, we should NOT be processing this callback
          if (!isReading) {
            console.log('[SpeakChunk Callback] isReading=false, ending reading');
            return; // EXIT EARLY - reading was stopped
          }
          
          // Note: Allow paused state to still process (user may resume)
          // Validate sentence groups still exist and are valid
          if (!sentenceGroups || !Array.isArray(sentenceGroups)) {
            console.warn('[SpeakChunk Callback] Invalid state - sentenceGroups became invalid');
            sentenceGroups = []; // Reset to empty array
          }
          
          // Check if user wants to skip current repeat
          if (loopSettings.skipToNextRepeat) {
            loopSettings.skipToNextRepeat = false;
            currentRepeatIteration = 0;
            currentSentenceGroupIndex++;
            console.log('Skipped to next repeat');
            setTimeout(() => {
              if (isReading && !isPaused) {
                readNextChunk();
              }
            }, 100);
            return;
          }

          // After speaking, check if we need to repeat
          // IMPORTANT: currentRepeatIteration starts at 0, so first read = 0, second = 1, etc.
          currentRepeatIteration++;
          const totalRepeatsCompleted = currentRepeatIteration;
          
          // DEFENSIVE: Clamp repeat count to reasonable values
          const safeRepeatCount = Math.max(1, Math.min(repeatCount, 100)); // Cap at 100 to prevent infinite loops from bad settings
          const isInfiniteLoop = loopSettings.infiniteLoop && totalRepeatsCompleted >= safeRepeatCount;
          
          const shouldRepeat = totalRepeatsCompleted < safeRepeatCount || isInfiniteLoop;
          console.log(`[Sentence Repeat] Group ${currentSentenceGroupIndex}/${sentenceGroups.length}: completed ${totalRepeatsCompleted}/${safeRepeatCount} repeats`);
          console.log(`[Sentence Decision] Check: ${totalRepeatsCompleted} < ${safeRepeatCount} = ${totalRepeatsCompleted < safeRepeatCount}, infinite=${isInfiniteLoop}, shouldRepeat=${shouldRepeat}`);
          console.log(`[Sentence Decision] State: isReading=${isReading}, isPaused=${isPaused}, sentenceGroups.length=${sentenceGroups.length}`);
          
          if (shouldRepeat && isReading && !isPaused && sentenceGroups.length > 0) {
            console.log(`[Sentence Decision] REPEATING sentence group ${currentSentenceGroupIndex}`);
            // Calculate delay based on loop intensity
            let delay = loopSettings.delayBetweenRepeats || 0;
            if (loopSettings.loopIntensity === 'gentle') {
              delay = 3000; // 3 second pause between repeats for gentle learning
            } else if (loopSettings.loopIntensity === 'intense') {
              delay = 100; // Minimal pause for intense practice
            }

            // Track repeat in history
            addToLoopHistory({
              groupIndex: currentSentenceGroupIndex,
              repeatCount: currentRepeatIteration,
              timestamp: Date.now()
            });

            // Apply fade effect if enabled
            if (loopSettings.fadeEffect && highlightedSpan) {
              highlightedSpan.style.opacity = '0.7';
              setTimeout(() => {
                if (highlightedSpan) highlightedSpan.style.opacity = '1';
              }, delay / 2);
            }

            // Repeat the same group with delay
            setTimeout(() => {
              if (isReading && !isPaused) {
                readNextChunk();
              }
            }, delay);
          } else {
            // Move to next group
            console.log(`[Sentence Decision] Moving to next group (${currentSentenceGroupIndex} → ${currentSentenceGroupIndex + 1})`);
            currentRepeatIteration = 0;
            currentSentenceGroupIndex++;
            
            // Schedule next read with safety check
            setTimeout(() => {
              if (isReading && !isPaused) {
                console.log(`[Sentence ReadNextChunk] Calling readNextChunk for group ${currentSentenceGroupIndex}`);
                readNextChunk();
              } else {
                console.log(`[Sentence ReadNextChunk] Skipped - isReading=${isReading}, isPaused=${isPaused}`);
              }
            }, 100);
          }
        } catch (e) {
          console.error('Error in repeat callback:', e);
          console.log('[Sentence Error Recovery] Moving to next group due to error');
          // Safe recovery: continue to next group
          currentRepeatIteration = 0;
          currentSentenceGroupIndex++;
          setTimeout(() => {
            if (isReading && !isPaused) {
              readNextChunk();
            }
          }, 100);
        }
      });
      return; // Exit after handling sentence group
    }
    
    // BRANCH 2: Fallback - word-by-word reading (no valid sentence groups, or continue after error above)
    if (currentWordIndex >= words.length) {
      console.log('Finished reading all words - restarting from beginning');
      currentWordIndex = 0;
      
      try { wordHighlighter.clearAll(wrappedSpans); } catch (_) {}
      try { wordHighlighter.resetPosition(); } catch (_) {}
      highlightedSpan = null;
      
      try {
        const messagePromise = chrome.runtime.sendMessage({ action: 'restarting' });
        if (messagePromise && typeof messagePromise.catch === 'function') {
          messagePromise.catch(err => {
            console.log('Restart message failed (extension may be reloading):', err ? err.message : 'unknown');
          });
        }
      } catch (e) {
        console.log('Could not send restart message (extension context invalid)');
      }
      
      // Brief pause before restarting
      setTimeout(() => {
        if (isReading && !isPaused) {
          readNextChunk();
        }
      }, 500);
      return;
    }
    
    const chunkSize = 50; // Larger chunks = fewer gaps = more continuous reading
    const endIndex = Math.min(currentWordIndex + chunkSize, words.length);
    
    // IMPROVED: Filter out empty/whitespace words and build chunk safely
    const chunkWords = [];
    let actualEndIndex = currentWordIndex;
    
    for (let i = currentWordIndex; i < endIndex && i < words.length; i++) {
      const word = words[i];
      // Strict validation: must exist, be string, and have real content
      if (word && typeof word === 'string' && word.length > 0 && word.trim().length > 0) {
        chunkWords.push(word.trim());
        actualEndIndex = i + 1;
      }
    }
    
    // Also ensure we're not stuck at same position
    if (chunkWords.length === 0 && currentWordIndex < words.length - 1) {
      // Found no valid words in this range, skip ahead
      console.warn(`Warning: Range ${currentWordIndex}-${endIndex} has no valid words, skipping`);
      currentWordIndex = endIndex;
      const progress = Math.round((currentWordIndex / Math.max(words.length, 1)) * 100);
      sendStatusUpdate(`Reading… ${currentWordIndex}/${words.length} words (skipped empty range)`, progress);
      setTimeout(() => {
        if (isReading && !isPaused) {
          readNextChunk();
        }
      }, 10);
      return;
    }
    
    const chunk = chunkWords.join(' ');

    const progress = words.length > 0 ? Math.round((currentWordIndex / words.length) * 100) : 0;
    sendStatusUpdate(`Reading… ${currentWordIndex}/${words.length} words`, progress);

    updateFloatingPlayer(progress, currentWordIndex, words.length);

    // Pass the actual end index where we found real words
    speakChunk(chunk, currentWordIndex, actualEndIndex);
  } catch (e) {
    console.error('Error in readNextChunk:', e);
    // Force continue even on error
    if (isReading && !isPaused && currentWordIndex < words.length) {
      currentWordIndex = Math.min(currentWordIndex + 200, words.length);
      setTimeout(() => {
        try {
          readNextChunk();
        } catch (retryError) {
          console.error('Error in retry:', retryError);
          handleStop();
        }
      }, 100);
    } else if (isReading && !isPaused) {
      // End of content reached with error, try to restart
      console.log('Attempting to restart reading after error');
      currentWordIndex = 0;
      setTimeout(() => {
        try {
          readNextChunk();
        } catch (retryError) {
          console.error('Error restarting:', retryError);
          handleStop();
        }
      }, 500);
    }
  }
}

function speakChunk(text, startWordIndex, endWordIndex, onEndCallback) {
  // IMPROVED: Better empty text handling
  if (!text || text.trim().length === 0) {
    console.warn(`⚠️ Empty text chunk at words ${startWordIndex}-${endWordIndex}, finding next non-empty chunk`);
    
    if (isReading && !isPaused) {
      // Skip forward to find next non-empty word
      let nextValidIndex = startWordIndex;
      while (nextValidIndex < words.length) {
        if (words[nextValidIndex] && typeof words[nextValidIndex] === 'string' && words[nextValidIndex].trim().length > 0) {
          break;
        }
        nextValidIndex++;
      }
      
      // Move to next valid index
      if (nextValidIndex < words.length) {
        currentWordIndex = nextValidIndex;
        console.log(`✓ Found next valid word at index ${nextValidIndex}`);
      } else {
        currentWordIndex = endWordIndex;
        console.log(`✓ No more valid words, advancing to ${endWordIndex}`);
      }
      
      // Try next chunk immediately
      setTimeout(() => {
        try {
          readNextChunk();
        } catch (e) {
          console.error('Error in empty chunk recovery:', e);
        }
      }, 5);
    }
    return;
  }
  
  utterance = new SpeechSynthesisUtterance(text);
  
  const voices = synth.getVoices();
  if (currentSettings.voice !== null && voices[currentSettings.voice]) {
    utterance.voice = voices[currentSettings.voice];
  }
  
  utterance.rate = currentSettings.speed || 1;
  utterance.pitch = currentSettings.pitch || 1;
  utterance.volume = currentSettings.volume || 1;
  
  // Build character-to-word-index map from the ACTUAL utterance text.
  // Walk `text` with a regex so charIndex values from onboundary map precisely.
  const charToWordMap = [];
  {
    // Collect the global word indices that are actually in this utterance
    // (same filtering logic used when building `chunk` in readNextChunk)
    const globalIndicesInChunk = [];
    for (let i = startWordIndex; i < endWordIndex; i++) {
      const w = words[i];
      if (w && typeof w === 'string' && w.trim().length > 0) {
        globalIndicesInChunk.push(i);
      }
    }
    // Walk the utterance text with a word regex to get exact start/end positions
    const wordRx = /\S+/g;
    let m;
    let tokenSeq = 0;
    while ((m = wordRx.exec(text)) !== null) {
      const gIdx = globalIndicesInChunk[tokenSeq] !== undefined ? globalIndicesInChunk[tokenSeq] : -1;
      charToWordMap.push({ start: m.index, end: m.index + m[0].length, wordIndex: gIdx, word: m[0] });
      tokenSeq++;
    }
  }
  

  
  let lastHighlightedIndex = -1;
  let lastMatchedMapIndex  = -1;   // forward-monotonic index into charToWordMap
  let boundaryEventCount = 0;
  let startTime = null;
  let fallbackInterval = null;
  let onendFired = false;

  utterance.onstart = () => {
    startTime = performance.now();
    lastSpeechActivityTime = Date.now();
    boundaryEventCount = 0;
    lastHighlightedIndex = -1;
    lastMatchedMapIndex  = -1;
    onendFired = false;

    const baseWPM = Math.max(50, 150 * (utterance.rate || 1));
    const msPerWord = 60000 / baseWPM;

    // Compute expected chunk duration from actual word count + 35% buffer, min 1.2s, max 45s
    const chunkWordCount = endWordIndex - startWordIndex;
    const expectedDurationMs = Math.min(45000, Math.max(1200, chunkWordCount * msPerWord * 1.35));

    // "Synth truly stopped" check: wait at least 80% of expected duration before trusting synth.speaking=false
    const synthStopMinWait = Math.max(600, expectedDurationMs * 0.8);

    // Absolute timeout: expected duration + 2s grace, but never less than 3s or more than 20s
    const absoluteTimeoutMs = Math.min(20000, Math.max(3000, expectedDurationMs + 2000));

    let lastBoundaryTime = performance.now(); // track when last boundary event fired

    fallbackInterval = setInterval(() => {
      if (!isReading || !utterance || onendFired) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
        return;
      }

      const now = performance.now();
      const elapsed = now - startTime;
      const msSinceLastBoundary = now - lastBoundaryTime;

      // ── Chrome onend-not-firing watchdog ──────────────────────────────────
      // Condition A: synth reports stopped and we've waited long enough
      const synthStopped = elapsed > synthStopMinWait && !synth.speaking && !synth.pending;
      // Condition B: absolute timeout — expected duration + grace has elapsed
      const absoluteTimeout = elapsed > absoluteTimeoutMs;
      // Condition C: boundary events have stalled for >2.5× msPerWord after receiving at least one event,
      //              and we're past 90% of expected duration — synth is stuck mid-chunk
      const boundaryDrought = boundaryEventCount > 0
        && msSinceLastBoundary > Math.max(2500, msPerWord * 2.5)
        && elapsed > expectedDurationMs * 0.9;

      if ((synthStopped || absoluteTimeout || boundaryDrought) && !onendFired && isReading && !isPaused) {
        onendFired = true;
        clearInterval(fallbackInterval);
        fallbackInterval = null;
        currentWordIndex = endWordIndex;
        if (onEndCallback) {
          try { onEndCallback(); } catch (e) { console.error('[speakChunk] onEndCallback error:', e); }
        } else {
          readNextChunk();
        }
        return;
      }

      // ── Time-based highlight fallback (when boundary events are absent) ───
      if (elapsed > 400 && boundaryEventCount < 2 && charToWordMap.length > 0 && !isPaused) {
        const estimatedTokenIdx = Math.min(Math.floor(elapsed / msPerWord), charToWordMap.length - 1);
        const entry = charToWordMap[estimatedTokenIdx];
        const globalIndex = entry ? entry.wordIndex : -1;

        if (globalIndex >= startWordIndex && globalIndex < endWordIndex && globalIndex !== lastHighlightedIndex && globalIndex >= 0) {
          try {
            highlightCurrentWordFlex(words[globalIndex], globalIndex, startWordIndex, endWordIndex - 1);
            currentWordIndex = globalIndex;
            lastHighlightedIndex = globalIndex;
          } catch (e) {
            console.warn('Error in fallback highlighting:', e);
          }
        }
      }
    }, 80);

    // Expose lastBoundaryTime updater for the onboundary handler below
    utterance._updateLastBoundaryTime = () => { lastBoundaryTime = performance.now(); };
  };
  
  utterance.onboundary = (event) => {
    if (!isReading || isPaused || !event || event.name !== 'word') return;

    boundaryEventCount++;
    lastSpeechActivityTime = Date.now();
    try { if (utterance._updateLastBoundaryTime) utterance._updateLastBoundaryTime(); } catch (_) {}

    try {
      const charIndex = event.charIndex;
      const charLen   = typeof event.charLength === 'number' ? event.charLength : 0;
      let matchedMapIndex = -1;

      if (typeof charIndex === 'number' && charIndex >= 0 && charToWordMap.length > 0) {
        // Search forward from lastMatchedMapIndex+1 so we never re-match the same entry.
        // Try charIndex as-is, then charIndex+1 (Chrome off-by-one) and charIndex-1.
        const searchFrom = lastMatchedMapIndex < 0 ? 0 : lastMatchedMapIndex + 1;
        outer:
        for (const ci of [charIndex, charIndex + 1, charIndex - 1]) {
          if (ci < 0) continue;
          for (let i = searchFrom; i < charToWordMap.length; i++) {
            const m = charToWordMap[i];
            if (ci >= m.start && ci < m.start + m.word.length + 1) {
              matchedMapIndex = i;
              break outer;
            }
          }
        }

        // Secondary: nearest start position, forward-only, within 60 chars
        if (matchedMapIndex === -1) {
          let minDist = Infinity;
          for (let i = searchFrom; i < charToWordMap.length; i++) {
            const dist = Math.abs(charIndex - charToWordMap[i].start);
            if (dist < minDist) { minDist = dist; matchedMapIndex = i; }
            // Once we pass the charIndex by more than we've already seen, stop early
            if (charToWordMap[i].start > charIndex + minDist + 10) break;
          }
          if (minDist > 60) matchedMapIndex = -1;
        }
      }

      // Forward-monotonic guard: never allow backward regression
      if (matchedMapIndex !== -1 && matchedMapIndex < lastMatchedMapIndex) {
        matchedMapIndex = -1;
      }

      // Fallback: advance sequentially from where we last were
      if (matchedMapIndex === -1) {
        const countIdx = lastMatchedMapIndex + 1;
        if (countIdx >= 0 && countIdx < charToWordMap.length) {
          matchedMapIndex = countIdx;
        }
      }

      if (matchedMapIndex >= 0 && matchedMapIndex < charToWordMap.length) {
        const mapEntry = charToWordMap[matchedMapIndex];
        const globalWordIndex = mapEntry.wordIndex;

        if (globalWordIndex >= startWordIndex && globalWordIndex < endWordIndex && globalWordIndex !== lastHighlightedIndex) {
          // Prefer the literal substring the TTS engine is pronouncing (charLength), 
          // fall back to the token we stored in charToWordMap.
          let exactTtsToken = mapEntry.word || null;
          if (charLen > 0 && typeof charIndex === 'number') {
            const extracted = text.substring(charIndex, charIndex + charLen).trim();
            if (extracted.length > 0) exactTtsToken = extracted;
          }

          lastMatchedMapIndex = matchedMapIndex; // commit forward advance
          const highlighted = highlightCurrentWordFlex(
            words[globalWordIndex], globalWordIndex,
            startWordIndex, endWordIndex - 1,
            exactTtsToken
          );
          if (typeof highlighted === 'number' && highlighted >= 0) {
            currentWordIndex = highlighted;
            lastHighlightedIndex = highlighted;
          }
        }
      }
    } catch (e) {
      console.warn('Boundary event error:', e);
    }
  };
  
  utterance.onend = () => {
    onendFired = true;
    console.log(`[speakChunk onend] Triggered, onEndCallback=${!!onEndCallback}, isReading=${isReading}, isPaused=${isPaused}`);
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }

    if (isReading && !isPaused) {
      currentWordIndex = endWordIndex;
      console.log(`[speakChunk onend] Triggering callback for words ${startWordIndex}-${endWordIndex}`);
      if (onEndCallback) {
        onEndCallback();
      } else {
        console.log(`[speakChunk onend] No callback, calling readNextChunk directly`);
        readNextChunk();
      }
    } else {
      console.log(`[speakChunk onend] Skipped callback - isReading=${isReading}, isPaused=${isPaused}`);
    }
  };
  
  utterance.onerror = (event) => {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
    
    if (event.error === 'interrupted') return;
    
    if (isReading && !isPaused) {
      currentWordIndex = endWordIndex;
      setTimeout(() => {
        try {
          readNextChunk();
        } catch (e) {
          console.error('Error in onerror callback:', e);
        }
      }, 5);
    }
  };
  
  try {
    // Check synth is available before speaking
    if (!synth) {
      console.error('Speech synthesis not available');
      if (isReading && !isPaused) {
        currentWordIndex = endWordIndex;
        setTimeout(() => readNextChunk(), 50);
      }
      return;
    }
    
    synth.speak(utterance);
  } catch (e) {
    console.error('Error speaking:', e);
    // Try next chunk
    if (isReading && !isPaused && utterance) {
      currentWordIndex = endWordIndex;
      setTimeout(() => {
        try {
          readNextChunk();
        } catch (retryError) {
          console.error('Error in speak catch block:', retryError);
        }
      }, 50);
    }
  }
}

function wrapAllWords(onComplete) {
  console.log('wrapAllWords called, readingContainer:', readingContainer);
  
  try {
    if (!readingContainer) {
      readingContainer = document.body || document.documentElement;
      if (!readingContainer) {
        console.error('No reading container available');
        if (onComplete) onComplete();
        return;
      }
    }
    
    // Backup original text content before wrapping
    try {
      originalTextBackup = (readingContainer.textContent || '').substring(0, 100000);  // Limit backup size
      console.log(`Backed up ${originalTextBackup.length} characters of original text`);
    } catch (e) {
      console.warn('Error backing up text:', e);
    }
  } catch (e) {
    console.error('Error in wrapAllWords initialization:', e);
    if (onComplete) onComplete();
    return;
  }
  
  wrappedSpans = [];
  words = [];
  let wordIndex = 0;
  
  const unwantedTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'IFRAME', 'TTS-WORD-SPAN'];
  let nodeQueue = [];
  let isProcessing = false;
  let errorCount = 0;
  const maxErrors = 10;
  
  function collectNodesToWrap(node, depth = 0) {
    // Prevent infinite recursion on complex DOMs
    if (depth > 100) {
      console.warn('Max DOM depth reached, stopping node collection');
      return;
    }
    
    try {
      if (!node || !node.nodeType) return;
      
      if (typeof node.className === 'string' && node.className.includes('tts-word-span')) {
        return;
      }
      
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue && node.nodeValue.trim()) {
          nodeQueue.push(node);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (!unwantedTags.includes(node.tagName) && (!node.classList || !node.classList.contains('tts-word-span'))) {
          // Skip aria-hidden elements and all their descendants
          if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return;
          // Skip elements with HTML hidden attribute
          if (node.hasAttribute && node.hasAttribute('hidden')) return;
          // Skip elements hidden via inline style
          if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) return;
          // Skip common screen-reader-only, skip-link and visually-hidden class patterns
          const nodeClass = (typeof node.className === 'string' ? node.className : '').toLowerCase();
          if (/sr-only|visually-?hidden|screen-reader|skip-link|skip-nav|skip-to|offscreen|a11y-hidden|clip-hidden/.test(nodeClass)) return;
          // Skip skip-link anchors: <a href="#main">Skip to content</a> and variants
          if (node.tagName === 'A') {
            const href = (node.getAttribute && node.getAttribute('href')) || '';
            const linkText = (node.textContent || '').trim().toLowerCase();
            if (href.startsWith('#') && /skip|jump\s+to|go\s+to\s+main|bypass/.test(linkText)) return;
            if (/skip.*(content|nav|main|link|navigation)|jump\s+to\s+(main|content)/.test(linkText)) return;
          }
          // Skip elements whose id signals skip-nav patterns
          const nodeId = (node.id || '').toLowerCase();
          if (/skip[-_]?(to[-_]?)?(nav|link|content|main|navigation)/.test(nodeId)) return;
          // Skip role=presentation/none elements (decorative, no content)
          const role = node.getAttribute && node.getAttribute('role');
          if (role === 'presentation' || role === 'none') return;
          try {
            const children = Array.from(node.childNodes);
            for (let child of children) {
              try {
                if (node && node.contains && node.contains(child)) {
                  collectNodesToWrap(child, depth + 1);
                }
              } catch (e) {
                console.warn('Error checking node containment:', e);
                continue;
              }
            }
          } catch (e) {
            console.warn('Error iterating child nodes:', e);
          }
        }
      }
    } catch (e) {
      errorCount++;
      if (errorCount < maxErrors) {
        console.warn('Error in collectNodesToWrap:', e);
      } else if (errorCount === maxErrors) {
        console.warn('Too many collection errors, stopping');
      }
    }
  }
  
  function processNodeBatch() {
    try {
      if (nodeQueue.length === 0 || errorCount >= maxErrors) {
        console.log(`Finished wrapping ${words.length} words from ${wrappedSpans.length} nodes`);
        isProcessing = false;
        // CALL COMPLETION CALLBACK WHEN WRAPPING IS DONE
        if (onComplete) {
          console.log('✓ Wrapping complete, calling onComplete callback');
          try {
            onComplete();
          } catch (e) {
            console.error('Error in onComplete callback:', e);
          }
        }
        return;
      }
      
      // Process a batch of nodes to prevent page hang
      const batchSize = (appConfig && appConfig.performance && appConfig.performance.maxParallelWraps) || 50;
      for (let batch = 0; batch < batchSize && nodeQueue.length > 0; batch++) {
        const node = nodeQueue.shift();
        
        try {
          if (node && node.nodeValue !== undefined) {
            wrapTextNode(node);
          }
        } catch (e) {
          errorCount++;
          if (errorCount < maxErrors) {
            console.warn('Error wrapping node:', e);
          }
        }
      }
      
      // Schedule next batch in next idle frame
      if (nodeQueue.length > 0 && errorCount < maxErrors) {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(() => {
            processNodeBatch();
          }, { timeout: 100 });
        } else {
          setTimeout(processNodeBatch, 10);
        }
      } else {
        isProcessing = false;
        console.log(`✓ Completed wrapping ${words.length} words (errors: ${errorCount})`);
        // CALL COMPLETION CALLBACK WHEN WRAPPING IS DONE
        if (onComplete) {
          console.log('✓ Wrapping complete, calling onComplete callback');
          try {
            onComplete();
          } catch (e) {
            console.error('Error in onComplete callback:', e);
          }
        }
      }
    } catch (e) {
      console.error('Critical error in processNodeBatch:', e);
      isProcessing = false;
      // CALL COMPLETION CALLBACK EVEN ON ERROR
      if (onComplete) {
        try {
          onComplete();
        } catch (e2) {
          console.error('Error in onComplete callback after error:', e2);
        }
      }
    }
  }
  
  function wrapTextNode(node) {
    try {
      if (!node || !node.nodeValue) return;
      
      const text = node.nodeValue;
      if (!text || !text.trim()) return;
      
      const parent = node.parentNode;
      if (!parent || unwantedTags.includes(parent.tagName)) {
        return;
      }
      
      if (parent.classList && parent.classList.contains('tts-word-span')) {
        return;
      }
      
      // Check if parent is actually visible - catches inline, computed, and clip-based hiding
      try {
        const cs = window.getComputedStyle(parent);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        // Catch off-screen positioning (skip-link pattern: position:absolute; left:-9999px)
        if (cs.position === 'absolute' || cs.position === 'fixed') {
          const left = parseFloat(cs.left);
          const top = parseFloat(cs.top);
          if (!isNaN(left) && left < -100) return;
          if (!isNaN(top) && top < -100) return;
        }
        if (parent.offsetHeight === 0 && parent.offsetWidth === 0) return;
      } catch (e) {
        // Some elements don't support getComputedStyle, ignore
      }
      
      const fragment = document.createDocumentFragment();
      const parts = text.split(/(\s+)/);
      
      // Build fragment with wrapped words
      for (let part of parts) {
        if (part.trim().length > 0) {
          const span = document.createElement('span');
          span.textContent = part;
          span.setAttribute('data-tts-index', wordIndex);
          span.className = 'tts-word-span';
          span.style.display = 'inline';
          span.style.whiteSpace = 'pre-wrap';
          fragment.appendChild(span);
          
          wrappedSpans[wordIndex] = span;
          words[wordIndex] = part.trim();
          wordIndex++;
        } else if (part.length > 0) {
          const textNode = document.createTextNode(part);
          fragment.appendChild(textNode);
        }
      }
      
      // Verify fragment content matches original
      const fragmentText = Array.from(fragment.childNodes)
        .map(n => n.textContent || '')
        .join('');
      
      if (fragmentText !== text) {
        console.error('Text mismatch! Not wrapping to prevent data loss');
        return;
      }
      
      try {
        if (node && node.parentNode && node.parentNode.contains && node.parentNode.contains(node)) {
          parent.replaceChild(fragment, node);
        }
      } catch (e) {
        console.warn('Error replacing node:', e);
        try {
          if (parent && !parent.contains(node)) {
            const restoreNode = document.createTextNode(text);
            parent.appendChild(restoreNode);
          }
        } catch (e2) {
          console.error('Critical: could not restore text:', e2);
        }
      }
    } catch (e) {
      errorCount++;
      if (errorCount < maxErrors) {
        console.error('Error in wrapTextNode:', e);
      }
    }
  }
  
  // Start collecting nodes
  try {
    if (readingContainer && readingContainer.parentNode) {
      collectNodesToWrap(readingContainer);
      console.log(`Collected ${nodeQueue.length} text nodes to wrap`);
      
      // Start processing in batches
      if (nodeQueue.length > 0) {
        isProcessing = true;
        processNodeBatch();
      }
    }
  } catch (e) {
    console.error('Error wrapping words:', e);
  }
}

function applyHighlightStyle(span) {
  if (!span) return;
  wordHighlighter._applyStyles(span, currentSettings);
  if (readingModes.getCurrentMode() === 'speed') {
    const progress = Math.round((currentWordIndex / Math.max(words.length, 1)) * 100);
    readingModes.updateRSVP(span.textContent || '', progress);
  }
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}



// WPM tracking state (duplicate block)
/* duplicate _wpmStartTime/_wpmWordsAtStart removed; using singleton declared earlier */

function trackWPM(wordIndex) {
  if (!_wpmStartTime) {
    _wpmStartTime = Date.now();
    _wpmWordsAtStart = wordIndex;
    return;
  }
  const elapsedMin = (Date.now() - _wpmStartTime) / 60000;
  const wordsRead = wordIndex - _wpmWordsAtStart;
  if (elapsedMin > 0.05 && wordsRead > 0) {
    const wpm = Math.round(wordsRead / elapsedMin);
    _wpmHistory.push(wpm);
    if (_wpmHistory.length > 8) _wpmHistory.shift();
    const avg = Math.round(_wpmHistory.reduce((a, b) => a + b, 0) / _wpmHistory.length);
    const wpmEl = document.getElementById('player-wpm');
    if (wpmEl) {
      wpmEl.textContent = `${avg} WPM`;
      // Color-code based on reading speed
      wpmEl.setAttribute('data-speed',
        avg < 150 ? 'slow' : avg <= 350 ? 'normal' : 'fast'
      );
    }
  }
}

function highlightCurrentWord(word, wordIndex) {
  try {
    // Remove previous highlight smoothly
    if (highlightedSpan && highlightedSpan.classList) {
      highlightedSpan.classList.remove('tts-word-highlight', 'tts-word-highlight-outline',
                                      'tts-word-highlight-underline', 'tts-word-highlight-glow',
                                      'tts-word-highlight-pulse', 'tts-word-highlight-scale');
      highlightedSpan.style.backgroundColor = '';
      highlightedSpan.style.outlineColor = '';
      highlightedSpan.style.borderBottomColor = '';
      highlightedSpan.style.borderBottomWidth = '';
      highlightedSpan.style.color = '';
      highlightedSpan.style.textShadow = '';
      highlightedSpan.style.fontWeight = '';
      highlightedSpan.style.transform = 'scale(1)';
      highlightedSpan.style.padding = '';
      highlightedSpan.style.borderRadius = '';
      highlightedSpan.style.boxShadow = '';
      highlightedSpan.style.opacity = '1';
      highlightedSpan.style.display = 'inline';
      highlightedSpan.style.visibility = 'visible';
      highlightedSpan = null;
    }

    if (wordIndex < 0 || wordIndex >= words.length || wordIndex >= wrappedSpans.length) return;

    // === REGEX WPM MATCHING ===
    // Verify the span at wordIndex contains the expected word using regex.
    // If not, search nearby spans for the correct match.
    let targetSpan = wrappedSpans[wordIndex];

    if (word && targetSpan) {
      const wordRegex = buildHighlightWordRegex(word);
      const spanText = (targetSpan.textContent || '').trim();

      if (!wordRegex.test(spanText)) {
        // Search nearby spans (±15) for a regex match
        let found = false;
        for (let offset = 1; offset <= 15; offset++) {
          const idxBelow = wordIndex - offset;
          const idxAbove = wordIndex + offset;

          if (idxBelow >= 0 && wrappedSpans[idxBelow]) {
            const bt = (wrappedSpans[idxBelow].textContent || '').trim();
            if (wordRegex.test(bt)) {
              targetSpan = wrappedSpans[idxBelow];
              found = true;
              break;
            }
          }
          if (idxAbove < wrappedSpans.length && wrappedSpans[idxAbove]) {
            const at = (wrappedSpans[idxAbove].textContent || '').trim();
            if (wordRegex.test(at)) {
              targetSpan = wrappedSpans[idxAbove];
              found = true;
              break;
            }
          }
        }
        // If no regex match found, fall back to index-based span
      }
    }

    if (!targetSpan || !targetSpan.parentNode || !targetSpan.classList) return;

    // Apply highlight with user's chosen color and style
    applyHighlightStyle(targetSpan);
    highlightedSpan = targetSpan;

    // Auto-scroll to highlighted word with delay enforcement
    if (autoScrollEnabled && targetSpan) {
      try {
        const now = Date.now();
        const rect = targetSpan.getBoundingClientRect();
        
        // More sensitivity: scroll if element is near edges (50px margin) or completely out of view
        // This catches elements that are partially visible or about to scroll out
        const margin = 50;
        const isNearOrOutOfView = rect.top < margin || rect.bottom > (window.innerHeight - margin) || 
                                  rect.left < margin || rect.right > (window.innerWidth - margin);
        
        // Enforce full auto-scroll delay (8-9 seconds) between scrolls
        const timeSinceLastScroll = now - lastScrollTime;
        
        if (isNearOrOutOfView && timeSinceLastScroll >= autoScrollDelay) {
          lastScrollTime = now;  // Update last scroll time
          
          // Try multiple scroll approaches for maximum compatibility
          const scrollOptions = { behavior: 'smooth', block: 'center' };
          
          try {
            // First attempt: scrollIntoView with options
            targetSpan.scrollIntoView(scrollOptions);
          } catch (e1) {
            try {
              // Fallback 1: scrollIntoView without options
              targetSpan.scrollIntoView(true);
            } catch (e2) {
              try {
                // Fallback 2: manually scroll window using element position
                const topOffset = targetSpan.offsetTop;
                const windowCenter = window.innerHeight / 2;
                window.scrollBy({ top: topOffset - windowCenter, behavior: 'smooth' });
              } catch (e3) {
                try {
                  // Fallback 3: basic window scroll (last resort)
                  window.scroll(0, targetSpan.offsetTop - window.innerHeight / 2);
                } catch (e4) {
                  // Scrolling blocked by website - silently fail
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    // Update floating player indicator periodically
    if (highlightIndicator && wordIndex % 5 === 0) {
      highlightIndicator.textContent = `${wordIndex + 1}/${words.length}`;
    }

    // Track WPM
    trackWPM(wordIndex);

  } catch (e) {
    // Silently fail — never break speech synthesis
  }
}



function createHighlightIndicator() {
  // Remove old indicator if exists
  const existing = document.getElementById('tts-highlight-indicator');
  if (existing) {
    existing.remove();
  }

  // Disabled: the progress indicator overlay was too intrusive.
  // Keep highlight logic intact; just don't render this UI element.
  highlightIndicator = null;
  return;
  
  highlightIndicator = document.createElement('div');
  highlightIndicator.id = 'tts-highlight-indicator';
  highlightIndicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #00ff00 0%, #00cc00 100%);
    color: white;
    padding: 16px 22px;
    border-radius: 12px;
    font-weight: bold;
    z-index: 999999999;
    box-shadow: 0 6px 20px rgba(0, 255, 0, 0.4);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    font-size: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(10px);
    animation: slideInRight 0.3s ease-out;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2);
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  
  if (document.head) {
    document.head.appendChild(style);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.head) document.head.appendChild(style);
    });
  }
  
  highlightIndicator.textContent = 'Reading...';
  safeAppendToBody(highlightIndicator);
  
  console.log('Indicator created and added to page');
}

function isInUnwantedElement(node) {
  let element = node.parentElement;
  while (element) {
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe'].includes(tag)) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0';
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSentenceGroups() {
  sentenceGroups = [];
  const rawSentenceCount = currentSettings.sentenceCount;
  const sentenceCount = Math.max(1, parseInt(rawSentenceCount) || 2);
  
  console.log(`[buildSentenceGroups] ENTRY: rawSentenceCount=${rawSentenceCount}, parsed=${sentenceCount}, currentSettings=`, {
    sentenceCount: currentSettings.sentenceCount,
    repeatCount: currentSettings.repeatCount,
    voice: currentSettings.voice,
    speed: currentSettings.speed
  });
  const ABBREV = new Set([
    'mr','mrs','ms','dr','prof','sr','jr','vs','etc','e.g','i.e','approx','dept',
    'est','fig','govt','inc','jr','lt','mt','op','pl','pp','pt','rev','sgt','st',
    'vol','jan','feb','mar','apr','jun','jul','aug','sep','oct','nov','dec',
    'mon','tue','wed','thu','fri','sat','sun'
  ]);

  function isSentenceEnd(word, nextWord) {
    if (!word) return false;
    if (!/[.!?]["')\]]*$/.test(word)) return false;
    if (/[!?]/.test(word)) return true;   // Always split on ! or ?

    // Dot heuristics — avoid splitting abbreviations
    const bare = word.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
    // Single capital letter followed by dot (e.g. "U.S.A." initials)
    if (/^([a-z]\.)+$/.test(bare)) return false;
    // Known abbreviation
    const noTrail = bare.replace(/\.$/, '');
    if (ABBREV.has(noTrail)) return false;
    // Number like "3.14" or "2023."
    if (/^\d+(\.\d*)?$/.test(bare)) return false;
    // Next word starts with lowercase → likely not a sentence boundary
    if (nextWord && /^[a-z]/.test(nextWord)) return false;

    return true;
  }

  // Split words into sentences
  const sentences = [];
  let currentSentence = [];

  for (let i = 0; i < words.length; i++) {
    currentSentence.push(i);
    const isEnd = isSentenceEnd(words[i], words[i + 1]);
    if (isEnd) {
      sentences.push(currentSentence);
      const sentenceText = currentSentence.map(idx => words[idx]).join(' ');
      console.log(`[sentence split] Sentence ${sentences.length-1}: "${sentenceText.substring(0, 80)}..."`);
      currentSentence = [];
    }
  }
  if (currentSentence.length > 0) {
    sentences.push(currentSentence);
    const sentenceText = currentSentence.map(idx => words[idx]).join(' ');
    console.log(`[sentence split] Sentence ${sentences.length-1} (final): "${sentenceText.substring(0, 80)}..."`);
  }

  console.log(`[buildSentenceGroups DETAIL] Split into ${sentences.length} sentences (sentenceCount=${sentenceCount})`);
  
  // Track if we used fallback to avoid over-merging
  let usedFallback = false;
  
  // FALLBACK: If no sentences found (all text is one block), split by word count
  if (sentences.length === 1) {
    usedFallback = true;
    console.warn('[buildSentenceGroups] ⚠️ NO PUNCTUATION FOUND - Using word-count fallback to create multiple readable chunks');
    sentences.length = 0; // Clear
    
    // For unpunctuated text, GUARANTEE minimum 2 groups
    // Calculate required number of groups based on text length
    let targetGroups = 2;  // Minimum is always 2
    if (words.length > 40) {
      targetGroups = Math.max(3, Math.ceil(words.length / 25));  // ~25 words per chunk
    }
    
    const wordsPerChunk = Math.ceil(words.length / targetGroups);
    console.log(`[buildSentenceGroups] Creating ${targetGroups} groups of ~${wordsPerChunk} words from ${words.length} total words`);
    
    
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunk = [];
      for (let j = i; j < Math.min(i + wordsPerChunk, words.length); j++) {
        chunk.push(j);
      }
      if (chunk.length > 0) {
        sentences.push(chunk);
        const chunkText = chunk.map(idx => words[idx]).join(' ');
        console.log(`[sentence split FALLBACK] Chunk ${sentences.length-1}: "${chunkText.substring(0, 80)}..."`);
      }
    }
    console.log(`[buildSentenceGroups FALLBACK] Created ${sentences.length} word-count chunks from ${words.length} words`);
    
    // Safety: if we still only have 1 chunk after fallback, force-split immediately
    if (sentences.length === 1) {
      console.warn('[buildSentenceGroups] ⚠️ FALLBACK FAILED - Still only 1 chunk, creating minimum 3 groups');
      const singleChunk = sentences[0];
      sentences.length = 0;
      
      // Force at least 3 groups
      const minChunks = Math.max(3, Math.ceil(singleChunk.length / 15));
      const chunkSize = Math.ceil(singleChunk.length / minChunks);
      
      for (let i = 0; i < singleChunk.length; i += chunkSize) {
        const newChunk = [];
        for (let j = i; j < Math.min(i + chunkSize, singleChunk.length); j++) {
          newChunk.push(singleChunk[j]);
        }
        if (newChunk.length > 0) {
          sentences.push(newChunk);
          console.log(`[fallback split] Created group with ${newChunk.length} words`);
        }
      }
      console.log(`[buildSentenceGroups] After safety split: ${sentences.length} groups`);
    }
  }
  
  // Group sentences (merge short sentences, respect sentenceCount)
  // NOTE: When fallback was used (no punctuation), use more conservative merging to keep groups readable
  const mergeLimit = usedFallback ? 1 : sentenceCount;  // Don't merge fallback chunks, keep them separate
  
  for (let i = 0; i < sentences.length; ) {
    const group = [...sentences[i]];
    let merged = 1;

    // Merge more sentences up to mergeLimit
    console.log(`[grouping] Starting group at sentence ${i}, merged=${merged}, mergeLimit=${mergeLimit}, condition: ${merged} < ${mergeLimit} = ${merged < mergeLimit}`);
    while (merged < mergeLimit && (i + merged) < sentences.length) {
      console.log(`[grouping loop] YES - Merging sentence ${i + merged} into group (merged=${merged}/${mergeLimit})`);
      group.push(...sentences[i + merged]);
      merged++;
    }
    console.log(`[grouping after-while] Group now has ${group.length} words, merged=${merged}`);

    // If the group is very short (<4 words) and there's a next sentence, absorb it
    if (!usedFallback && group.length < 4 && (i + merged) < sentences.length) {
      console.log(`[grouping loop] Group too short (${group.length}<4), absorbing sentence ${i + merged}`);
      group.push(...sentences[i + merged]);
      merged++;
    }

    if (group.length > 0) {
      console.log(`[grouping loop] Created group: words[${group[0]}...${group[group.length-1]}] (len=${group.length})`);
      sentenceGroups.push(group);
    }
    i += merged;
  }

  console.log(`[Sentence Groups] Built ${sentenceGroups.length} groups from ${sentences.length} sentences`);
  
  // CRITICAL FIX: If we still only have 1 group after merging, split it up
  // This check is more aggressive - triggers on 1 group regardless of size, to ensure reading continues
  if (sentenceGroups.length === 1) {
    const largeGroup = sentenceGroups[0];
    console.warn(`[buildSentenceGroups] ⚠️ SPLIT REQUIRED - Only 1 group created (${largeGroup.length} words), forcefully splitting for readability`);
    
    sentenceGroups = []; // Clear
    
    // For very small texts (<20 words): create at least 2 groups
    // For small texts (20-50 words): create 3 groups
    // For larger texts: split into chunks of ~30 words
    let targetGroups = 2;
    if (largeGroup.length > 50) {
      targetGroups = Math.max(3, Math.ceil(largeGroup.length / 30));
    } else if (largeGroup.length >= 20) {
      targetGroups = 3;
    }
    
    const wordsPerGroup = Math.ceil(largeGroup.length / targetGroups);
    
    console.log(`[buildSentenceGroups] Force-splitting 1 large group (${largeGroup.length} words) into ${targetGroups} groups of ~${wordsPerGroup} words`);
    
    for (let i = 0; i < largeGroup.length; i += wordsPerGroup) {
      const newGroup = [];
      for (let j = i; j < Math.min(i + wordsPerGroup, largeGroup.length); j++) {
        newGroup.push(largeGroup[j]);
      }
      if (newGroup.length > 0) {
        sentenceGroups.push(newGroup);
        const groupText = newGroup.map(idx => words[idx]).join(' ');
        console.log(`[split group] Group ${sentenceGroups.length-1}: "${groupText.substring(0, 80)}..."`);
      }
    }
    
    console.log(`[buildSentenceGroups] After force-split: ${sentenceGroups.length} groups created (guaranteed minimum 2 groups)`);
    
    // Emergency safeguard: if force-split still resulted in 1 group (edge case), create 2 groups manually
    if (sentenceGroups.length === 1 && largeGroup.length > 1) {
      console.error('[buildSentenceGroups] EMERGENCY: Force-split failed! Creating 2 groups manually');
      const mid = Math.floor(largeGroup.length / 2);
      sentenceGroups = [
        largeGroup.slice(0, mid),
        largeGroup.slice(mid)
      ];
      console.log(`[buildSentenceGroups] Emergency split: Group 0: ${mid} words, Group 1: ${largeGroup.length - mid} words`);
    }
  }

  // Setup sentence hover listeners
  setupSentenceHoverListeners();
}

function setupSentenceHoverListeners() {
  // Defensive check
  if (!sentenceGroups || !Array.isArray(sentenceGroups)) {
    console.warn('setupSentenceHoverListeners: sentenceGroups is not a valid array');
    return;
  }
  
  // Add scroll listener to detect scrolling
  document.addEventListener('scroll', () => {
    isScrolling = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, 1500); // Hide buttons 1.5 seconds after scroll stops
  }, { passive: true });
  
  // Add hover listeners to sentence groups
  sentenceGroups.forEach((group, groupIndex) => {
    if (group.length === 0) return;
    
    const firstWordIndex = group[0];
    const lastWordIndex = group[group.length - 1];
    
    // Get the first and last span elements
    const firstSpan = wrappedSpans[firstWordIndex];
    const lastSpan = wrappedSpans[lastWordIndex];
    
    if (!firstSpan || !lastSpan) return;
    
    // Create a container for the sentence group
    const sentenceContainer = {
      firstSpan,
      lastSpan,
      groupIndex,
      group,
      playButton: null,
      isVisible: false
    };
    
    // Add hover listeners to all spans in this group
    for (let i = firstWordIndex; i <= lastWordIndex; i++) {
      const span = wrappedSpans[i];
      if (!span) continue;
      
      span.addEventListener('mouseenter', () => {
        // Only show play button if scrolling
        if (isScrolling) {
          showSentencePlayButton(sentenceContainer);
        }
      });
      
      span.addEventListener('mouseleave', () => {
        hideSentencePlayButton(sentenceContainer);
      });
    }
  });
}

function showSentencePlayButton(sentenceContainer) {
  // Remove any existing play button
  if (hoveredSentenceElement && hoveredSentenceElement.playButton) {
    hoveredSentenceElement.playButton.remove();
    hoveredSentenceElement.playButton = null;
  }
  
  hoveredSentenceElement = sentenceContainer;
  
  // Create play button SVG
  const playButton = document.createElement('div');
  playButton.className = 'tts-sentence-play-btn';
  playButton.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" stroke="currentColor" stroke-width="2"/>
      <path d="M9 7L9 17L17 12L9 7Z" fill="currentColor"/>
    </svg>
  `;
  
  playButton.style.cssText = `
    position: fixed;
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #00ffaa 0%, #00cc88 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 999999997;
    box-shadow: 0 0 20px rgba(0, 255, 170, 0.7), 0 4px 12px rgba(0, 255, 170, 0.5);
    border: 2px solid rgba(0, 0, 0, 0.4);
    color: #000000;
    font-weight: 700;
    font-size: 18px;
    transition: all 0.3s ease;
    animation: popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;
  
  // Add animation style
  const style = document.createElement('style');
  style.textContent = `
    @keyframes popIn {
      from {
        transform: scale(0);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }
    .tts-sentence-play-btn:hover {
      transform: scale(1.15);
      box-shadow: 0 6px 16px rgba(102, 126, 234, 0.8);
    }
    .tts-sentence-play-btn:active {
      transform: scale(0.95);
    }
  `;
  if (!document.querySelector('style[data-tts-play-btn]')) {
    style.setAttribute('data-tts-play-btn', 'true');
    if (document.head) {
      document.head.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.head && !document.querySelector('style[data-tts-play-btn]')) {
          document.head.appendChild(style);
        }
      });
    }
  }
  
  // Position button near the first word of the sentence
  const rect = sentenceContainer.firstSpan.getBoundingClientRect();
  playButton.style.left = (rect.left - 40) + 'px';
  playButton.style.top = (rect.top + rect.height / 2 - 16) + 'px';
  
  // Add click handler to play the sentence
  playButton.addEventListener('click', (e) => {
    e.stopPropagation();
    playSentence(sentenceContainer.groupIndex);
  });
  
  safeAppendToBody(playButton);
  sentenceContainer.playButton = playButton;
}

function hideSentencePlayButton(sentenceContainer) {
  if (sentenceContainer.playButton) {
    sentenceContainer.playButton.remove();
    sentenceContainer.playButton = null;
  }
  
  if (hoveredSentenceElement === sentenceContainer) {
    hoveredSentenceElement = null;
  }
}

function playSentence(groupIndex) {
  if (groupIndex < 0 || groupIndex >= sentenceGroups.length) {
    console.warn('Invalid sentence group index:', groupIndex);
    return;
  }
  
  // Stop current reading if any
  if (isReading) {
    handleStop();
  }
  
  // Set up to read this specific sentence
  isReading = true;
  lastScrollTime = 0;  // Reset scroll timer for immediate scrolling
  isPaused = false;
  currentSentenceGroupIndex = groupIndex;
  currentRepeatIteration = 0;
  currentWordIndex = sentenceGroups[groupIndex][0];
  
  console.log('Playing sentence group:', groupIndex);
  
  // Create visual indicator
  createHighlightIndicator();
  
  // Start reading
  readNextChunk();
}

function handlePause() {
  if (isReading && !isPaused) {
    isPaused = true;
    try {
      synth.pause();
    } catch (e) {
      console.error('Error pausing speech:', e);
    }
    // Dim the active highlight so it's visually clear reading has paused
    try {
      if (highlightedSpan) {
        highlightedSpan.style.opacity = '0.45';
        highlightedSpan.style.transition = 'opacity 0.2s';
      }
    } catch (_) {}
    if (highlightIndicator) {
      highlightIndicator.textContent = 'Paused';
    }
    syncFloatingPlayerState();
    sendStatusUpdate('Paused', Math.round((currentWordIndex / Math.max(words.length, 1)) * 100));
  }
}

function handleResume() {
  if (isReading && isPaused) {
    isPaused = false;
    // Restore highlight opacity
    try {
      if (highlightedSpan) {
        highlightedSpan.style.opacity = '';
        highlightedSpan.style.transition = '';
      }
    } catch (_) {}
    try {
      synth.resume();
    } catch (e) {
      console.error('Error resuming speech:', e);
    }
    // Chrome bug: resume() is unreliable after tab switch or long pause.
    // Check 250ms later whether synth is actually speaking; if not, restart chunk.
    setTimeout(() => {
      if (isReading && !isPaused && !synth.speaking) {
        console.warn('handleResume: synth not speaking after resume — restarting from word', currentWordIndex);
        synth.cancel();
        setTimeout(() => { if (isReading && !isPaused) readNextChunk(); }, 80);
      }
    }, 250);
    if (highlightIndicator) {
      highlightIndicator.textContent = 'Reading...';
    }
    syncFloatingPlayerState();
    sendStatusUpdate('Resuming...', Math.round((currentWordIndex / Math.max(words.length, 1)) * 100));
  }
}

// Sync floating player button state smoothly with current reading state
function syncFloatingPlayerState() {
  const player = document.getElementById('tts-floating-player');
  if (!player) return;
  
  const playBtn = player.querySelector('#player-play');
  if (playBtn) {
    // Smoothly transition button icon
    const targetIcon = (isPaused) ? '▶' : '⏸';
    if (playBtn.textContent !== targetIcon) {
      playBtn.style.transform = 'scale(0.85)';
      playBtn.style.opacity = '0.7';
      setTimeout(() => {
        playBtn.textContent = targetIcon;
        playBtn.style.transform = 'scale(1)';
        playBtn.style.opacity = '1';
      }, 100);
    }
  }
}

function handleStop() {
  isReading = false;
  isPaused = false;
  currentWordIndex = 0;
  words = [];

  // Reset WPM tracking
  _wpmStartTime = null;
  _wpmWordsAtStart = 0;
  _wpmHistory = [];

  try {
    synth.cancel();
  } catch (e) {
    console.error('Error canceling speech:', e);
  }

  // Stop visibility guardian
  stopVisibilityGuardian();
  
  removeHighlight();
  
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  
  // Hide floating player when stopping (keep in DOM for next read)
  const floatingPlayer = document.getElementById('tts-floating-player');
  if (floatingPlayer) {
    floatingPlayer.style.display = 'none';
  }
  
  // Reset floating button color
  const floatingBtn = document.getElementById('tts-floating-btn');
  if (floatingBtn) {
    floatingBtn.style.background = 'linear-gradient(135deg, #00ffaa 0%, #00cc88 100%)';
  }
  
  sendStatusUpdate('Stopped', 0);
}

// ===== RESET REPEAT COUNTERS (for paragraph reader loop) =====
// Called when switching between paragraphs to prevent sentence-level repeats from carrying over
function resetRepeatCounters() {
  console.log(`[ResetRepeatCounters] Before reset: currentRepeatIteration=${currentRepeatIteration}, currentSentenceGroupIndex=${currentSentenceGroupIndex}, groups=${sentenceGroups.length}`);
  
  // IMPORTANT: Only reset the indices, NOT the sentence groups!
  // If we clear sentence groups, the current reading callback will fail when it tries to advance
  currentRepeatIteration = 0;
  currentSentenceGroupIndex = 0;
  
  console.log(`[ResetRepeatCounters] Reset indices to 0, kept ${sentenceGroups.length} sentence groups`);
}

// ===== PLAYBACK CONTROLS =====
function skipBackward(milliseconds) {
  if (!isReading && !isPaused) {
    console.warn('Not reading, cannot skip backward');
    return;
  }
  
  // Calculate words to skip based on milliseconds and current reading speed
  const wordsPerSecond = (currentSettings.speed || 1) * 2.5;  // Approx 150 WPM = 2.5 words/sec
  const skipAmount = Math.ceil((milliseconds / 1000) * wordsPerSecond);
  currentWordIndex = Math.max(0, currentWordIndex - skipAmount);
  
  console.log('Skipping backward to word:', currentWordIndex, 'skip amount:', skipAmount);
  sendStatusUpdate('Rewinding...', Math.round((currentWordIndex / Math.max(words.length, 1)) * 100));
  
  // Resume reading from new position if was paused
  if (isPaused) {
    handleResume();
  } else {
    // If currently reading, restart from new position
    synth.cancel();
    setTimeout(() => {
      if (isReading && !isPaused) {
        readNextChunk();
      }
    }, 50);
  }
}

function skipForward(milliseconds) {
  if (!isReading && !isPaused) {
    console.warn('Not reading, cannot skip forward');
    return;
  }
  
  // Calculate words to skip based on milliseconds and current reading speed
  const wordsPerSecond = (currentSettings.speed || 1) * 2.5;  // Approx 150 WPM = 2.5 words/sec
  const skipAmount = Math.ceil((milliseconds / 1000) * wordsPerSecond);
  currentWordIndex = Math.min(words.length - 1, currentWordIndex + skipAmount);
  
  console.log('Skipping forward to word:', currentWordIndex, 'skip amount:', skipAmount);
  sendStatusUpdate('Fast forwarding...', Math.round((currentWordIndex / Math.max(words.length, 1)) * 100));
  
  // Resume reading from new position if was paused
  if (isPaused) {
    handleResume();
  } else {
    // If currently reading, restart from new position
    synth.cancel();
    setTimeout(() => {
      if (isReading && !isPaused) {
        readNextChunk();
      }
    }, 50);
  }
}

// ===== SMART CONTENT EXTRACTION =====
function extractAndCleanContent() {
  console.log('Extracting and cleaning page content using advanced algorithms...');
  
  try {
    // Clone the body to avoid modifying the original
    const clone = document.body.cloneNode(true);
    
    // Remove unwanted elements with enhanced selectors
    const selectorsToRemove = [
      'script', 'style', 'noscript', 'iframe', 
      '.ad', '.ads', '[class*="advertisement"]', '[id*="advertisement"]',
      '.sidebar', '.nav', '.navigation', 'nav',
      '.menu', '[role="navigation"]', '[role="banner"]',
      '.header', 'header:not([role="main"])', '.footer', 'footer', '[role="contentinfo"]',
      '.popup', '.modal', '.overlay', '.dialog',
      '[aria-hidden="true"]', '[style*="display: none"]', '[style*="visibility: hidden"]',
      'svg:not([role="img"])', 'canvas',
      '.social-share', '.share-buttons', '.comments', '#comments',
      '.related-posts', '.recommended', '.newsletter',
      'form:not([role="search"])', 'button:not([role="button"])'
    ];
    
    selectorsToRemove.forEach(selector => {
      try {
        const elements = clone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      } catch (e) {
        console.warn('Could not remove selector:', selector);
      }
    });
    
    // Try multiple selectors for main content with priority order
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      '.main-content',
      '#content',
      '#main-content',
      '.story-body',
      '.article-body'
    ];
    
    let mainContent = null;
    for (const selector of contentSelectors) {
      try {
        const element = clone.querySelector(selector);
        if (element) {
          const text = (element.innerText || '').trim();
          if (text.length > 100) {
            mainContent = element;
            console.log(`Found main content using selector: ${selector}`);
            break;
          }
        }
      } catch (e) {
        console.warn(`Error checking selector ${selector}:`, e);
      }
    }
    
    let textContent = '';
    if (mainContent) {
      try {
        textContent = (mainContent.innerText || '').trim();
      } catch (e) {
        console.warn('Error extracting innerText from mainContent:', e);
        textContent = '';
      }
    }
    
    if (!textContent) {
      console.log('No main content found, extracting from paragraphs...');
      try {
        const paragraphs = Array.from(clone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li'));
        const contentBlocks = paragraphs
          .map(p => {
            try {
              return p ? (p.innerText || '').trim() : '';
            } catch (e) {
              return '';
            }
          })
          .filter(text => text && text.length > 20);
        textContent = contentBlocks.join(' ');
      } catch (e) {
        console.error('Error extracting paragraph content:', e);
        textContent = '';
      }
    }
    
    // Clean up text content
    textContent = textContent
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '. ')
      .trim();
    
    if (!textContent || textContent.length < 50) {
      sendStatusUpdate('No readable content found on page', 50);
      return;
    }
    
    // Now read the extracted content
    const settings = currentSettings;
    isReading = true;
    isPaused = false;
    words = textContent
      .split(/\s+/)
      .filter(word => word.length > 0)
      .map(word => word.trim());
    
    currentWordIndex = 0;
    readingText = textContent;
    
    // Clear old wrapped spans
    wrappedSpans = [];
    wordPositionsCache.clear();
    
    // Start speaking the extracted content
    if (words.length > 0) {
      sendStatusUpdate(`Reading clean content: ${words.length} words`, 0);
      console.log(`Successfully extracted ${words.length} words from page`);
      try { buildSentenceGroups(); } catch (e) { sentenceGroups = []; }
      currentSentenceGroupIndex = 0;
      currentRepeatIteration = 0;
      try { createHighlightIndicator(); } catch (_) {}
      if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
      readNextChunk();
    }
    
  } catch (error) {
    console.error('Error extracting content:', error);
    sendStatusUpdate('Could not extract content', 50);
  }
}

function sendStatusUpdate(text, progress) {
  // Always update the floating player progress bar regardless of online state
  try {
    if (typeof progress === 'number') {
      const fill = document.getElementById('player-progress-fill');
      if (fill) fill.style.width = Math.max(0, Math.min(100, progress)) + '%';
    }
  } catch (_) {}

  // Don't try to send runtime messages if offline or in file:// mode
  if (isOfflineMode || !navigator.onLine) {
    return;
  }
  
  try {
    // Check if chrome.runtime is available and extension context is valid
    if (!chrome || !chrome.runtime) {
      console.log('Chrome runtime not available - extension context invalidated');
      return;
    }
    
    // Attempt to send message with proper error handling
    // Use try-catch instead of promise chain to avoid "asynchronous response" warnings
    try {
      chrome.runtime.sendMessage(
        { action: 'updateStatus', text: text, progress: progress },
        () => { void chrome.runtime.lastError; }
      );
    } catch (sendErr) {
      // Silently ignore - normal when extension context is invalidated or page navigates
    }
  } catch (e) {
    // Handle synchronous errors
    console.debug('Error in sendStatusUpdate catch block:', e?.message || e);
  }
}

function updateFloatingPlayer(progress, currentPos, total) {
  const player = document.getElementById('tts-floating-player');
  if (!player) return;
  
  // Update play/pause button state
  const playBtn = player.querySelector('#player-play');
  if (playBtn) {
    playBtn.textContent = (isPaused) ? '▶' : '⏸';
  }
  
  // Update progress bar
  const progressFill = player.querySelector('#player-progress-fill');
  if (progressFill) {
    progressFill.style.width = progress + '%';
  }
  
  // Use real measured WPM from history, fall back to speed-ratio estimate
  const measuredWpm = (Array.isArray(_wpmHistory) && _wpmHistory.length > 0)
    ? Math.round(_wpmHistory.reduce((a, b) => a + b, 0) / _wpmHistory.length)
    : Math.round(150 * (currentSettings.speed || 1));

  const totalWords = words.length || 0;
  const wordsRemaining = Math.max(0, totalWords - currentPos);
  const elapsedSeconds = _wpmStartTime ? (Date.now() - _wpmStartTime) / 1000 : 0;
  const remainingSeconds = measuredWpm > 0 ? (wordsRemaining / measuredWpm) * 60 : 0;
  const totalSeconds = elapsedSeconds + remainingSeconds;

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const currentTimeEl = player.querySelector('#player-current-time');
  if (currentTimeEl) currentTimeEl.textContent = formatTime(elapsedSeconds);

  const totalTimeEl = player.querySelector('#player-total-time');
  if (totalTimeEl) totalTimeEl.textContent = formatTime(totalSeconds);

  // WPM is kept up-to-date by trackWPM(); only set initial value here
  const wpmEl = player.querySelector('#player-wpm');
  if (wpmEl && wpmEl.textContent === '0 WPM') {
    wpmEl.textContent = `${measuredWpm} WPM`;
  }
}

// Handle left-click to start/stop reading - DISABLED to prevent text disappearing
let listenersSetup = false; // Guard flag to prevent duplicate listeners

function setupClickToReadListener() {
  if (listenersSetup) {
    console.log('Click listeners already set up, skipping duplicate initialization');
    return;
  }

  listenersSetup = true;

  let selectionChangeDebounce = false;
  let _pendingClickTimer = null;
  window._cancelPendingClick = function() {
    clearTimeout(_pendingClickTimer);
    _pendingClickTimer = null;
  };

  document.addEventListener('selectionchange', () => {
    if (isReading && !selectionChangeDebounce) {
      selectionChangeDebounce = true;
      setTimeout(() => { selectionChangeDebounce = false; }, 500);
    }
  });

  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (e.altKey || (e.ctrlKey && e.shiftKey)) return;

    if (e.target.closest && e.target.closest('#tts-floating-player')) return;

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) return;

    // Resume is immediate — no debounce needed for pause→resume toggle
    if (isReading && isPaused) {
      handleResume();
      return;
    }

    // Do not start reading from a click unless click-to-read mode is explicitly enabled
    if (!clickToReadEnabled && !isReading) return;

    // All "start reading" actions are debounced 220ms so a double-click
    // can cancel the pending single-click before it starts reading twice.
    const capturedX = e.clientX;
    const capturedY = e.clientY;
    const capturedSpan = e.target.closest ? e.target.closest('.tts-word-span') : null;

    clearTimeout(_pendingClickTimer);
    _pendingClickTimer = setTimeout(() => {
      _pendingClickTimer = null;

      const wordSpan = capturedSpan;

      if (isReading && !isPaused) {
        const range = _getCaretRange(capturedX, capturedY);
        handleStop();
        if (wordSpan) {
          const idx = parseInt(wordSpan.getAttribute('data-tts-index') || '0');
          if (!isNaN(idx) && words.length > 0) {
            setTimeout(() => {
              currentWordIndex = Math.max(0, Math.min(idx, words.length - 1));
              isReading = true;
              isPaused  = false;
              createHighlightIndicator();
              readNextChunk();
            }, 60);
          }
        } else if (range) {
          setTimeout(() => readFromClickPoint(range, currentSettings), 60);
        }
        return;
      }

      // Not reading: left-click on a word span → start from that word
      if (wordSpan) {
        const idx = parseInt(wordSpan.getAttribute('data-tts-index') || '0');
        if (!isNaN(idx) && words.length > 0) {
          currentWordIndex = Math.max(0, Math.min(idx, words.length - 1));
          isReading = true;
          isPaused  = false;
          createHighlightIndicator();
          readNextChunk();
          return;
        }
      }

      // Not reading and no word span: start reading from caret position
      const range = _getCaretRange(capturedX, capturedY);
      if (range) {
        readFromClickPoint(range, currentSettings);
      } else {
        handleRead('page', currentSettings);
      }
    }, 220);
  }, true);

document.addEventListener('dblclick', (e) => {
  if (e.altKey || (e.ctrlKey && e.shiftKey)) return;
  if (e.target.closest && e.target.closest('#tts-floating-player')) return;

  // Cancel any pending single-click read so it doesn't double-fire
  clearTimeout(_pendingClickTimer);
  _pendingClickTimer = null;

  const wordSpan = e.target.closest ? e.target.closest('.tts-word-span') : null;
  if (!wordSpan) return;

  e.preventDefault();
  e.stopPropagation();

  const idx = parseInt(wordSpan.getAttribute('data-tts-index') || '0');
  if (!isNaN(idx) && words && words.length > 0) {
    if (isReading) handleStop();
    currentWordIndex = Math.max(0, Math.min(idx, words.length - 1));
    isReading = true;
    isPaused = false;
    try {
      createHighlightIndicator();
      readNextChunk();
    } catch (err) {
      console.error('[dblclick] Error starting reading:', err);
    }
  }
}, true);

console.log('✓ Click-to-read and double-click listeners active');
}

// Function to read from where user clicked
function readFromClickPoint(range, settings) {
  console.log('readFromClickPoint called with settings:', settings);
  
  if (isReading) {
    handleStop();
  }
  
  if (!range) {
    console.warn('readFromClickPoint: No range provided, reading full page');
    handleRead('page', settings);
    return;
  }
  
  // CRITICAL FIX: Merge settings instead of replacing them to preserve all properties
  if (settings) {
    currentSettings = Object.assign({}, currentSettings, settings);
  }
  
  // DEFENSIVE: Ensure critical settings like sentenceCount are always present
  if (!currentSettings.sentenceCount || currentSettings.sentenceCount < 1) {
    currentSettings.sentenceCount = 2;
    console.log(`[readFromClickPoint] WARNING: sentenceCount was missing/invalid, set to 2`);
  }
  if (!currentSettings.repeatCount || currentSettings.repeatCount < 1) {
    currentSettings.repeatCount = 1;
    console.log(`[readFromClickPoint] WARNING: repeatCount was missing/invalid, set to 1`);
  }
  
  console.log(`[readFromClickPoint] AFTER DEFENSIVE CHECK: sentenceCount=${currentSettings.sentenceCount}, repeatCount=${currentSettings.repeatCount}`);
  console.log(`[readFromClickPoint] Final settings object:`, JSON.stringify({
    sentenceCount: currentSettings.sentenceCount,
    repeatCount: currentSettings.repeatCount,
    speed: currentSettings.speed,
    voice: currentSettings.voice,
    pitch: currentSettings.pitch,
    volume: currentSettings.volume
  }));
  
  // Show floating player (create if needed, then reveal)
  createFloatingPlayer(currentSettings || {});
  const _rfcpPlayer = document.getElementById('tts-floating-player');
  if (_rfcpPlayer) {
    if (document.body && document.body.classList.contains('dark-mode')) {
      _rfcpPlayer.classList.add('dark-mode');
    } else {
      _rfcpPlayer.classList.remove('dark-mode');
    }
    _rfcpPlayer.style.display = 'flex';
    _rfcpPlayer.style.animation = 'ttsSlideDown 0.3s cubic-bezier(0.4,0,0.2,1) forwards';
    console.log('🎵 Floating player shown (readFromClickPoint)');
  }

  selectedNodes = [];
  readingContainer = document.body;
  
  currentWordIndex = 0;
  isReading = true;
  lastScrollTime = 0;  // Reset scroll timer for immediate scrolling
  isPaused = false;
  wordPositionsCache.clear();
  wrappedSpans = [];
  words = [];
  sentenceGroups = [];
  currentSentenceGroupIndex = 0;
  currentRepeatIteration = 0;
  
  // Get the node and offset from click point
  const startNode = range.endContainer || range.startContainer;
  const startOffset = range.endOffset || range.startOffset || 0;
  
  if (!startNode) {
    console.warn('readFromClickPoint: No startNode available, reading full page');
    wrappedSpans = [];
    words = [];
    wrapAllWords(() => startReadingFromClickPoint());
    return;
  }
  
  console.log('Starting from node:', startNode.nodeName, 'offset:', startOffset);
  
  // Wrap words from click position
  try {
    wrapWordsFromNode(startNode, startOffset);
  } catch (e) {
    console.warn('Error wrapping from click point:', e);
    wrappedSpans = [];
    words = [];
  }
  
  if (words.length === 0) {
    // Fallback to entire page if no words from click - use callback
    console.log('No words from click point, trying entire page');
    wrappedSpans = [];
    words = [];
    wrapAllWords(() => startReadingFromClickPoint());
    return;
  }
  
  // Words were found from click position, start reading immediately
  console.log(`readFromClickPoint: Starting with ${words.length} words`);
  startReadingFromClickPoint();
}

// Helper function to start reading after click point wrapping
function startReadingFromClickPoint() {
  try {
    console.log(`[startReadingFromClickPoint] ENTRY - currentSettings.sentenceCount=${currentSettings.sentenceCount}, currentSettings=`, currentSettings);
    
    // Validate state
    if (typeof words === 'undefined' || words === null) {
      words = [];
    }
    if (!Array.isArray(words) || words.length === 0) {
      sendStatusUpdate('No text found at click point', 0);
      isReading = false;
      console.warn('No words available for reading');
      return;
    }
    
    console.log(`startReadingFromClickPoint: Total words: ${words.length}, wrapped spans: ${wrappedSpans.length}`);
    console.log(`[DEBUG] currentSettings.sentenceCount = ${currentSettings.sentenceCount}, fulSettings:`, currentSettings);
    
    // Ensure sentence groups are built
    if (!sentenceGroups || !Array.isArray(sentenceGroups)) {
      sentenceGroups = [];
    }
    if (sentenceGroups.length === 0 && words.length > 0) {
      try {
        buildSentenceGroups();
        console.log(`[CRITICAL] After buildSentenceGroups: created ${sentenceGroups.length} groups from ${words.length} words, sentenceCount was ${currentSettings.sentenceCount}`);
        if (sentenceGroups.length === 1) {
          console.warn(`[CRITICAL WARNING!!!] Only 1 group! All sentences merged, will only read once!`);
        }
      } catch (e) {
        console.warn('Error building sentence groups in startReadingFromClickPoint:', e);
        sentenceGroups = [];
      }
    }
    
    readingText = words.join(' ');
    
    // Create visual indicator
    try {
      createHighlightIndicator();
    } catch (e) {
      console.warn('Error creating highlight indicator:', e);
    }
    
    // Watchdog timer — stuck-detection (same pattern as continueHandleRead)
    if (watchdogTimer) clearInterval(watchdogTimer);
    let _cwKa = 0;
    let _cwIdleStart = null;
    watchdogTimer = setInterval(() => {
      try {
        if (!isReading || isPaused) { _cwIdleStart = null; return; }
        _cwKa++;
        if (_cwKa % 13 === 0 && synth && synth.speaking) {
          try { synth.pause(); synth.resume(); } catch (_) {}
        }
        const synthIdle = synth && !synth.speaking && !synth.pending;
        if (synthIdle) {
          if (_cwIdleStart === null) _cwIdleStart = Date.now();
          const idleMs = Date.now() - _cwIdleStart;
          const silentMs = Date.now() - lastSpeechActivityTime;
          if (idleMs >= 2000 && silentMs >= 2000) {
            _cwIdleStart = null;
            try { synth.cancel(); } catch (_) {}
            setTimeout(() => { if (isReading && !isPaused) readNextChunk(); }, 80);
          }
        } else {
          _cwIdleStart = null;
        }
      } catch (e) { console.warn('[ClickWatchdog] Error:', e); }
    }, 800);
    
    // Start reading
    readNextChunk();
  } catch (e) {
    console.error('Error in startReadingFromClickPoint:', e);
    isReading = false;
    sendStatusUpdate('Error starting reading: ' + (e.message || 'Unknown error'), 0);
  }
}

// Function to read from cursor position
function readFromCursor(settings) {
  if (isReading) {
    handleStop();
  }
  
  // CRITICAL FIX: Merge settings instead of replacing to preserve all properties
  if (settings) {
    currentSettings = Object.assign({}, currentSettings, settings);
  }
  selectedNodes = [];
  readingContainer = null;
  
  // Get text from cursor position onwards
  const selection = window.getSelection();
  let startNode = null;
  let startOffset = 0;
  
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    startNode = range.endContainer;
    startOffset = range.endOffset;
    readingContainer = document.body;
  } else {
    readingContainer = document.body;
  }
  
  currentWordIndex = 0;
  isReading = true;
  isPaused = false;
  wordPositionsCache.clear();
  wrappedSpans = [];
  words = [];
  
  try {
    // Wrap words from cursor position
    wrapWordsFromNode(startNode, startOffset);
    
    if (!words || words.length === 0) {
      console.log('No text from cursor onwards, falling back to page read');
      sendStatusUpdate('No text from cursor onwards, reading full page', 0);
      // Fallback to reading entire page
      wrappedSpans = [];
      words = [];
      wrapAllWords(() => startReadingAfterWrapping());
      return;
    }
    
    console.log(`Total words to read from cursor: ${words.length}`);
    console.log(`Total wrapped spans: ${wrappedSpans.length}`);
    
    readingText = words.join(' ');
    
    // Create visual indicator
    createHighlightIndicator();
    
    // Start watchdog timer
    if (watchdogTimer) clearInterval(watchdogTimer);
    let _rfc_idleStart = null;
    watchdogTimer = setInterval(() => {
      try {
        if (!isReading || isPaused) { _rfc_idleStart = null; return; }
        const synthIdle = synth && !synth.speaking && !synth.pending;
        if (synthIdle) {
          if (_rfc_idleStart === null) _rfc_idleStart = Date.now();
          const idleMs = Date.now() - _rfc_idleStart;
          const silentMs = Date.now() - lastSpeechActivityTime;
          if (idleMs >= 2000 && silentMs >= 2000) {
            _rfc_idleStart = null;
            try { synth.cancel(); } catch (_) {}
            setTimeout(() => { if (isReading && !isPaused) readNextChunk(); }, 80);
          }
        } else {
          _rfc_idleStart = null;
        }
      } catch (_) {}
    }, 800);
    
    readNextChunk();
  } catch (e) {
    console.error('Error in readFromCursor:', e);
    sendStatusUpdate('Error reading from cursor: ' + (e.message || 'Unknown error'), 0);
    isReading = false;
  }
}

// Function to wrap words starting from a specific node and offset
function wrapWordsFromNode(startNode, startOffset) {
  console.log('wrapWordsFromNode called, startNode:', startNode, 'offset:', startOffset);
  
  try {
    wrappedSpans = [];
    words = [];
    let wordIndex = 0;
    let foundStart = startNode === null;
    
    const unwantedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'IFRAME', 'TTS-WORD-SPAN']);
    
    function processTextNode(node, originalText) {
      // Process text node and wrap words
      const processText = originalText;
      if (!processText || !processText.trim()) return;
      
      // Create and populate fragment
      const frag = document.createDocumentFragment();
      const parts = processText.split(/(\s+)/);
      let hasContent = false;
      
      for (let part of parts) {
        if (part.trim().length > 0) {
          const span = document.createElement('span');
          span.textContent = part;
          span.setAttribute('data-tts-index', wordIndex);
          span.className = 'tts-word-span';
          frag.appendChild(span);
          
          wrappedSpans[wordIndex] = span;
          words[wordIndex] = part.trim();
          wordIndex++;
          hasContent = true;
        } else if (part.length > 0) {
          frag.appendChild(document.createTextNode(part));
        }
      }
      
      return { fragment: frag, hasContent: hasContent, wordCount: hasContent ? wordIndex - wrappedSpans.filter(s => s).length : 0 };
    }
    
    function wrapWordsInNode(node) {
      // Skip if node is already wrapped
      if (typeof node.className === 'string' && node.className.includes('tts-word-span')) {
        return;
      }
      
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (!text || !text.trim()) return;
        
        const parent = node.parentNode;
        if (!parent || unwantedTags.has(parent.tagName)) {
          return;
        }
        
        // Don't wrap text already in wrapped spans
        if (parent.classList && parent.classList.contains('tts-word-span')) {
          return;
        }
        
        // Check if parent is hidden
        if (parent.offsetHeight === 0 && parent.offsetWidth === 0) {
          return;
        }
        
        let textToProcess = text;
        
        // If this is the start node, skip to offset
        if (!foundStart && node === startNode) {
          foundStart = true;
          if (startOffset > 0) {
            // Keep text before offset as plain text
            const beforeText = text.substring(0, startOffset);
            try {
              if (node.parentNode && node.parentNode.contains(node)) {
                const beforeNode = document.createTextNode(beforeText);
                node.parentNode.insertBefore(beforeNode, node);
              }
            } catch (e) {
              console.warn('Could not insert pre-offset text:', e);
            }
          }
          textToProcess = text.substring(startOffset);
        } else if (!foundStart) {
          return;
        }
        
        if (!textToProcess.trim()) return;
        
        // Process the text and create fragment
        const result = processTextNode(node, textToProcess);
        if (!result || !result.hasContent) {
          console.warn('No valid content from text node');
          return;
        }
        
        try {
          // Only replace if node is still in DOM
          if (node.parentNode && node.parentNode.contains(node)) {
            node.parentNode.replaceChild(result.fragment, node);
          }
        } catch (e) {
          console.warn('Error replacing text node in wrapWordsFromNode:', e);
          try {
            if (node.parentNode) {
              const restored = document.createTextNode(text);
              node.parentNode.appendChild(restored);
            }
          } catch (e2) {
            console.error('Critical: could not restore text in wrapWordsFromNode:', e2);
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (unwantedTags.has(node.tagName)) {
          return;
        }
        
        // Skip already wrapped nodes
        if (node.classList && node.classList.contains('tts-word-span')) {
          return;
        }

        // Skip aria-hidden / hidden elements
        if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return;
        if (node.hasAttribute && node.hasAttribute('hidden')) return;
        if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) return;

        // Skip screen-reader-only and skip-link class patterns
        const cls = (typeof node.className === 'string' ? node.className : '').toLowerCase();
        if (/sr-only|visually-?hidden|screen-reader|skip-link|skip-nav|skip-to|offscreen|a11y-hidden|clip-hidden/.test(cls)) return;

        // Skip skip-link anchors: <a href="#...">Skip to content</a>
        if (node.tagName === 'A') {
          const href = (node.getAttribute && node.getAttribute('href')) || '';
          const txt = (node.textContent || '').trim().toLowerCase();
          if (href.startsWith('#') && /skip|jump\s+to|go\s+to\s+main|bypass/.test(txt)) return;
          if (/skip.*(content|nav|main|link|navigation)|jump\s+to\s+(main|content)/.test(txt)) return;
        }

        // Skip elements hidden off-screen (common pattern for accessible skip links)
        try {
          const cs = window.getComputedStyle(node);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if ((cs.position === 'absolute' || cs.position === 'fixed') &&
              (parseFloat(cs.left) < -100 || parseFloat(cs.top) < -100)) return;
          if (node.offsetHeight === 0 && node.offsetWidth === 0) return;
        } catch (_) {}

        // Process children
        const children = Array.from(node.childNodes);
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          // Check if child is still in DOM before processing
          if (node.contains(child)) {
            wrapWordsInNode(child);
          }
        }
      }
    }
    
    // Start wrapping from reading container
    try {
      if (readingContainer) {
        wrapWordsInNode(readingContainer);
      }
    } catch (e) {
      console.error('Error wrapping words from cursor:', e);
    }
  } catch (e) {
    console.error('Fatal error in wrapWordsFromNode:', e);
    wrappedSpans = [];
    words = [];
  }
}

// Initialize click-to-read listener when page loads or immediately if already loaded
function initializeContentScript() {
  console.log('Initializing content script, DOM state:', document.readyState);
  console.log('Is offline mode:', isOffline);
  
  // Try to set up click listener immediately regardless of DOM state
  try {
    setupClickToReadListener();
  } catch (e) {
    console.warn('Could not set up click listener immediately:', e);
  }
}

// Vocab widget functions
async function loadVocabCache() {
  try {
    const result = await chrome.storage.local.get(['vocabCache']);
    if (result.vocabCache && Array.isArray(result.vocabCache)) {
      vocabCache = result.vocabCache;
      window.vocabCache = vocabCache; // Sync with window reference
      console.log(`Loaded ${vocabCache.length} vocab words from cache`);
    } else {
      vocabCache = getDefaultVocab();
      window.vocabCache = vocabCache; // Sync with window reference
      await saveVocabCache();
    }
  } catch (e) {
    console.warn('Could not load vocab cache:', e);
    vocabCache = getDefaultVocab();
    window.vocabCache = vocabCache; // Sync with window reference
  }
}

async function saveVocabCache() {
  try {
    const cacheString = JSON.stringify(vocabCache);
    const cacheSize = new Blob([cacheString]).size;
    
    if (cacheSize <= VOCAB_CACHE_SIZE_LIMIT) {
      await chrome.storage.local.set({ vocabCache: vocabCache });
      console.log(`Saved ${vocabCache.length} vocab words to cache (${(cacheSize / 1024).toFixed(2)} KB)`);
    } else {
      console.warn('Vocab cache exceeds 10MB limit, truncating...');
      const maxItems = Math.floor(vocabCache.length * 0.9);
      vocabCache = vocabCache.slice(0, maxItems);
      window.vocabCache = vocabCache; // Sync with window reference
      await chrome.storage.local.set({ vocabCache: vocabCache });
    }
  } catch (e) {
    if (!e?.message?.includes('Extension context invalidated')) {
      console.warn('Could not save vocab cache:', e);
    }
  }
}

async function fetchVocabFromAPI() {
  if (!navigator.onLine) {
    console.log('Offline - skipping vocab fetch');
    return;
  }
  
  try {
    console.log('Fetching vocab from API...');
    
    // Fetch multiple words to build a better vocab cache
    const commonWords = [
      'hello', 'world', 'learning', 'reading', 'speaking', 'writing', 'listening', 'understanding', 'knowledge', 'education',
      'technology', 'innovation', 'development', 'communication', 'collaboration', 'creativity', 'excellence', 'achievement',
      'success', 'growth', 'improvement', 'progress', 'challenge', 'opportunity', 'solution', 'problem', 'analysis', 'strategy',
      'planning', 'execution', 'quality', 'efficiency', 'productivity', 'performance', 'excellence', 'leadership', 'teamwork'
    ];
    let allNewVocab = [];
    let fetchedCount = 0;
    
    for (const word of commonWords) {
      try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`, {
          timeout: 5000
        });
        
        if (response.ok) {
          const data = await response.json();
          const newVocab = extractVocabFromAPI(data);
          allNewVocab = [...allNewVocab, ...newVocab];
          fetchedCount++;
        }
      } catch (e) {
        console.warn(`Could not fetch vocab for word "${word}":`, e);
      }
      
      // Limit API calls to avoid rate limiting
      if (fetchedCount >= 20) break;
    }
    
    if (allNewVocab.length > 0) {
      console.log(`Fetched ${allNewVocab.length} new vocab words from API`);
      
      // Merge with existing cache, removing duplicates
      const uniqueVocab = [];
      const seenWords = new Set();
      
      // Add new vocab first
      for (const vocab of allNewVocab) {
        if (!seenWords.has(vocab.word)) {
          uniqueVocab.push(vocab);
          seenWords.add(vocab.word);
        }
      }
      
      // Add old vocab that's not in new vocab
      for (const vocab of vocabCache) {
        if (!seenWords.has(vocab.word)) {
          uniqueVocab.push(vocab);
          seenWords.add(vocab.word);
        }
      }
      
      vocabCache = uniqueVocab;
      window.vocabCache = vocabCache; // Sync with window reference
      
      // Keep cache under 10MB limit
      const cacheString = JSON.stringify(vocabCache);
      const cacheSize = new Blob([cacheString]).size;
      
      if (cacheSize > VOCAB_CACHE_SIZE_LIMIT) {
        console.log(`Cache size ${(cacheSize / 1024 / 1024).toFixed(2)}MB exceeds limit, trimming...`);
        vocabCache = vocabCache.slice(0, Math.floor(vocabCache.length * 0.8));
        window.vocabCache = vocabCache; // Sync with window reference
      }
      
      await saveVocabCache();
      console.log(`✅ Vocab cache updated: ${vocabCache.length} words, ${(new Blob([JSON.stringify(vocabCache)]).size / 1024).toFixed(2)}KB`);
      
      // Update widget to display newly fetched vocab
      if (typeof updateVocabWidget === 'function') {
        updateVocabWidget();
      }
    }
  } catch (e) {
    console.warn('Could not fetch vocab from API:', e);
  }
}

function extractVocabFromAPI(data) {
  const vocab = [];
  
  try {
    if (Array.isArray(data)) {
      data.forEach(entry => {
        if (entry.word && entry.meanings) {
          entry.meanings.forEach(meaning => {
            if (meaning.definitions && meaning.definitions.length > 0) {
              vocab.push({
                word: entry.word,
                meaning: meaning.definitions[0].definition,
                partOfSpeech: meaning.partOfSpeech || ''
              });
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn('Error extracting vocab:', e);
  }
  
  return vocab;
}

// DISABLED: extractToughWordsFromPage() removed - it only shows "X occurrences on this page" 
// instead of real word meanings. Use API-fetched vocabulary instead for actual definitions.
/*
function extractToughWordsFromPage() {
  const toughWords = [];
  const commonSimpleWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'either', 'neither', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'well', 'good', 'bad', 'new', 'old', 'big', 'small', 'high', 'low', 'first', 'last', 'long', 'short', 'right', 'wrong', 'yes', 'no', 'here', 'there', 'now', 'then', 'today', 'yesterday', 'tomorrow'
  ]);
  
  const wordFrequency = new Map();
  const bodyText = document.body ? document.body.textContent : '';
  if (!bodyText) return toughWords;
  const allText = bodyText.toLowerCase();
  const words = allText.match(/\\b\\w+\\b/g) || [];
  
  words.forEach(word => {
    if (word.length > 6 && !commonSimpleWords.has(word)) {
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
    }
  });
  
  const sortedWords = Array.from(wordFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  
  sortedWords.forEach(([word, freq]) => {
    toughWords.push({
      word: word.charAt(0).toUpperCase() + word.slice(1),
      meaning: `${freq} occurrence${freq > 1 ? 's' : ''} on this page`,
      partOfSpeech: 'noun/adjective/verb'
    });
  });
  
  return toughWords;
}
*/

function getDefaultVocab() {
  return [
    { word: 'Eloquent', meaning: 'Fluent or persuasive in speaking or writing', partOfSpeech: 'adjective' },
    { word: 'Serene', meaning: 'Calm, peaceful, and untroubled', partOfSpeech: 'adjective' },
    { word: 'Ephemeral', meaning: 'Lasting for a very short time', partOfSpeech: 'adjective' },
    { word: 'Resilient', meaning: 'Able to withstand or recover quickly from difficulties', partOfSpeech: 'adjective' },
    { word: 'Pragmatic', meaning: 'Dealing with things sensibly and realistically', partOfSpeech: 'adjective' },
    { word: 'Tenacious', meaning: 'Holding firmly to something; persistent', partOfSpeech: 'adjective' },
    { word: 'Benevolent', meaning: 'Well-meaning and kindly', partOfSpeech: 'adjective' },
    { word: 'Diligent', meaning: 'Having or showing care and conscientiousness', partOfSpeech: 'adjective' },
    { word: 'Vivid', meaning: 'Producing powerful feelings or strong, clear images', partOfSpeech: 'adjective' },
    { word: 'Meticulous', meaning: 'Showing great attention to detail; very careful', partOfSpeech: 'adjective' },
    { word: 'Abundant', meaning: 'Existing or available in large quantities; plentiful', partOfSpeech: 'adjective' },
    { word: 'Candid', meaning: 'Truthful and straightforward; frank', partOfSpeech: 'adjective' },
    { word: 'Coherent', meaning: 'Logical and consistent', partOfSpeech: 'adjective' },
    { word: 'Diverse', meaning: 'Showing a great deal of variety', partOfSpeech: 'adjective' },
    { word: 'Efficient', meaning: 'Working in a well-organized and competent way', partOfSpeech: 'adjective' },
    { word: 'Genuine', meaning: 'Truly what something is said to be; authentic', partOfSpeech: 'adjective' },
    { word: 'Innovative', meaning: 'Featuring new methods; advanced and original', partOfSpeech: 'adjective' },
    { word: 'Lucid', meaning: 'Expressed clearly; easy to understand', partOfSpeech: 'adjective' },
    { word: 'Optimistic', meaning: 'Hopeful and confident about the future', partOfSpeech: 'adjective' },
    { word: 'Profound', meaning: 'Very great or intense; showing deep insight', partOfSpeech: 'adjective' }
  ];
}

// Initialize advanced vocab widget instance (guard against missing dependency on re-injection)
const advancedVocabWidget = (typeof AdvancedVocabWidget !== 'undefined')
  ? new AdvancedVocabWidget()
  : { widget: null, create: () => {}, displayWord: () => {}, updateCounter: () => {}, close: () => {}, toggleExpand: () => {} };

function createVocabWidget() {
  advancedVocabWidget.create();
  if (vocabCache.length > 0) {
    advancedVocabWidget.displayWord(vocabCache[currentVocabIndex]);
    advancedVocabWidget.updateCounter();
  }
  vocabWidget = advancedVocabWidget.widget;
}

function updateVocabWidget() {
  if (!advancedVocabWidget.widget || vocabCache.length === 0) {
    return false;
  }
  
  const vocab = vocabCache[currentVocabIndex];
  
  if (vocab) {
    advancedVocabWidget.displayWord(vocab);
    advancedVocabWidget.updateCounter();
    
    // Auto-scroll vocab widget into view with multiple fallback approaches
    try {
      if (advancedVocabWidget.widget) {
        const widgetElement = advancedVocabWidget.widget;
        const rect = widgetElement.getBoundingClientRect();
        const isOutOfView = rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth;
        
        if (isOutOfView) {
          // Try multiple scroll approaches
          try {
            // First attempt: scrollIntoView with options
            widgetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            console.log('[Vocab] Auto-scrolled to vocab widget (method 1)');
          } catch (e1) {
            try {
              // Fallback 1: scrollIntoView without options
              widgetElement.scrollIntoView(true);
              console.log('[Vocab] Auto-scrolled to vocab widget (method 2)');
            } catch (e2) {
              try {
                // Fallback 2: manually scroll window
                const topOffset = widgetElement.offsetTop;
                window.scrollBy({ top: topOffset - (window.innerHeight / 2), behavior: 'smooth' });
                console.log('[Vocab] Auto-scrolled to vocab widget (method 3)');
              } catch (e3) {
                try {
                  // Fallback 3: basic window scroll (last resort)
                  window.scroll(0, widgetElement.offsetTop - (window.innerHeight / 2));
                  console.log('[Vocab] Auto-scrolled to vocab widget (method 4)');
                } catch (e4) {
                  console.warn('[Vocab] All scroll methods failed - scrolling may be blocked by website');
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Vocab] Auto-scroll error:', e);
    }
  }
  
  currentVocabIndex = (currentVocabIndex + 1) % vocabCache.length;
}

function startVocabRotation() {
  if (vocabRotationTimer) {
    clearInterval(vocabRotationTimer);
  }
  
  createVocabWidget();
  updateVocabWidget();

  if (vocabAutoRefresh) {
    vocabRotationTimer = setInterval(() => {
      updateVocabWidget();
    }, vocabRefreshInterval);
  }
}

function stopVocabRotation() {
  if (vocabRotationTimer) {
    clearInterval(vocabRotationTimer);
    vocabRotationTimer = null;
  }
  
  if (advancedVocabWidget && advancedVocabWidget.widget) {
    advancedVocabWidget.close();
    vocabWidget = null;
  }
  
  console.log('Vocab rotation stopped');
}

// Initialize vocab system
async function initializeVocab() {
  await loadVocabCache();
  
  // Skip extractToughWordsFromPage - it adds incomplete vocab without real definitions
  // Only use API-fetched vocabulary with proper meanings
  
  if (navigator.onLine) {
    setTimeout(() => {
      fetchVocabFromAPI();
    }, 5000);
  }
  
  // Only auto-show widget if showVocab setting is enabled (check saved setting)
  try {
    const result = await chrome.storage.local.get(['readerSettings']);
    const savedShowVocab = result?.readerSettings?.showVocab;
    if (savedShowVocab === false) {
      showVocabWidget = false;
      return; // Don't auto-create widget if user has disabled it
    }
  } catch (_) {}
  
  startVocabRotation();
}

// Listen for online event to refresh vocab
window.addEventListener('online', () => {
  console.log('Online - fetching fresh vocab');
  fetchVocabFromAPI();
});

// ===== ENHANCED LOOP MANAGEMENT FUNCTIONS =====

function addToLoopHistory(entry) {
  try {
    loopHistory.push(entry);
    
    // Keep history size under control
    if (loopHistory.length > loopSettings.loopHistorySize) {
      loopHistory.shift(); // Remove oldest entry
    }
    
    // Store to local storage for later analysis
    if (loopHistory.length % 10 === 0) {
      try {
        chrome.storage.local.set({ loopHistory: loopHistory }).catch(() => {});
      } catch (_) {}
    }
  } catch (e) {
    if (!e?.message?.includes('Extension context invalidated')) {
      console.warn('Error adding to loop history:', e);
    }
  }
}

function getLoopStats() {
  try {
    const stats = {
      totalRepeats: loopHistory.length,
      uniqueGroups: new Set(loopHistory.map(e => e.groupIndex)).size,
      averageRepeatTime: 0,
      lastRepeatTime: loopHistory.length > 0 ? loopHistory[loopHistory.length - 1].timestamp : 0
    };
    
    if (loopHistory.length > 1) {
      const timeDiffs = [];
      for (let i = 1; i < loopHistory.length; i++) {
        timeDiffs.push(loopHistory[i].timestamp - loopHistory[i - 1].timestamp);
      }
      stats.averageRepeatTime = Math.round(timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length);
    }
    
    return stats;
  } catch (e) {
    console.warn('Error getting loop stats:', e);
    return {
      totalRepeats: 0,
      uniqueGroups: 0,
      averageRepeatTime: 0,
      lastRepeatTime: 0
    };
  }
}

function setLoopIntensity(intensity) {
  try {
    if (['gentle', 'normal', 'intense'].includes(intensity)) {
      loopSettings.loopIntensity = intensity;
      updateConfig('loopSettings', 'loopIntensity', intensity);
      console.log(`✓ Loop intensity set to: ${intensity}`);
      return true;
    }
    console.warn('Invalid loop intensity:', intensity);
    return false;
  } catch (e) {
    console.error('Error setting loop intensity:', e);
    return false;
  }
}

function setLoopDelay(delayMs) {
  try {
    if (typeof delayMs === 'number' && delayMs >= 0 && delayMs <= 10000) {
      loopSettings.delayBetweenRepeats = delayMs;
      updateConfig('loopSettings', 'delayBetweenRepeats', delayMs);
      console.log(`✓ Loop delay set to: ${delayMs}ms`);
      return true;
    }
    console.warn('Invalid loop delay:', delayMs);
    return false;
  } catch (e) {
    console.error('Error setting loop delay:', e);
    return false;
  }
}

function enableLoopFadeEffect(enabled) {
  try {
    loopSettings.fadeEffect = Boolean(enabled);
    updateConfig('loopSettings', 'fadeEffect', enabled);
    console.log(`✓ Loop fade effect ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  } catch (e) {
    console.error('Error setting fade effect:', e);
    return false;
  }
}

function setInfiniteLoop(enabled) {
  try {
    loopSettings.infiniteLoop = Boolean(enabled);
    updateConfig('loopSettings', 'infiniteLoop', enabled);
    console.log(`✓ Infinite loop ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  } catch (e) {
    console.error('Error setting infinite loop:', e);
    return false;
  }
}

function skipCurrentRepeat() {
  try {
    if (isReading && currentRepeatIteration > 0) {
      loopSettings.skipToNextRepeat = true;
      console.log('Skip current repeat requested');
      
      // Cancel current utterance to trigger callback
      if (synth && synth.speaking) {
        synth.cancel();
      }
      return true;
    }
    console.warn('Cannot skip: not in a repeat or not reading');
    return false;
  } catch (e) {
    console.error('Error skipping repeat:', e);
    return false;
  }
}

function getLoopState() {
  return {
    isLooping: currentRepeatIteration > 0,
    currentIteration: currentRepeatIteration,
    currentGroup: currentSentenceGroupIndex,
    totalGroups: sentenceGroups.length,
    loopSettings: loopSettings,
    stats: getLoopStats()
  };
}

// Load loop settings from storage on startup
async function loadLoopSettings() {
  try {
    const result = await chrome.storage.local.get(['loopIntensity', 'loopDelay', 'loopFadeEffect', 'infiniteLoop']);
    
    if (result.loopIntensity) {
      loopSettings.loopIntensity = result.loopIntensity;
    }
    if (result.loopDelay !== undefined) {
      loopSettings.delayBetweenRepeats = result.loopDelay;
    }
    if (result.loopFadeEffect !== undefined) {
      loopSettings.fadeEffect = result.loopFadeEffect;
    }
    if (result.infiniteLoop !== undefined) {
      loopSettings.infiniteLoop = result.infiniteLoop;
    }
    
    console.log('Loop settings loaded:', loopSettings);
  } catch (e) {
    console.warn('Could not load loop settings:', e);
  }
}

// Initialize immediately
initializeContentScript();
loadLoopSettings();  // Load enhanced loop settings
loadConfig().then(() => {
  console.log('✓ Configuration loaded from storage');
  
  // Listen for config updates from other sources
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.appConfig) {
      appConfig = Object.assign(appConfig, changes.appConfig.newValue);
      console.log('✓ Configuration auto-updated from storage');
    }
  });
}).catch(e => {
  console.warn('Could not load configuration:', e);
});

// Defer vocab initialization until after page is interactive to prevent hanging
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Use requestIdleCallback for non-critical initialization
    if (window.requestIdleCallback) {
      requestIdleCallback(() => initializeVocab(), { timeout: 3000 });
    } else {
      setTimeout(() => initializeVocab(), 100);
    }
  });
} else {
  // Page already loaded
  if (window.requestIdleCallback) {
    requestIdleCallback(() => initializeVocab(), { timeout: 3000 });
  } else {
    setTimeout(() => initializeVocab(), 100);
  }
}

// Pre-create floating player on page load (hidden) so it's ready instantly when reading starts
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try { createFloatingPlayer(currentSettings || {}); } catch (e) { console.warn('Player pre-init error:', e); }
  });
} else {
  try { createFloatingPlayer(currentSettings || {}); } catch (e) { console.warn('Player pre-init error:', e); }
}

console.log('Advanced Text Reader content script fully initialized at:', new Date().toISOString());
console.log('✓ Configuration system active - auto-saves on settings changes');
console.log('Use RIGHT-CLICK context menu or extension popup to start reading');
console.log('Alt+Click for non-blocking click-to-speak (optimized)');
console.log('Enhanced loop features: intensity, delay, fade effect, infinite loop');

window.readFromClickPoint = readFromClickPoint;
window.handleStop = handleStop;
window.handleRead = handleRead;
window.handleResume = handleResume;
window.handlePause = handlePause;
window.resetRepeatCounters = resetRepeatCounters;
window.currentSettings = currentSettings;
window.vocabCache = vocabCache;
window.currentVocabIndex = currentVocabIndex;

// Store function references in persistent object for access after guard closes
window._ttsReaderFunctions = {
  readFromClickPoint,
  handleStop,
  handleRead,
  handleResume,
  handlePause,
  resetRepeatCounters,
  currentSettings,
  vocabCache,
  currentVocabIndex
};

// Vocab handlers exported to window so the message listener (outside guard) can call them
window._ttsVocabFunctions = {
  launch: () => {
    showVocabWidget = true;
    if (!advancedVocabWidget.widget) {
      startVocabRotation();
    } else {
      // Widget exists — ensure it's visible and expanded (never collapse on launch)
      try {
        if (advancedVocabWidget.widget.style.display === 'none') {
          advancedVocabWidget.widget.style.display = '';
        }
        if (!advancedVocabWidget.isExpanded) {
          if (typeof advancedVocabWidget.toggleExpand === 'function') advancedVocabWidget.toggleExpand();
        }
      } catch (_) {}
    }
  },
  setVisibility: (value) => {
    showVocabWidget = Boolean(value);
    if (showVocabWidget && !vocabWidget) {
      startVocabRotation();
    } else if (!showVocabWidget) {
      stopVocabRotation();
    }
  },
  setRefreshInterval: (interval) => {
    const n = Number(interval);
    if (n > 0) {
      vocabRefreshInterval = n;
      if (vocabRotationTimer) {
        clearInterval(vocabRotationTimer);
        vocabRotationTimer = setInterval(() => { updateVocabWidget(); }, vocabRefreshInterval);
      }
    }
    try { chrome.storage.local.set({ vocabTimerSettings: { vocabRefreshInterval, vocabAutoRefresh } }); } catch (_) {}
  },
  setAutoRefresh: (value) => {
    vocabAutoRefresh = Boolean(value);
    if (!vocabAutoRefresh) {
      if (vocabRotationTimer) { clearInterval(vocabRotationTimer); vocabRotationTimer = null; }
    } else {
      if (!vocabRotationTimer && showVocabWidget) {
        vocabRotationTimer = setInterval(() => { updateVocabWidget(); }, vocabRefreshInterval);
      }
    }
    try { chrome.storage.local.set({ vocabTimerSettings: { vocabRefreshInterval, vocabAutoRefresh } }); } catch (_) {}
  }
};

console.log('[EXPORT] All core functions exported successfully');
console.log('[GUARD] Guard block initialization COMPLETE');

} // END OF GUARD

// Re-export functions outside guard using stored references
if (window._ttsReaderFunctions) {
  if (typeof window.readFromClickPoint === 'undefined') {
    window.readFromClickPoint = window._ttsReaderFunctions.readFromClickPoint;
    window.handleStop = window._ttsReaderFunctions.handleStop;
    window.handleRead = window._ttsReaderFunctions.handleRead;
    window.handleResume = window._ttsReaderFunctions.handleResume;
    window.handlePause = window._ttsReaderFunctions.handlePause;
    window.resetRepeatCounters = window._ttsReaderFunctions.resetRepeatCounters;
    window.currentSettings = window._ttsReaderFunctions.currentSettings;
    window.vocabCache = window._ttsReaderFunctions.vocabCache;
    window.currentVocabIndex = window._ttsReaderFunctions.currentVocabIndex;
    console.log('[RE-EXPORT] Functions re-exported after page reload');
  }
}

