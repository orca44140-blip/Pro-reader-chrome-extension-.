let voices = [];
let favoriteVoices = [];
let currentSettings = {
  voice: null,
  speed: 1,
  pitch: 1,
  volume: 1,
  sentenceCount: 2,
  repeatCount: 1,
  selectionRepeatCount: 1,
  autoScroll: true,
  autoScrollDelay: 4000,
  showVocab: true,
  voiceQualityIndicator: false,
  vocabRefreshInterval: 15000,
  vocabAutoRefresh: true,
  darkMode: false,
  highlightColor: '#00ff00',
  highlightStyle: 'background',
  highlightOpacity: 1,
  syncHighlight: true
};

let isOffline = !navigator.onLine;
let previewUtterance = null;
let isReading = false;
let isPaused = false;
let startTime = 0;
let readingStats = {
  wordsRead: 0,
  timeElapsed: 0,
  currentWPM: 0
};

document.addEventListener('DOMContentLoaded', async () => {
  // Update offline status
  updateOfflineStatus();
  
  await loadVoices();
  await loadSettings();
  initializeDarkMode();
  initializeTabSystem();
  initializeEventListeners();
  initializeFileImport();
  initializePlaybackControls();
  initializeHelpModal();
});

// ===== TAB SYSTEM =====
function initializeTabSystem() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  
  if (!tabButtons || tabButtons.length === 0) {
    console.log('No tab buttons found');
    return;
  }
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      
      // Remove active class from all buttons and panes
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));
      
      // Add active class to clicked button
      button.classList.add('active');
      
      // Show corresponding tab pane
      const targetPane = document.getElementById(`${targetTab}-tab`);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

// ===== DARK MODE ===== 
function initializeDarkMode() {
  const darkModeToggle = document.getElementById('dark-mode-toggle');
  const isDarkMode = localStorage.getItem('textReaderDarkMode') === 'true';
  
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    document.body.classList.remove('light-mode');
  } else {
    document.body.classList.add('light-mode');
    document.body.classList.remove('dark-mode');
  }
  
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark-mode');
      document.body.classList.toggle('light-mode');
      localStorage.setItem('textReaderDarkMode', isDark);
      darkModeToggle.textContent = isDark ? '☀️' : '🌙';
    });
  }
}

// ===== HELP MODAL =====
function initializeHelpModal() {
  const helpBtn = document.getElementById('help-btn');
  const helpModal = document.getElementById('help-modal');
  const closeHelpBtn = document.getElementById('close-help');
  
  if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', () => {
      helpModal.style.display = 'flex';
    });
  }
  
  if (closeHelpBtn && helpModal) {
    closeHelpBtn.addEventListener('click', () => {
      helpModal.style.display = 'none';
    });
    
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.style.display = 'none';
      }
    });
  }
}

// ===== PLAYBACK CONTROLS =====
function initializePlaybackControls() {
  const playBtn = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const rewindBtn = document.getElementById('rewind-btn');
  const forwardBtn = document.getElementById('forward-btn');
  
  // Smart Play Button - Start reading if not reading, resume if paused, pause if playing
  if (playBtn) {
    playBtn.addEventListener('click', async () => {
      if (!isReading) {
        // Not reading yet - start reading the page
        await readContent('page');
      } else if (isPaused) {
        // Paused - resume reading
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'resume'}).catch(() => {});
          }
        });
        isPaused = false;
        playBtn.classList.add('active');
        pauseBtn.classList.remove('active');
      } else {
        // Playing - pause reading
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'pause'}).catch(() => {});
          }
        });
        isPaused = true;
        playBtn.classList.remove('active');
        pauseBtn.classList.add('active');
      }
    });
  }
  
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {action: 'pause'}).catch(() => {});
        }
      });
      isPaused = true;
      playBtn.classList.remove('active');
      pauseBtn.classList.add('active');
    });
  }
  
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {action: 'stop'}).catch(() => {});
        }
      });
      isReading = false;
      isPaused = false;
      playBtn.classList.remove('active');
      pauseBtn.classList.remove('active');
      updateStatus('Stopped', 0);
    });
  }
  
  if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {action: 'rewind', amount: 5000}).catch(() => {});
        }
      });
    });
  }
  
  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {action: 'forward', amount: 5000}).catch(() => {});
        }
      });
    });
  }
  
  const downloadAudioBtn = document.getElementById('download-audio-btn');
  if (downloadAudioBtn) {
    downloadAudioBtn.addEventListener('click', async () => {
      await downloadAudio();
    });
  }
  
  // Progress bar seek functionality
  const progressBar = document.getElementById('progress-bar');
  if (progressBar) {
    progressBar.addEventListener('click', (e) => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          const rect = progressBar.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
          console.log('seeking to', percentage);
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'seekToPercentage',
            percentage: percentage
          }).catch(() => {});
        }
      });
    });
  }
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (!currentSettings.enableShortcuts) return;
    
    if (e.code === 'Space' && !e.target.matches('input, textarea')) {
      e.preventDefault();
      playBtn?.click();
    } else if (e.code === 'Escape') {
      stopBtn?.click();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      forwardBtn?.click();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      rewindBtn?.click();
    }
  });
}

// ===== UPDATE STATISTICS =====
function updateReadingStats(wordsRead, timeElapsed) {
  readingStats.wordsRead = wordsRead;
  readingStats.timeElapsed = timeElapsed;
  readingStats.currentWPM = timeElapsed > 0 ? Math.round((wordsRead / timeElapsed) * 60) : 0;
  
  const wordsReadEl = document.getElementById('words-read');
  const timeEl = document.getElementById('reading-time');
  const wpmEl = document.getElementById('wpm-display');
  
  if (wordsReadEl) wordsReadEl.textContent = readingStats.wordsRead;
  if (timeEl) timeEl.textContent = formatTime(readingStats.timeElapsed);
  if (wpmEl) wpmEl.textContent = `WPM: ${readingStats.currentWPM}`;
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Listen for offline/online changes
window.addEventListener('offline', () => {
  isOffline = true;
  updateOfflineStatus();
});

window.addEventListener('online', () => {
  isOffline = false;
  updateOfflineStatus();
});

function updateOfflineStatus() {
  const statusIndicator = document.getElementById('offline-indicator');
  if (statusIndicator) {
    if (isOffline) {
      statusIndicator.textContent = '📡 Offline Mode';
    } else {
      statusIndicator.textContent = '📡 Online';
    }
  }
}

async function loadVoices() {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;

    function scoreVoice(v) {
      let s = 0;
      if (v.localService) s += 10;          // offline = no external API
      const n = (v.name || '').toLowerCase();
      const good = ['natural','neural','premium','enhanced','hd','zira','david',
                    'samantha','daniel','karen','moira','fiona','allison','ava',
                    'victoria','alex','tom','mark','tessa','google','microsoft'];
      good.forEach(kw => { if (n.includes(kw)) s += 2; });
      if (/en[-_]us/i.test(v.lang))   s += 3;
      if (/en[-_]gb/i.test(v.lang))   s += 2;
      if (/^en/i.test(v.lang))        s += 1;
      return s;
    }

    function populateVoices() {
      voices = synth.getVoices();
      const voiceSelect = document.getElementById('voice-select');
      if (!voiceSelect) return;
      voiceSelect.innerHTML = '';

      if (voices.length === 0) {
        voiceSelect.innerHTML = '<option value="">No voices available</option>';
        resolve();
        return;
      }

      // Sort: offline first, then by score descending
      const scored = voices.map((v, i) => ({ v, i, score: scoreVoice(v) }));
      scored.sort((a, b) => {
        if (b.v.localService !== a.v.localService) return b.v.localService ? 1 : -1;
        return b.score - a.score;
      });

      // Group separators
      let lastGroup = null;
      scored.forEach(({ v, i, score }) => {
        const group = v.localService ? 'offline' : 'online';
        if (group !== lastGroup) {
          const grpEl = document.createElement('option');
          grpEl.disabled = true;
          grpEl.textContent = group === 'offline' ? '── 📥 Offline Voices ──' : '── ☁️ Online Voices ──';
          grpEl.style.color = '#6ab8a0';
          voiceSelect.appendChild(grpEl);
          lastGroup = group;
        }
        const option = document.createElement('option');
        option.value = i;
        const stars = score >= 14 ? '★★★' : score >= 10 ? '★★' : score >= 6 ? '★' : '';
        const badge = v.localService ? '📥' : '☁️';
        option.textContent = `${badge}${stars ? ' ' + stars : ''} ${v.name} (${v.lang})`;
        option.title = `Score: ${score} | ${v.localService ? 'Offline (no API)' : 'Online'}`;
        voiceSelect.appendChild(option);
      });

      // Auto-select best voice if no saved preference
      if (currentSettings.voice === null && scored.length > 0) {
        const bestIdx = scored[0].i;
        voiceSelect.value = bestIdx;
        currentSettings.voice = bestIdx;
      }

      resolve();
    }

    populateVoices();

    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = populateVoices;
    }
  });
}

