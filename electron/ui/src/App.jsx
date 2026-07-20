import { useState, useCallback, useEffect } from 'react';
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
  const [speedHistory, setSpeedHistory] = useState([]);
  // Theming state
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('idmm_theme') || 'dark-green';
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

  if (showSettings) {
    return (
      <div className="flex h-screen bg-slate-900">
        <Sidebar
          filter={filter}
          onFilterChange={setFilter}
          onSettingsClick={() => setShowSettings(false)}
          speedHistory={speedHistory}
          stats={stats}
        />
        <div className="flex-1 overflow-y-auto">
          <Settings onBack={() => setShowSettings(false)} theme={theme} onThemeChange={setTheme} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans" style={{ WebkitAppRegion: 'drag' }}>
      <Sidebar
        filter={filter}
        onFilterChange={setFilter}
        onSettingsClick={() => setShowSettings(true)}
        speedHistory={speedHistory}
        stats={stats}
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
