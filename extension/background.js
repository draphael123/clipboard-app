// ClipStash - Background Service Worker
// Handles clipboard history storage, context menus, commands, and more

const MAX_HISTORY_SIZE = 100;
const STORAGE_KEY = 'clipstash_history';
const SETTINGS_KEY = 'clipstash_settings';
const STATS_KEY = 'clipstash_stats';

const DEFAULT_SETTINGS = {
  maxHistorySize: 100,
  autoDeleteDays: 0,
  excludedSites: [],
  showNotifications: true,
  detectSensitive: true,
  theme: 'system'
};

const DEFAULT_STATS = {
  totalClipsSaved: 0,
  totalCopiesFromHistory: 0,
  mostCopiedClips: []
};

const SENSITIVE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{48}$/,
  /^ghp_[a-zA-Z0-9]{36}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /^[a-f0-9]{32}$/,
  /password\s*[:=]\s*\S+/i,
  /^-----BEGIN.*PRIVATE KEY-----/m,
];

// Ensure storage is initialized
async function ensureInitialized() {
  const result = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, STATS_KEY]);
  
  if (!result[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  }
  if (!result[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
  if (!result[STATS_KEY]) {
    await chrome.storage.local.set({ [STATS_KEY]: DEFAULT_STATS });
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('ClipStash: Extension installed/updated');
  await ensureInitialized();
  createContextMenus();
  updateBadge();
});

// Also initialize on startup (service worker wake)
chrome.runtime.onStartup.addListener(async () => {
  console.log('ClipStash: Service worker starting');
  await ensureInitialized();
  createContextMenus();
  updateBadge();
});

// Create context menus
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'save-selection',
      title: 'Save to ClipStash',
      contexts: ['selection']
    });
    
    chrome.contextMenus.create({
      id: 'paste-recent',
      title: 'Paste from ClipStash',
      contexts: ['editable']
    });
    
    for (let i = 1; i <= 5; i++) {
      chrome.contextMenus.create({
        id: `paste-recent-${i}`,
        parentId: 'paste-recent',
        title: `${i}. (empty)`,
        contexts: ['editable']
      });
    }
    
    updateContextMenuClips();
  });
}

async function updateContextMenuClips() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    
    for (let i = 1; i <= 5; i++) {
      const clip = history[i - 1];
      const title = clip 
        ? `${i}. ${clip.content.substring(0, 40)}${clip.content.length > 40 ? '...' : ''}`
        : `${i}. (empty)`;
      
      chrome.contextMenus.update(`paste-recent-${i}`, { title }).catch(() => {});
    }
  } catch (e) {
    console.log('ClipStash: Could not update context menus', e);
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-selection' && info.selectionText) {
    const result = await saveClip({
      content: info.selectionText,
      type: detectContentType(info.selectionText),
      source: { url: tab?.url, title: tab?.title, hostname: new URL(tab?.url || 'http://unknown').hostname }
    });
    console.log('ClipStash: Saved from context menu', result);
  }
  
  if (info.menuItemId.startsWith('paste-recent-')) {
    const index = parseInt(info.menuItemId.split('-')[2]) - 1;
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    
    if (history[index] && tab?.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => {
          navigator.clipboard.writeText(text);
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            document.execCommand('insertText', false, text);
          }
        },
        args: [history[index].content]
      });
    }
  }
});

// Omnibox support
chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({
    description: 'Search ClipStash: type to search your clipboard history'
  });
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const history = result[STORAGE_KEY] || [];
  
  const query = text.toLowerCase();
  const matches = history
    .filter(clip => clip.content.toLowerCase().includes(query))
    .slice(0, 5)
    .map(clip => ({
      content: clip.content,
      description: `${clip.type} - ${escapeXml(clip.content.substring(0, 60))}${clip.content.length > 60 ? '...' : ''}`
    }));
  
  suggest(matches);
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => navigator.clipboard.writeText(text),
      args: [text]
    });
  }
});

// Keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command.startsWith('copy-recent-')) {
    const index = parseInt(command.split('-')[2]) - 1;
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    
    if (history[index]) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (text) => navigator.clipboard.writeText(text),
          args: [history[index].content]
        });
      }
    }
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('ClipStash: Received message', message.type);
  
  // Handle async
  (async () => {
    await ensureInitialized();
    
    let response;
    switch (message.type) {
      case 'SAVE_CLIP':
        response = await saveClip(message.data);
        break;
      case 'GET_HISTORY':
        response = await getHistory(message.filters);
        break;
      case 'DELETE_CLIP':
        response = await deleteClip(message.id);
        break;
      case 'CLEAR_HISTORY':
        response = await clearHistory();
        break;
      case 'PIN_CLIP':
        response = await togglePin(message.id);
        break;
      case 'GET_SETTINGS':
        response = await getSettings();
        break;
      case 'SAVE_SETTINGS':
        response = await saveSettings(message.settings);
        break;
      case 'GET_STATS':
        response = await getStats();
        break;
      case 'EXPORT_DATA':
        response = await exportData();
        break;
      case 'IMPORT_DATA':
        response = await importData(message.data);
        break;
      case 'SET_CATEGORY':
        response = await setCategory(message.id, message.category);
        break;
      case 'GET_CATEGORIES':
        response = await getCategories();
        break;
      case 'INCREMENT_COPY':
        response = await incrementCopyCount(message.id);
        break;
      case 'CHECK_STORAGE':
        response = await checkStorageQuota();
        break;
      default:
        response = { success: false, error: 'Unknown message type' };
    }
    
    console.log('ClipStash: Sending response', response);
    sendResponse(response);
  })();
  
  return true; // Keep channel open
});

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] };
}

async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getStats() {
  const result = await chrome.storage.local.get(STATS_KEY);
  return { success: true, stats: { ...DEFAULT_STATS, ...result[STATS_KEY] } };
}

async function incrementCopyCount(clipId) {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY, STATS_KEY]);
    let history = result[STORAGE_KEY] || [];
    let stats = { ...DEFAULT_STATS, ...result[STATS_KEY] };
    
    const clipIndex = history.findIndex(c => c.id === clipId);
    if (clipIndex !== -1) {
      history[clipIndex].copyCount = (history[clipIndex].copyCount || 0) + 1;
      stats.totalCopiesFromHistory++;
      
      await chrome.storage.local.set({ 
        [STORAGE_KEY]: history,
        [STATS_KEY]: stats
      });
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Save a new clip to history
async function saveClip(clipData) {
  try {
    console.log('ClipStash: Saving clip', clipData.content?.substring(0, 50));
    
    const settings = await getSettings();
    const result = await chrome.storage.local.get([STORAGE_KEY, STATS_KEY]);
    let history = result[STORAGE_KEY] || [];
    let stats = { ...DEFAULT_STATS, ...result[STATS_KEY] };
    
    // Check excluded sites
    if (clipData.source?.hostname && settings.excludedSites?.includes(clipData.source.hostname)) {
      console.log('ClipStash: Site excluded');
      return { success: true, excluded: true };
    }
    
    // Check for duplicates
    const existingIndex = history.findIndex(c => c.content === clipData.content);
    if (existingIndex !== -1) {
      // Move existing to top and update timestamp
      const existing = history.splice(existingIndex, 1)[0];
      existing.timestamp = Date.now();
      existing.source = clipData.source || existing.source;
      history.unshift(existing);
      await chrome.storage.local.set({ [STORAGE_KEY]: history });
      updateBadge();
      updateContextMenuClips();
      console.log('ClipStash: Duplicate moved to top');
      return { success: true, duplicate: true, updated: true };
    }
    
    // Detect sensitive content
    const isSensitive = settings.detectSensitive && detectSensitiveContent(clipData.content);
    
    const newClip = {
      id: generateId(),
      content: clipData.content,
      type: clipData.type || 'text',
      timestamp: Date.now(),
      source: clipData.source || { hostname: 'unknown' },
      pinned: false,
      category: null,
      copyCount: 0,
      isSensitive
    };
    
    // Add to beginning
    history.unshift(newClip);
    stats.totalClipsSaved++;
    
    // Apply max history size
    const maxSize = settings.maxHistorySize || MAX_HISTORY_SIZE;
    const pinned = history.filter(c => c.pinned);
    const unpinned = history.filter(c => !c.pinned);
    
    if (unpinned.length > maxSize) {
      history = [...pinned, ...unpinned.slice(0, maxSize)];
    }
    
    await chrome.storage.local.set({ 
      [STORAGE_KEY]: history,
      [STATS_KEY]: stats
    });
    
    updateBadge();
    updateContextMenuClips();
    
    console.log('ClipStash: Clip saved successfully, total clips:', history.length);
    return { success: true, clip: newClip };
  } catch (error) {
    console.error('ClipStash: Error saving clip:', error);
    return { success: false, error: error.message };
  }
}

function detectSensitiveContent(content) {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(content));
}

