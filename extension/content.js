// ClipStash - Content Script
// Detects copy events on web pages and sends to background worker

console.log('ClipStash: Content script loaded on', window.location.hostname);

// Listen for copy events with capture phase to catch before other handlers
document.addEventListener('copy', handleCopy, true);
window.addEventListener('copy', handleCopy, true);

// Also listen for keyboard shortcut as backup
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    console.log('ClipStash: Ctrl+C detected');
    // Give time for clipboard to update
    setTimeout(captureFromSelection, 100);
  }
}, true);

function handleCopy(event) {
  console.log('ClipStash: Copy event detected');
  
  // Try to get from event's clipboardData first
  if (event.clipboardData) {
    const text = event.clipboardData.getData('text/plain');
    if (text && text.trim()) {
      console.log('ClipStash: Got from clipboardData, length:', text.length);
      sendToBackground(text.trim());
      return;
    }
  }
  
  // Fallback to selection
  captureFromSelection();
}

function captureFromSelection() {
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';
  
  if (selectedText) {
    console.log('ClipStash: Got from selection, length:', selectedText.length);
    sendToBackground(selectedText);
  } else {
    console.log('ClipStash: No text found in selection');
  }
}

function sendToBackground(content) {
  if (!content || content.length === 0) {
    console.log('ClipStash: Empty content, skipping');
    return;
  }
  
  const source = {
    url: window.location.href,
    title: document.title,
    hostname: window.location.hostname
  };
  
  const message = {
    type: 'SAVE_CLIP',
    data: {
      content: content,
      type: detectContentType(content),
      source: source
    }
  };
  
  console.log('ClipStash: Sending to background -', message.data.type, '- length:', content.length);
  
  chrome.runtime.sendMessage(message)
    .then(response => {
      if (response && response.success) {
        console.log('ClipStash: Saved successfully!');
      } else {
        console.log('ClipStash: Save response:', response);
      }
    })
    .catch(error => {
      console.error('ClipStash: Error sending message:', error);
    });
}

function detectContentType(content) {
  if (/^https?:\/\/[^\s]+$/i.test(content)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return 'email';
  if (/^(function|const|let|var|import|export|class|if|for|while)\s/m.test(content) ||
      (/[{}\[\]();]/.test(content) && content.includes('\n'))) return 'code';
  if (/^[\d\s\-\+\(\)\.]+$/.test(content) && content.replace(/\D/g, '').length >= 7) return 'phone';
  return 'text';
}