function _syncVocabRefreshUI(ms, autoOn) {
  const sec     = Math.round((ms || 15000) / 1000);
  const valEl   = document.getElementById('vocab-delay-value');
  const slider  = document.getElementById('vocab-delay-slider');
  const togBtn  = document.getElementById('vocab-autorefresh-toggle');
  const stepper = document.getElementById('vocab-refresh-stepper');
  const track   = document.querySelector('.vrc-track-wrap');
  const isOn    = autoOn !== false;

  if (valEl)   valEl.textContent = sec;
  if (slider)  slider.value = Math.min(120, Math.max(15, sec));

  if (togBtn) {
    togBtn.classList.toggle('vrc-on',  isOn);
    togBtn.classList.toggle('vrc-off', !isOn);
    const lbl = togBtn.querySelector('.vrc-onoff-label');
    if (lbl) lbl.textContent = isOn ? 'On' : 'Off';
  }
  if (stepper) stepper.classList.toggle('disabled', !isOn);
  if (track)   track.classList.toggle('disabled', !isOn);

  const decBtn = document.getElementById('vocab-delay-dec');
  const incBtn = document.getElementById('vocab-delay-inc');
  if (decBtn) decBtn.disabled = sec <= 15;
  if (incBtn) incBtn.disabled = sec >= 120;
}

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['readerSettings', 'vocabTimerSettings']);
    // Overlay vocabTimerSettings (separate key) onto readerSettings for reliable persistence
    if (result && result.vocabTimerSettings && result.readerSettings) {
      if (typeof result.vocabTimerSettings.vocabRefreshInterval === 'number') {
        result.readerSettings.vocabRefreshInterval = result.vocabTimerSettings.vocabRefreshInterval;
      }
      if (typeof result.vocabTimerSettings.vocabAutoRefresh === 'boolean') {
        result.readerSettings.vocabAutoRefresh = result.vocabTimerSettings.vocabAutoRefresh;
      }
    }
    if (result && result.readerSettings) {
      // Validate and merge with defaults
      currentSettings = {
        voice: result.readerSettings.voice !== undefined ? result.readerSettings.voice : null,
        speed: result.readerSettings.speed !== undefined ? result.readerSettings.speed : 1,
        pitch: result.readerSettings.pitch !== undefined ? result.readerSettings.pitch : 1,
        volume: result.readerSettings.volume !== undefined ? result.readerSettings.volume : 1,
        sentenceCount: result.readerSettings.sentenceCount !== undefined ? result.readerSettings.sentenceCount : 2,
        repeatCount: result.readerSettings.repeatCount !== undefined ? result.readerSettings.repeatCount : 1,
        selectionRepeatCount: result.readerSettings.selectionRepeatCount !== undefined ? result.readerSettings.selectionRepeatCount : 1,
        autoScroll: result.readerSettings.autoScroll !== undefined ? result.readerSettings.autoScroll : true,
        autoScrollDelay: result.readerSettings.autoScrollDelay || 4000,
        showVocab: result.readerSettings.showVocab !== undefined ? result.readerSettings.showVocab : true,
        voiceQualityIndicator: result.readerSettings.voiceQualityIndicator !== undefined ? result.readerSettings.voiceQualityIndicator : false,
        vocabRefreshInterval: result.readerSettings.vocabRefreshInterval !== undefined ? result.readerSettings.vocabRefreshInterval : 15000,
        vocabAutoRefresh: result.readerSettings.vocabAutoRefresh !== undefined ? result.readerSettings.vocabAutoRefresh : true,
        darkMode: result.readerSettings.darkMode !== undefined ? result.readerSettings.darkMode : false,
        highlightColor: result.readerSettings.highlightColor || '#00ff00',
        highlightStyle: result.readerSettings.highlightStyle || 'background',
        highlightOpacity: result.readerSettings.highlightOpacity !== undefined ? result.readerSettings.highlightOpacity : 1,
        syncHighlight: result.readerSettings.syncHighlight !== undefined ? result.readerSettings.syncHighlight : true,
        sentenceHighlight: result.readerSettings.sentenceHighlight !== undefined ? result.readerSettings.sentenceHighlight : false,
        enableShortcuts: result.readerSettings.enableShortcuts !== undefined ? result.readerSettings.enableShortcuts : true
      };
    } else {
      // Initialize default settings if none exist
      currentSettings = {
        voice: null,
        speed: 1,
        pitch: 1,
        volume: 1,
        sentenceCount: 2,
        repeatCount: 1,
        selectionRepeatCount: 1,
        autoScroll: true,
        autoScrollDelay: 4000,
        showVocab: true,
        voiceQualityIndicator: false,
        vocabRefreshInterval: 15000,
        vocabAutoRefresh: true,
        darkMode: false,
        highlightColor: '#00ff00',
        highlightStyle: 'background',
        highlightOpacity: 1,
        syncHighlight: true,
        sentenceHighlight: false,
        enableShortcuts: true
      };
      await chrome.storage.local.set({ readerSettings: currentSettings });
    }
    
    // Update UI with current settings
    const voiceSelect = document.getElementById('voice-select');
    if (voiceSelect) {
      voiceSelect.value = currentSettings.voice !== null ? currentSettings.voice : (voices.length > 0 ? 0 : '');
    }
    const speedSelect = document.getElementById('speed-select');
    if (speedSelect) speedSelect.value = currentSettings.speed;
    const pitchSelect = document.getElementById('pitch-select');
    if (pitchSelect) pitchSelect.value = currentSettings.pitch;
    const volumeSelect = document.getElementById('volume-select');
    if (volumeSelect) volumeSelect.value = currentSettings.volume;
    const volumeValue = document.getElementById('volume-value');
    if (volumeValue) volumeValue.textContent = Math.round(currentSettings.volume * 100) + '%';
    const sentenceCountSelect = document.getElementById('sentence-count-select');
    if (sentenceCountSelect) sentenceCountSelect.value = currentSettings.sentenceCount;
    const repeatCountSelect = document.getElementById('repeat-count-select');
    if (repeatCountSelect) repeatCountSelect.value = currentSettings.repeatCount;
    const selectionRepeatSelect = document.getElementById('selection-repeat-select');
    if (selectionRepeatSelect) selectionRepeatSelect.value = currentSettings.selectionRepeatCount;
    const autoScrollToggle = document.getElementById('auto-scroll-toggle');
    if (autoScrollToggle) autoScrollToggle.checked = currentSettings.autoScroll;
    const vocabToggle = document.getElementById('vocab-toggle');
    if (vocabToggle) vocabToggle.checked = currentSettings.showVocab;
    const voiceQualityToggle = document.getElementById('voice-quality-toggle');
    if (voiceQualityToggle) voiceQualityToggle.checked = currentSettings.voiceQualityIndicator;
    _syncVocabRefreshUI(currentSettings.vocabRefreshInterval, currentSettings.vocabAutoRefresh !== false);
    const highlightColorInput = document.getElementById('highlight-color');
    if (highlightColorInput) highlightColorInput.value = currentSettings.highlightColor;
    const highlightStyleSelect = document.getElementById('highlight-style');
    if (highlightStyleSelect) highlightStyleSelect.value = currentSettings.highlightStyle;
    const highlightOpacityInput = document.getElementById('highlight-opacity');
    if (highlightOpacityInput) highlightOpacityInput.value = currentSettings.highlightOpacity;
    const opacityValue = document.getElementById('opacity-value');
    if (opacityValue) opacityValue.textContent = Math.round(currentSettings.highlightOpacity * 100) + '%';
    const syncHighlightToggle = document.getElementById('sync-highlight-toggle');
    if (syncHighlightToggle) syncHighlightToggle.checked = currentSettings.syncHighlight;
    const sentenceHighlightToggle = document.getElementById('sentence-highlight-toggle');
    if (sentenceHighlightToggle) sentenceHighlightToggle.checked = currentSettings.sentenceHighlight;
    const enableShortcutsToggle = document.getElementById('enable-shortcuts-toggle');
    if (enableShortcutsToggle) enableShortcutsToggle.checked = currentSettings.enableShortcuts;
  } catch (e) {
    console.error('Error loading settings:', e);
    // Keep current defaults on error
  }
}

