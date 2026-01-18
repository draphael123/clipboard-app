// ClipStash v2.0 - Background Service Worker
// Full-featured clipboard manager

const STORAGE_KEYS = {
  history: 'clipstash_history',
  settings: 'clipstash_settings',
  stats: 'clipstash_stats',
  templates: 'clipstash_templates',
  workspaces: 'clipstash_workspaces',
  activeWorkspace: 'clipstash_active_workspace'
};

const DEFAULT_SETTINGS = {
  maxHistorySize: 200,
  autoDeleteDays: 0,
  excludedSites: [],
  showNotifications: false,
  detectSensitive: true,
  autoPaste: false,
  theme: 'system',
  defaultWorkspace: 'default'
};

const DEFAULT_STATS = {
  totalClipsSaved: 0,
  totalCopiesFromHistory: 0,
  totalImagesSaved: 0
};

const DEFAULT_WORKSPACES = [
  { id: 'default', name: 'Default', icon: '📋', color: '#5b3fd4' },
  { id: 'work', name: 'Work', icon: '💼', color: '#059669' },
  { id: 'code', name: 'Code', icon: '💻', color: '#0891b2' }
];

const SENSITIVE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}$/,
  /^ghp_[a-zA-Z0-9]{36}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /password\s*[:=]\s*\S+/i,
  /^-----BEGIN.*PRIVATE KEY-----/m,
  /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/,
];

let isInitialized = false;

// Initialize
async function init() {
  if (isInitialized) return;
  
  const defaults = {
    [STORAGE_KEYS.history]: [],
    [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
    [STORAGE_KEYS.stats]: DEFAULT_STATS,
    [STORAGE_KEYS.templates]: [],
    [STORAGE_KEYS.workspaces]: DEFAULT_WORKSPACES,
    [STORAGE_KEYS.activeWorkspace]: 'default'
  };
  
  const result = await chrome.storage.local.get(Object.keys(defaults));
  const updates = {};
  
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!result[key]) updates[key] = defaultValue;
  }
  
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  
  isInitialized = true;
}

init();

chrome.runtime.onInstalled.addListener(async () => {
  isInitialized = false;
  await init();
  await createContextMenus();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  isInitialized = false;
  await init();
  await createContextMenus();
  await updateBadge();
});

// Context Menus
async function createContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    
    chrome.contextMenus.create({ id: 'save-selection', title: 'Save to ClipStash', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'save-image', title: 'Save Image to ClipStash', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'paste-recent', title: 'Paste from ClipStash', contexts: ['editable'] });
    
    for (let i = 1; i <= 5; i++) {
      chrome.contextMenus.create({
        id: `paste-recent-${i}`,
        parentId: 'paste-recent',
        title: `${i}. (empty)`,
        contexts: ['editable']
      });
    }
    
    await updateContextMenuClips();
  } catch (e) {}
}

async function updateContextMenuClips() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.history);
    const history = result[STORAGE_KEYS.history] || [];
    
    for (let i = 1; i <= 5; i++) {
      const clip = history[i - 1];
      let title = `${i}. (empty)`;
      if (clip) {
        if (clip.type === 'image') {
          title = `${i}. 🖼️ Image`;
        } else {
          title = `${i}. ${clip.content.substring(0, 30)}${clip.content.length > 30 ? '...' : ''}`;
        }
      }
      await chrome.contextMenus.update(`paste-recent-${i}`, { title }).catch(() => {});
    }
  } catch (e) {}
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await init();
  
  if (info.menuItemId === 'save-selection' && info.selectionText) {
    await saveClip({
      content: info.selectionText,
      type: detectType(info.selectionText),
      source: { url: tab?.url, title: tab?.title, hostname: new URL(tab?.url || 'http://x').hostname }
    });
  }
  
  if (info.menuItemId === 'save-image' && info.srcUrl) {
    await saveClip({
      content: info.srcUrl,
      type: 'image',
      source: { url: tab?.url, title: tab?.title, hostname: new URL(tab?.url || 'http://x').hostname }
    });
  }
  
  if (info.menuItemId.startsWith('paste-recent-')) {
    const index = parseInt(info.menuItemId.split('-')[2]) - 1;
    const result = await chrome.storage.local.get(STORAGE_KEYS.history);
    const clip = (result[STORAGE_KEYS.history] || [])[index];
    
    if (clip && tab?.id && clip.type !== 'image') {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => {
          navigator.clipboard.writeText(text);
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            document.execCommand('insertText', false, text);
          }
        },
        args: [clip.content]
      }).catch(() => {});
    }
  }
});

// Commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command.startsWith('copy-recent-')) {
    await init();
    const index = parseInt(command.split('-')[2]) - 1;
    const result = await chrome.storage.local.get([STORAGE_KEYS.history, STORAGE_KEYS.settings]);
    const clip = (result[STORAGE_KEYS.history] || [])[index];
    const settings = result[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    
    if (clip && clip.type !== 'image') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const shouldPaste = settings.autoPaste;
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (text, paste) => {
            navigator.clipboard.writeText(text);
            if (paste) {
              const el = document.activeElement;
              if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
                document.execCommand('insertText', false, text);
              }
            }
          },
          args: [clip.content, shouldPaste]
        }).catch(() => {});
      }
    }
  }
});

// Omnibox
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  await init();
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = (result[STORAGE_KEYS.history] || []).filter(c => c.type !== 'image');
  
  const matches = history
    .filter(c => c.content.toLowerCase().includes(text.toLowerCase()))
    .slice(0, 5)
    .map(c => ({ content: c.content.substring(0, 100), description: c.content.substring(0, 60) }));
  
  suggest(matches);
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t) => navigator.clipboard.writeText(t),
      args: [text]
    }).catch(() => {});
  }
});

// Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(e => sendResponse({ success: false, error: e.message }));
  return true;
});

async function handleMessage(msg) {
  await init();
  
  switch (msg.type) {
    case 'SAVE_CLIP': return await saveClip(msg.data);
    case 'GET_HISTORY': return await getHistory(msg.filters);
    case 'DELETE_CLIP': return await deleteClip(msg.id);
    case 'CLEAR_HISTORY': return await clearHistory();
    case 'PIN_CLIP': return await togglePin(msg.id);
    case 'EDIT_CLIP': return await editClip(msg.id, msg.content);
    case 'MERGE_CLIPS': return await mergeClips(msg.ids, msg.separator);
    case 'SET_NOTE': return await setNote(msg.id, msg.note);
    case 'SET_CATEGORY': return await setCategory(msg.id, msg.category);
    case 'SET_WORKSPACE': return await setWorkspace(msg.id, msg.workspace);
    case 'GET_SETTINGS': return await getSettings();
    case 'SAVE_SETTINGS': return await saveSettings(msg.settings);
    case 'GET_STATS': return await getStats();
    case 'GET_TEMPLATES': return await getTemplates();
    case 'SAVE_TEMPLATE': return await saveTemplate(msg.template);
    case 'DELETE_TEMPLATE': return await deleteTemplate(msg.id);
    case 'GET_WORKSPACES': return await getWorkspaces();
    case 'SET_ACTIVE_WORKSPACE': return await setActiveWorkspace(msg.workspace);
    case 'CREATE_WORKSPACE': return await createWorkspace(msg.workspace);
    case 'DELETE_WORKSPACE': return await deleteWorkspace(msg.id);
    case 'SHARE_CLIP': return await shareClip(msg.id);
    case 'EXPORT_DATA': return await exportData();
    case 'IMPORT_DATA': return await importData(msg.data);
    case 'GET_CATEGORIES': return await getCategories();
    case 'INCREMENT_COPY': return await incrementCopy(msg.id);
    case 'CHECK_STORAGE': return await checkStorage();
    default: return { success: false, error: 'Unknown: ' + msg.type };
  }
}

// Core Functions
async function saveClip(data) {
  if (!data?.content) return { success: false, error: 'No content' };
  
  const result = await chrome.storage.local.get([STORAGE_KEYS.history, STORAGE_KEYS.stats, STORAGE_KEYS.settings, STORAGE_KEYS.activeWorkspace]);
  let history = result[STORAGE_KEYS.history] || [];
  let stats = { ...DEFAULT_STATS, ...result[STORAGE_KEYS.stats] };
  const settings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.settings] };
  const activeWorkspace = result[STORAGE_KEYS.activeWorkspace] || 'default';
  
  // Check excluded sites
  if (data.source?.hostname && settings.excludedSites?.includes(data.source.hostname)) {
    return { success: true, excluded: true };
  }
  
  // Check duplicates (for non-images)
  if (data.type !== 'image') {
    const existing = history.findIndex(c => c.content === data.content);
    if (existing !== -1) {
      const clip = history.splice(existing, 1)[0];
      clip.timestamp = Date.now();
      clip.source = data.source || clip.source;
      history.unshift(clip);
      await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
      updateBadge();
      updateContextMenuClips();
      return { success: true, duplicate: true };
    }
  }
  
  const clip = {
    id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    content: data.content,
    html: data.html || null,
    type: data.type || 'text',
    mimeType: data.mimeType || null,
    timestamp: Date.now(),
    source: data.source || { hostname: 'unknown' },
    pinned: false,
    category: null,
    workspace: activeWorkspace,
    note: null,
    copyCount: 0,
    isSensitive: settings.detectSensitive && data.type === 'text' && detectSensitive(data.content)
  };
  
  history.unshift(clip);
  stats.totalClipsSaved++;
  if (data.type === 'image') stats.totalImagesSaved++;
  
  // Enforce max size
  const maxSize = settings.maxHistorySize || 200;
  const pinned = history.filter(c => c.pinned);
  const unpinned = history.filter(c => !c.pinned);
  if (unpinned.length > maxSize) {
    history = [...pinned, ...unpinned.slice(0, maxSize)];
  }
  
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: history, [STORAGE_KEYS.stats]: stats });
  updateBadge();
  updateContextMenuClips();
  
  return { success: true, clip };
}

