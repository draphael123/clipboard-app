// ClipStash - Background Service Worker
// Handles clipboard history storage, context menus, commands, and more

const MAX_HISTORY_SIZE = 100;
const STORAGE_KEY = 'clipstash_history';
const SETTINGS_KEY = 'clipstash_settings';
const STATS_KEY = 'clipstash_stats';

const DEFAULT_SETTINGS = {
  maxHistorySize: 100,
  autoDeleteDays: 0, // 0 = never
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

// Sensitive patterns to detect
const SENSITIVE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{48}$/,  // OpenAI API key
  /^ghp_[a-zA-Z0-9]{36}$/, // GitHub token
  /^AKIA[0-9A-Z]{16}$/,    // AWS Access Key
  /^[a-f0-9]{32}$/,        // Generic 32-char hex (could be API key)
  /password\s*[:=]\s*\S+/i, // Password patterns
  /^-----BEGIN.*PRIVATE KEY-----/m, // Private keys
];

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  // Initialize storage
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
  
  // Create context menus
  createContextMenus();
  
  // Update badge
  updateBadge();
  
  console.log('ClipStash initialized');
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
      id: 'separator-1',
      type: 'separator',
      contexts: ['selection', 'editable']
    });
    
    chrome.contextMenus.create({
      id: 'paste-recent',
      title: 'Paste from ClipStash',
      contexts: ['editable']
    });
    
    // Add submenu for recent clips
    for (let i = 1; i <= 5; i++) {
      chrome.contextMenus.create({
        id: `paste-recent-${i}`,
        parentId: 'paste-recent',
        title: `Loading...`,
        contexts: ['editable']
      });
    }
    
    updateContextMenuClips();
  });
}

// Update context menu with recent clips
async function updateContextMenuClips() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const history = result[STORAGE_KEY] || [];
  
  for (let i = 1; i <= 5; i++) {
    const clip = history[i - 1];
    const title = clip 
      ? `${i}. ${clip.content.substring(0, 40)}${clip.content.length > 40 ? '...' : ''}`
      : `${i}. (empty)`;
    
    try {
      chrome.contextMenus.update(`paste-recent-${i}`, { title });
    } catch (e) {
      // Menu might not exist yet
    }
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-selection' && info.selectionText) {
    await saveClip({
      content: info.selectionText,
      type: detectContentType(info.selectionText),
      source: { url: tab?.url, title: tab?.title, hostname: new URL(tab?.url || '').hostname }
    });
    
    const settings = await getSettings();
    if (settings.showNotifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'ClipStash',
        message: 'Selection saved to clipboard history!'
      });
    }
  }
  
  if (info.menuItemId.startsWith('paste-recent-')) {
    const index = parseInt(info.menuItemId.split('-')[2]) - 1;
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    
    if (history[index]) {
      // Copy to clipboard
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => {
          navigator.clipboard.writeText(text);
          // Also paste into focused element
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            document.execCommand('insertText', false, text);
          }
        },
        args: [history[index].content]
      });
      
      await incrementCopyCount(history[index].id);
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
      description: `<dim>${clip.type}</dim> - ${escapeXml(clip.content.substring(0, 60))}${clip.content.length > 60 ? '...' : ''}`
    }));
  
  suggest(matches);
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  // Copy the selected/entered text
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const history = result[STORAGE_KEY] || [];
  
  // Find exact match or use input text
  const match = history.find(clip => clip.content === text);
  const content = match ? match.content : text;
  
  // Copy to clipboard via active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => navigator.clipboard.writeText(text),
      args: [content]
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
        
        await incrementCopyCount(history[index].id);
        
        const settings = await getSettings();
        if (settings.showNotifications) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'ClipStash',
            message: `Copied: "${history[index].content.substring(0, 50)}..."`
          });
        }
      }
    }
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'SAVE_CLIP':
      return await saveClip(message.data);
    case 'GET_HISTORY':
      return await getHistory(message.filters);
    case 'DELETE_CLIP':
      return await deleteClip(message.id);
    case 'CLEAR_HISTORY':
      return await clearHistory();
    case 'PIN_CLIP':
      return await togglePin(message.id);
    case 'GET_SETTINGS':
      return await getSettings();
    case 'SAVE_SETTINGS':
      return await saveSettings(message.settings);
    case 'GET_STATS':
      return await getStats();
    case 'EXPORT_DATA':
      return await exportData();
    case 'IMPORT_DATA':
      return await importData(message.data);
    case 'SET_CATEGORY':
      return await setCategory(message.id, message.category);
    case 'GET_CATEGORIES':
      return await getCategories();
    case 'INCREMENT_COPY':
      return await incrementCopyCount(message.id);
    case 'CHECK_STORAGE':
      return await checkStorageQuota();
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// Get settings
async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] };
}