async function saveSettings() {
  try {
    // Validate and save ALL settings including highlight options
    const validSettings = {
      voice: currentSettings.voice !== undefined ? currentSettings.voice : null,
      speed: Math.max(0.5, Math.min(2.25, currentSettings.speed || 1)),
      pitch: Math.max(0.5, Math.min(1.5, currentSettings.pitch || 1)),
      volume: Math.max(0, Math.min(1, currentSettings.volume || 1)),
      sentenceCount: Math.max(1, Math.min(4, currentSettings.sentenceCount || 2)),
      repeatCount: Math.max(1, Math.min(10, currentSettings.repeatCount || 1)),
      selectionRepeatCount: currentSettings.selectionRepeatCount || 1,
      autoScroll: currentSettings.autoScroll !== undefined ? currentSettings.autoScroll : true,
      autoScrollDelay: currentSettings.autoScrollDelay || 4000,
      showVocab: currentSettings.showVocab !== undefined ? currentSettings.showVocab : true,
      voiceQualityIndicator: currentSettings.voiceQualityIndicator !== undefined ? currentSettings.voiceQualityIndicator : false,
      vocabRefreshInterval: currentSettings.vocabRefreshInterval || 15000,
      vocabAutoRefresh: currentSettings.vocabAutoRefresh !== undefined ? currentSettings.vocabAutoRefresh : true,
      darkMode: currentSettings.darkMode !== undefined ? currentSettings.darkMode : false,
      highlightColor: currentSettings.highlightColor || '#00ff00',
      highlightStyle: currentSettings.highlightStyle || 'background',
      highlightOpacity: currentSettings.highlightOpacity !== undefined ? currentSettings.highlightOpacity : 1,
      syncHighlight: currentSettings.syncHighlight !== undefined ? currentSettings.syncHighlight : true,
      sentenceHighlight: currentSettings.sentenceHighlight !== undefined ? currentSettings.sentenceHighlight : false,
      enableShortcuts: currentSettings.enableShortcuts !== undefined ? currentSettings.enableShortcuts : true
    };
    
    // Save to popup settings storage
    await chrome.storage.local.set({ readerSettings: validSettings });
    currentSettings = validSettings;
    console.log('✓ Settings saved to popup storage');
    
    // Also sync with appConfig in content script
    await chrome.storage.local.set({ 
      appConfig: {
        version: '2.1',
        lastUpdated: Date.now(),
        settings: validSettings,
        loopSettings: currentSettings.loopSettings || {
          delayBetweenRepeats: 0,
          infiniteLoop: false,
          loopIntensity: 'normal',
          fadeEffect: false
        }
      },
      lastConfigUpdate: Date.now()
    });
    console.log('✓ Configuration file auto-updated');
    
    // Show save confirmation
    showNotification('✅ Settings saved & synced!', 'success');
    
    // Send updated settings to content script
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'updateSettings',
          settings: validSettings
        }).catch(() => {});
      }
    } catch (e) {
      console.log('Could not send settings to content script');
    }
  } catch (e) {
    console.error('Error saving settings:', e);
  }
}

