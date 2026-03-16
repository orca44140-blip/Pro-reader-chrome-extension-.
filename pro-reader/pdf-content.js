console.log('PDF Text Reader content script loading - Enhanced Version');

if (window.__TTSPDFReaderLoaded) {
  console.log('PDF content script already loaded, skipping');
} else {
  window.__TTSPDFReaderLoaded = true;

// ===== ENHANCED PDF STATE MANAGEMENT =====
const pdfState = {
  synth: window.speechSynthesis,
  utterance: null,
  words: [],
  currentWordIndex: 0,
  isPaused: false,
  isReading: false,
  currentSettings: {},
  readingText: '',
  highlightedSpan: null,
  highlightIndicator: null,
  watchdogTimer: null,
  wrappedSpans: [],
  pdfTextLayers: [],
  
  // Enhanced state
  currentPage: 1,
  totalPages: 1,
  readingStartTime: 0,
  totalWordsRead: 0,
  readingHistory: [],
  bookmarks: [],
  isDarkMode: false,
  useOCR: false,
  flashcardMode: false
};

// ===== INTELLIGENT PDF DETECTION & TEXT EXTRACTION =====
function detectPDFViewer() {
  // Check for PDF.js viewer
  if (window.PDFViewerApplication) {
    console.log('📄 PDF.js viewer detected');
    return 'pdfjs';
  }
  
  // Check for Chrome built-in viewer
  if (document.querySelector('embed[type="application/pdf"]') || 
      document.querySelector('object[type="application/pdf"]')) {
    console.log('📄 Chrome built-in PDF viewer detected');
    return 'chrome-builtin';
  }
  
  // Check for iframe-based viewers
  if (document.querySelector('iframe[src*=".pdf"]') ||
      document.querySelector('iframe[src*="pdfviewer"]') ||
      document.querySelector('iframe[src*="google"]')) {
    console.log('📄 iframe-based PDF viewer detected');
    return 'iframe';
  }
  
  // Check for jQuery-based viewers
  if (window.$ && (window.$.pdfViewer || window.PDFJS)) {
    console.log('📄 jQuery PDF viewer detected');
    return 'jquery';
  }
  
  console.log('📄 Generic PDF viewer - will extract from DOM');
  return 'generic';
}

function extractPDFTextSmart() {
  console.log('🔍 Starting smart PDF text extraction...');
  
  const viewerType = detectPDFViewer();
  let extractedText = [];
  
  switch(viewerType) {
    case 'pdfjs':
      extractedText = extractFromPDFJS();
      break;
    case 'chrome-builtin':
      extractedText = extractFromChromeViewer();
      break;
    case 'iframe':
      extractedText = extractFromIframe();
      break;
    case 'jquery':
      extractedText = extractFromJQuery();
      break;
    default:
      extractedText = extractFromDOM();
  }
  
  return extractedText;
}

function extractFromPDFJS() {
  console.log('Extracting from PDF.js viewer...');
  const texts = [];
  
  try {
    // Method 1: From visible text content
    const pdfDocument = window.PDFViewerApplication.pdfDocument;
    if (pdfDocument) {
      console.log(`📊 PDF has ${pdfDocument.numPages} pages`);
      pdfState.totalPages = pdfDocument.numPages;
    }
    
    // Method 2: From text layer
    const textLayers = document.querySelectorAll('.textLayer span');
    if (textLayers.length > 0) {
      textLayers.forEach(span => {
        const text = span.textContent.trim();
        if (text) texts.push(text);
      });
      console.log(`✓ Extracted ${texts.length} text elements from PDF.js text layer`);
      return texts;
    }
    
    // Method 3: From canvas annotations
    const pageText = document.querySelector('.page');
    if (pageText) {
      const allText = pageText.innerText || pageText.textContent;
      if (allText) {
        return allText.split(/\s+/).filter(w => w.trim());
      }
    }
  } catch (e) {
    console.warn('Error extracting from PDF.js:', e);
  }
  
  return texts;
}

function extractFromChromeViewer() {
  console.log('Extracting from Chrome viewer...');
  const bodyText = document.body.innerText || document.body.textContent || '';
  if (bodyText.trim()) {
    return bodyText.split(/\s+/).filter(w => w.trim());
  }
  return [];
}

function extractFromIframe() {
  console.log('Extracting from iframe viewer...');
  try {
    const iframe = document.querySelector('iframe');
    if (iframe) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const text = iframeDoc.body.innerText || iframeDoc.body.textContent;
        if (text) {
          return text.split(/\s+/).filter(w => w.trim());
        }
      } catch (e) {
        console.warn('Cannot access iframe content (CORS):', e);
      }
    }
  } catch (e) {
    console.warn('Error extracting from iframe:', e);
  }
  
  return extractFromDOM();
}