async function getHistory(filters = {}) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    
    if (filters.type && filters.type !== 'all') {
      history = history.filter(c => c.type === filters.type);
    }
    if (filters.category) {
      history = history.filter(c => c.category === filters.category);
    }
    if (filters.pinned) {
      history = history.filter(c => c.pinned);
    }
    if (filters.search) {
      const query = filters.search.toLowerCase();
      history = history.filter(c => c.content.toLowerCase().includes(query));
    }
    
    return { success: true, history };
  } catch (error) {
    console.error('ClipStash: Error getting history:', error);
    return { success: false, error: error.message };
  }
}

async function deleteClip(clipId) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    history = history.filter(clip => clip.id !== clipId);
    await chrome.storage.local.set({ [STORAGE_KEY]: history });
    updateBadge();
    updateContextMenuClips();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function clearHistory() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    updateBadge();
    updateContextMenuClips();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

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
    return { success: false, error: error.message };
  }
}

async function setCategory(clipId, category) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    const clipIndex = history.findIndex(c => c.id === clipId);
    
    if (clipIndex !== -1) {
      history[clipIndex].category = category;
      await chrome.storage.local.set({ [STORAGE_KEY]: history });
      return { success: true };
    }
    
    return { success: false, error: 'Clip not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getCategories() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    const categories = [...new Set(history.map(c => c.category).filter(Boolean))];
    return { success: true, categories };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function exportData() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, STATS_KEY]);
    return {
      success: true,
      data: {
        history: result[STORAGE_KEY] || [],
        settings: result[SETTINGS_KEY] || DEFAULT_SETTINGS,
        stats: result[STATS_KEY] || DEFAULT_STATS,
        exportDate: new Date().toISOString(),
        version: '1.1.0'
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function importData(data) {
  try {
    if (data.history) {
      await chrome.storage.local.set({ [STORAGE_KEY]: data.history });
    }
    if (data.settings) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: data.settings });
    }
    if (data.stats) {
      await chrome.storage.local.set({ [STATS_KEY]: data.stats });
    }
    
    updateBadge();
    updateContextMenuClips();
    
    return { success: true, imported: data.history?.length || 0 };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function checkStorageQuota() {
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse();
    const quota = chrome.storage.local.QUOTA_BYTES || 5242880;
    const percentUsed = (bytesInUse / quota) * 100;
    
    return {
      success: true,
      bytesInUse,
      quota,
      percentUsed: percentUsed.toFixed(1),
      warning: percentUsed > 80
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function updateBadge() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    const count = history.length;
    
    chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#5b3fd4' });
  } catch (error) {
    console.log('ClipStash: Could not update badge');
  }
}

function detectContentType(content) {
  if (/^https?:\/\/[^\s]+$/i.test(content)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return 'email';
  if (/^(function|const|let|var|import|export|class|if|for|while)\s/m.test(content) ||
      /[{}\[\]();]/.test(content) && content.includes('\n')) return 'code';
  if (/^[\d\s\-\+\(\)\.]+$/.test(content) && content.replace(/\D/g, '').length >= 7) return 'phone';
  return 'text';
}

function generateId() {
  return `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Log that service worker is active
console.log('ClipStash: Service worker loaded');
