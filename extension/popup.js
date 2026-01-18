// ClipStash v2.0 - Popup Logic

let clips = [];
let workspaces = [];
let templates = [];
let activeWorkspace = 'default';
let currentTab = 'all';
let searchQuery = '';
let typeFilter = 'all';
let selectedClips = new Set();
let editingClipId = null;
let noteClipId = null;
let selectedEmoji = '📋';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadWorkspaces();
  await loadClips();
  await loadTemplates();
  setupListeners();
}

function setupListeners() {
  // Search
  document.getElementById('searchBtn').addEventListener('click', toggleSearch);
  document.getElementById('searchInput').addEventListener('input', e => { searchQuery = e.target.value; renderClips(); });
  document.getElementById('typeFilter').addEventListener('change', e => { typeFilter = e.target.value; renderClips(); });
  
  // Buttons
  document.getElementById('templatesBtn').addEventListener('click', () => openModal('templatesModal'));
  document.getElementById('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('addWorkspaceBtn').addEventListener('click', () => openModal('workspaceModal'));
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('mergeBtn').addEventListener('click', mergeSelected);
  
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  
  // Modals
  document.getElementById('saveEditBtn').addEventListener('click', saveEdit);
  document.getElementById('saveNoteBtn').addEventListener('click', saveNote);
  document.getElementById('saveTemplateBtn').addEventListener('click', saveTemplate);
  document.getElementById('createWorkspaceBtn').addEventListener('click', createWorkspace);
  
  // Emoji picker
  document.querySelectorAll('.emoji-picker span').forEach(span => {
    span.addEventListener('click', () => {
      document.querySelectorAll('.emoji-picker span').forEach(s => s.classList.remove('selected'));
      span.classList.add('selected');
      selectedEmoji = span.dataset.emoji;
    });
  });
  
  // Keyboard
  document.addEventListener('keydown', handleKeyboard);
}

async function loadWorkspaces() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_WORKSPACES' });
  if (res.success) {
    workspaces = res.workspaces;
    activeWorkspace = res.active;
    renderWorkspaces();
  }
}

async function loadClips() {
  const filters = { workspace: activeWorkspace };
  if (currentTab === 'pinned') filters.pinned = true;
  if (currentTab === 'images') filters.type = 'image';
  
  const res = await chrome.runtime.sendMessage({ type: 'GET_HISTORY', filters });
  if (res.success) {
    clips = res.history;
    renderClips();
  }
}

async function loadTemplates() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' });
  if (res.success) {
    templates = res.templates;
    renderTemplates();
  }
}

function renderWorkspaces() {
  const container = document.getElementById('workspaces');
  container.innerHTML = workspaces.map(ws => `
    <button class="workspace-btn ${ws.id === activeWorkspace ? 'active' : ''}" data-id="${ws.id}">
      ${ws.icon} ${ws.name}
    </button>
  `).join('');
  
  container.querySelectorAll('.workspace-btn').forEach(btn => {
    btn.addEventListener('click', () => switchWorkspace(btn.dataset.id));
  });
}

function renderClips() {
  let filtered = [...clips];
  
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c => c.type !== 'image' && c.content.toLowerCase().includes(q));
  }
  
  if (typeFilter !== 'all') {
    filtered = filtered.filter(c => c.type === typeFilter);
  }
  
  const container = document.getElementById('clipsList');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('clipCount');
  
  count.textContent = `${clips.length} clip${clips.length !== 1 ? 's' : ''}`;
  
  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }
  
  empty.classList.add('hidden');
  container.innerHTML = filtered.map(clip => createClipHtml(clip)).join('');
  
  // Event listeners
  container.querySelectorAll('.clip-item').forEach(item => {
    const id = item.dataset.id;
    item.addEventListener('click', e => {
      if (!e.target.closest('.clip-actions') && !e.target.closest('.clip-checkbox')) {
        copyClip(id);
      }
    });
    
    item.querySelector('.pin-btn')?.addEventListener('click', e => { e.stopPropagation(); togglePin(id); });
    item.querySelector('.edit-btn')?.addEventListener('click', e => { e.stopPropagation(); openEdit(id); });
    item.querySelector('.note-btn')?.addEventListener('click', e => { e.stopPropagation(); openNote(id); });
    item.querySelector('.share-btn')?.addEventListener('click', e => { e.stopPropagation(); shareClip(id); });
    item.querySelector('.delete-btn')?.addEventListener('click', e => { e.stopPropagation(); deleteClip(id); });
  });
  
  updateMergeButton();
}

