// ClipStash - Popup Logic
// Handles UI interactions and communicates with background worker

document.addEventListener('DOMContentLoaded', init);

let allClips = [];
let filteredClips = [];
let currentTab = 'all';
let searchQuery = '';
let selectedIndex = -1;
let filters = {
  type: 'all',
  category: '',
  date: 'all'
};

async function init() {
  await loadClips();
  await loadCategories();
  setupEventListeners();
  setupKeyboardNavigation();
}

function setupEventListeners() {
  // Search toggle
  document.getElementById('searchToggle').addEventListener('click', toggleSearch);
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  
  // Filter toggle
  document.getElementById('filterToggle').addEventListener('click', toggleFilters);
  document.getElementById('typeFilter').addEventListener('change', handleFilterChange);
  document.getElementById('categoryFilter').addEventListener('change', handleFilterChange);
  document.getElementById('dateFilter').addEventListener('change', handleFilterChange);
  
  // Settings
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  
  // Clear all
  document.getElementById('clearAll').addEventListener('click', confirmClearAll);
  
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  
  // Category modal
  document.getElementById('cancelCategory').addEventListener('click', closeCategoryModal);
  document.getElementById('saveCategory').addEventListener('click', saveCategory);
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Focus search with /
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      toggleSearch();
      setTimeout(() => document.getElementById('searchInput').focus(), 100);
      return;
    }
    
    // Escape to close search/filters
    if (e.key === 'Escape') {
      const searchBar = document.getElementById('searchBar');
      const filterBar = document.getElementById('filterBar');
      if (searchBar.classList.contains('active')) {
        toggleSearch();
      }
      if (filterBar.classList.contains('active')) {
        toggleFilters();
      }
      selectedIndex = -1;
      renderClips();
      return;
    }
    
    // Arrow navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const clips = document.querySelectorAll('.clip-item');
      if (clips.length === 0) return;
      
      if (e.key === 'ArrowDown') {
        selectedIndex = Math.min(selectedIndex + 1, clips.length - 1);
      } else {
        selectedIndex = Math.max(selectedIndex - 1, 0);
      }
      
      updateSelection(clips);
    }
    
    // Enter to copy selected
    if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      const clipId = filteredClips[selectedIndex]?.id;
      if (clipId) {
        copyToClipboard(clipId);
      }
    }
    
    // Number keys for quick copy (Alt+1, Alt+2, Alt+3)
    if (e.altKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      if (filteredClips[index]) {
        copyToClipboard(filteredClips[index].id);
      }
    }
  });
}

function updateSelection(clips) {
  clips.forEach((clip, index) => {
    clip.classList.toggle('selected', index === selectedIndex);
    if (index === selectedIndex) {
      clip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

async function loadClips() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  
  if (response.success) {
    allClips = response.history;
    applyFilters();
  }
}

async function loadCategories() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_CATEGORIES' });
  
  if (response.success && response.categories.length > 0) {
    const select = document.getElementById('categoryFilter');
    const datalist = document.getElementById('categoryList');
    
    // Clear existing options (except first)
    while (select.options.length > 1) {
      select.remove(1);
    }
    datalist.innerHTML = '';
    
    response.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      select.appendChild(option);
      
      const dataOption = document.createElement('option');
      dataOption.value = cat;
      datalist.appendChild(dataOption);
    });
  }
}

function applyFilters() {
  filteredClips = [...allClips];
  
  // Tab filter
  if (currentTab === 'pinned') {
    filteredClips = filteredClips.filter(clip => clip.pinned);
  }
  
  // Search filter
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filteredClips = filteredClips.filter(clip => 
      clip.content.toLowerCase().includes(query)
    );
  }
  
  // Type filter
  if (filters.type !== 'all') {
    filteredClips = filteredClips.filter(clip => clip.type === filters.type);
  }
  
  // Category filter
  if (filters.category) {
    filteredClips = filteredClips.filter(clip => clip.category === filters.category);
  }
  
  // Date filter
  if (filters.date !== 'all') {
    const now = Date.now();
    let cutoff;
    switch (filters.date) {
      case 'today':
        cutoff = now - 24 * 60 * 60 * 1000;
        break;
      case 'week':
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        cutoff = now - 30 * 24 * 60 * 60 * 1000;
        break;
    }
    if (cutoff) {
      filteredClips = filteredClips.filter(clip => clip.timestamp >= cutoff);
    }
  }
  
  selectedIndex = -1;
  renderClips();
}

function renderClips() {
  const container = document.getElementById('clipsList');
  const emptyState = document.getElementById('emptyState');
  const countEl = document.getElementById('clipCount');
  
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
  container.innerHTML = filteredClips.map((clip, index) => createClipElement(clip, index)).join('');
  
  // Add event listeners
  container.querySelectorAll('.clip-item').forEach((item, index) => {
    const clipId = item.dataset.id;
    
    // Click to copy
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.clip-actions') && !e.target.closest('.expand-btn')) {
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
    
    // Category button
    item.querySelector('.category-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openCategoryModal(clipId);
    });
    
    // Expand button
    item.querySelector('.expand-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpand(item, e.target);
    });
  });
}

