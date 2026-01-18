// ClipStash v2.0 - Content Script
// Captures text, images, and rich text

(function() {
  'use strict';
  
  if (window.__clipstashV2) return;
  window.__clipstashV2 = true;
  
  let lastContent = '';
  let lastTime = 0;
  
  // Listen for copy/cut events
  document.addEventListener('copy', handleClipboard, true);
  document.addEventListener('cut', handleClipboard, true);
  
  async function handleClipboard(event) {
    const now = Date.now();
    
    // Try to get rich content from clipboard event
    if (event.clipboardData) {
      // Check for images first
      const items = event.clipboardData.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (blob) {
              const dataUrl = await blobToDataUrl(blob);
              sendClip({
                content: dataUrl,
                type: 'image',
                preview: dataUrl.substring(0, 100) + '...',
                mimeType: item.type,
                size: blob.size
              });
              return;
            }
          }
        }
      }
      
      // Check for HTML (rich text)
      const html = event.clipboardData.getData('text/html');
      if (html && html.trim()) {
        const text = event.clipboardData.getData('text/plain') || extractTextFromHtml(html);
        sendClip({
          content: text.trim(),
          html: html,
          type: 'richtext'
        });
        return;
      }
    }
    
    // Fallback to selection
    captureSelection();
  }
  
  function captureSelection() {
    let text = '';
    
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      text = selection.toString().trim();
    }
    
    if (!text) {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        if (el.selectionStart !== el.selectionEnd) {
          text = el.value.substring(el.selectionStart, el.selectionEnd).trim();
        }
      }
    }
    
    if (!text) return;
    
    // Debounce
    const now = Date.now();
    if (text === lastContent && (now - lastTime) < 100) return;
    lastContent = text;
    lastTime = now;
    
    sendClip({
      content: text,
      type: detectType(text)
    });
  }
  
  function sendClip(data) {
    try {
      chrome.runtime.sendMessage({
        type: 'SAVE_CLIP',
        data: {
          ...data,
          source: {
            url: location.href,
            title: document.title,
            hostname: location.hostname
          }
        }
      }).catch(() => {});
    } catch (e) {}
  }
  
  function detectType(text) {
    if (/^https?:\/\/\S+$/i.test(text)) return 'url';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email';
    if (/^[\d\s\-\+\(\)\.]+$/.test(text) && text.replace(/\D/g, '').length >= 7) return 'phone';
    if (/[{}\[\]();]/.test(text) || /^(const|let|var|function|import|def|class|SELECT|INSERT)\s/mi.test(text)) return 'code';
    return 'text';
  }
  
  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }
  
  function extractTextFromHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }
  
  // Also capture images from right-click
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'IMG') {
      window.__clipstashLastImage = e.target.src;
    }
  }, true);
  
})();
