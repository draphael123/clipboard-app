// ClipStash - Popup Logic
// Handles UI interactions and communicates with background worker

document.addEventListener('DOMContentLoaded', init);

let allClips = [];
let currentTab = 'all';
let searchQuery = '';

async function init() {
  await loadClips();
  setupEventListeners();
}

function setupEventListeners() {
  // Search toggle
  document.getElementById('searchToggle').addEventListener('click', toggleSearch);
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  
  // Clear all
  document.getElementById('clearAll').addEventListener('click', confirmClearAll);
  
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

async function loadClips() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  
  if (response.success) {
    allClips = response.history;
    renderClips();
  }
}

function renderClips() {
  const container = document.getElementById('clipsList');
  const emptyState = document.getElementById('emptyState');
  const countEl = document.getElementById('clipCount');
  
  // Filter clips based on tab and search
  let filteredClips = allClips;
  
  if (currentTab === 'pinned') {
    filteredClips = filteredClips.filter(clip => clip.pinned);
  }
  
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filteredClips = filteredClips.filter(clip => 
      clip.content.toLowerCase().includes(query)
    );
  }
  
  // Update count
  countEl.textContent = `${allClips.length} clip${allClips.length !== 1 ? 's' : ''}`;
  
  // Show/hide empty state
  if (filteredClips.length === 0) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }
  
  emptyState.classList.add('hidden');
  
  // Render clips
  container.innerHTML = filteredClips.map(clip => createClipElement(clip)).join('');
  
  // Add event listeners to clip items
  container.querySelectorAll('.clip-item').forEach(item => {
    const clipId = item.dataset.id;
    
    // Click to copy
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.clip-actions')) {
        copyToClipboard(clipId);
      }
    });
    
    // Pin button
    item.querySelector('.pin-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(clipId);
    });
    
    // Delete button
    item.querySelector('.delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteClip(clipId);
    });
  });
}

function createClipElement(clip) {
  const time = formatTime(clip.timestamp);
  const typeClass = clip.type !== 'text' ? clip.type : '';
  const contentClass = `clip-content ${typeClass}`;
  const source = clip.source?.hostname || '';
  
  return `
    <div class="clip-item ${clip.pinned ? 'pinned' : ''}" data-id="${clip.id}">
      <div class="${contentClass}">${escapeHtml(clip.content)}</div>
      <div class="clip-meta">
        <div class="clip-info">
          <span class="clip-type ${typeClass}">${clip.type}</span>
          <span class="clip-time">${time}</span>
          ${source ? `<span class="clip-source" title="${escapeHtml(clip.source?.url || '')}">${source}</span>` : ''}
        </div>
        <div class="clip-actions">
          <button class="pin-btn ${clip.pinned ? 'active' : ''}" title="${clip.pinned ? 'Unpin' : 'Pin'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${clip.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M12 2L12 12M12 12L8 8M12 12L16 8M5 21L12 14L19 21"/>
            </svg>
          </button>
          <button class="delete-btn" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6L18 18"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function copyToClipboard(clipId) {
  const clip = allClips.find(c => c.id === clipId);
  if (!clip) return;
  
  try {
    await navigator.clipboard.writeText(clip.content);
    showToast('Copied to clipboard!');
  } catch (error) {
    console.error('Failed to copy:', error);
    showToast('Failed to copy');
  }
}

async function togglePin(clipId) {
  const response = await chrome.runtime.sendMessage({ 
    type: 'PIN_CLIP', 
    id: clipId 
  });
  
  if (response.success) {
    const clip = allClips.find(c => c.id === clipId);
    if (clip) {
      clip.pinned = response.pinned;
      renderClips();
    }
  }
}

async function deleteClip(clipId) {
  const response = await chrome.runtime.sendMessage({ 
    type: 'DELETE_CLIP', 
    id: clipId 
  });
  
  if (response.success) {
    allClips = allClips.filter(c => c.id !== clipId);
    renderClips();
  }
}

async function confirmClearAll() {
  if (allClips.length === 0) return;
  
  const confirmed = confirm('Clear all clipboard history? Pinned items will also be removed.');
  if (confirmed) {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    if (response.success) {
      allClips = [];
      renderClips();
      showToast('History cleared');
    }
  }
}

function toggleSearch() {
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  
  searchBar.classList.toggle('active');
  
  if (searchBar.classList.contains('active')) {
    searchInput.focus();
  } else {
    searchInput.value = '';
    searchQuery = '';
    renderClips();
  }
}

function handleSearch(e) {
  searchQuery = e.target.value;
  renderClips();
}

function switchTab(tab) {
  currentTab = tab;
  
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  
  renderClips();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

