function safeAppendToBody(element, timeout = 5000) {
  if (!element) return false;

  if (document.body) {
    try {
      document.body.appendChild(element);
      return true;
    } catch (e) {
      console.error('Error appending to document.body:', e);
      return false;
    }
  }

  const startTime = Date.now();
  const waitForBody = () => {
    if (document.body) {
      try {
        document.body.appendChild(element);
        return true;
      } catch (e) {
        console.error('Error appending after wait:', e);
        return false;
      }
    }

    if (Date.now() - startTime > timeout) {
      console.error('Timeout waiting for document.body');
      return false;
    }

    setTimeout(waitForBody, 50);
  };

  waitForBody();
  return true;
}

window.safeAppendToBody = safeAppendToBody;
