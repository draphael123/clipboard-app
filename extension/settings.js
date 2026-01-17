// ClipStash Settings Page Logic

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadSettings();
  await loadStats();
  await loadStorageUsage();
  setupEventListeners();
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const settings = response;
  
  document.getElementById('maxHistory').value = settings.maxHistorySize || 100;
  document.getElementById('autoDelete').value = settings.autoDeleteDays || 0;
  document.getElementById('detectSensitive').checked = settings.detectSensitive !== false;
  document.getElementById('showNotifications').checked = settings.showNotifications !== false;
  document.getElementById('theme').value = settings.theme || 'system';
  document.getElementById('excludedSites').value = (settings.excludedSites || []).join('\n');
}

async function loadStats() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
  if (response.success) {
    document.getElementById('totalSaved').textContent = response.stats.totalClipsSaved || 0;
    document.getElementById('totalCopied').textContent = response.stats.totalCopiesFromHistory || 0;
  }
  
  // Get current clip count
  const historyResponse = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  if (historyResponse.success) {
    document.getElementById('currentClips').textContent = historyResponse.history.length;
  }
}

async function loadStorageUsage() {
  const response = await chrome.runtime.sendMessage({ type: 'CHECK_STORAGE' });
  if (response.success) {
    const percent = parseFloat(response.percentUsed);
    const bytesKB = (response.bytesInUse / 1024).toFixed(1);
    const quotaMB = (response.quota / 1024 / 1024).toFixed(0);
    
    document.getElementById('storagePercent').textContent = `${percent}%`;
    document.getElementById('storageText').textContent = `${bytesKB} KB of ${quotaMB} MB`;
    
    const fill = document.getElementById('storageFill');
    fill.style.width = `${percent}%`;
    
    if (percent > 90) {
      fill.classList.add('danger');
      fill.classList.remove('warning');
    } else if (percent > 80) {
      fill.classList.add('warning');
      fill.classList.remove('danger');
    } else {
      fill.classList.remove('warning', 'danger');
    }
  }
}

function setupEventListeners() {
  // Auto-save on change
  const inputs = ['maxHistory', 'autoDelete', 'detectSensitive', 'showNotifications', 'theme', 'excludedSites'];
  inputs.forEach(id => {
    const element = document.getElementById(id);
    element.addEventListener('change', saveSettings);
    if (element.tagName === 'TEXTAREA') {
      element.addEventListener('blur', saveSettings);
    }
  });
  
  // Export button
  document.getElementById('exportBtn').addEventListener('click', exportData);
  
  // Import button
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  
  document.getElementById('importFile').addEventListener('change', importData);
  
  // Clear all button
  document.getElementById('clearAllBtn').addEventListener('click', clearAllHistory);
}

async function saveSettings() {
  const settings = {
    maxHistorySize: parseInt(document.getElementById('maxHistory').value),
    autoDeleteDays: parseInt(document.getElementById('autoDelete').value),
    detectSensitive: document.getElementById('detectSensitive').checked,
    showNotifications: document.getElementById('showNotifications').checked,
    theme: document.getElementById('theme').value,
    excludedSites: document.getElementById('excludedSites').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
  };
  
  const response = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  
  if (response.success) {
    showToast('Settings saved!');
  } else {
    showToast('Error saving settings', true);
  }
}

async function exportData() {
  const response = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA' });
  
  if (response.success) {
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clipstash-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast(`Exported ${response.data.history.length} clips!`);
  } else {
    showToast('Export failed', true);
  }
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (!data.history || !Array.isArray(data.history)) {
      throw new Error('Invalid backup file');
    }
    
    const confirmed = confirm(`Import ${data.history.length} clips? This will merge with your existing clips.`);
    if (!confirmed) return;
    
    const response = await chrome.runtime.sendMessage({ type: 'IMPORT_DATA', data });
    
    if (response.success) {
      showToast(`Imported ${response.imported} clips!`);
      await loadStats();
      await loadStorageUsage();
    } else {
      showToast('Import failed: ' + response.error, true);
    }
  } catch (error) {
    showToast('Invalid file format', true);
  }
  
  e.target.value = '';
}

async function clearAllHistory() {
  const confirmed = confirm('Are you sure you want to delete ALL clipboard history? This cannot be undone.');
  if (!confirmed) return;
  
  const doubleConfirm = confirm('This will permanently delete all your clips. Are you absolutely sure?');
  if (!doubleConfirm) return;
  
  const response = await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  
  if (response.success) {
    showToast('All history cleared');
    await loadStats();
    await loadStorageUsage();
  } else {
    showToast('Error clearing history', true);
  }
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