async function getHistory(filters = {}) {
  const result = await chrome.storage.local.get([STORAGE_KEYS.history, STORAGE_KEYS.activeWorkspace]);
  let history = result[STORAGE_KEYS.history] || [];
  const activeWorkspace = result[STORAGE_KEYS.activeWorkspace] || 'default';
  
  // Filter by workspace unless 'all' requested
  if (filters.workspace !== 'all') {
    const ws = filters.workspace || activeWorkspace;
    history = history.filter(c => !c.workspace || c.workspace === ws);
  }
  
  if (filters.type && filters.type !== 'all') history = history.filter(c => c.type === filters.type);
  if (filters.category) history = history.filter(c => c.category === filters.category);
  if (filters.pinned) history = history.filter(c => c.pinned);
  if (filters.source) history = history.filter(c => c.source?.hostname === filters.source);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    history = history.filter(c => c.type !== 'image' && c.content.toLowerCase().includes(q));
  }
  
  return { success: true, history };
}

async function deleteClip(id) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = (result[STORAGE_KEYS.history] || []).filter(c => c.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
  updateBadge();
  updateContextMenuClips();
  return { success: true };
}

async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
  updateBadge();
  updateContextMenuClips();
  return { success: true };
}

async function togglePin(id) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = result[STORAGE_KEYS.history] || [];
  const clip = history.find(c => c.id === id);
  if (clip) {
    clip.pinned = !clip.pinned;
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
    return { success: true, pinned: clip.pinned };
  }
  return { success: false, error: 'Not found' };
}

async function editClip(id, content) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = result[STORAGE_KEYS.history] || [];
  const clip = history.find(c => c.id === id);
  if (clip && clip.type !== 'image') {
    clip.content = content;
    clip.editedAt = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
    return { success: true };
  }
  return { success: false, error: 'Not found or is image' };
}

async function mergeClips(ids, separator = '\n') {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = result[STORAGE_KEYS.history] || [];
  const clips = ids.map(id => history.find(c => c.id === id)).filter(c => c && c.type !== 'image');
  
  if (clips.length < 2) return { success: false, error: 'Need at least 2 text clips' };
  
  const merged = clips.map(c => c.content).join(separator);
  return await saveClip({ content: merged, type: 'text', source: { hostname: 'merged' } });
}

async function setNote(id, note) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = result[STORAGE_KEYS.history] || [];
  const clip = history.find(c => c.id === id);
  if (clip) {
    clip.note = note || null;
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
    return { success: true };
  }
  return { success: false, error: 'Not found' };
}

async function setCategory(id, category) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = result[STORAGE_KEYS.history] || [];
  const clip = history.find(c => c.id === id);
  if (clip) {
    clip.category = category || null;
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
    return { success: true };
  }
  return { success: false, error: 'Not found' };
}

async function setWorkspace(id, workspace) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const history = result[STORAGE_KEYS.history] || [];
  const clip = history.find(c => c.id === id);
  if (clip) {
    clip.workspace = workspace;
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
    return { success: true };
  }
  return { success: false, error: 'Not found' };
}

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.settings] };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  return { success: true };
}

async function getStats() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.stats);
  return { success: true, stats: { ...DEFAULT_STATS, ...result[STORAGE_KEYS.stats] } };
}

async function getTemplates() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.templates);
  return { success: true, templates: result[STORAGE_KEYS.templates] || [] };
}

async function saveTemplate(template) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.templates);
  const templates = result[STORAGE_KEYS.templates] || [];
  
  if (template.id) {
    const idx = templates.findIndex(t => t.id === template.id);
    if (idx !== -1) templates[idx] = template;
    else templates.push(template);
  } else {
    template.id = `tpl_${Date.now()}`;
    templates.push(template);
  }
  
  await chrome.storage.local.set({ [STORAGE_KEYS.templates]: templates });
  return { success: true, template };
}

