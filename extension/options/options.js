'use strict';

/**
 * IDMAM Extension — Options Page Script.
 *
 * Uses IDMAM_API from lib/api-client.js for settings persistence.
 * Settings are stored under the 'idmam_settings' key in chrome.storage.local.
 * Backend URL is hidden from users — only shows Connected/Not Running.
 */

// ─── DOM references ────────────────────────────────────────────────

const $serverStatus = document.getElementById('server-status');
const $extEnabled = document.getElementById('ext-enabled');
const $maxThreads = document.getElementById('max-threads');
const $defaultSavePath = document.getElementById('default-save-path');
const $minSize = document.getElementById('min-size');
const $btnSave = document.getElementById('btn-save');
const $btnReset = document.getElementById('btn-reset');
const $saveStatus = document.getElementById('save-status');
const $btnBrowse = document.getElementById('btn-browse');
const $folderPicker = document.getElementById('folder-picker');

// Intercept toggles
const $interceptToggles = {
  video:    document.getElementById('intercept-video'),
  audio:    document.getElementById('intercept-audio'),
  archive:  document.getElementById('intercept-archive'),
  software: document.getElementById('intercept-software'),
  document: document.getElementById('intercept-document'),
};

// Map category names to settings keys
const CATEGORY_KEY_MAP = {
  video: 'interceptVideo',
  audio: 'interceptAudio',
  archive: 'interceptArchive',
  software: 'interceptSoftware',
  document: 'interceptDocument',
};

// ─── Initialization ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadSettings();
  checkStatus();
});

// ─── Event listeners ───────────────────────────────────────────────

function setupEventListeners() {
  $btnSave.addEventListener('click', saveSettings);
  $btnReset.addEventListener('click', resetSettings);

  // E3: Browse button — open hidden folder picker
  $btnBrowse.addEventListener('click', () => {
    $folderPicker.click();
  });

  $folderPicker.addEventListener('change', () => {
    const files = $folderPicker.files;
    if (!files || files.length === 0) return;

    // Extract folder name from webkitRelativePath (e.g. "MyFolder/file.txt" → "MyFolder")
    const relativePath = files[0].webkitRelativePath || '';
    const folderName = relativePath.split('/')[0] || '';

    if (folderName) {
      $defaultSavePath.value = folderName;
    }

    // Reset so the same folder can be re-selected
    $folderPicker.value = '';
  });
}

// ─── Load settings from storage ────────────────────────────────────

async function loadSettings() {
  const settings = await IDMAM_API.getSettings();

  $extEnabled.checked = settings.enabled !== false;
  $maxThreads.value = settings.maxThreads || 8;
  $defaultSavePath.value = settings.defaultSavePath || '';
  $minSize.value = String(settings.interceptMinSize || 5 * 1024 * 1024);

  // Intercept toggles
  for (const [category, toggle] of Object.entries($interceptToggles)) {
    if (toggle) {
      const key = CATEGORY_KEY_MAP[category];
      toggle.checked = settings[key] !== false;
    }
  }
}

// ─── Save settings to storage ──────────────────────────────────────

async function saveSettings() {
  const settings = {
    enabled: $extEnabled.checked,
    maxThreads: clamp(parseInt($maxThreads.value, 10) || 8, 1, 64),
    defaultSavePath: $defaultSavePath.value.trim(),
    interceptMinSize: parseInt($minSize.value, 10) || (5 * 1024 * 1024),
  };

  // Build intercept toggles
  for (const [category, toggle] of Object.entries($interceptToggles)) {
    if (toggle) {
      settings[CATEGORY_KEY_MAP[category]] = toggle.checked;
    }
  }

  await IDMAM_API.saveSettings(settings);

  // Notify background to reload settings
  try {
    await sendMessage({ type: 'SETTINGS_UPDATED' });
  } catch {
    // Background may not be ready
  }

  showSaveStatus('Settings saved!', false);
}

// ─── Reset to defaults ─────────────────────────────────────────────

async function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;

  const defaults = IDMAM_API.defaultSettings();
  await IDMAM_API.saveSettings(defaults);
  await loadSettings();

  try {
    await sendMessage({ type: 'SETTINGS_UPDATED' });
  } catch {
    // OK
  }

  showSaveStatus('Settings reset to defaults', false);
}

// ─── Server status check (no URL exposed) ──────────────────────────

async function checkStatus() {
  $serverStatus.textContent = 'Checking...';
  $serverStatus.className = 'status-indicator checking';

  try {
    const ok = await IDMAM_API.healthCheck();
    if (ok) {
      $serverStatus.textContent = 'Connected \u2713';
      $serverStatus.className = 'status-indicator online';
    } else {
      $serverStatus.textContent = 'Not Running \u2717';
      $serverStatus.className = 'status-indicator offline';
    }
  } catch {
    $serverStatus.textContent = 'Not Running \u2717';
    $serverStatus.className = 'status-indicator offline';
  }
}

// ─── Message helper ────────────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── UI helpers ────────────────────────────────────────────────────

function showSaveStatus(text, isError) {
  $saveStatus.textContent = text;
  $saveStatus.className = isError ? 'save-status error' : 'save-status';
  setTimeout(() => {
    $saveStatus.textContent = '';
  }, 3000);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