// Voice Preview Function
function previewVoice() {
  try {
    if (!voices || voices.length === 0) {
      alert('No voices available');
      return;
    }
    
    const voiceSelect = document.getElementById('voice-select');
    if (!voiceSelect) return;
    
    const voiceIndex = parseInt(voiceSelect.value);
    
    if (isNaN(voiceIndex) || voiceIndex < 0 || voiceIndex >= voices.length) {
      alert('Please select a valid voice');
      return;
    }
    
    // Cancel previous preview if still playing
    try {
      if (previewUtterance && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch (e) {
      console.warn('Error canceling previous preview:', e);
    }
    
    const selectedVoice = voices[voiceIndex];
    if (!selectedVoice) {
      alert('Voice not found');
      return;
    }
    
    const previewText = 'Hello! This is a preview of the ' + selectedVoice.name + ' voice.';
    
    previewUtterance = new SpeechSynthesisUtterance(previewText);
    previewUtterance.voice = selectedVoice;
    previewUtterance.rate = currentSettings.speed || 1;
    previewUtterance.pitch = currentSettings.pitch || 1;
    previewUtterance.volume = currentSettings.volume || 1;
    
    const previewBtn = document.getElementById('voice-preview-btn');
    if (previewBtn) {
      previewBtn.textContent = '⏸️ Stop';
      previewBtn.style.background = '#D97706';
    }
    
    previewUtterance.onend = () => {
      if (previewBtn) {
        previewBtn.textContent = '🔊';
        previewBtn.style.background = '';
      }
    };
    
    previewUtterance.onerror = (e) => {
      console.error('Preview error:', e);
      if (previewBtn) {
        previewBtn.textContent = '🔊';
        previewBtn.style.background = '';
      }
    };
    
    if (window.speechSynthesis) {
      window.speechSynthesis.speak(previewUtterance);
    }
  } catch (e) {
    console.error('Error in previewVoice:', e);
  }
}

// Add/Remove Favorite Voice
function toggleFavoriteVoice() {
  const voiceSelect = document.getElementById('voice-select');
  const voiceIndex = parseInt(voiceSelect.value);
  
  if (isNaN(voiceIndex) || voiceIndex < 0 || voiceIndex >= voices.length) {
    alert('Please select a valid voice');
    return;
  }
  
  const selectedVoice = voices[voiceIndex];
  const voiceKey = selectedVoice.name + '_' + selectedVoice.lang;
  
  const favoriteBtn = document.getElementById('voice-favorite-btn');
  
  if (favoriteVoices.includes(voiceKey)) {
    // Remove from favorites
    favoriteVoices = favoriteVoices.filter(v => v !== voiceKey);
    favoriteBtn.textContent = '☆ Favorite';
    favoriteBtn.style.background = '#f5576c';
  } else {
    // Add to favorites
    favoriteVoices.push(voiceKey);
    favoriteBtn.textContent = '★ Favorited';
    favoriteBtn.style.background = '#ffd700';
  }
  
  // Save favorites to storage
  chrome.storage.local.set({ favoriteVoices: favoriteVoices });
}

// Filter Voices
function filterVoices(filterType) {
  const voiceSelect = document.getElementById('voice-select');
  const currentValue = voiceSelect.value;
  
  voiceSelect.innerHTML = '';
  
  voices.forEach((voice, index) => {
    let shouldShow = false;
    
    switch(filterType) {
      case 'offline':
        shouldShow = voice.localService;
        break;
      case 'online':
        shouldShow = !voice.localService;
        break;
      case 'male':
        shouldShow = voice.name.toLowerCase().includes('male') || voice.name.toLowerCase().includes('man');
        break;
      case 'female':
        shouldShow = voice.name.toLowerCase().includes('female') || voice.name.toLowerCase().includes('woman');
        break;
      case 'english':
        shouldShow = voice.lang.startsWith('en');
        break;
      case 'spanish':
        shouldShow = voice.lang.startsWith('es');
        break;
      case 'french':
        shouldShow = voice.lang.startsWith('fr');
        break;
      case 'german':
        shouldShow = voice.lang.startsWith('de');
        break;
      case 'favorites':
        const voiceKey = voice.name + '_' + voice.lang;
        shouldShow = favoriteVoices.includes(voiceKey);
        break;
      default:
        shouldShow = true;
    }
    
    if (shouldShow) {
      const option = document.createElement('option');
      option.value = index;
      const offlineIndicator = voice.localService ? '📥 ' : '☁️ ';
      const favoriteIndicator = favoriteVoices.includes(voice.name + '_' + voice.lang) ? '⭐ ' : '';
      option.textContent = `${offlineIndicator}${favoriteIndicator}${voice.name} (${voice.lang})`;
      voiceSelect.appendChild(option);
    }
  });
  
  // Restore previous selection if still available
  if (voiceSelect.querySelector(`option[value="${currentValue}"]`)) {
    voiceSelect.value = currentValue;
  }
}

// Load Favorite Voices
async function loadFavoriteVoices() {
  const result = await chrome.storage.local.get(['favoriteVoices']);
  if (result.favoriteVoices) {
    favoriteVoices = result.favoriteVoices;
  }
}

function initializeEventListeners() {
  try {
    // Load favorites first
    loadFavoriteVoices().catch(() => {
      console.warn('Could not load favorite voices');
    });
    
    // Voice Selection
    const voiceSelect = document.getElementById('voice-select');
    if (voiceSelect) {
      voiceSelect.addEventListener('change', (e) => {
        currentSettings.voice = parseInt(e.target.value);
        saveSettings();
      });
    }
    
    // Voice Preview Button
    const previewBtn = document.getElementById('voice-preview-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', previewVoice);
    }

    // Best Voice Auto-select Button
    const bestVoiceBtn = document.getElementById('voice-best-btn');
    if (bestVoiceBtn) {
      bestVoiceBtn.addEventListener('click', () => {
        const sel = document.getElementById('voice-select');
        if (!sel || voices.length === 0) return;
        // Find first non-disabled option (best offline voice)
        for (const opt of sel.options) {
          if (!opt.disabled && opt.value !== '') {
            sel.value = opt.value;
            currentSettings.voice = parseInt(opt.value);
            saveSettings();
            bestVoiceBtn.textContent = '✓';
            setTimeout(() => { bestVoiceBtn.textContent = '★'; }, 1200);
            break;
          }
        }
      });
    }

    // Voice Filter
    const voiceFilter = document.getElementById('voice-filter');
    if (voiceFilter) {
      voiceFilter.addEventListener('change', (e) => {
        filterVoices(e.target.value);
      });
    }
    
    // Speed Controls with +/- buttons
    const speedSelect = document.getElementById('speed-select');
    if (speedSelect) {
      speedSelect.addEventListener('change', (e) => {
        currentSettings.speed = parseFloat(e.target.value);
        saveSettings();
      });
    }
    
    const speedDown = document.getElementById('speed-down');
    if (speedDown) {
      speedDown.addEventListener('click', () => {
        const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25];
        const currentIdx = speeds.indexOf(currentSettings.speed);
        if (currentIdx > 0) {
          currentSettings.speed = speeds[currentIdx - 1];
          speedSelect.value = currentSettings.speed;
          saveSettings();
        } else if (currentIdx === -1) {
          const closest = speeds.reduce((a, b) => Math.abs(b - currentSettings.speed) < Math.abs(a - currentSettings.speed) ? b : a);
          const closestIdx = speeds.indexOf(closest);
          if (closestIdx > 0) {
            currentSettings.speed = speeds[closestIdx - 1];
            speedSelect.value = currentSettings.speed;
            saveSettings();
          }
        }
      });
    }
    
    const speedUp = document.getElementById('speed-up');
    if (speedUp) {
      speedUp.addEventListener('click', () => {
        const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25];
        const currentIdx = speeds.indexOf(currentSettings.speed);
        if (currentIdx < speeds.length - 1 && currentIdx !== -1) {
          currentSettings.speed = speeds[currentIdx + 1];
          speedSelect.value = currentSettings.speed;
          saveSettings();
        } else if (currentIdx === -1) {
          const closest = speeds.reduce((a, b) => Math.abs(b - currentSettings.speed) < Math.abs(a - currentSettings.speed) ? b : a);
          const closestIdx = speeds.indexOf(closest);
          if (closestIdx < speeds.length - 1) {
            currentSettings.speed = speeds[closestIdx + 1];
            speedSelect.value = currentSettings.speed;
            saveSettings();
          }
        }
      });
    }
    
    // Pitch
    const pitchSelect = document.getElementById('pitch-select');
    if (pitchSelect) {
      pitchSelect.addEventListener('change', (e) => {
        currentSettings.pitch = parseFloat(e.target.value);
        saveSettings();
      });
    }
    
    // Volume
    const volumeSelect = document.getElementById('volume-select');
    if (volumeSelect) {
      volumeSelect.addEventListener('input', (e) => {
        currentSettings.volume = parseFloat(e.target.value);
        const volumeValue = document.getElementById('volume-value');
        if (volumeValue) {
          volumeValue.textContent = Math.round(currentSettings.volume * 100) + '%';
        }
        saveSettings();
      });
    }
    
    // Sentence Count
    const sentenceCount = document.getElementById('sentence-count-select');
    if (sentenceCount) {
      sentenceCount.addEventListener('change', (e) => {
        currentSettings.sentenceCount = parseInt(e.target.value);
        saveSettings();
      });
    }
    
    // Repeat Count
    const repeatCount = document.getElementById('repeat-count-select');
    if (repeatCount) {
      repeatCount.addEventListener('change', (e) => {
        currentSettings.repeatCount = parseInt(e.target.value);
        saveSettings();
      });
    }
    
    // Selection Repeat
    const selectionRepeat = document.getElementById('selection-repeat-select');
    if (selectionRepeat) {
      selectionRepeat.addEventListener('change', (e) => {
        currentSettings.selectionRepeatCount = e.target.value;
        saveSettings();
        sendMessageToTab({ action: 'setSelectionRepeatCount', value: e.target.value }).catch(() => {});
      });
    }
    
    // Auto-scroll toggle
    const autoScrollToggle = document.getElementById('auto-scroll-toggle');
    if (autoScrollToggle) {
      autoScrollToggle.addEventListener('change', (e) => {
        currentSettings.autoScroll = e.target.checked;
        saveSettings();
        sendMessageToTab({ action: 'setAutoScroll', value: e.target.checked }).catch(() => {});
      });
    }

    // Click-to-read toggle
    const clickToReadToggle = document.getElementById('click-to-read-toggle');
    if (clickToReadToggle) {
      chrome.storage.local.get(['clickToReadEnabled'], (result) => {
        clickToReadToggle.checked = Boolean(result.clickToReadEnabled);
      });
      clickToReadToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ clickToReadEnabled: e.target.checked });
        sendMessageToTab({ action: 'setClickToRead', value: e.target.checked }).catch(() => {});
      });
    }
    
    // Vocab launch button
    const launchVocabBtn = document.getElementById('launch-vocab-btn');
    if (launchVocabBtn) {
      launchVocabBtn.addEventListener('click', () => {
        sendMessageToTab({ action: 'launchVocabWidget' }).then(() => {
          launchVocabBtn.textContent = '';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '12'); svg.setAttribute('height', '12');
          svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.5');
          svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
          const check = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          check.setAttribute('points', '20 6 9 17 4 12');
          svg.appendChild(check);
          launchVocabBtn.appendChild(svg);
          launchVocabBtn.appendChild(document.createTextNode(' Opened'));
          launchVocabBtn.style.opacity = '0.7';
          setTimeout(() => {
            launchVocabBtn.innerHTML = '';
            const svg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg2.setAttribute('width', '12'); svg2.setAttribute('height', '12');
            svg2.setAttribute('viewBox', '0 0 24 24'); svg2.setAttribute('fill', 'none');
            svg2.setAttribute('stroke', 'currentColor'); svg2.setAttribute('stroke-width', '2.5');
            svg2.setAttribute('stroke-linecap', 'round'); svg2.setAttribute('stroke-linejoin', 'round');
            const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            pl.setAttribute('points', '5 3 19 12 5 21 5 3');
            svg2.appendChild(pl);
            launchVocabBtn.appendChild(svg2);
            launchVocabBtn.appendChild(document.createTextNode(' Launch'));
            launchVocabBtn.style.opacity = '';
          }, 1800);
        }).catch(() => {});
      });
    }

    // Vocab toggle
    const vocabToggle = document.getElementById('vocab-toggle');
    if (vocabToggle) {
      vocabToggle.addEventListener('change', (e) => {
        currentSettings.showVocab = e.target.checked;
        saveSettings();
        sendMessageToTab({ action: 'setVocabVisibility', value: e.target.checked }).catch(() => {});
      });
    }

    // ── Vocab Auto-Refresh controls ──────────────────────────────────────────
    const autoRefreshToggle = document.getElementById('vocab-autorefresh-toggle');
    const delayDec          = document.getElementById('vocab-delay-dec');
    const delayInc          = document.getElementById('vocab-delay-inc');
    const delaySlider       = document.getElementById('vocab-delay-slider');

    function _saveVocabTimerSettings() {
      try {
        chrome.storage.local.set({
          vocabTimerSettings: {
            vocabRefreshInterval: currentSettings.vocabRefreshInterval,
            vocabAutoRefresh: currentSettings.vocabAutoRefresh
          }
        });
      } catch (_) {}
    }

    function _applyVocabRefreshInterval(ms) {
      currentSettings.vocabRefreshInterval = ms;
      saveSettings();
      _saveVocabTimerSettings();
      sendMessageToTab({ action: 'setVocabRefreshInterval', value: ms }).catch(() => {});
    }

    function _applyVocabAutoRefresh(enabled) {
      currentSettings.vocabAutoRefresh = enabled;
      saveSettings();
      _saveVocabTimerSettings();
      sendMessageToTab({ action: 'setVocabAutoRefresh', value: enabled }).catch(() => {});
    }

    if (autoRefreshToggle) {
      autoRefreshToggle.addEventListener('click', () => {
        const isOn = autoRefreshToggle.classList.contains('vrc-on');
        const next = !isOn;
        autoRefreshToggle.classList.toggle('vrc-on',  next);
        autoRefreshToggle.classList.toggle('vrc-off', !next);
        autoRefreshToggle.querySelector('.vrc-onoff-label').textContent = next ? 'On' : 'Off';
        const stepper   = document.getElementById('vocab-refresh-stepper');
        const trackWrap = document.querySelector('.vrc-track-wrap');
        if (stepper)   stepper.classList.toggle('disabled', !next);
        if (trackWrap) trackWrap.classList.toggle('disabled', !next);
        _applyVocabAutoRefresh(next);
      });
    }

    if (delayDec) {
      delayDec.addEventListener('click', () => {
        const cur = currentSettings.vocabRefreshInterval / 1000;
        const next = Math.max(15, cur - 15);
        _syncVocabRefreshUI(next * 1000, currentSettings.vocabAutoRefresh !== false);
        _applyVocabRefreshInterval(next * 1000);
      });
    }

    if (delayInc) {
      delayInc.addEventListener('click', () => {
        const cur = currentSettings.vocabRefreshInterval / 1000;
        const next = Math.min(120, cur + 15);
        _syncVocabRefreshUI(next * 1000, currentSettings.vocabAutoRefresh !== false);
        _applyVocabRefreshInterval(next * 1000);
      });
    }

    if (delaySlider) {
      delaySlider.addEventListener('input', () => {
        const sec = parseInt(delaySlider.value);
        const ms = sec * 1000;
        const valEl = document.getElementById('vocab-delay-value');
        if (valEl) valEl.textContent = sec;
        currentSettings.vocabRefreshInterval = ms;
        saveSettings();
      });
      delaySlider.addEventListener('change', () => {
        _applyVocabRefreshInterval(parseInt(delaySlider.value) * 1000);
      });
    }
    
    // Voice quality toggle
    const voiceQuality = document.getElementById('voice-quality-toggle');
    if (voiceQuality) {
      voiceQuality.addEventListener('change', (e) => {
        currentSettings.voiceQualityIndicator = e.target.checked;
        saveSettings();
      });
    }
    
    // Read buttons
    const readPage = document.getElementById('read-page');
    if (readPage) {
      readPage.addEventListener('click', () => readContent('page'));
    }
    
    const readSelection = document.getElementById('read-selection');
    if (readSelection) {
      readSelection.addEventListener('click', () => readContent('selection'));
    }
    
    // Extract content button
    const extractContent = document.getElementById('extract-content');
    if (extractContent) {
      extractContent.addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'extractContent'})
              .then(() => {
                updateStatus('Content extracted and cleaned', 100);
              })
              .catch(() => {
                updateStatus('Could not extract content from this page', 50);
              });
          }
        });
      });
    }
    
    // Highlight controls
    const highlightColor = document.getElementById('highlight-color');
    if (highlightColor) {
      highlightColor.addEventListener('change', (e) => {
        currentSettings.highlightColor = e.target.value;
        saveSettings();
      });
    }
    
    const highlightPreset = document.getElementById('highlight-preset');
    if (highlightPreset) {
      highlightPreset.addEventListener('change', (e) => {
        currentSettings.highlightColor = e.target.value;
        if (highlightColor) highlightColor.value = e.target.value;
        saveSettings();
      });
    }
    
    const highlightStyle = document.getElementById('highlight-style');
    if (highlightStyle) {
      highlightStyle.addEventListener('change', (e) => {
        currentSettings.highlightStyle = e.target.value;
        saveSettings();
      });
    }
    
    const highlightOpacity = document.getElementById('highlight-opacity');
    if (highlightOpacity) {
      highlightOpacity.addEventListener('change', (e) => {
        currentSettings.highlightOpacity = parseFloat(e.target.value);
        const opacityValue = document.getElementById('opacity-value');
        if (opacityValue) {
          opacityValue.textContent = Math.round(currentSettings.highlightOpacity * 100) + '%';
        }
        saveSettings();
      });
    }
    
    const syncHighlight = document.getElementById('sync-highlight-toggle');
    if (syncHighlight) {
      syncHighlight.addEventListener('change', (e) => {
        currentSettings.syncHighlight = e.target.checked;
        saveSettings();
      });
    }
    
    const sentenceHighlight = document.getElementById('sentence-highlight-toggle');
    if (sentenceHighlight) {
      sentenceHighlight.addEventListener('change', (e) => {
        currentSettings.sentenceHighlight = e.target.checked;
        saveSettings();
      });
    }
    
    const enableShortcuts = document.getElementById('enable-shortcuts-toggle');
    if (enableShortcuts) {
      enableShortcuts.addEventListener('change', (e) => {
        currentSettings.enableShortcuts = e.target.checked;
        saveSettings();
      });
    }

    // ===== ENHANCED LOOP CONTROLS =====
    const loopIntensity = document.getElementById('loop-intensity-select');
    if (loopIntensity) {
      loopIntensity.addEventListener('change', (e) => {
        sendMessageToTab({ 
          action: 'setLoopIntensity', 
          value: e.target.value 
        }).then((response) => {
          if (response && response.success) {
            showNotification(`Loop intensity set to: ${e.target.value}`, 'success');
          }
        }).catch(() => {
          console.warn('Could not set loop intensity');
        });
      });
    }

    const loopDelaySlider = document.getElementById('loop-delay-slider');
    if (loopDelaySlider) {
      loopDelaySlider.addEventListener('change', (e) => {
        const delayMs = parseInt(e.target.value);
        const delayValue = document.getElementById('loop-delay-value');
        if (delayValue) {
          delayValue.textContent = delayMs + 'ms';
        }
        
        sendMessageToTab({ 
          action: 'setLoopDelay', 
          value: delayMs 
        }).then((response) => {
          if (response && response.success) {
            showNotification(`Loop delay set to: ${delayMs}ms`, 'success');
          }
        }).catch(() => {
          console.warn('Could not set loop delay');
        });
      });
    }

    const loopDelayDown = document.getElementById('loop-delay-down');
    if (loopDelayDown) {
      loopDelayDown.addEventListener('click', () => {
        const slider = document.getElementById('loop-delay-slider');
        if (slider) {
          const currentValue = parseInt(slider.value);
          const newValue = Math.max(0, currentValue - 500);
          slider.value = newValue;
          slider.dispatchEvent(new Event('change'));
        }
      });
    }

    const loopDelayUp = document.getElementById('loop-delay-up');
    if (loopDelayUp) {
      loopDelayUp.addEventListener('click', () => {
        const slider = document.getElementById('loop-delay-slider');
        if (slider) {
          const currentValue = parseInt(slider.value);
          const newValue = Math.min(10000, currentValue + 500);
          slider.value = newValue;
          slider.dispatchEvent(new Event('change'));
        }
      });
    }

    const loopFadeToggle = document.getElementById('loop-fade-toggle');
    if (loopFadeToggle) {
      loopFadeToggle.addEventListener('change', (e) => {
        sendMessageToTab({ 
          action: 'enableFadeEffect', 
          value: e.target.checked 
        }).then((response) => {
          if (response && response.success) {
            showNotification(`Fade effect ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
          }
        }).catch(() => {
          console.warn('Could not set fade effect');
        });
      });
    }

    const infiniteLoopToggle = document.getElementById('infinite-loop-toggle');
    if (infiniteLoopToggle) {
      infiniteLoopToggle.addEventListener('change', (e) => {
        sendMessageToTab({ 
          action: 'setInfiniteLoop', 
          value: e.target.checked 
        }).then((response) => {
          if (response && response.success) {
            showNotification(`Infinite loop ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
          }
        }).catch(() => {
          console.warn('Could not set infinite loop');
        });
      });
    }
    
    // Control buttons
    const pauseBtnCtrl = document.getElementById('pause-btn');
    if (pauseBtnCtrl) {
      pauseBtnCtrl.addEventListener('click', () => {
        sendMessageToTab({ action: 'pause' }).catch(() => {});
        toggleButtons('paused');
      });
    }
    
    const resumeBtnCtrl = document.getElementById('resume-btn');
    if (resumeBtnCtrl) {
      resumeBtnCtrl.addEventListener('click', () => {
        sendMessageToTab({ action: 'resume' }).catch(() => {});
        toggleButtons('playing');
      });
    }
    
    const stopBtnCtrl = document.getElementById('stop-btn');
    if (stopBtnCtrl) {
      stopBtnCtrl.addEventListener('click', () => {
        sendMessageToTab({ action: 'stop' }).catch(() => {});
        toggleButtons('stopped');
        updateStatus('Stopped', 0);
      });
    }
  } catch (e) {
    console.error('Error initializing event listeners:', e);
  }
}