async function deleteTemplate(id) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.templates);
  const templates = (result[STORAGE_KEYS.templates] || []).filter(t => t.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.templates]: templates });
  return { success: true };
}

async function getWorkspaces() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.workspaces, STORAGE_KEYS.activeWorkspace]);
  return {
    success: true,
    workspaces: result[STORAGE_KEYS.workspaces] || DEFAULT_WORKSPACES,
    active: result[STORAGE_KEYS.activeWorkspace] || 'default'
  };
}

async function setActiveWorkspace(workspace) {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeWorkspace]: workspace });
  return { success: true };
}

async function createWorkspace(workspace) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.workspaces);
  const workspaces = result[STORAGE_KEYS.workspaces] || DEFAULT_WORKSPACES;
  workspace.id = `ws_${Date.now()}`;
  workspaces.push(workspace);
  await chrome.storage.local.set({ [STORAGE_KEYS.workspaces]: workspaces });
  return { success: true, workspace };
}

async function deleteWorkspace(id) {
  if (id === 'default') return { success: false, error: 'Cannot delete default' };
  const result = await chrome.storage.local.get(STORAGE_KEYS.workspaces);
  const workspaces = (result[STORAGE_KEYS.workspaces] || []).filter(w => w.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.workspaces]: workspaces });
  return { success: true };
}

async function shareClip(id) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const clip = (result[STORAGE_KEYS.history] || []).find(c => c.id === id);
  
  if (!clip || clip.type === 'image') {
    return { success: false, error: 'Cannot share images or not found' };
  }
  
  // Create a simple share URL using a free paste service simulation
  const encoded = btoa(encodeURIComponent(clip.content));
  const shareUrl = `data:text/html,<pre>${encodeURIComponent(clip.content)}</pre>`;
  
  return { success: true, shareUrl, content: clip.content };
}

async function exportData() {
  const result = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    success: true,
    data: {
      history: result[STORAGE_KEYS.history] || [],
      settings: result[STORAGE_KEYS.settings] || DEFAULT_SETTINGS,
      stats: result[STORAGE_KEYS.stats] || DEFAULT_STATS,
      templates: result[STORAGE_KEYS.templates] || [],
      workspaces: result[STORAGE_KEYS.workspaces] || DEFAULT_WORKSPACES,
      exportDate: new Date().toISOString(),
      version: '2.0.0'
    }
  };
}

async function importData(data) {
  const updates = {};
  if (data.history) updates[STORAGE_KEYS.history] = data.history;
  if (data.settings) updates[STORAGE_KEYS.settings] = data.settings;
  if (data.stats) updates[STORAGE_KEYS.stats] = data.stats;
  if (data.templates) updates[STORAGE_KEYS.templates] = data.templates;
  if (data.workspaces) updates[STORAGE_KEYS.workspaces] = data.workspaces;
  
  await chrome.storage.local.set(updates);
  updateBadge();
  updateContextMenuClips();
  return { success: true, imported: data.history?.length || 0 };
}

async function getCategories() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.history);
  const cats = [...new Set((result[STORAGE_KEYS.history] || []).map(c => c.category).filter(Boolean))];
  return { success: true, categories: cats };
}

async function incrementCopy(id) {
  const result = await chrome.storage.local.get([STORAGE_KEYS.history, STORAGE_KEYS.stats]);
  const history = result[STORAGE_KEYS.history] || [];
  let stats = { ...DEFAULT_STATS, ...result[STORAGE_KEYS.stats] };
  
  const clip = history.find(c => c.id === id);
  if (clip) {
    clip.copyCount = (clip.copyCount || 0) + 1;
    stats.totalCopiesFromHistory++;
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: history, [STORAGE_KEYS.stats]: stats });
  }
  return { success: true };
}

async function checkStorage() {
  const bytes = await chrome.storage.local.getBytesInUse();
  const quota = chrome.storage.local.QUOTA_BYTES || 5242880;
  return { success: true, bytesInUse: bytes, quota, percentUsed: ((bytes / quota) * 100).toFixed(1) };
}

async function updateBadge() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.history);
    const count = (result[STORAGE_KEYS.history] || []).length;
    await chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#5b3fd4' });
  } catch (e) {}
}

function detectType(text) {
  if (/^https?:\/\/\S+$/i.test(text)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email';
  if (/^[\d\s\-\+\(\)\.]+$/.test(text) && text.replace(/\D/g, '').length >= 7) return 'phone';
  if (/[{}\[\]();]/.test(text) || /^(const|let|var|function|import|def|class|SELECT)\s/mi.test(text)) return 'code';
  return 'text';
}

function detectSensitive(text) {
  return SENSITIVE_PATTERNS.some(p => p.test(text));
}

console.log('ClipStash v2.0 loaded');
