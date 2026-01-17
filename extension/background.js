// ClipStash - Background Service Worker
// Handles clipboard history storage and management

const MAX_HISTORY_SIZE = 100;
const STORAGE_KEY = 'clipstash_history';

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  }
  console.log('ClipStash initialized');
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_CLIP') {
    saveClip(message.data).then(sendResponse);
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'GET_HISTORY') {
    getHistory().then(sendResponse);
    return true;
  }
  
  if (message.type === 'DELETE_CLIP') {
    deleteClip(message.id).then(sendResponse);
    return true;
  }
  
  if (message.type === 'CLEAR_HISTORY') {
    clearHistory().then(sendResponse);
    return true;
  }
  
  if (message.type === 'PIN_CLIP') {
    togglePin(message.id).then(sendResponse);
    return true;
  }
});

// Save a new clip to history
async function saveClip(clipData) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    
    // Check for duplicates (don't add if same as most recent)
    if (history.length > 0 && history[0].content === clipData.content) {
      return { success: true, duplicate: true };
    }
    
    const newClip = {
      id: generateId(),
      content: clipData.content,
      type: clipData.type || 'text',
      timestamp: Date.now(),
      source: clipData.source || 'unknown',
      pinned: false
    };
    
    // Add to beginning of array
    history.unshift(newClip);
    
    // Keep pinned items, trim unpinned to max size
    const pinned = history.filter(c => c.pinned);
    const unpinned = history.filter(c => !c.pinned);
    
    if (unpinned.length > MAX_HISTORY_SIZE) {
      history = [...pinned, ...unpinned.slice(0, MAX_HISTORY_SIZE)];
    }
    
    await chrome.storage.local.set({ [STORAGE_KEY]: history });
    return { success: true, clip: newClip };
  } catch (error) {
    console.error('Error saving clip:', error);
    return { success: false, error: error.message };
  }
}

// Get full clipboard history
async function getHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return { success: true, history: result[STORAGE_KEY] || [] };
  } catch (error) {
    console.error('Error getting history:', error);
    return { success: false, error: error.message };
  }
}

// Delete a specific clip
async function deleteClip(clipId) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    history = history.filter(clip => clip.id !== clipId);
    await chrome.storage.local.set({ [STORAGE_KEY]: history });
    return { success: true };
  } catch (error) {
    console.error('Error deleting clip:', error);
    return { success: false, error: error.message };
  }
}

// Clear all history
async function clearHistory() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    return { success: true };
  } catch (error) {
    console.error('Error clearing history:', error);
    return { success: false, error: error.message };
  }
}

// Toggle pin status
async function togglePin(clipId) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    const clipIndex = history.findIndex(c => c.id === clipId);
    
    if (clipIndex !== -1) {
      history[clipIndex].pinned = !history[clipIndex].pinned;
      await chrome.storage.local.set({ [STORAGE_KEY]: history });
      return { success: true, pinned: history[clipIndex].pinned };
    }
    
    return { success: false, error: 'Clip not found' };
  } catch (error) {
    console.error('Error toggling pin:', error);
    return { success: false, error: error.message };
  }
}

// Generate unique ID
function generateId() {
  return `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

