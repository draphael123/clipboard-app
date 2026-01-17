// ClipStash - Content Script
// Detects copy events on web pages and sends to background worker

// Listen for copy events
document.addEventListener('copy', handleCopy);

// Handle keyboard shortcut for copy (backup detection)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    // Small delay to ensure clipboard is updated
    setTimeout(captureClipboard, 50);
  }
});

function handleCopy(event) {
  // Try to get text from clipboard event
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';
  
  if (selectedText) {
    sendToBackground(selectedText);
  } else {
    // Fallback: try clipboard API after a brief delay
    setTimeout(captureClipboard, 50);
  }
}

async function captureClipboard() {
  try {
    // Try to read from clipboard using modern API
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        sendToBackground(text.trim());
      }
    }
  } catch (error) {
    // Clipboard access may be restricted - silent fail
    console.debug('ClipStash: Could not access clipboard directly');
  }
}

function sendToBackground(content) {
  if (!content || content.length === 0) return;
  
  // Get source information
  const source = {
    url: window.location.href,
    title: document.title,
    hostname: window.location.hostname
  };
  
  chrome.runtime.sendMessage({
    type: 'SAVE_CLIP',
    data: {
      content: content,
      type: detectContentType(content),
      source: source
    }
  }).catch(() => {
    // Extension context may be invalidated - silent fail
  });
}

function detectContentType(content) {
  // Detect URLs
  if (/^https?:\/\/[^\s]+$/i.test(content)) {
    return 'url';
  }
  
  // Detect email addresses
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) {
    return 'email';
  }
  
  // Detect code patterns
  if (/^(function|const|let|var|import|export|class|if|for|while)\s/m.test(content) ||
      /[{}\[\]();]/.test(content) && content.includes('\n')) {
    return 'code';
  }
  
  // Detect numbers/phone numbers
  if (/^[\d\s\-\+\(\)\.]+$/.test(content) && content.replace(/\D/g, '').length >= 7) {
    return 'phone';
  }
  
  return 'text';
}

// Notify that content script is loaded
console.debug('ClipStash content script loaded');