function createClipElement(clip, index) {
  const time = formatTime(clip.timestamp);
  const typeClass = clip.type !== 'text' ? clip.type : '';
  const isLong = clip.content.length > 200 || clip.content.split('\n').length > 3;
  const isSelected = index === selectedIndex;
  
  let content = escapeHtml(clip.content);
  
  // Apply syntax highlighting for code
  if (clip.type === 'code') {
    content = highlightSyntax(content);
  }
  
  const source = clip.source?.hostname || '';
  
  return `
    <div class="clip-item ${clip.pinned ? 'pinned' : ''} ${clip.isSensitive ? 'sensitive' : ''} ${isSelected ? 'selected' : ''}" data-id="${clip.id}">
      <div class="clip-content ${typeClass} ${isLong ? 'collapsed' : ''}">${content}</div>
      ${isLong ? '<button class="expand-btn">Show more</button>' : ''}
      <div class="clip-meta">
        <div class="clip-info">
          <span class="clip-type ${typeClass}">${clip.type}</span>
          ${clip.category ? `<span class="clip-category">${escapeHtml(clip.category)}</span>` : ''}
          ${clip.isSensitive ? '<span class="sensitive-badge">⚠️ Sensitive</span>' : ''}
          <span class="clip-time">${time}</span>
          ${clip.copyCount > 0 ? `<span class="copy-count"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>${clip.copyCount}</span>` : ''}
        </div>
        <div class="clip-actions">
          <button class="category-btn" title="Set category">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          </button>
          <button class="pin-btn ${clip.pinned ? 'active' : ''}" title="${clip.pinned ? 'Unpin' : 'Pin'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${clip.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6a3 3 0 00-3-3 3 3 0 00-3 3v4.76z"/>
            </svg>
          </button>
          <button class="delete-btn" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function highlightSyntax(code) {
  // Keywords
  code = code.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|true|false|null|undefined)\b/g, '<span class="keyword">$1</span>');
  
  // Strings (simple single and double quotes)
  code = code.replace(/(&quot;[^&]*&quot;|&#39;[^&]*&#39;)/g, '<span class="string">$1</span>');
  
  // Numbers
  code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');
  
  // Comments (single line)
  code = code.replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>');
  
  // Operators
  code = code.replace(/([=+\-*/<>!&|]+)/g, '<span class="operator">$1</span>');
  
  return code;
}

function toggleExpand(item, btn) {
  const content = item.querySelector('.clip-content');
  const isCollapsed = content.classList.contains('collapsed');
  
  content.classList.toggle('collapsed');
  btn.textContent = isCollapsed ? 'Show less' : 'Show more';
}

async function copyToClipboard(clipId) {
  const clip = allClips.find(c => c.id === clipId);
  if (!clip) return;
  
  try {
    await navigator.clipboard.writeText(clip.content);
    await chrome.runtime.sendMessage({ type: 'INCREMENT_COPY', id: clipId });
    showToast('Copied to clipboard!');
    
    // Update local copy count
    clip.copyCount = (clip.copyCount || 0) + 1;
    renderClips();
  } catch (error) {
    console.error('Failed to copy:', error);
    showToast('Failed to copy', true);
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
      applyFilters();
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
    applyFilters();
  }
}

async function confirmClearAll() {
  if (allClips.length === 0) return;
  
  const confirmed = confirm('Clear all clipboard history? Pinned items will also be removed.');
  if (confirmed) {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    if (response.success) {
      allClips = [];
      applyFilters();
      showToast('History cleared');
    }
  }
}

function toggleSearch() {
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchToggle');
  
  searchBar.classList.toggle('active');
  searchBtn.classList.toggle('active');
  
  if (searchBar.classList.contains('active')) {
    searchInput.focus();
  } else {
    searchInput.value = '';
    searchQuery = '';
    applyFilters();
  }
}

function toggleFilters() {
  const filterBar = document.getElementById('filterBar');
  const filterBtn = document.getElementById('filterToggle');
  
  filterBar.classList.toggle('active');
  filterBtn.classList.toggle('active');
}

function handleSearch(e) {
  searchQuery = e.target.value;
  applyFilters();
}

function handleFilterChange() {
  filters.type = document.getElementById('typeFilter').value;
  filters.category = document.getElementById('categoryFilter').value;
  filters.date = document.getElementById('dateFilter').value;
  applyFilters();
}

function switchTab(tab) {
  currentTab = tab;
  
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  
  applyFilters();
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

// Category Modal
let currentCategoryClipId = null;

function openCategoryModal(clipId) {
  currentCategoryClipId = clipId;
  const modal = document.getElementById('categoryModal');
  const input = document.getElementById('categoryInput');
  
  const clip = allClips.find(c => c.id === clipId);
  input.value = clip?.category || '';
  
  modal.classList.add('active');
  input.focus();
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.remove('active');
  currentCategoryClipId = null;
}

async function saveCategory() {
  const category = document.getElementById('categoryInput').value.trim();
  
  if (currentCategoryClipId) {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_CATEGORY',
      id: currentCategoryClipId,
      category: category || null
    });
    
    if (response.success) {
      const clip = allClips.find(c => c.id === currentCategoryClipId);
      if (clip) {
        clip.category = category || null;
      }
      await loadCategories();
      applyFilters();
      showToast(category ? 'Category set!' : 'Category removed');
    }
  }
  
  closeCategoryModal();
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
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
