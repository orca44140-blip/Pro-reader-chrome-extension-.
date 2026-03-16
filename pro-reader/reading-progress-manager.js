class ReadingProgressManager {
  constructor() {
    this.storageKey = 'tts_reading_progress';
  }

  async saveProgress(url, wordIndex, totalWords, timestamp = Date.now()) {
    try {
      const progress = {
        url,
        wordIndex,
        totalWords,
        progress: Math.round((wordIndex / totalWords) * 100),
        timestamp,
        lastUpdated: new Date().toISOString()
      };

      const result = await chrome.storage.local.get([this.storageKey]);
      const allProgress = result[this.storageKey] || {};

      allProgress[url] = progress;

      const entries = Object.entries(allProgress);
      if (entries.length > 50) {
        entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        const limited = Object.fromEntries(entries.slice(0, 50));
        await chrome.storage.local.set({ [this.storageKey]: limited });
      } else {
        await chrome.storage.local.set({ [this.storageKey]: allProgress });
      }

      console.log(`💾 Progress saved: ${progress.progress}% at word ${wordIndex}`);
      return progress;
    } catch (e) {
      console.error('Error saving progress:', e);
      return null;
    }
  }

  async loadProgress(url) {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      const allProgress = result[this.storageKey] || {};
      const progress = allProgress[url];

      if (progress) {
        console.log(`📖 Progress loaded: ${progress.progress}% from ${progress.lastUpdated}`);
      }

      return progress || null;
    } catch (e) {
      console.error('Error loading progress:', e);
      return null;
    }
  }

  async clearProgress(url) {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      const allProgress = result[this.storageKey] || {};
      delete allProgress[url];
      await chrome.storage.local.set({ [this.storageKey]: allProgress });
      console.log('🗑️ Progress cleared for', url);
    } catch (e) {
      console.error('Error clearing progress:', e);
    }
  }
}

window.ReadingProgressManager = ReadingProgressManager;
