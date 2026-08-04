import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DownloadList from './components/DownloadList';
import Settings from './components/Settings';
import useWebSocket from './hooks/useWebSocket';
import { getDownloads, getStats, deleteDownload, formatBytes as formatSize } from './api';

export default function App() {
  const [downloads, setDownloads] = useState([]);
  const [stats, setStats] = useState({ totalSpeed: 0, active: 0, completed: 0 });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [pendingFilter, setPendingFilter] = useState(null);
  const saveRef = useRef(null);
  const [speedHistory, setSpeedHistory] = useState([]);
  // Completed sort state
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  // Detail / missing-file modals
  const [detailDl, setDetailDl] = useState(null);
  const [missingDl, setMissingDl] = useState(null);
  const [copied, setCopied] = useState(false);
  // Theming state — sumber utama: theme.json (main process, dibaca via preload)
  // supaya titleBarOverlay (tombol min/max/close) ikut berganti warna.
  const [theme, setTheme] = useState('dark');
  const themeOnEnterRef = useRef('dark');

  useEffect(() => {
    (async () => {
      try {
        const saved = window.idmm?.getTheme ? await window.idmm.getTheme() : null;
        if (saved) setTheme(saved);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.idmm?.setTheme?.(theme);
    } catch (e) {
      console.error(e);
    }
  }, [theme]);

  const handleOpenSettings = useCallback(() => {
    themeOnEnterRef.current = theme;
    setShowSettings(true);
  }, [theme]);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'progress') {
      // WP-8: Batched format — { type: 'progress', downloads: [...] }
      if (msg.downloads && Array.isArray(msg.downloads)) {
        setDownloads((prev) => {
          const updates = new Map(msg.downloads.map((d) => [d.id, d]));
          // Only update existing downloads — don't add new ones (handled by 'added' message)
          return prev.map((d) =>
            updates.has(d.id) ? { ...d, ...updates.get(d.id) } : d
          );
        });
        // Update speed history from the batch
        setSpeedHistory((prev) => {
          const now = Date.now();
          const totalSpeed = msg.downloads.reduce((sum, d) => sum + (d.speed || 0), 0);
          const next = [...prev, { time: now, speed: totalSpeed }];
          return next.slice(-60);
        });
      }
    } else if (msg.type === 'status') {
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === msg.id ? { ...d, status: msg.status } : d
        )
      );
    } else if (msg.type === 'added') {
      setDownloads((prev) => {
        // Prevent duplicate — check if already in list
        if (prev.some(d => d.id === msg.data?.id)) return prev;
        return [msg.data, ...prev];
      });
    } else if (msg.type === 'removed') {
      setDownloads((prev) => prev.filter((d) => d.id !== msg.id));
    }
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  // E-5: WebSocket is authoritative. Poll only as fallback every 10s when WS disconnected.
  useEffect(() => {
    // Initial load always fetches
    getDownloads().then(setDownloads).catch(console.error);
    getStats().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    if (connected) return; // WS connected — no polling needed

    const interval = setInterval(() => {
      getDownloads().then(setDownloads).catch(() => {});
      getStats().then(setStats).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [connected]);

  const filtered = downloads.filter((d) => {
    if (search && !d.filename?.toLowerCase().includes(search.toLowerCase()) &&
        !d.url?.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    switch (filter) {
      case 'active': return d.status === 'downloading' || d.status === 'active';
      case 'completed': return d.status === 'completed';
      case 'paused': return d.status === 'paused';
      case 'queue': return d.status === 'queued' || d.status === 'waiting';
      default: return true;
    }
  });

  // Client-side sort (applies to all filters; sort bar shows for completed)
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name':
        cmp = (a.filename || '').localeCompare(b.filename || '');
        break;
      case 'size':
        cmp = (a.total_size || 0) - (b.total_size || 0);
        break;
      case 'type': {
        const ta = (a.mime_type || a.category || a.filename?.split('.').pop() || '').toLowerCase();
        const tb = (b.mime_type || b.category || b.filename?.split('.').pop() || '').toLowerCase();
        cmp = ta.localeCompare(tb);
        break;
      }
      case 'date':
      default:
        cmp = new Date(a.completed_at || a.created_at) - new Date(b.completed_at || b.created_at);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleRefresh = async () => {
    try {
      const data = await getDownloads();
      setDownloads(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleFilterChange = useCallback((filterKey) => {
    if (filterKey === 'settings') {
      themeOnEnterRef.current = theme;
      setShowSettings(true);
      return;
    }
    if (showSettings && settingsDirty) {
      setPendingFilter(filterKey);
      setShowConfirmLeave(true);
    } else {
      setFilter(filterKey);
      if (showSettings) setShowSettings(false);
    }
  }, [showSettings, settingsDirty, theme]);

  const handleSaveAndLeave = useCallback(async () => {
    if (saveRef.current) {
      try { await saveRef.current(); } catch (e) { console.error(e); }
    }
    setSettingsDirty(false);
    setShowConfirmLeave(false);
    if (pendingFilter) {
      setFilter(pendingFilter);
      setPendingFilter(null);
    }
    setShowSettings(false);
  }, [pendingFilter]);

  const handleDiscardAndLeave = useCallback(() => {
    // Revert theme to what it was when settings were opened
    setTheme(themeOnEnterRef.current);
    setSettingsDirty(false);
    setShowConfirmLeave(false);
    if (pendingFilter) {
      setFilter(pendingFilter);
      setPendingFilter(null);
    }
    setShowSettings(false);
  }, [pendingFilter]);

  const handleCancelLeave = useCallback(() => {
    setShowConfirmLeave(false);
    setPendingFilter(null);
  }, []);

  const handleOpenDetail = useCallback(({ type, download }) => {
    if (type === 'detail') {
      setDetailDl(download);
      setCopied(false);
    } else if (type === 'missing') {
      setMissingDl(download);
    }
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!detailDl?.url) return;
    try {
      await navigator.clipboard.writeText(detailDl.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  }, [detailDl]);

  const handleDeleteMissing = useCallback(async () => {
    if (!missingDl) return;
    try {
      await deleteDownload(missingDl.id, false);
      setMissingDl(null);
      handleRefresh();
    } catch (e) {
      console.error(e);
    }
  }, [missingDl]);

  if (showSettings) {
    return (
      <div className="flex h-screen base-bg">
        <Sidebar
          filter={filter}
          onFilterChange={handleFilterChange}
        />
        <div className="flex-1 overflow-y-auto">
          <Settings
            onBack={() => setShowSettings(false)}
            theme={theme}
            onThemeChange={setTheme}
            onDirtyChange={setSettingsDirty}
            saveRef={saveRef}
          />
        </div>
        {showConfirmLeave && (
          <ConfirmLeaveModal
            onSave={handleSaveAndLeave}
            onDiscard={handleDiscardAndLeave}
            onCancel={handleCancelLeave}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen base-bg text-main font-sans" style={{ WebkitAppRegion: 'drag' }}>
      <Sidebar
        filter={filter}
        onFilterChange={handleFilterChange}
        style={{ WebkitAppRegion: 'no-drag' }}
      />
      <div className="flex-1 flex flex-col overflow-hidden" style={{ WebkitAppRegion: 'no-drag' }}>
        <Header
          search={search}
          onSearchChange={setSearch}
          totalSpeed={stats.totalSpeed}
          activeCount={stats.active}
          completedCount={stats.completed}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <DownloadList
            downloads={sorted}
            onRefresh={handleRefresh}
            showSortBar={filter === 'completed'}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={setSortKey}
            onDirToggle={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            onOpenDetail={handleOpenDetail}
          />
        </main>
      </div>
      {detailDl && (
        <DetailModal download={detailDl} copied={copied} onCopy={handleCopyLink} onClose={() => setDetailDl(null)} />
      )}
      {missingDl && (
        <MissingFileModal
          download={missingDl}
          onOk={() => setMissingDl(null)}
          onDeleteHistory={handleDeleteMissing}
        />
      )}
    </div>
  );
}

function DetailModal({ download, copied, onCopy, onClose }) {
  const formatDate = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="surface border border-theme rounded-2xl p-6 w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-main">Download Details</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-muted hover:text-main hover:bg-surface-hover transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs text-muted mb-0.5">Filename</div>
            <div className="text-main font-medium break-all">{download.filename || 'Unknown'}</div>
          </div>
          <div>
            <div className="text-xs text-muted mb-0.5">URL</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={download.url || ''}
                onFocus={(e) => e.target.select()}
                className="flex-1 base-bg border border-theme rounded-lg px-3 py-1.5 text-xs text-main focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <button
                onClick={onCopy}
                className="px-3 py-1.5 rounded-lg bg-accent-dim text-white text-xs font-medium hover:bg-accent transition-colors whitespace-nowrap"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted mb-0.5">Size</div>
              <div className="text-main">{formatSize(download.total_size) || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted mb-0.5">Status</div>
              <div className="text-main capitalize">{download.status || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted mb-0.5">Date</div>
              <div className="text-main">{formatDate(download.completed_at || download.created_at)}</div>
            </div>
            <div>
              <div className="text-xs text-muted mb-0.5">Save Path</div>
              <div className="text-main break-all">{download.save_to || '-'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MissingFileModal({ download, onOk, onDeleteHistory }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="surface border border-theme rounded-2xl p-6 w-full max-w-sm shadow-2xl"
      >
        <h3 className="text-lg font-bold text-main mb-2">File Already Deleted</h3>
        <p className="text-sm text-muted mb-5">
          The file <span className="text-main font-medium">{download.filename}</span> no longer exists on disk.
          Delete its history entry?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onDeleteHistory}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-dim text-white hover:bg-accent transition-colors"
          >
            Oke, Hapus History
          </button>
          <button
            onClick={onOk}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium surface border border-theme text-main hover:bg-surface-hover transition-colors"
          >
            Oke
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmLeaveModal({ onSave, onDiscard, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="surface border border-theme rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-main mb-2">Unsaved Changes</h3>
        <p className="text-sm text-muted mb-5">You have unsaved settings. Save before leaving?</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onSave}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-dim text-white hover:bg-accent transition-colors"
          >
            Save &amp; Leave
          </button>
          <button
            onClick={onDiscard}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium surface border border-theme text-main hover:bg-surface-hover transition-colors"
          >
            Discard &amp; Leave
          </button>
          <button
            onClick={onCancel}
            className="w-full px-4 py-2.5 rounded-lg text-sm text-muted hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