function extractFromJQuery() {
  console.log('Extracting from jQuery PDF viewer...');
  const container = document.querySelector('.pdfViewer, .pdf-container, [data-pdf]');
  if (container) {
    const text = container.innerText || container.textContent;
    if (text) {
      return text.split(/\s+/).filter(w => w.trim());
    }
  }
  return extractFromDOM();
}

function extractFromDOM() {
  console.log('Extracting from generic DOM...');
  const mainContent = document.querySelector('main, article, .content, #content, [role="main"]');
  const element = mainContent || document.body;
  
  const textElements = element.querySelectorAll('p, div, span, section, h1, h2, h3');
  const texts = [];
  
  textElements.forEach(el => {
    const text = el.innerText || el.textContent;
    if (text && text.trim().length > 2) {
      texts.push(text.trim());
    }
  });
  
  if (texts.length > 0) {
    return texts;
  }
  
  // Fallback: use entire body text
  const bodyText = document.body.innerText || document.body.textContent || '';
  return bodyText.split(/\s+/).filter(w => w.trim());
}

// ===== MESSAGE LISTENER - Enhanced =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 PDF message received:', request.action);
  
  try {
    switch(request.action) {
      case 'read':
        handleRead(request.type, request.settings);
        break;
      case 'pause':
        handlePause();
        break;
      case 'resume':
        handleResume();
        break;
      case 'stop':
        handleStop();
        break;
      case 'skip':
        skipForward(request.amount || 5);
        break;
      case 'rewind':
        skipBackward(request.amount || 5);
        break;
      case 'toggleFlashcard':
        pdfState.flashcardMode = !pdfState.flashcardMode;
        console.log('🎯 Flashcard mode:', pdfState.flashcardMode);
        break;
      case 'getReadingStats':
        sendResponse({
          wordsRead: pdfState.totalWordsRead,
          timeElapsed: Date.now() - pdfState.readingStartTime,
          currentPage: pdfState.currentPage
        });
        return true;
      default:
        console.warn('Unknown action:', request.action);
    }
    sendResponse({ success: true, message: 'Action completed' });
  } catch (error) {
    console.error('Error in PDF message handler:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
});

// ===== ENHANCED READ HANDLER =====
function handleRead(type, settings) {
  try {
    if (pdfState.isReading) {
      handleStop();
    }
    
    pdfState.currentSettings = settings || {};
    pdfState.currentWordIndex = 0;
    pdfState.isReading = true;
    pdfState.readingStartTime = Date.now();
    pdfState.readingHistory = [];
    
    // Detect dark mode
    pdfState.isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    console.log('🌓 Dark mode detected:', pdfState.isDarkMode);
    
    // Extract text with smart detection
    const textArray = extractPDFTextSmart();
    
    if (textArray.length === 0) {
      sendStatusUpdate('❌ No text found in PDF - PDF might be image-based', 0);
      pdfState.isReading = false;
      return;
    }
    
    // Convert text array to words
    pdfState.words = [];
    textArray.forEach(text => {
      const words = text.split(/\s+/).filter(w => w.trim());
      pdfState.words.push(...words);
    });
    
    console.log(`✓ Extracted ${pdfState.words.length} words from PDF`);
    pdfState.readingText = pdfState.words.join(' ');
    
    // Wrap text for highlighting
    try {
      wrapPDFText();
    } catch (e) {
      console.warn('Text wrapping failed, continuing without highlights:', e);
    }
    
    // Create modern UI
    createEnhancedIndicator();
    
    // Start reading
    readNextChunk();
    
  } catch (error) {
    console.error('Critical error in handleRead:', error);
    sendStatusUpdate('❌ Error: ' + error.message.substring(0, 50), 0);
    pdfState.isReading = false;
  }
}

