import { useState, useEffect, useRef, useCallback } from 'react';
import { getSettings, updateSettings } from '../api';

export default function Settings({ onBack, theme, onThemeChange, onDirtyChange, saveRef }) {
  const [settings, setSettings] = useState({
    threadMode: 'auto',
    threads: 8,
    savePath: '',
  });
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
            threadMode: s.default_thread_mode ?? prev.threadMode,
            threads: Number(s.default_threads ?? s.threads ?? prev.threads),
            savePath: s.default_save_path ?? s.savePath ?? prev.savePath,
          }));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Mark dirty on any setting change
  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => {
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
        default_thread_mode: settings.threadMode,
        default_threads: String(settings.threads),
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
    onThemeChange(value);
    isDirtyRef.current = true;
    if (onDirtyChange) onDirtyChange(true);
  }, [onThemeChange, onDirtyChange]);

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
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-2xl font-bold text-slate-100">Settings</h2>
      </div>

      <div className="space-y-6">
        {/* Theme Settings */}
        <div className="bg-slate-800/50 rounded-xl p-5">
          <label className="block text-sm font-medium text-slate-300 mb-2">Theme</label>
          <p className="text-xs text-slate-500 mb-3">Select application color theme</p>
          <select
            value={theme}
            onChange={(e) => handleThemeChange(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
          >
            <option value="dark">Dark Theme (Default)</option>
            <option value="light">Light Theme</option>
          </select>
        </div>

        {/* Thread Mode */}
        <div className="bg-slate-800/50 rounded-xl p-5">
          <label className="block text-sm font-medium text-slate-300 mb-2">Thread Mode</label>
          <p className="text-xs text-slate-500 mb-3">How download threads are determined</p>
          <select
            value={settings.threadMode}
            onChange={(e) => updateSetting('threadMode', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
          >
            <option value="auto">Auto (recommended)</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        {/* Download Threads — only shown in Manual mode */}
        {settings.threadMode === 'manual' ? (
          <div className="bg-slate-800/50 rounded-xl p-5">
            <label className="block text-sm font-medium text-slate-300 mb-2">Download Threads</label>
            <p className="text-xs text-slate-500 mb-3">Number of parallel download connections (1–128)</p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1}
                max={128}
                value={settings.threads}
                onChange={(e) => updateSetting('threads', Number(e.target.value))}
                className="flex-1 accent-accent"
              />
              <span className="text-sm font-mono text-accent w-10 text-center">{settings.threads}</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800/50 rounded-xl p-5">
            <label className="block text-sm font-medium text-slate-300 mb-2">Auto Thread Detection</label>
            <p className="text-xs text-slate-400 leading-relaxed">
              Thread count is chosen automatically based on file size:
            </p>
            <ul className="mt-2 text-xs text-slate-500 space-y-1">
              <li>&lt; 5 MB &rarr; 1 thread</li>
              <li>5–50 MB &rarr; 4 threads</li>
              <li>50–500 MB &rarr; 16 threads</li>
              <li>&gt; 500 MB &rarr; 32 threads</li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Max 64 threads. Automatically reduces on server throttling.
            </p>
          </div>
        )}

        {/* Save Path */}
        <div className="bg-slate-800/50 rounded-xl p-5">
          <label className="block text-sm font-medium text-slate-300 mb-2">Save Path</label>
          <p className="text-xs text-slate-500 mb-3">Default download directory</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.savePath}
              onChange={(e) => updateSetting('savePath', e.target.value)}
              placeholder="C:\Downloads"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            />
            <button
              type="button"
              onClick={handleSelectFolder}
              disabled={folderPickerOpen}
              className="px-3 py-2.5 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {folderPickerOpen ? '...' : 'Select Folder'}
            </button>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onBack}
            className="px-4 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors"
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
