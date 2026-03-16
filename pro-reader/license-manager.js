class LicenseManager {
  constructor() {
    this.isPro = true;
    this.license = null;
    this.checkingLicense = false;
  }

  async checkLicense() {
    this.isPro = true;
    return true;
  }

  canUseSpeedMode() {
    return true;
  }

  canUseFocusMode() {
    return true;
  }

  canUseVocabWidget() {
    return true;
  }

  canSaveProgress() {
    return true;
  }

  canUseAdvancedHighlighting() {
    return true;
  }

  canUseAltClickReading() {
    return true;
  }
}

window.LicenseManager = LicenseManager;