// ===== MODERN ENHANCED INDICATOR UI =====
function createEnhancedIndicator() {
  const existing = document.getElementById('tts-pdf-indicator');
  if (existing) existing.remove();
  
  const indicator = document.createElement('div');
  indicator.id = 'tts-pdf-indicator';
  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 360px;
    background: linear-gradient(135deg, ${pdfState.isDarkMode ? '#2a2a2e' : '#f8fafc'} 0%, ${pdfState.isDarkMode ? '#1a1a1e' : '#f0f4f8'} 100%);
    border: 2px solid #4F46E5;
    border-radius: 16px;
    padding: 16px;
    box-shadow: 0 20px 60px rgba(79, 70, 229, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.2);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: ${pdfState.isDarkMode ? '#e0e0e0' : '#1f2937'};
    backdrop-filter: blur(20px);
    animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;
  
  indicator.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <span style="font-weight: 700; font-size: 14px;">📖 Reading PDF</span>
      <button id="pdf-close-btn" style="background: none; border: none; color: ${pdfState.isDarkMode ? '#a0a0a0' : '#666'}; cursor: pointer; font-size: 18px; padding: 0; width: 24px; height: 24px;">✕</button>
    </div>
    <div id="pdf-progress-bar" style="width: 100%; height: 6px; background: rgba(79, 70, 229, 0.2); border-radius: 3px; overflow: hidden; margin-bottom: 12px;">
      <div id="pdf-progress-fill" style="height: 100%; width: 0%; background: linear-gradient(90deg, #4F46E5, #7C3AED); transition: width 0.3s ease; border-radius: 3px;"></div>
    </div>
    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
      <button id="pdf-prev-btn" style="flex: 1; padding: 8px; background: rgba(79, 70, 229, 0.2); border: 1px solid #4F46E5; border-radius: 8px; color: #4F46E5; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s;">⏮ Prev</button>
      <button id="pdf-play-btn" style="flex: 1; padding: 8px; background: #4F46E5; border: none; border-radius: 8px; color: white; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s;">⏸ Pause</button>
      <button id="pdf-next-btn" style="flex: 1; padding: 8px; background: rgba(79, 70, 229, 0.2); border: 1px solid #4F46E5; border-radius: 8px; color: #4F46E5; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s;">Next ⏭</button>
    </div>
    <div style="font-size: 12px; opacity: 0.8; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div>📊 Words: <strong id="pdf-word-count">0</strong></div>
      <div>⏱️ Time: <strong id="pdf-time">0s</strong></div>
    </div>
  `;
  
  document.body.appendChild(indicator);
  pdfState.highlightIndicator = indicator;
  
  // Attach event listeners
  document.getElementById('pdf-close-btn').onclick = handleStop;
  document.getElementById('pdf-play-btn').onclick = () => pdfState.isPaused ? handleResume() : handlePause();
  document.getElementById('pdf-prev-btn').onclick = () => skipBackward(10);
  document.getElementById('pdf-next-btn').onclick = () => skipForward(10);
  
  // Update stats every second
  setInterval(() => {
    if (pdfState.isReading) {
      const elapsed = Math.floor((Date.now() - pdfState.readingStartTime) / 1000);
      document.getElementById('pdf-time').textContent = formatTime(elapsed);
      document.getElementById('pdf-word-count').textContent = pdfState.currentWordIndex;
      const progress = Math.round((pdfState.currentWordIndex / pdfState.words.length) * 100);
      document.getElementById('pdf-progress-fill').style.width = progress + '%';
    }
  }, 1000);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===== SMART TEXT WRAPPING =====
function wrapPDFText() {
  const textLayers = document.querySelectorAll('.textLayer');
  
  if (textLayers.length > 0) {
    console.log(`Wrapping text from ${textLayers.length} text layers...`);
    wrapFromTextLayers(textLayers);
  } else {
    console.log('No text layers found, creating virtual spans...');
    createVirtualHighlights();
  }
}

function wrapFromTextLayers(textLayers) {
  let wordIndex = 0;
  
  textLayers.forEach((layer) => {
    const spans = layer.querySelectorAll('span');
    spans.forEach((span) => {
      if (!span.classList.contains('tts-word-span')) {
        const text = span.textContent;
        if (text && text.trim()) {
          const wrappedSpan = createWordSpan(text, wordIndex);
          try {
            span.parentNode.replaceChild(wrappedSpan, span);
            pdfState.wrappedSpans[wordIndex] = wrappedSpan;
            wordIndex++;
          } catch (e) {
            console.warn('Could not wrap span:', e);
          }
        }
      }
    });
  });
  
  console.log(`Wrapped ${wordIndex} words for highlighting`);
}

function createVirtualHighlights() {
  // Create div container for virtual highlights
  const container = document.createElement('div');
  container.id = 'tts-pdf-highlights-container';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999990;
  `;
  document.body.appendChild(container);
}