// Save settings
async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get stats
async function getStats() {
  const result = await chrome.storage.local.get(STATS_KEY);
  return { success: true, stats: { ...DEFAULT_STATS, ...result[STATS_KEY] } };
}

// Increment copy count for a clip
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
    const settings = await getSettings();
    const result = await chrome.storage.local.get([STORAGE_KEY, STATS_KEY]);
    let history = result[STORAGE_KEY] || [];
    let stats = { ...DEFAULT_STATS, ...result[STATS_KEY] };
    
    // Check excluded sites
    if (clipData.source?.hostname && settings.excludedSites.includes(clipData.source.hostname)) {
      return { success: true, excluded: true };
    }
    
    // Check for duplicates (improved - check all history)
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
      return { success: true, duplicate: true, updated: true };
    }
    
    // Detect sensitive content
    const isSensitive = settings.detectSensitive && detectSensitiveContent(clipData.content);
    
    const newClip = {
      id: generateId(),
      content: clipData.content,
      type: clipData.type || 'text',
      timestamp: Date.now(),
      source: clipData.source || 'unknown',
      pinned: false,
      category: null,
      copyCount: 0,
      isSensitive
    };
    
    // Add to beginning of array
    history.unshift(newClip);
    stats.totalClipsSaved++;
    
    // Apply max history size from settings
    const maxSize = settings.maxHistorySize || MAX_HISTORY_SIZE;
    const pinned = history.filter(c => c.pinned);
    const unpinned = history.filter(c => !c.pinned);
    
    if (unpinned.length > maxSize) {
      history = [...pinned, ...unpinned.slice(0, maxSize)];
    }
    
    // Auto-delete old clips if setting is enabled
    if (settings.autoDeleteDays > 0) {
      const cutoff = Date.now() - (settings.autoDeleteDays * 24 * 60 * 60 * 1000);
      history = history.filter(c => c.pinned || c.timestamp > cutoff);
    }
    
    await chrome.storage.local.set({ 
      [STORAGE_KEY]: history,
      [STATS_KEY]: stats
    });
    
    updateBadge();
    updateContextMenuClips();
    
    // Warn about sensitive content
    if (isSensitive && settings.showNotifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'ClipStash - Sensitive Content',
        message: 'This clip may contain sensitive data (API key, password, etc.)'
      });
    }
    
    return { success: true, clip: newClip, isSensitive };
  } catch (error) {
    console.error('Error saving clip:', error);
    return { success: false, error: error.message };
  }
}

// Detect sensitive content
function detectSensitiveContent(content) {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(content));
}

// Get clipboard history with optional filters
async function getHistory(filters = {}) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    
    // Apply filters
    if (filters.type && filters.type !== 'all') {
      history = history.filter(c => c.type === filters.type);
    }
    
    if (filters.category) {
      history = history.filter(c => c.category === filters.category);
    }
    
    if (filters.pinned) {
      history = history.filter(c => c.pinned);
    }
    
    if (filters.startDate) {
      history = history.filter(c => c.timestamp >= filters.startDate);
    }
    
    if (filters.endDate) {
      history = history.filter(c => c.timestamp <= filters.endDate);
    }
    
    if (filters.search) {
      const query = filters.search.toLowerCase();
      history = history.filter(c => c.content.toLowerCase().includes(query));
    }
    
    return { success: true, history };
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
    updateBadge();
    updateContextMenuClips();
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
    updateBadge();
    updateContextMenuClips();
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

// Set category for a clip
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

// Get all categories
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

// Export all data
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

// Import data
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

// Check storage quota
async function checkStorageQuota() {
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse();
    const quota = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB default
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

// Update badge with clip count
async function updateBadge() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    const count = history.length;
    
    chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#5b3fd4' });
  } catch (error) {
    console.error('Error updating badge:', error);
  }
}

// Content type detection
function detectContentType(content) {
  if (/^https?:\/\/[^\s]+$/i.test(content)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return 'email';
  if (/^(function|const|let|var|import|export|class|if|for|while)\s/m.test(content) ||
      /[{}\[\]();]/.test(content) && content.includes('\n')) return 'code';
  if (/^[\d\s\-\+\(\)\.]+$/.test(content) && content.replace(/\D/g, '').length >= 7) return 'phone';
  return 'text';
}

// Generate unique ID
function generateId() {
  return `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Escape XML for omnibox
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
