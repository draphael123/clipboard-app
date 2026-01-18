// ClipStash - Content Script (Robust Version)
// Captures copy events on all websites

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__clipstashInjected) return;
  window.__clipstashInjected = true;
  
  console.log('ClipStash: Content script loaded on', window.location.hostname);
  
  // Debounce to prevent duplicate captures
  let lastCaptured = '';
  let lastCaptureTime = 0;
  const DEBOUNCE_MS = 500;
  
  // Track if we're currently processing
  let isProcessing = false;
  
  // Method 1: Listen for copy event (capture phase)
  document.addEventListener('copy', onCopyEvent, true);
  
  // Method 2: Listen for cut event (also captures text)
  document.addEventListener('cut', onCopyEvent, true);
  
  // Method 3: Keyboard shortcut detection (backup)
  document.addEventListener('keydown', onKeyDown, true);
  
  function onCopyEvent(event) {
    // Don't process if already processing
    if (isProcessing) return;
    
    console.log('ClipStash: Copy/cut event detected');
    
    // Small delay to let the browser update selection
    setTimeout(() => captureSelection('event'), 10);
  }
  
  function onKeyDown(event) {
    // Check for Ctrl+C or Cmd+C
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
      console.log('ClipStash: Keyboard Ctrl+C detected');
      // Longer delay for keyboard shortcut to ensure clipboard is ready
      setTimeout(() => captureSelection('keyboard'), 150);
    }
    
    // Also capture Ctrl+X
    if ((event.ctrlKey || event.metaKey) && (event.key === 'x' || event.key === 'X')) {
      console.log('ClipStash: Keyboard Ctrl+X detected');
      setTimeout(() => captureSelection('keyboard'), 150);
    }
  }
  
  function captureSelection(source) {
    if (isProcessing) {
      console.log('ClipStash: Already processing, skipping');
      return;
    }
    
    isProcessing = true;
    
    try {
      // Get selection from window
      const selection = window.getSelection();
      let text = selection ? selection.toString() : '';
      
      // Try to get from active element if no window selection
      if (!text) {
        const activeEl = document.activeElement;
        if (activeEl) {
          // Handle input/textarea
          if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
            const start = activeEl.selectionStart;
            const end = activeEl.selectionEnd;
            if (start !== end) {
              text = activeEl.value.substring(start, end);
            }
          }
          // Handle contenteditable
          else if (activeEl.isContentEditable) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              text = sel.toString();
            }
          }
          // Handle iframes (same origin only)
          else if (activeEl.tagName === 'IFRAME') {
            try {
              const iframeDoc = activeEl.contentDocument || activeEl.contentWindow.document;
              const iframeSel = iframeDoc.getSelection();
              if (iframeSel) {
                text = iframeSel.toString();
              }
            } catch (e) {
              // Cross-origin iframe, can't access
            }
          }
        }
      }
      
      // Trim the text
      text = text ? text.trim() : '';
      
      if (!text) {
        console.log('ClipStash: No text found to capture');
        isProcessing = false;
        return;
      }
      
      // Debounce check - skip if same text captured recently
      const now = Date.now();
      if (text === lastCaptured && (now - lastCaptureTime) < DEBOUNCE_MS) {
        console.log('ClipStash: Debounced (duplicate within', DEBOUNCE_MS, 'ms)');
        isProcessing = false;
        return;
      }
      
      lastCaptured = text;
      lastCaptureTime = now;
      
      console.log('ClipStash: Captured text, length:', text.length, 'source:', source);
      
      // Send to background
      sendToBackground(text);
      
    } catch (error) {
      console.error('ClipStash: Error capturing selection:', error);
    } finally {
      // Reset processing flag after a short delay
      setTimeout(() => {
        isProcessing = false;
      }, 100);
    }
  }
  
  function sendToBackground(content) {
    const message = {
      type: 'SAVE_CLIP',
      data: {
        content: content,
        type: detectContentType(content),
        source: {
          url: window.location.href,
          title: document.title || window.location.hostname,
          hostname: window.location.hostname
        }
      }
    };
    
    console.log('ClipStash: Sending to background, type:', message.data.type);
    
    // Use try-catch for extension context errors
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(message)
          .then(response => {
            if (response && response.success) {
              console.log('ClipStash: ✓ Saved successfully!');
            } else if (response && response.duplicate) {
              console.log('ClipStash: ✓ Duplicate moved to top');
            } else {
              console.log('ClipStash: Response:', response);
            }
          })
          .catch(error => {
            // Handle extension context invalidated
            if (error.message && error.message.includes('Extension context invalidated')) {
              console.log('ClipStash: Extension was reloaded, refresh page to reconnect');
            } else {
              console.error('ClipStash: Send error:', error.message);
            }
          });
      }
    } catch (error) {
      console.error('ClipStash: Runtime not available:', error.message);
    }
  }
  
  function detectContentType(content) {
    // URL detection
    if (/^https?:\/\/\S+$/i.test(content)) {
      return 'url';
    }
    
    // Email detection
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) {
      return 'email';
    }
    
    // Phone number detection
    if (/^[\d\s\-\+\(\)\.]+$/.test(content) && content.replace(/\D/g, '').length >= 7) {
      return 'phone';
    }
    
    // Code detection (multiple heuristics)
    const codeIndicators = [
      /^(function|const|let|var|import|export|class|interface|type|enum)\s/m,
      /^(def|class|import|from|if __name__|print\()/m, // Python
      /^(public|private|protected|static|void|int|string)\s/m, // Java/C#
      /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s/i, // SQL
      /^<\?php|^<\/?[a-z]+[^>]*>/i, // PHP/HTML
      /[{}\[\]();].*[{}\[\]();]/, // Multiple brackets
      /^\s*(\/\/|\/\*|#|--)\s*\w/m, // Comments
      /=>\s*{|async\s+function|await\s+/,
      /\.(map|filter|reduce|forEach|find)\(/,
    ];
    
    // Check if content has code characteristics
    const hasCodeIndicator = codeIndicators.some(pattern => pattern.test(content));
    const hasMultipleLines = content.split('\n').length > 1;
    const hasIndentation = /^\s{2,}/m.test(content);
    
    if (hasCodeIndicator || (hasMultipleLines && hasIndentation)) {
      return 'code';
    }
    
    return 'text';
  }
  
})();