function createWordSpan(text, index) {
  const span = document.createElement('span');
  span.textContent = text;
  span.className = 'tts-word-span';
  span.setAttribute('data-tts-index', index);
  span.style.cssText = `
    position: relative;
    display: inline;
    background-color: transparent;
    transition: background-color 0.1s ease;
  `;
  return span;
}

// ===== READING CONTROLS =====
function readNextChunk() {
  try {
    if (!pdfState.isReading || pdfState.isPaused) return;
    
    if (pdfState.currentWordIndex >= pdfState.words.length) {
      console.log('✓ Finished reading PDF');
      pdfState.isReading = false;
      handleStop();
      return;
    }
    
    const chunkSize = 20;
    const endIndex = Math.min(pdfState.currentWordIndex + chunkSize, pdfState.words.length);
    const chunk = pdfState.words.slice(pdfState.currentWordIndex, endIndex).join(' ');
    
    const progress = Math.round((pdfState.currentWordIndex / pdfState.words.length) * 100);
    sendStatusUpdate(`📖 Reading... ${pdfState.currentWordIndex}/${pdfState.words.length}`, progress);
    
    speakChunk(chunk, pdfState.currentWordIndex, endIndex);
    
  } catch (e) {
    console.error('Error in readNextChunk:', e);
    pdfState.currentWordIndex = Math.min(pdfState.currentWordIndex + 50, pdfState.words.length);
    setTimeout(() => readNextChunk(), 100);
  }
}

function speakChunk(text, startWordIndex, endWordIndex) {
  pdfState.utterance = new SpeechSynthesisUtterance(text);
  
  const voices = pdfState.synth.getVoices();
  if (pdfState.currentSettings.voice !== null && voices[pdfState.currentSettings.voice]) {
    pdfState.utterance.voice = voices[pdfState.currentSettings.voice];
  }
  
  pdfState.utterance.rate = pdfState.currentSettings.speed || 1;
  pdfState.utterance.pitch = pdfState.currentSettings.pitch || 1;
  pdfState.utterance.volume = pdfState.currentSettings.volume || 1;
  
  let startTime = null;
  
  pdfState.utterance.onstart = () => {
    startTime = performance.now();
  };
  
  pdfState.utterance.onend = () => {
    if (pdfState.isReading && !pdfState.isPaused) {
      pdfState.currentWordIndex = endWordIndex;
      pdfState.totalWordsRead += (endWordIndex - startWordIndex);
      highlightCurrentWord(endWordIndex - 1);
      setTimeout(() => readNextChunk(), 10);
    }
  };
  
  pdfState.utterance.onerror = (event) => {
    if (event.error === 'interrupted') return;
    console.error('Speech error:', event.error);
    if (pdfState.isReading && !pdfState.isPaused) {
      pdfState.currentWordIndex = endWordIndex;
      setTimeout(() => readNextChunk(), 50);
    }
  };
  
  try {
    pdfState.synth.speak(pdfState.utterance);
  } catch (e) {
    console.error('Error speaking chunk:', e);
    pdfState.currentWordIndex = endWordIndex;
    setTimeout(() => readNextChunk(), 50);
  }
}