function createClipHtml(clip) {
  const time = formatTime(clip.timestamp);
  const isImage = clip.type === 'image';
  
  let content;
  if (isImage) {
    content = `<img class="clip-image" src="${clip.content}" alt="Image">`;
  } else {
    const escaped = escapeHtml(clip.content);
    content = `<div class="clip-content ${clip.type}">${escaped}</div>`;
  }
  
  return `
    <div class="clip-item ${clip.pinned ? 'pinned' : ''} ${clip.isSensitive ? 'sensitive' : ''} ${selectedClips.has(clip.id) ? 'selected' : ''}" data-id="${clip.id}">
      <input type="checkbox" class="clip-checkbox" ${selectedClips.has(clip.id) ? 'checked' : ''} onclick="toggleSelect('${clip.id}', event)">
      ${content}
      ${clip.note ? `<div class="clip-note">📝 ${escapeHtml(clip.note)}</div>` : ''}
      <div class="clip-meta">
        <div class="clip-info">
          <span class="clip-type ${clip.type}">${clip.type}</span>
          <span class="clip-time">${time}</span>
          ${clip.copyCount ? `<span class="clip-time">📋 ${clip.copyCount}</span>` : ''}
        </div>
        <div class="clip-actions">
          ${!isImage ? `<button class="edit-btn" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}
          <button class="note-btn" title="Note"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg></button>
          ${!isImage ? `<button class="share-btn" title="Share"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>` : ''}
          <button class="pin-btn ${clip.pinned ? 'active' : ''}" title="${clip.pinned ? 'Unpin' : 'Pin'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="${clip.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6a3 3 0 00-3-3 3 3 0 00-3 3v4.76z"/></svg></button>
          <button class="delete-btn delete" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
      </div>
    </div>
  `;
}

function renderTemplates() {
  const container = document.getElementById('templatesList');
  if (templates.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No templates yet</p>';
    return;
  }
  
  container.innerHTML = templates.map(t => `
    <div class="template-item" data-id="${t.id}">
      <div>
        <div class="name">${escapeHtml(t.name)}</div>
        <div class="preview">${escapeHtml(t.content.substring(0, 40))}...</div>
      </div>
      <button class="icon-btn small" onclick="deleteTemplate('${t.id}', event)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');
  
  container.querySelectorAll('.template-item').forEach(item => {
    item.addEventListener('click', e => {
      if (!e.target.closest('button')) {
        useTemplate(item.dataset.id);
      }
    });
  });
}

// Actions
async function copyClip(id) {
  const clip = clips.find(c => c.id === id);
  if (!clip) return;
  
  try {
    if (clip.type === 'image') {
      // For images, we can only copy the URL
      await navigator.clipboard.writeText(clip.content);
    } else {
      await navigator.clipboard.writeText(clip.content);
    }
    await chrome.runtime.sendMessage({ type: 'INCREMENT_COPY', id });
    showToast('Copied!');
    clip.copyCount = (clip.copyCount || 0) + 1;
    renderClips();
  } catch (e) {
    showToast('Failed to copy', true);
  }
}

async function togglePin(id) {
  const res = await chrome.runtime.sendMessage({ type: 'PIN_CLIP', id });
  if (res.success) {
    const clip = clips.find(c => c.id === id);
    if (clip) clip.pinned = res.pinned;
    renderClips();
  }
}

async function deleteClip(id) {
  await chrome.runtime.sendMessage({ type: 'DELETE_CLIP', id });
  clips = clips.filter(c => c.id !== id);
  selectedClips.delete(id);
  renderClips();
}