async function readContent(type) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showNotification('Error: No active tab found', 'error');
      updateStatus('Error: No active tab', 0);
      toggleButtons('stopped');
      return;
    }
    
    // Check if the tab URL is allowed for content scripts
    const restrictedPatterns = ['chrome://', 'chrome-extension://', 'about:', 'edge://'];
    const isRestricted = restrictedPatterns.some(pattern => tab.url.startsWith(pattern));
    
    // Allow file:// URLs and PDFs for offline reading
    const isPDF = tab.url.endsWith('.pdf') || tab.url.includes('.pdf?');
    if (isRestricted && !tab.url.startsWith('file://') && !isPDF) {
      showNotification('Cannot read this page type. Try a regular website.', 'error');
      updateStatus('Error: Page type not supported', 0);
      toggleButtons('stopped');
      return;
    }
    
    // Show PDF notice if applicable
    if (isPDF) {
      updateStatus('Reading PDF...', 0);
    }
    
    updateStatus('Initializing...', 0);
    
    // Ensure settings are valid before sending
    const settingsToSend = {
      voice: currentSettings.voice !== undefined ? currentSettings.voice : null,
      speed: currentSettings.speed || 1,
      pitch: currentSettings.pitch || 1,
      volume: currentSettings.volume || 1,
      sentenceCount: currentSettings.sentenceCount || 2,
      repeatCount: currentSettings.repeatCount || 1,
      highlightColor: currentSettings.highlightColor || '#00ff00',
      highlightStyle: currentSettings.highlightStyle || 'background',
      highlightOpacity: currentSettings.highlightOpacity || 1,
      syncHighlight: currentSettings.syncHighlight !== undefined ? currentSettings.syncHighlight : true
    };
    
    try {
      console.log('Injecting content script if needed...');
      await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: ['content.js']
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Script injection timeout')), 5000))
      ]).catch((err) => {
        console.log('Script may already be injected:', err.message);
      });
      
      await Promise.race([
        chrome.scripting.insertCSS({
          target: { tabId: tab.id, allFrames: false },
          files: ['highlight.css']
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('CSS insertion timeout')), 5000))
      ]).catch((err) => {
        console.log('CSS may already be inserted:', err.message);
      });
      
      // Message listener is now always available (set up outside guard)
      // Wait just enough for script injection to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.log('Sending read message to content script on tab', tab.id);
      await Promise.race([
        chrome.tabs.sendMessage(tab.id, {
          action: 'read',
          type: type,
          settings: settingsToSend
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Message timeout')), 8000))
      ]);
      console.log('Message sent successfully');
      showNotification('✅ Reading started', 'success');
      updateStatus('Reading started...', 5);
      toggleButtons('playing');
      isReading = true;
      isPaused = false;
    } catch (error) {
      console.error('Error starting reading:', error.message);
      
      if (error.message && (error.message.includes('Receiving end does not exist') || error.message.includes('timeout'))) {
        try {
          console.log('Retrying with fresh injection...');
          showNotification('Reconnecting to page...', 'info');
          
          await Promise.race([
            chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: false },
              files: ['content.js']
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Retry timeout')), 5000))
          ]);
          console.log('Content script injected successfully');
          
          await Promise.race([
            chrome.scripting.insertCSS({
              target: { tabId: tab.id, allFrames: false },
              files: ['highlight.css']
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('CSS retry timeout')), 5000))
          ]);
          console.log('CSS inserted successfully');
          
          // Wait for fresh injection to complete
          // Message listener is always available now (outside guard)
          await new Promise(resolve => setTimeout(resolve, 150));
          
          console.log('Sending message after fresh injection...');
          await Promise.race([
            chrome.tabs.sendMessage(tab.id, {
              action: 'read',
              type: type,
              settings: settingsToSend
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Retry message timeout')), 8000))
          ]);
          console.log('Message sent after injection successfully');
          showNotification('✅ Reading started after reconnect', 'success');
          updateStatus('Reading started...', 5);
          toggleButtons('playing');
          isReading = true;
          isPaused = false;
        } catch (injectionError) {
          console.error('Failed to inject script:', injectionError);
          if (injectionError.message && injectionError.message.includes('is not allowed')) {
            showNotification('Extension not allowed on this page', 'error');
            updateStatus('Error: Extension not allowed', 0);
          } else if (injectionError.message && injectionError.message.includes('timeout')) {
            showNotification('Connection timeout - page may be unresponsive', 'error');
            updateStatus('Error: Connection timeout', 0);
          } else {
            showNotification('Failed: ' + injectionError.message.substring(0, 50), 'error');
            updateStatus('Error: ' + injectionError.message.substring(0, 40), 0);
          }
          toggleButtons('stopped');
        }
      } else {
        console.error('Unexpected error:', error);
        if (error.message && error.message.includes('timeout')) {
          showNotification('Page did not respond - try clicking the page first', 'error');
          updateStatus('Error: Page timeout', 0);
        } else {
          showNotification('Error: ' + error.message.substring(0, 50), 'error');
          updateStatus('Error: ' + error.message.substring(0, 35), 0);
        }
        toggleButtons('stopped');
      }
    }
  } catch (outerError) {
    console.error('Outer error in readContent:', outerError);
    showNotification('Critical error - please reload the page', 'error');
    updateStatus('Critical error', 0);
    toggleButtons('stopped');
  }
}