function highlightCurrentWord(wordIndex) {
  try {
    if (pdfState.highlightedSpan) {
      pdfState.highlightedSpan.classList.remove('tts-word-highlight');
    }
    
    if (wordIndex >= 0 && wordIndex < pdfState.wrappedSpans.length && pdfState.wrappedSpans[wordIndex]) {
      const span = pdfState.wrappedSpans[wordIndex];
      span.classList.add('tts-word-highlight');
      pdfState.highlightedSpan = span;
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (e) {
    console.warn('Highlight error:', e);
  }
}

function skipForward(amount) {
  pdfState.currentWordIndex = Math.min(pdfState.currentWordIndex + (amount * 10), pdfState.words.length - 1);
  pdfState.synth.cancel();
  if (pdfState.isReading && !pdfState.isPaused) {
    readNextChunk();
  }
}

function skipBackward(amount) {
  pdfState.currentWordIndex = Math.max(pdfState.currentWordIndex - (amount * 10), 0);
  pdfState.synth.cancel();
  if (pdfState.isReading && !pdfState.isPaused) {
    readNextChunk();
  }
}

function handlePause() {
  if (pdfState.isReading && !pdfState.isPaused) {
    pdfState.isPaused = true;
    pdfState.synth.pause();
    const btn = document.getElementById('pdf-play-btn');
    if (btn) btn.textContent = '▶ Resume';
    sendStatusUpdate('⏸ Paused', Math.round((pdfState.currentWordIndex / pdfState.words.length) * 100));
  }
}

function handleResume() {
  if (pdfState.isReading && pdfState.isPaused) {
    pdfState.isPaused = false;
    pdfState.synth.resume();
    const btn = document.getElementById('pdf-play-btn');
    if (btn) btn.textContent = '⏸ Pause';
    sendStatusUpdate('▶ Resuming...', Math.round((pdfState.currentWordIndex / pdfState.words.length) * 100));
  }
}

function handleStop() {
  pdfState.isReading = false;
  pdfState.isPaused = false;
  pdfState.currentWordIndex = 0;
  pdfState.synth.cancel();
  
  // Remove indicator
  const indicator = document.getElementById('tts-pdf-indicator');
  if (indicator) {
    indicator.style.animation = 'slideDown 0.3s ease';
    setTimeout(() => indicator.remove(), 300);
  }
  
  // Remove highlights
  removeHighlight();
  sendStatusUpdate('⏹ Stopped', 0);
}

function removeHighlight() {
  const allWrappedSpans = document.querySelectorAll('.tts-word-span');
  allWrappedSpans.forEach(span => {
    if (span.parentNode) {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    }
  });
  
  pdfState.highlightedSpan = null;
  pdfState.wrappedSpans = [];
}

function sendStatusUpdate(text, progress) {
  try {
    chrome.runtime.sendMessage({
      action: 'updateStatus',
      text: text,
      progress: progress,
      type: 'pdf'
    }).catch(() => {});
  } catch (e) {
    console.warn('Could not send status update:', e);
  }
}

console.log('✅ Enhanced PDF Text Reader loaded');

}
    isPaused = false;
    wrappedSpans = [];
    words = [];
    
    try {
      extractAndWrapPDFText();
    } catch (e) {
      console.error('Error extracting PDF text:', e);
      sendStatusUpdate('Error: Could not extract text from PDF', 0);
      isReading = false;
      return;
    }
    
    if (words.length === 0) {
      sendStatusUpdate('No text found in PDF', 0);
      isReading = false;
      return;
    }
    
    console.log(`Total words to read in PDF: ${words.length}`);
    readingText = words.join(' ');
    
    try {
      createHighlightIndicator();
    } catch (e) {
      console.warn('Error creating indicator:', e);
    }
    
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = setInterval(() => {
      try {
        if (isReading && !isPaused && synth && !synth.speaking && utterance && !utterance.paused) {
          console.log('Watchdog: speech stopped unexpectedly, resuming');
          readNextChunk();
        }
      } catch (e) {
        console.warn('Error in watchdog timer:', e);
      }
    }, 2000);
    
    readNextChunk();
  } catch (error) {
    console.error('Critical error in handleRead:', error);
    sendStatusUpdate('Critical error: ' + error.message.substring(0, 30), 0);
    isReading = false;
  }
}

