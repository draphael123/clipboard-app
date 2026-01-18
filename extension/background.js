// ClipStash - Background Service Worker (Robust Version)
// Handles clipboard history storage, context menus, commands

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
  totalCopiesFromHistory: 0
};

const SENSITIVE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}$/,
  /^ghp_[a-zA-Z0-9]{36}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /password\s*[:=]\s*\S+/i,
  /^-----BEGIN.*PRIVATE KEY-----/m,
  /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/,  // JWT token
];

// Initialize storage immediately
let isInitialized = false;

async function ensureInitialized() {
  if (isInitialized) return;
  
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, STATS_KEY]);
    
    const updates = {};
    if (!result[STORAGE_KEY]) updates[STORAGE_KEY] = [];
    if (!result[SETTINGS_KEY]) updates[SETTINGS_KEY] = DEFAULT_SETTINGS;
    if (!result[STATS_KEY]) updates[STATS_KEY] = DEFAULT_STATS;
    
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
    
    isInitialized = true;
    console.log('ClipStash: Storage initialized');
  } catch (error) {
    console.error('ClipStash: Init error:', error);
  }
}

// Initialize on service worker start
ensureInitialized();

// Also initialize on install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('ClipStash: Installed/updated, reason:', details.reason);
  isInitialized = false;
  await ensureInitialized();
  await createContextMenus();
  await updateBadge();
});

// Initialize on browser startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('ClipStash: Browser startup');
  isInitialized = false;
  await ensureInitialized();
  await createContextMenus();
  await updateBadge();
});

// Context Menus
async function createContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    
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
    
    await updateContextMenuClips();
    console.log('ClipStash: Context menus created');
  } catch (error) {
    console.log('ClipStash: Context menu error:', error.message);
  }
}

async function updateContextMenuClips() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    
    for (let i = 1; i <= 5; i++) {
      const clip = history[i - 1];
      const title = clip 
        ? `${i}. ${clip.content.substring(0, 35)}${clip.content.length > 35 ? '...' : ''}`
        : `${i}. (empty)`;
      
      await chrome.contextMenus.update(`paste-recent-${i}`, { title }).catch(() => {});
    }
  } catch (error) {
    // Silently fail - menus might not exist yet
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ensureInitialized();
  
  if (info.menuItemId === 'save-selection' && info.selectionText) {
    const hostname = tab?.url ? new URL(tab.url).hostname : 'unknown';
    await saveClip({
      content: info.selectionText,
      type: detectContentType(info.selectionText),
      source: { url: tab?.url, title: tab?.title, hostname }
    });
    console.log('ClipStash: Saved from context menu');
  }
  
  if (info.menuItemId.startsWith('paste-recent-')) {
    const index = parseInt(info.menuItemId.split('-')[2]) - 1;
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    
    if (history[index] && tab?.id) {
      try {
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
      } catch (error) {
        console.log('ClipStash: Could not paste:', error.message);
      }
    }
  }
});

// Omnibox
chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({
    description: 'Search your clipboard history'
  });
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  await ensureInitialized();
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const history = result[STORAGE_KEY] || [];
  
  const query = text.toLowerCase();
  const matches = history
    .filter(clip => clip.content.toLowerCase().includes(query))
    .slice(0, 5)
    .map(clip => ({
      content: clip.content.substring(0, 100),
      description: escapeXml(clip.content.substring(0, 60))
    }));
  
  suggest(matches);
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => navigator.clipboard.writeText(text),
        args: [text]
      });
    } catch (error) {
      console.log('ClipStash: Omnibox copy error:', error.message);
    }
  }
});

// Keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command.startsWith('copy-recent-')) {
    await ensureInitialized();
    const index = parseInt(command.split('-')[2]) - 1;
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY] || [];
    
    if (history[index]) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (text) => navigator.clipboard.writeText(text),
            args: [history[index].content]
          });
          console.log('ClipStash: Quick-copied clip', index + 1);
        } catch (error) {
          console.log('ClipStash: Quick-copy error:', error.message);
        }
      }
    }
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Log the message type
  console.log('ClipStash: Message received:', message.type);
  
  // Handle async
  handleMessage(message).then(response => {
    console.log('ClipStash: Responding:', response?.success ?? response);
    sendResponse(response);
  }).catch(error => {
    console.error('ClipStash: Message handler error:', error);
    sendResponse({ success: false, error: error.message });
  });
  
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  await ensureInitialized();
  
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
      return { success: false, error: 'Unknown message type: ' + message.type };
  }
}

