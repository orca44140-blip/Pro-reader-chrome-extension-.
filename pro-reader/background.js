'use strict';

function isRestrictedPage(tabUrl) {
  if (!tabUrl) return true;
  const restricted = ['chrome://', 'about:', 'edge://', 'brave://', 'opera://',
    'chrome-extension://', 'moz-extension://', 'chrome-search://', 'devtools://'];
  return restricted.some(p => tabUrl.startsWith(p));
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 250));
    return true;
  } catch (e) {
    console.warn('[BG] Could not inject content script:', e.message);
    return false;
  }
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    const ok = await ensureContentScript(tabId);
    if (!ok) throw new Error('Content script unavailable on this page');
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      throw e2;
    }
  }
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['readerSettings'], result => {
      const s = result?.readerSettings || {};
      resolve({ voice: s.voice ?? null, speed: s.speed || 1, pitch: s.pitch || 1, volume: s.volume || 1 });
    });
  });
}

let creatingContextMenus = false;

function createContextMenus() {
  if (creatingContextMenus) return;
  creatingContextMenus = true;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'readSelection', title: '🔊 Read selected text', contexts: ['selection'] },
      () => chrome.runtime.lastError && console.warn(chrome.runtime.lastError.message));
    chrome.contextMenus.create({ id: 'readPage', title: '🔊 Read entire page', contexts: ['page'] },
      () => { chrome.runtime.lastError && console.warn(chrome.runtime.lastError.message); creatingContextMenus = false; });
  });
}

chrome.runtime.onInstalled.addListener(() => { console.log('Pro Reader installed'); createContextMenus(); });
chrome.runtime.onStartup.addListener(() => createContextMenus());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || isRestrictedPage(tab.url)) return;
  try {
    const settings = await getSettings();
    const type = info.menuItemId === 'readSelection' ? 'selection' : 'page';
    await sendToTab(tab.id, { action: 'read', type, settings });
  } catch (e) {
    console.error('Context menu error:', e.message);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkLicense') { sendResponse({ isPaid: false }); return false; }
  if (request.action === 'openPopup') {
    try { chrome.action.openPopup(); } catch (_) {}
    sendResponse({ ok: true });
    return false;
  }
  // Handle updateStatus and other messages from content script
  if (request.action === 'updateStatus') {
    // Just acknowledge the message, don't need to do anything with status
    try { sendResponse({ success: true }); } catch (e) {}
    return false;
  }
  // For any other unknown action, respond immediately
  try { sendResponse({ success: false, error: 'Unknown action' }); } catch (e) {}
  return false;
});

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || isRestrictedPage(tab.url)) return;

  if (command === 'open-popup') {
    try { await chrome.action.openPopup(); } catch (_) {}
    return;
  }

  try {
    const settings = await getSettings();
    const map = {
      'toggle-reading':  { action: 'read', type: 'page', settings },
      'pause-resume':    { action: 'togglePause' },
      'stop-reading':    { action: 'stop' },
      'read-selection':  { action: 'read', type: 'selection', settings },
    };
    const msg = map[command];
    if (msg) await sendToTab(tab.id, msg);
  } catch (e) {
    console.error('Command error:', e.message);
  }
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id || isRestrictedPage(tab.url)) return;
  try {
    const settings = await getSettings();
    await sendToTab(tab.id, { action: 'read', type: 'page', settings });
  } catch (e) {
    console.error('Action click error:', e.message);
  }
});

console.log('✅ Background service worker ready');