function extractAndWrapPDFText() {
  let textLayers = document.querySelectorAll('.textLayer');
  
  if (textLayers.length === 0) {
    const embed = document.querySelector('embed[type="application/pdf"]');
    const object = document.querySelector('object[type="application/pdf"]');
    const iframe = document.querySelector('iframe[src*=".pdf"]');
    
    if (embed || object || iframe) {
      console.log('Chrome built-in PDF viewer detected - extracting text from embed');
      extractFromChromeBuiltInViewer();
      return;
    }
    
    const canvasElements = document.querySelectorAll('canvas');
    if (canvasElements.length > 0) {
      console.log('Canvas-based PDF detected - extracting from page text');
      extractTextFromCanvasPDF();
      return;
    }
  }
  
  console.log(`Found ${textLayers.length} PDF text layers`);
  
  if (textLayers.length === 0) {
    console.warn('No PDF text layers found - trying alternative methods');
    extractTextFromBody();
    return;
  }
  
  let wordIndex = 0;
  
  textLayers.forEach((layer, layerIdx) => {
    const textSpans = layer.querySelectorAll('span');
    const divs = layer.querySelectorAll('div');
    const allTextElements = [...textSpans, ...divs];
    
    allTextElements.forEach((textSpan) => {
      if (textSpan.classList.contains('tts-word-span')) {
        return;
      }
      
      const text = textSpan.textContent;
      if (!text || !text.trim()) return;
      
      const parent = textSpan.parentNode;
      const fragment = document.createDocumentFragment();
      const parts = text.split(/(\s+)/);
      
      for (let part of parts) {
        if (part.trim().length > 0) {
          const span = document.createElement('span');
          span.textContent = part;
          span.setAttribute('data-tts-index', wordIndex);
          span.className = 'tts-word-span';
          
          const computedStyle = window.getComputedStyle(textSpan);
          span.style.fontFamily = computedStyle.fontFamily;
          span.style.fontSize = computedStyle.fontSize;
          span.style.color = computedStyle.color;
          span.style.position = 'relative';
          span.style.display = 'inline';
          
          fragment.appendChild(span);
          
          wrappedSpans[wordIndex] = span;
          words[wordIndex] = part.trim();
          wordIndex++;
        } else if (part.length > 0) {
          fragment.appendChild(document.createTextNode(part));
        }
      }
      
      try {
        if (textSpan.parentNode && textSpan.parentNode.contains(textSpan)) {
          parent.replaceChild(fragment, textSpan);
        }
      } catch (e) {
        console.warn('Error replacing PDF text span:', e);
      }
    });
  });
  
  console.log(`Wrapped ${wordIndex} words in PDF`);
}

function extractFromChromeBuiltInViewer() {
  console.log('Chrome PDF viewer detected - PDFs opened in Chrome use built-in viewer');
  const bodyText = document.body.innerText || document.body.textContent || '';
  if (bodyText.trim()) {
    const textWords = bodyText.trim().split(/\s+/);
    words = textWords;
    console.log(`Extracted ${words.length} words from Chrome PDF viewer`);
  } else {
    console.warn('No text found in Chrome PDF viewer');
  }
}

function extractTextFromBody() {
  console.log('Extracting text from document body for PDF');
  const bodyText = document.body.innerText || document.body.textContent || '';
  if (bodyText.trim()) {
    const textWords = bodyText.trim().split(/\s+/);
    words = textWords;
    console.log(`Extracted ${words.length} words from body`);
  }
}

function extractTextFromCanvasPDF() {
  console.log('Extracting text from canvas-based PDF');
  const allText = [];
  const textElements = document.querySelectorAll('div, p, span, section, article');
  
  textElements.forEach((el) => {
    const text = el.textContent;
    if (text && text.trim() && !el.querySelector('canvas')) {
      const elementText = text.trim();
      if (elementText.length > 5 && !allText.includes(elementText)) {
        allText.push(elementText);
      }
    }
  });
  
  if (allText.length === 0) {
    extractTextFromBody();
    return;
  }
  
  const fullText = allText.join(' ');
  words = fullText.split(/\s+/).filter(w => w.trim().length > 0);
  console.log(`Extracted ${words.length} words from canvas-based PDF`);
}

function readNextChunk() {
  try {
    if (!isReading || isPaused) {
      return;
    }
    
    if (currentWordIndex >= words.length) {
      console.log('Finished reading PDF - restarting from beginning');
      currentWordIndex = 0;
      
      if (highlightedSpan && highlightedSpan.classList) {
        highlightedSpan.classList.remove('tts-word-highlight');
        highlightedSpan = null;
      }
      
      try {
        chrome.runtime.sendMessage({ action: 'restarting' });
      } catch (e) {
        console.log('Could not send restart message');
      }
      
      setTimeout(() => {
        if (isReading && !isPaused) {
          readNextChunk();
        }
      }, 500);
      return;
    }
    
    const chunkSize = 15;
    const endIndex = Math.min(currentWordIndex + chunkSize, words.length);
    const chunk = words.slice(currentWordIndex, endIndex).join(' ');
    
    const progress = Math.round((currentWordIndex / words.length) * 100);
    sendStatusUpdate(`Reading PDF... (${currentWordIndex}/${words.length} words)`, progress);
    
    speakChunk(chunk, currentWordIndex, endIndex);
  } catch (e) {
    console.error('Error in PDF readNextChunk:', e);
    if (isReading && !isPaused && currentWordIndex < words.length) {
      currentWordIndex = Math.min(currentWordIndex + 200, words.length);
      setTimeout(() => {
        readNextChunk();
      }, 100);
    }
  }
}