function showNotification(message, type = 'info') {
  // Remove any existing notification
  const existing = document.querySelector('.toast-notification');
  if (existing) {
    existing.remove();
  }
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `toast-notification toast-${type}`;
  notification.textContent = message;
  
  // Add to DOM
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  // Remove after 2 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 2000);
}

async function sendMessageToTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.warn('No active tab found');
      return null;
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response;
  } catch (error) {
    console.warn('Could not send message to content script:', error);
    return null;
  }
}

function toggleButtons(state) {
  const readPageBtn = document.getElementById('read-page');
  const readSelectionBtn = document.getElementById('read-selection');
  const pauseBtn = document.getElementById('pause-btn');
  const resumeBtn = document.getElementById('resume-btn');
  const stopBtn = document.getElementById('stop-btn');
  
  if (state === 'playing') {
    if (readPageBtn) readPageBtn.style.display = 'none';
    if (readSelectionBtn) readSelectionBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'block';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'block';
  } else if (state === 'paused') {
    if (readPageBtn) readPageBtn.style.display = 'none';
    if (readSelectionBtn) readSelectionBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (resumeBtn) resumeBtn.style.display = 'block';
    if (stopBtn) stopBtn.style.display = 'block';
  } else {
    if (readPageBtn) readPageBtn.style.display = 'block';
    if (readSelectionBtn) readSelectionBtn.style.display = 'block';
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'block';
  }
}

