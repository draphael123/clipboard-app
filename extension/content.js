// ClipStash - Content Script (Fast Version)
// Captures copy events on all websites

(function() {
  'use strict';
  
  if (window.__clipstashInjected) return;
  window.__clipstashInjected = true;
  
  console.log('ClipStash: Loaded on', window.location.hostname);
  
  // Debounce tracking
  let lastContent = '';
  let lastTime = 0;
  
  // Primary: Listen for copy/cut events
  document.addEventListener('copy', handleCopy, true);
  document.addEventListener('cut', handleCopy, true);
  
  function handleCopy() {
    // Capture immediately - no delay needed for selection
    captureAndSend();
  }
  
  function captureAndSend() {
    // Get selection
    let text = '';
    
    // Try window selection first
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      text = selection.toString().trim();
    }
    
    // Fallback: check active element
    if (!text) {
      const el = document.activeElement;
      if (el) {
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && 
            el.selectionStart !== el.selectionEnd) {
          text = el.value.substring(el.selectionStart, el.selectionEnd).trim();
        } else if (el.isContentEditable) {
          const sel = window.getSelection();
          text = sel ? sel.toString().trim() : '';
        }
      }
    }
    
    if (!text) return;
    
    // Quick debounce (100ms for same content)
    const now = Date.now();
    if (text === lastContent && (now - lastTime) < 100) return;
    lastContent = text;
    lastTime = now;
    
    // Send immediately
    sendClip(text);
  }
  
  function sendClip(content) {
    try {
      chrome.runtime.sendMessage({
        type: 'SAVE_CLIP',
        data: {
          content,
          type: getType(content),
          source: {
            url: location.href,
            title: document.title,
            hostname: location.hostname
          }
        }
      }).then(r => {
        if (r?.success) console.log('ClipStash: ✓ Saved');
      }).catch(() => {});
    } catch (e) {}
  }
  
  function getType(text) {
    if (/^https?:\/\/\S+$/i.test(text)) return 'url';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email';
    if (/^[\d\s\-\+\(\)\.]+$/.test(text) && text.replace(/\D/g, '').length >= 7) return 'phone';
    if (/[{}\[\]();]/.test(text) || /^(const|let|var|function|import|def|class)\s/m.test(text)) return 'code';
    return 'text';
  }
})();
