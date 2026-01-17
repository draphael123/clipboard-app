// ClipStash - Content Script
// Detects copy events on web pages and sends to background worker

console.log('ClipStash: Content script loaded on', window.location.hostname);

// Listen for copy events
document.addEventListener('copy', handleCopy);

function handleCopy(event) {
  console.log('ClipStash: Copy event detected');
  
  // Get selected text
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';
  
  if (selectedText) {
    console.log('ClipStash: Got selection, length:', selectedText.length);
    sendToBackground(selectedText);
  } else {
    console.log('ClipStash: No selection found');
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
  
  console.log('ClipStash: Sending to background', message.data.type);
  
  chrome.runtime.sendMessage(message)
    .then(response => {
      console.log('ClipStash: Background response', response);
    })
    .catch(error => {
      console.log('ClipStash: Error sending message', error);
    });
}

function detectContentType(content) {
  if (/^https?:\/\/[^\s]+$/i.test(content)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return 'email';
  if (/^(function|const|let|var|import|export|class|if|for|while)\s/m.test(content) ||
      /[{}\[\]();]/.test(content) && content.includes('\n')) return 'code';
  if (/^[\d\s\-\+\(\)\.]+$/.test(content) && content.replace(/\D/g, '').length >= 7) return 'phone';
  return 'text';
}