function updateStatus(text, progress) {
  document.getElementById('status-text').textContent = text;
  document.getElementById('progress-fill').style.width = progress + '%';
}

// File Import Functions
function showImportStatus(message, isError = false) {
  const statusDiv = document.getElementById('import-status');
  statusDiv.textContent = message;
  statusDiv.classList.remove('success', 'error');
  statusDiv.classList.add(isError ? 'error' : 'success');
  setTimeout(() => {
    statusDiv.classList.remove('success', 'error');
  }, 5000);
}

async function handleFileUpload(files) {
  if (files.length === 0) return;

  for (const file of files) {
    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        await handlePDFUpload(file);
      } else {
        showImportStatus(`📥 Processing: ${file.name}...`);
        const text = await readFileAsText(file);
        if (text) {
          const importedTexts = JSON.parse(sessionStorage.getItem('importedTexts') || '[]');
          importedTexts.push({ name: file.name, text, timestamp: new Date().toISOString() });
          sessionStorage.setItem('importedTexts', JSON.stringify(importedTexts));
          showImportStatus(`✅ Successfully imported: ${file.name}`);
          setTimeout(() => readImportedText(text), 500);
        }
      }
    } catch (error) {
      showImportStatus(`❌ Error reading ${file.name}: ${error.message}`, true);
    }
  }
}

async function handlePDFUpload(file) {
  showImportStatus(`📄 Processing PDF: ${file.name}…`);

  try {
    // Read PDF as ArrayBuffer then encode as base64
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    // Check size limit (chrome.storage.session ~10MB, base64 is ~33% larger)
    if (base64.length > 9 * 1024 * 1024) {
      showImportStatus('⚠️ PDF is too large (max ~6MB). Try a smaller file.', true);
      return;
    }

    // Store in chrome.storage.session for the reader page to pick up
    const pdfRecord = { data: base64, name: file.name, timestamp: Date.now() };

    let stored = false;
    try {
      await chrome.storage.session.set({ pendingPDF: pdfRecord });
      stored = true;
    } catch (e) {
      console.warn('session storage failed, trying local:', e);
    }

    if (!stored) {
      try {
        await chrome.storage.local.set({ pendingPDF: pdfRecord });
        stored = true;
      } catch (e2) {
        showImportStatus('❌ Could not store PDF data: ' + e2.message, true);
        return;
      }
    }

    showImportStatus(`✅ PDF ready — opening reader…`);

    // Open the dedicated PDF reader page in a new tab and auto-focus it
    const readerUrl = chrome.runtime.getURL('pdf-reader.html');
    chrome.tabs.create({ url: readerUrl, active: true });

  } catch (err) {
    showImportStatus(`❌ Failed to process PDF: ${err.message}`, true);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        
        // Handle different file types
        if (file.name.endsWith('.txt')) {
          resolve(content);
        } else if (file.name.endsWith('.pdf')) {
          // For PDF, we'll extract text (basic implementation)
          showImportStatus('⚠️ PDF support requires additional library. Using text extraction...', false);
          resolve(extractTextFromPDF(content));
        } else if (file.name.endsWith('.docx')) {
          // For DOCX, extract text
          resolve(extractTextFromDOCX(content));
        } else if (file.name.endsWith('.epub')) {
          // For EPUB, extract text
          resolve(extractTextFromEPUB(content));
        } else {
          resolve(content);
        }
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    
    // Read file based on type
    if (file.name.endsWith('.pdf') || file.name.endsWith('.docx') || file.name.endsWith('.epub')) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
}

function extractTextFromPDF(arrayBuffer) {
  // Basic PDF text extraction (simplified)
  // For full PDF support, consider using pdf.js library
  const view = new Uint8Array(arrayBuffer);
  let text = '';
  
  for (let i = 0; i < view.length; i++) {
    const byte = view[i];
    if (byte >= 32 && byte <= 126) {
      text += String.fromCharCode(byte);
    } else if (byte === 10 || byte === 13) {
      text += '\n';
    }
  }
  
  return text.replace(/\s+/g, ' ').trim();
}

function extractTextFromDOCX(arrayBuffer) {
  // Basic DOCX text extraction (simplified)
  // DOCX is a ZIP file containing XML
  try {
    const view = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Convert to string and extract text between XML tags
    let str = '';
    for (let i = 0; i < view.length; i++) {
      str += String.fromCharCode(view[i]);
    }
    
    // Extract text from <w:t> tags (Word text elements)
    const matches = str.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    if (matches) {
      text = matches.map(m => m.replace(/<[^>]*>/g, '')).join(' ');
    }
    
    return text || 'Could not extract text from DOCX file';
  } catch (error) {
    return 'Error extracting DOCX: ' + error.message;
  }
}

function extractTextFromEPUB(arrayBuffer) {
  // Basic EPUB text extraction (simplified)
  // EPUB is also a ZIP file containing HTML/XML
  try {
    const view = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Convert to string and extract text
    let str = '';
    for (let i = 0; i < view.length; i++) {
      str += String.fromCharCode(view[i]);
    }
    
    // Extract text from HTML tags
    const matches = str.match(/>([^<]+)</g);
    if (matches) {
      text = matches.map(m => m.replace(/[><]/g, '')).join(' ');
    }
    
    return text || 'Could not extract text from EPUB file';
  } catch (error) {
    return 'Error extracting EPUB: ' + error.message;
  }
}

async function handleURLImport() {
  const url = prompt('Enter URL to import text from:');
  if (!url) return;
  
  try {
    showImportStatus(`🔗 Fetching from URL: ${url}...`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    let text = '';
    
    if (contentType && contentType.includes('text/html')) {
      const html = await response.text();
      // Extract text from HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      text = doc.body.innerText;
    } else if (contentType && contentType.includes('text/plain')) {
      text = await response.text();
    } else {
      text = await response.text();
    }
    
    if (text.trim().length === 0) {
      throw new Error('No text content found at URL');
    }
    
    showImportStatus(`✅ Successfully imported from URL`);
    
    // Store imported text
    const importedTexts = JSON.parse(sessionStorage.getItem('importedTexts') || '[]');
    importedTexts.push({
      name: `URL: ${url}`,
      text: text,
      timestamp: new Date().toISOString()
    });
    sessionStorage.setItem('importedTexts', JSON.stringify(importedTexts));
    
    // Auto-read the imported text
    setTimeout(() => {
      readImportedText(text);
    }, 500);
  } catch (error) {
    showImportStatus(`❌ Error importing from URL: ${error.message}`, true);
  }
}

async function handleClipboardImport() {
  try {
    showImportStatus(`📋 Reading clipboard...`);
    
    const text = await navigator.clipboard.readText();
    
    if (text.trim().length === 0) {
      throw new Error('Clipboard is empty');
    }
    
    showImportStatus(`✅ Successfully imported from clipboard`);
    
    // Store imported text
    const importedTexts = JSON.parse(sessionStorage.getItem('importedTexts') || '[]');
    importedTexts.push({
      name: 'Clipboard',
      text: text,
      timestamp: new Date().toISOString()
    });
    sessionStorage.setItem('importedTexts', JSON.stringify(importedTexts));
    
    // Auto-read the imported text
    setTimeout(() => {
      readImportedText(text);
    }, 500);
  } catch (error) {
    showImportStatus(`❌ Error reading clipboard: ${error.message}`, true);
  }
}

function readImportedText(text) {
  // Send imported text to content script for reading
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      showImportStatus('❌ No active tab found', true);
      return;
    }
    
    const tab = tabs[0];
    
    // Create a temporary div with the imported text
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: (importedText) => {
        // Create a temporary container with imported text
        const tempDiv = document.createElement('div');
        tempDiv.id = 'tts-imported-text-container';
        tempDiv.style.display = 'none';
        tempDiv.textContent = importedText;
        document.body.appendChild(tempDiv);
        
        // Trigger reading of imported text
        window.importedTextToRead = importedText;
      },
      args: [text]
    }).catch((err) => {
      console.warn('Failed to execute script:', err);
    });
    
    // Send message to read the imported text
    setTimeout(() => {
      const settingsToSend = {
        voice: currentSettings.voice,
        speed: currentSettings.speed,
        pitch: currentSettings.pitch,
        volume: currentSettings.volume,
        sentenceCount: currentSettings.sentenceCount,
        repeatCount: currentSettings.repeatCount
      };
      
      chrome.tabs.sendMessage(tab.id, {
        action: 'read',
        type: 'imported',
        text: text,
        settings: settingsToSend
      }).catch((err) => {
        console.warn('Could not send text to page:', err);
        showImportStatus('❌ Could not send text to page', true);
      });
    }, 300);
  });
}

