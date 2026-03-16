class TTSStateManager {
  constructor() {
    this.state = {
      isReading: false,
      isPaused: false,
      isOffline: !navigator.onLine,
      currentWordIndex: 0,
      words: [],
      readingText: '',
      settings: {},
      lastError: null,
      readingStartTime: 0,
      totalWordsRead: 0,
      sessionStats: {
        totalTimeReading: 0,
        totalWordsRead: 0,
        averageWPM: 0,
        sessionsCompleted: 0
      }
    };

    this.listeners = new Map();
    this.errorHandlers = [];
    this.stateHistory = [];
    this.maxHistorySize = 50;
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    const oldValue = this.state[key];
    this.state[key] = value;

    this.stateHistory.push({
      key,
      oldValue,
      newValue: value,
      timestamp: Date.now()
    });

    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }

    if (this.listeners.has(key)) {
      this.listeners.get(key).forEach(callback => {
        try {
          callback(value, oldValue);
        } catch (e) {
          console.error(`Error in state listener for ${key}:`, e);
        }
      });
    }

    return value;
  }

  update(changes) {
    Object.entries(changes).forEach(([key, value]) => {
      this.set(key, value);
    });
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(callback);

    return () => {
      const callbacks = this.listeners.get(key);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    };
  }

  onError(handler) {
    this.errorHandlers.push(handler);
  }

  handleError(error, context = {}) {
    console.error('TTSStateManager Error:', error, context);
    this.set('lastError', { error: error.message, context, timestamp: Date.now() });

    this.errorHandlers.forEach(handler => {
      try {
        handler(error, context);
      } catch (e) {
        console.error('Error in error handler:', e);
      }
    });
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getHistory(key = null) {
    if (key) {
      return this.stateHistory.filter(entry => entry.key === key);
    }
    return this.stateHistory;
  }

  reset() {
    this.update({
      isReading: false,
      isPaused: false,
      currentWordIndex: 0,
      words: [],
      readingText: '',
      lastError: null
    });
  }
}

window.TTSStateManager = TTSStateManager;
