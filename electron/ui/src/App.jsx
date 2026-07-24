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
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [pendingFilter, setPendingFilter] = useState(null);
  const saveRef = useRef(null);
  const [speedHistory, setSpeedHistory] = useState([]);
  // Theming state
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('idmm_theme') || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('idmm_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'progress') {
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === msg.id ? { ...d, ...msg.data } : d
        )
      );
      setSpeedHistory((prev) => {
        const now = Date.now();
        const next = [...prev, { time: now, speed: msg.data.speed || 0 }];
        return next.slice(-60);
      });
    } else if (msg.type === 'status') {
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === msg.id ? { ...d, status: msg.status } : d
        )
      );
    } else if (msg.type === 'added') {
      setDownloads((prev) => [msg.data, ...prev]);
    } else if (msg.type === 'removed') {
      setDownloads((prev) => prev.filter((d) => d.id !== msg.id));
    }
  }, []);

  useWebSocket(handleWsMessage);

  useEffect(() => {
    getDownloads().then(setDownloads).catch(console.error);
    getStats().then(setStats).catch(console.error);
    const interval = setInterval(() => {
      getDownloads().then(setDownloads).catch(() => {});
      getStats().then(setStats).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

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

  const handleInstallExtension = useCallback((browser) => {
    setExtensionStatus({ loading: true, browser });
    fetch('http://127.0.0.1:9977/api/extension/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          setExtensionStatus({ success: true, message: data.message || `${browser} extension installed successfully.`, browser });
        } else {
          setExtensionStatus({ error: true, message: data.error || 'Failed to install extension.', browser });
        }
      })
      .catch(err => {
        setExtensionStatus({ error: true, message: err.message || 'Network error.', browser });
      });
  }, []);

  if (showSettings) {
    return (
      <div className="flex h-screen bg-slate-900">
        <Sidebar
          filter={filter}
          onFilterChange={handleFilterChange}
          onSettingsClick={() => setShowSettings(false)}
          onInstallExtension={() => setShowExtensionModal(true)}
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
        {showExtensionModal && (
          <ExtensionInstallModal
            onClose={() => { setShowExtensionModal(false); setExtensionStatus(null); }}
            onInstall={handleInstallExtension}
            status={extensionStatus}
          />
        )}
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
        onSettingsClick={() => setShowSettings(true)}
        onInstallExtension={() => setShowExtensionModal(true)}
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
      {showExtensionModal && (
        <ExtensionInstallModal
          onClose={() => { setShowExtensionModal(false); setExtensionStatus(null); }}
          onInstall={handleInstallExtension}
          status={extensionStatus}
        />
      )}
    </div>
  );
}

const BROWSER_BUTTONS = [
  { key: 'chrome', label: 'Chrome', color: 'bg-slate-700 hover:bg-slate-600' },
  { key: 'edge', label: 'Edge', color: 'bg-slate-700 hover:bg-slate-600' },
  { key: 'firefox', label: 'Firefox', color: 'bg-slate-700 hover:bg-slate-600' },
  { key: 'brave', label: 'Brave', color: 'bg-slate-700 hover:bg-slate-600' },
  { key: 'opera', label: 'Opera', color: 'bg-slate-700 hover:bg-slate-600' },
  { key: 'vivaldi', label: 'Vivaldi', color: 'bg-slate-700 hover:bg-slate-600' },
];

function ExtensionInstallModal({ onClose, onInstall, status }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-100">Install Browser Extension</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">Select your browser to install the IDMM extension.</p>
        <div className="grid grid-cols-2 gap-3">
          {BROWSER_BUTTONS.map((btn) => (
            <button
              key={btn.key}
              onClick={() => onInstall(btn.key)}
              disabled={status?.loading}
              className={`${btn.color} px-4 py-3 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        {status?.loading && (
          <p className="text-sm text-slate-400 mt-4 animate-pulse">Installing for {status.browser}...</p>
        )}
        {status?.success && (
          <div className="mt-4 p-3 rounded-lg bg-green-500/20 border border-green-500/30">
            <p className="text-sm text-green-400">{status.message}</p>
          </div>
        )}
        {status?.error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30">
            <p className="text-sm text-red-400">{status.message}</p>
          </div>
        )}
      </div>
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