// Core functions
async function saveClip(clipData) {
  try {
    if (!clipData?.content) {
      return { success: false, error: 'No content provided' };
    }
    
    const content = clipData.content.trim();
    if (!content) {
      return { success: false, error: 'Empty content' };
    }
    
    console.log('ClipStash: Saving clip, length:', content.length);
    
    const settings = await getSettings();
    const result = await chrome.storage.local.get([STORAGE_KEY, STATS_KEY]);
    let history = result[STORAGE_KEY] || [];
    let stats = { ...DEFAULT_STATS, ...result[STATS_KEY] };
    
    // Check excluded sites
    const hostname = clipData.source?.hostname || '';
    if (hostname && settings.excludedSites?.includes(hostname)) {
      console.log('ClipStash: Site excluded:', hostname);
      return { success: true, excluded: true };
    }
    
    // Check for duplicates (exact match)
    const existingIndex = history.findIndex(c => c.content === content);
    if (existingIndex !== -1) {
      // Move to top and update timestamp
      const existing = history.splice(existingIndex, 1)[0];
      existing.timestamp = Date.now();
      existing.source = clipData.source || existing.source;
      history.unshift(existing);
      
      await chrome.storage.local.set({ [STORAGE_KEY]: history });
      updateBadge();
      updateContextMenuClips();
      
      console.log('ClipStash: Duplicate moved to top');
      return { success: true, duplicate: true };
    }
    
    // Detect sensitive content
    const isSensitive = settings.detectSensitive && detectSensitiveContent(content);
    
    // Create new clip
    const newClip = {
      id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content: content,
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
    
    // Enforce max size (keep pinned items)
    const maxSize = settings.maxHistorySize || MAX_HISTORY_SIZE;
    const pinned = history.filter(c => c.pinned);
    const unpinned = history.filter(c => !c.pinned);
    
    if (unpinned.length > maxSize) {
      history = [...pinned, ...unpinned.slice(0, maxSize)];
    }
    
    // Save
    await chrome.storage.local.set({ 
      [STORAGE_KEY]: history,
      [STATS_KEY]: stats
    });
    
    updateBadge();
    updateContextMenuClips();
    
    console.log('ClipStash: Saved! Total clips:', history.length);
    return { success: true, clip: newClip };
    
  } catch (error) {
    console.error('ClipStash: Save error:', error);
    return { success: false, error: error.message };
  }
}

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
    if (filters.search) {
      const query = filters.search.toLowerCase();
      history = history.filter(c => c.content.toLowerCase().includes(query));
    }
    
    return { success: true, history };
  } catch (error) {
    return { success: false, error: error.message, history: [] };
  }
}

async function deleteClip(clipId) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    history = history.filter(c => c.id !== clipId);
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
    const clip = history.find(c => c.id === clipId);
    
    if (clip) {
      clip.pinned = !clip.pinned;
      await chrome.storage.local.set({ [STORAGE_KEY]: history });
      return { success: true, pinned: clip.pinned };
    }
    return { success: false, error: 'Clip not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

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
    
    const clip = history.find(c => c.id === clipId);
    if (clip) {
      clip.copyCount = (clip.copyCount || 0) + 1;
      stats.totalCopiesFromHistory++;
      await chrome.storage.local.set({ [STORAGE_KEY]: history, [STATS_KEY]: stats });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function setCategory(clipId, category) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let history = result[STORAGE_KEY] || [];
    const clip = history.find(c => c.id === clipId);
    
    if (clip) {
      clip.category = category || null;
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
    return { success: false, error: error.message, categories: [] };
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
        version: '1.2.0'
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function importData(data) {
  try {
    if (data.history) await chrome.storage.local.set({ [STORAGE_KEY]: data.history });
    if (data.settings) await chrome.storage.local.set({ [SETTINGS_KEY]: data.settings });
    if (data.stats) await chrome.storage.local.set({ [STATS_KEY]: data.stats });
    
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
    const count = (result[STORAGE_KEY] || []).length;
    await chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#5b3fd4' });
  } catch (error) {
    // Badge update failed - not critical
  }
}

function detectContentType(content) {
  if (/^https?:\/\/\S+$/i.test(content)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return 'email';
  if (/^[\d\s\-\+\(\)\.]+$/.test(content) && content.replace(/\D/g, '').length >= 7) return 'phone';
  
  const codePatterns = [
    /^(function|const|let|var|import|export|class|def|public|private)\s/m,
    /^(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/i,
    /[{}\[\]();].*\n.*[{}\[\]();]/,
  ];
  if (codePatterns.some(p => p.test(content))) return 'code';
  
  return 'text';
}

function detectSensitiveContent(content) {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(content));
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

console.log('ClipStash: Service worker loaded');
