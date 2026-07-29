import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DownloadList from './components/DownloadList';
import AddDownload from './components/AddDownload';
import SpeedGraph from './components/SpeedGraph';
import Settings from './components/Settings';
import useWebSocket from './hooks/useWebSocket';
import { getDownloads, getStats } from './api';

export default function App() {
  const [downloads, setDownloads] = useState([]);
  const [stats, setStats] = useState({ totalSpeed: 0, active: 0, completed: 0 });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [pendingFilter, setPendingFilter] = useState(null);
  const saveRef = useRef(null);
  const [speedHistory, setSpeedHistory] = useState([]);
  // Theming state
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('idmm_theme') || 'dark';
  });
  const themeOnEnterRef = useRef(theme);

  useEffect(() => {
    localStorage.setItem('idmm_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
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
      setDownloads((prev) => {
        // Remove cancelled downloads from list (they're terminated)
        if (msg.status === 'cancelled') {
          return prev.filter((d) => d.id !== msg.id);
        }
        return prev.map((d) =>
          d.id === msg.id ? { ...d, status: msg.status } : d
        );
      });
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

  const handleRefresh = async () => {
    try {
      const data = await getDownloads();
      setDownloads(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleFilterChange = useCallback((filterKey) => {
    if (showSettings && settingsDirty) {
      setPendingFilter(filterKey);
      setShowConfirmLeave(true);
    } else {
      setFilter(filterKey);
      if (showSettings) setShowSettings(false);
    }
  }, [showSettings, settingsDirty]);

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

  if (showSettings) {
    return (
      <div className="flex h-screen bg-slate-900">
        <Sidebar
          filter={filter}
          onFilterChange={handleFilterChange}
          onSettingsClick={() => setShowSettings(false)}
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
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans" style={{ WebkitAppRegion: 'drag' }}>
      <Sidebar
        filter={filter}
        onFilterChange={handleFilterChange}
        onSettingsClick={() => { themeOnEnterRef.current = theme; setShowSettings(true); }}
        style={{ WebkitAppRegion: 'no-drag' }}
      />
      <div className="flex-1 flex flex-col overflow-hidden" style={{ WebkitAppRegion: 'no-drag' }}>
        <Header
          search={search}
          onSearchChange={setSearch}
          totalSpeed={stats.totalSpeed}
          onAddClick={() => setShowAdd(true)}
          activeCount={stats.active}
          completedCount={stats.completed}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <DownloadList downloads={filtered} onRefresh={handleRefresh} />
        </main>
      </div>
      {showAdd && <AddDownload onClose={() => setShowAdd(false)} onAdded={handleRefresh} />}
    </div>
  );
}

function ConfirmLeaveModal({ onSave, onDiscard, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-slate-100 mb-2">Unsaved Changes</h3>
        <p className="text-sm text-slate-400 mb-5">You have unsaved settings. Save before leaving?</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onSave}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-dim text-white hover:bg-accent transition-colors"
          >
            Save &amp; Leave
          </button>
          <button
            onClick={onDiscard}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
          >
            Discard &amp; Leave
          </button>
          <button
            onClick={onCancel}
            className="w-full px-4 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-700/50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