function speakChunk(text, startWordIndex, endWordIndex) {
  utterance = new SpeechSynthesisUtterance(text);
  
  const voices = synth.getVoices();
  if (currentSettings.voice !== null && voices[currentSettings.voice]) {
    utterance.voice = voices[currentSettings.voice];
  }
  
  utterance.rate = currentSettings.speed || 1;
  utterance.pitch = currentSettings.pitch || 1;
  utterance.volume = currentSettings.volume || 1;
  
  const charToWordMap = [];
  let charPos = 0;
  
  for (let i = startWordIndex; i < endWordIndex; i++) {
    const word = words[i];
    const wordStart = charPos;
    const wordEnd = charPos + word.length;
    
    charToWordMap.push({
      start: wordStart,
      end: wordEnd,
      wordIndex: i,
      word: word
    });
    
    charPos = wordEnd + 1;
  }
  
  let lastHighlightedIndex = -1;
  let boundaryEventCount = 0;
  let startTime = null;
  let fallbackInterval = null;
  
  utterance.onstart = () => {
    startTime = performance.now();
    boundaryEventCount = 0;
    lastHighlightedIndex = -1;
    
    fallbackInterval = setInterval(() => {
      if (!isReading) {
        clearInterval(fallbackInterval);
        return;
      }
      
      const now = performance.now();
      const elapsed = now - startTime;
      
      if (elapsed > 500 && boundaryEventCount < 2) {
        const msPerWord = 60000 / (150 * (utterance.rate || 1));
        const estimatedIndex = Math.floor(elapsed / msPerWord);
        const globalIndex = startWordIndex + estimatedIndex;
        
        if (globalIndex >= startWordIndex && globalIndex < endWordIndex && globalIndex !== lastHighlightedIndex) {
          highlightCurrentWord(words[globalIndex], globalIndex);
          currentWordIndex = globalIndex;
          lastHighlightedIndex = globalIndex;
        }
      }
    }, 50);
  };
  
  utterance.onboundary = (event) => {
    if (!isReading || event.name !== 'word') return;
    
    boundaryEventCount++;
    
    try {
      const charIndex = event.charIndex;
      let foundMatch = false;
      let matchedIndex = -1;
      
      for (let i = 0; i < charToWordMap.length; i++) {
        const mapping = charToWordMap[i];
        const tolerance = 3;
        
        if (charIndex >= mapping.start - tolerance && charIndex <= mapping.end + tolerance) {
          matchedIndex = i;
          foundMatch = true;
          break;
        }
      }
      
      if (!foundMatch && charToWordMap.length > 0) {
        let closestIndex = 0;
        let minDistance = Math.abs(charIndex - charToWordMap[0].start);
        
        for (let i = 1; i < charToWordMap.length; i++) {
          const distance = Math.abs(charIndex - charToWordMap[i].start);
          if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
          }
        }
        
        matchedIndex = closestIndex;
      }
      
      if (matchedIndex >= 0 && matchedIndex < charToWordMap.length) {
        const globalWordIndex = charToWordMap[matchedIndex].wordIndex;
        
        if (globalWordIndex !== lastHighlightedIndex && globalWordIndex < words.length) {
          highlightCurrentWord(words[globalWordIndex], globalWordIndex);
          currentWordIndex = globalWordIndex;
          lastHighlightedIndex = globalWordIndex;
        }
      }
    } catch (e) {
      console.warn('PDF boundary error:', e);
    }
  };
  
  utterance.onend = () => {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
    
    if (isReading && !isPaused) {
      currentWordIndex = endWordIndex;
      setTimeout(() => readNextChunk(), 5);
    }
  };
  
  utterance.onerror = (event) => {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
    
    if (event.error === 'interrupted') return;
    
    console.error('PDF speech error:', event.error);
    if (isReading && !isPaused) {
      currentWordIndex = endWordIndex;
      setTimeout(() => {
        readNextChunk();
      }, 50);
    }
  };
  
  try {
    synth.speak(utterance);
  } catch (e) {
    console.error('Error speaking PDF chunk:', e);
    if (isReading && !isPaused) {
      currentWordIndex = endWordIndex;
      setTimeout(() => {
        readNextChunk();
      }, 50);
    }
  }
}

