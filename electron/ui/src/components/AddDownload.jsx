import { useState, useRef, useEffect } from 'react';
import { addDownload } from '../api';

export default function AddDownload({ onClose, onAdded }) {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [savePath, setSavePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const options = {};
      if (filename.trim()) options.filename = filename.trim();
      if (savePath.trim()) options.savePath = savePath.trim();
      
      await addDownload(url.trim(), options);
      onAdded?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to add download');
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      // clipboard access denied
    }
  };

  const handleSelectFolder = async () => {
    if (window.idmm && window.idmm.selectFolder) {
      const folder = await window.idmm.selectFolder();
      if (folder) {
        setSavePath(folder);
      }
    }
  };

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-700 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-slate-100">Add Download</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">{error}</div>
          )}

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">URL</label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/file.zip"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
              />
              <button
                type="button"
                onClick={handlePaste}
                className="px-3 py-2.5 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 transition-colors"
                title="Paste from clipboard"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </button>
            </div>
          </div>

          {/* Filename (optional) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Filename <span className="text-slate-500">(optional)</span></label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="file.zip"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            />
          </div>

          {/* Save Path (optional) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Save Path <span className="text-slate-500">(optional)</span></label>
            <div className="flex gap-2">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="Leave blank for default"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
              />
              <button
                type="button"
                onClick={handleSelectFolder}
                className="px-3 py-2.5 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 transition-colors whitespace-nowrap"
              >
                Select Folder
              </button>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim() || loading}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-accent-dim text-white hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Adding...' : 'Download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