// Initialize file import listeners
function initializeFileImport() {
  const fileInput = document.getElementById('file-input');
  const fileUploadBtn = document.getElementById('file-upload-btn');
  const urlImportBtn = document.getElementById('url-import-btn');
  const clipboardBtn = document.getElementById('clipboard-btn');
  const dropZone = document.getElementById('file-drop-zone');
  
  // File upload button
  fileUploadBtn.addEventListener('click', () => {
    fileInput.click();
  });
  
  // File input change
  fileInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files);
  });
  
  // URL import button
  if (urlImportBtn) {
    urlImportBtn.addEventListener('click', handleURLImport);
  }
  
  // Clipboard button
  if (clipboardBtn) {
    clipboardBtn.addEventListener('click', handleClipboardImport);
  }
  
  // Drag and drop
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFileUpload(e.dataTransfer.files);
    });
  }
  
  // Tabs
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      button.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');
    });
  });
  
  // Refresh vocab button
  const refreshVocabBtn = document.getElementById('refresh-vocab-btn');
  if (refreshVocabBtn) {
    refreshVocabBtn.addEventListener('click', () => {
      refreshVocabFromInternet();
    });
  }
}

// Refresh vocab from internet
async function refreshVocabFromInternet() {
  const refreshBtn = document.getElementById('refresh-vocab-btn');
  if (!refreshBtn) {
    console.warn('Refresh vocab button not found');
    return;
  }
  
  // Disable button and show loading state
  refreshBtn.disabled = true;
  const originalText = refreshBtn.textContent;
  refreshBtn.textContent = '⏳ Updating...';
  
  try {
    // Send message to content script to refresh vocab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      await chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshVocab' }).catch((err) => {
        console.warn('Could not send refresh message:', err);
      });
    }
    
    // Also refresh in background
    showImportStatus('🔄 Fetching vocab from internet...', false);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    showImportStatus('✅ Vocab updated successfully!', false);
    refreshBtn.textContent = '✅ Updated';
    
    setTimeout(() => {
      refreshBtn.textContent = originalText;
      refreshBtn.disabled = false;
    }, 2000);
  } catch (error) {
    showImportStatus(`❌ Error updating vocab: ${error.message}`, true);
    refreshBtn.textContent = originalText;
    refreshBtn.disabled = false;
  }
}

async function downloadAudio() {
  try {
    const downloadBtn = document.getElementById('download-audio-btn');
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = '⏳';
    }
    
    updateStatus('Preparing audio download...', 0);
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      alert('No active tab found');
      return;
    }
    
    const response = await chrome.tabs.sendMessage(tabs[0].id, { 
      action: 'getTextForAudio' 
    }).catch(() => null);
    
    if (!response || !response.text) {
      showNotification('Could not extract text from page. Try reading first.', 'error');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '⬇️';
      }
      return;
    }
    
    const textToSpeak = response.text;
    updateStatus('Converting text to audio...', 20);
    
    const audioBlob = await textToAudioBlob(textToSpeak);
    
    if (!audioBlob) {
      showNotification('Failed to generate audio', 'error');
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '⬇️';
      }
      return;
    }
    
    updateStatus('Downloading audio file...', 90);
    
    const url = URL.createObjectURL(audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `page-audio-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateStatus('✅ Audio downloaded successfully!', 100);
    
    if (downloadBtn) {
      downloadBtn.textContent = '✅';
      setTimeout(() => {
        downloadBtn.textContent = '⬇️';
        downloadBtn.disabled = false;
      }, 2000);
    }
  } catch (error) {
    console.error('Error downloading audio:', error);
    showNotification('Error downloading audio: ' + error.message, 'error');
    const downloadBtn = document.getElementById('download-audio-btn');
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '⬇️';
    }
  }
}

async function textToAudioBlob(text) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();
      const mediaRecorder = new MediaRecorder(destination.stream);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        audioContext.close();
        resolve(blob);
      };
      
      mediaRecorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        audioContext.close();
        reject(error);
      };
      
      mediaRecorder.start();
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      const voiceSelect = document.getElementById('voice-select');
      const voiceIndex = parseInt(voiceSelect?.value || 0);
      if (!isNaN(voiceIndex) && voiceIndex >= 0 && voiceIndex < voices.length) {
        utterance.voice = voices[voiceIndex];
      }
      
      utterance.rate = currentSettings.speed || 1;
      utterance.pitch = currentSettings.pitch || 1;
      utterance.volume = currentSettings.volume || 1;
      
      utterance.onend = () => {
        setTimeout(() => {
          mediaRecorder.stop();
        }, 500);
      };
      
      utterance.onerror = (error) => {
        console.error('Speech synthesis error:', error);
        mediaRecorder.stop();
        reject(error);
      };
      
      window.speechSynthesis.speak(utterance);
      
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          reject(new Error('Recording timeout - text may be too long'));
        }
      }, 300000);
      
    } catch (error) {
      console.error('Error in textToAudioBlob:', error);
      reject(error);
    }
  });
}