function highlightCurrentWord(word, wordIndex) {
  try {
    if (highlightedSpan && highlightedSpan.classList) {
      highlightedSpan.classList.remove('tts-word-highlight');
      highlightedSpan = null;
    }
    
    if (wordIndex < 0 || wordIndex >= words.length) {
      return;
    }
    
    if (wrappedSpans.length > 0 && wordIndex < wrappedSpans.length) {
      const span = wrappedSpans[wordIndex];
      if (span && span.parentNode && span.classList) {
        span.classList.add('tts-word-highlight');
        highlightedSpan = span;
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    
    if (highlightIndicator && wordIndex % 5 === 0) {
      highlightIndicator.textContent = `${wordIndex + 1}/${words.length}`;
    }
  } catch (e) {
    console.warn('PDF highlight error:', e);
  }
}

function createHighlightIndicator() {
  const existing = document.getElementById('tts-highlight-indicator');
  if (existing) {
    existing.remove();
  }
  
  highlightIndicator = document.createElement('div');
  highlightIndicator.id = 'tts-highlight-indicator';
  highlightIndicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ff6b35;
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    font-weight: bold;
    z-index: 999999999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    font-family: Arial, sans-serif;
    font-size: 14px;
    border: 2px solid #fff;
  `;
  highlightIndicator.textContent = 'Reading PDF...';
  document.body.appendChild(highlightIndicator);
}

function removeHighlight() {
  if (highlightIndicator) {
    highlightIndicator.remove();
    highlightIndicator = null;
  }
  
  const allWrappedSpans = document.querySelectorAll('.tts-word-span');
  console.log(`Removing ${allWrappedSpans.length} PDF wrapped spans`);
  
  const spansByParent = new Map();
  
  allWrappedSpans.forEach(span => {
    if (span.parentNode) {
      if (!spansByParent.has(span.parentNode)) {
        spansByParent.set(span.parentNode, []);
      }
      spansByParent.get(span.parentNode).push(span);
    }
  });
  
  spansByParent.forEach((spans, parent) => {
    try {
      const fragment = document.createDocumentFragment();
      const childNodes = Array.from(parent.childNodes);
      
      childNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && 
            node.classList && 
            node.classList.contains('tts-word-span')) {
          const textContent = node.textContent;
          if (textContent) {
            fragment.appendChild(document.createTextNode(textContent));
          }
        } else {
          fragment.appendChild(node.cloneNode(true));
        }
      });
      
      while (parent.firstChild) {
        parent.removeChild(parent.firstChild);
      }
      parent.appendChild(fragment);
      
    } catch (e) {
      console.warn('Error restoring PDF text:', e);
    }
  });
  
  highlightedSpan = null;
  wrappedSpans = [];
}

function handlePause() {
  if (isReading && !isPaused) {
    isPaused = true;
    synth.pause();
    if (highlightIndicator) highlightIndicator.textContent = 'Paused';
    sendStatusUpdate('Paused', Math.round((currentWordIndex / words.length) * 100));
  }
}

function handleResume() {
  if (isReading && isPaused) {
    isPaused = false;
    synth.resume();
    if (highlightIndicator) highlightIndicator.textContent = 'Reading PDF...';
    sendStatusUpdate('Resuming...', Math.round((currentWordIndex / words.length) * 100));
  }
}

function handleStop() {
  isReading = false;
  isPaused = false;
  currentWordIndex = 0;
  words = [];
  synth.cancel();
  removeHighlight();
  
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  
  sendStatusUpdate('Stopped', 0);
}

function sendStatusUpdate(text, progress) {
  try {
    chrome.runtime.sendMessage({
      action: 'updateStatus',
      text: text,
      progress: progress
    }).catch(() => {});
  } catch (e) {
    console.warn('Could not send PDF status update:', e);
  }
}

console.log('PDF Text Reader content script loaded');

}