async function clearAll() {
  if (!confirm('Clear all clips in this workspace?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  clips = [];
  selectedClips.clear();
  renderClips();
}

function openEdit(id) {
  editingClipId = id;
  const clip = clips.find(c => c.id === id);
  document.getElementById('editContent').value = clip?.content || '';
  openModal('editModal');
}

async function saveEdit() {
  const content = document.getElementById('editContent').value.trim();
  if (!content || !editingClipId) return;
  
  const res = await chrome.runtime.sendMessage({ type: 'EDIT_CLIP', id: editingClipId, content });
  if (res.success) {
    const clip = clips.find(c => c.id === editingClipId);
    if (clip) clip.content = content;
    renderClips();
    showToast('Saved!');
  }
  closeModal('editModal');
}

function openNote(id) {
  noteClipId = id;
  const clip = clips.find(c => c.id === id);
  document.getElementById('noteContent').value = clip?.note || '';
  openModal('noteModal');
}

async function saveNote() {
  const note = document.getElementById('noteContent').value.trim();
  if (!noteClipId) return;
  
  const res = await chrome.runtime.sendMessage({ type: 'SET_NOTE', id: noteClipId, note });
  if (res.success) {
    const clip = clips.find(c => c.id === noteClipId);
    if (clip) clip.note = note || null;
    renderClips();
    showToast('Note saved!');
  }
  closeModal('noteModal');
}

async function shareClip(id) {
  const res = await chrome.runtime.sendMessage({ type: 'SHARE_CLIP', id });
  if (res.success) {
    await navigator.clipboard.writeText(res.content);
    showToast('Content copied for sharing!');
  } else {
    showToast(res.error, true);
  }
}

// Selection
window.toggleSelect = function(id, e) {
  e.stopPropagation();
  if (selectedClips.has(id)) {
    selectedClips.delete(id);
  } else {
    selectedClips.add(id);
  }
  renderClips();
};

function updateMergeButton() {
  const btn = document.getElementById('mergeBtn');
  btn.classList.toggle('hidden', selectedClips.size < 2);
  if (selectedClips.size >= 2) {
    btn.textContent = `Merge (${selectedClips.size})`;
  }
}

async function mergeSelected() {
  const ids = Array.from(selectedClips);
  const res = await chrome.runtime.sendMessage({ type: 'MERGE_CLIPS', ids, separator: '\n\n' });
  if (res.success) {
    selectedClips.clear();
    await loadClips();
    showToast('Clips merged!');
  } else {
    showToast(res.error, true);
  }
}

// Workspaces
async function switchWorkspace(id) {
  activeWorkspace = id;
  await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_WORKSPACE', workspace: id });
  renderWorkspaces();
  await loadClips();
}

async function createWorkspace() {
  const name = document.getElementById('workspaceName').value.trim();
  if (!name) return;
  
  const res = await chrome.runtime.sendMessage({
    type: 'CREATE_WORKSPACE',
    workspace: { name, icon: selectedEmoji, color: '#5b3fd4' }
  });
  
  if (res.success) {
    workspaces.push(res.workspace);
    renderWorkspaces();
    document.getElementById('workspaceName').value = '';
    closeModal('workspaceModal');
    showToast('Workspace created!');
  }
}

// Templates
async function saveTemplate() {
  const name = document.getElementById('templateName').value.trim();
  const content = document.getElementById('templateContent').value.trim();
  if (!name || !content) return;
  
  const res = await chrome.runtime.sendMessage({
    type: 'SAVE_TEMPLATE',
    template: { name, content }
  });
  
  if (res.success) {
    templates.push(res.template);
    renderTemplates();
    document.getElementById('templateName').value = '';
    document.getElementById('templateContent').value = '';
    showToast('Template saved!');
  }
}

window.deleteTemplate = async function(id, e) {
  e.stopPropagation();
  await chrome.runtime.sendMessage({ type: 'DELETE_TEMPLATE', id });
  templates = templates.filter(t => t.id !== id);
  renderTemplates();
};

async function useTemplate(id) {
  const template = templates.find(t => t.id === id);
  if (template) {
    await navigator.clipboard.writeText(template.content);
    showToast('Template copied!');
    closeModal('templatesModal');
  }
}

// UI
function toggleSearch() {
  const bar = document.getElementById('searchBar');
  const btn = document.getElementById('searchBtn');
  bar.classList.toggle('hidden');
  btn.classList.toggle('active');
  if (!bar.classList.contains('hidden')) {
    document.getElementById('searchInput').focus();
  } else {
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    renderClips();
  }
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  loadClips();
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

window.closeModal = function(id) {
  document.getElementById(id).classList.remove('active');
};

function showToast(msg, error = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function handleKeyboard(e) {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    toggleSearch();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  }
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  
  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
