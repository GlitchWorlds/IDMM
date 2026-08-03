import { useState, useEffect, useRef, useCallback } from 'react';
import { getSettings, updateSettings } from '../api';

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark', swatch: '#010102' },
  { value: 'white', label: 'White', swatch: '#ffffff' },
  { value: 'brown', label: 'Brown', swatch: '#f2f0eb' },
  { value: 'pinky', label: 'Pinky', swatch: '#ff385c' },
];

export default function Settings({ onBack, theme, onThemeChange, onDirtyChange, saveRef }) {
  const [settings, setSettings] = useState({ savePath: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s) {
          setSettings((prev) => ({
            ...prev,
            savePath: s.default_save_path ?? prev.savePath,
          }));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Mark dirty on any setting change
  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => {
      if (prev[key] === value) return prev; // No actual change — skip
      const next = { ...prev, [key]: value };
      isDirtyRef.current = true;
      if (onDirtyChange) onDirtyChange(true);
      return next;
    });
  }, [onDirtyChange]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const payload = {
        default_save_path: settings.savePath || '',
      };
      await updateSettings(payload);
      setSaved(true);
      isDirtyRef.current = false;
      if (onDirtyChange) onDirtyChange(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [settings, onDirtyChange]);

  // Expose handleSave to parent via saveRef
  useEffect(() => {
    if (saveRef) saveRef.current = handleSave;
  }, [saveRef, handleSave]);

  // Prevent spam on select folder — lock while dialog open
  const handleSelectFolder = useCallback(async () => {
    if (folderPickerOpen) return;
    if (!window.idmm || !window.idmm.selectFolder) return;

    setFolderPickerOpen(true);
    try {
      const folder = await window.idmm.selectFolder();
      if (folder) {
        updateSetting('savePath', folder);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFolderPickerOpen(false);
    }
  }, [folderPickerOpen, updateSetting]);

  // Handle theme change — mark dirty
  const handleThemeChange = useCallback((value) => {
    if (value === theme) return; // No actual change
    onThemeChange(value);
    isDirtyRef.current = true;
    if (onDirtyChange) onDirtyChange(true);
  }, [theme, onThemeChange, onDirtyChange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8 animate-fade-in">
      {/* Back & Title */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-muted hover:text-main hover:bg-surface transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-2xl font-bold text-main">Settings</h2>
      </div>

      <div className="space-y-6">
        {/* Theme Settings */}
        <div className="surface rounded-xl p-5 border border-theme">
          <label className="block text-sm font-medium text-main mb-2">Theme</label>
          <p className="text-xs text-muted mb-3">Select application color theme</p>
          <div className="grid grid-cols-4 gap-3">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleThemeChange(opt.value)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                  theme === opt.value
                    ? 'border-accent bg-accent/10 ring-2 ring-accent/30'
                    : 'border-theme hover:border-accent/40'
                }`}
              >
                <span
                  className="w-8 h-8 rounded-full border border-theme"
                  style={{ backgroundColor: opt.swatch }}
                />
                <span className={`text-xs ${theme === opt.value ? 'text-main font-medium' : 'text-muted'}`}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Save Folder Location */}
        <div className="surface rounded-xl p-5 border border-theme">
          <label className="block text-sm font-medium text-main mb-2">Save Folder Location</label>
          <p className="text-xs text-muted mb-3">Default download directory</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.savePath}
              onChange={(e) => updateSetting('savePath', e.target.value)}
              placeholder="C:\Downloads"
              className="flex-1 base-bg border border-theme rounded-lg px-4 py-2.5 text-sm text-main placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            />
            <button
              type="button"
              onClick={handleSelectFolder}
              disabled={folderPickerOpen}
              className="px-3 py-2.5 rounded-lg surface border border-theme text-main text-sm hover:bg-surface-hover transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {folderPickerOpen ? '...' : 'Select Folder'}
            </button>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onBack}
            className="px-4 py-2.5 rounded-lg text-sm text-muted hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg text-sm font-medium bg-accent-dim text-white hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
