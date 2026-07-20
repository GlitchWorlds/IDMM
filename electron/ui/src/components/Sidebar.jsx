import { memo } from 'react';
import SpeedGraph from './SpeedGraph';
import { formatSpeed } from '../api';

const NAV_ITEMS = [
  { key: 'all', label: 'All Downloads', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  { key: 'active', label: 'Active', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { key: 'completed', label: 'Completed', icon: 'M5 13l4 4L19 7' },
  { key: 'paused', label: 'Paused', icon: 'M10 9v6m4-6v6' },
  { key: 'queue', label: 'Queue', icon: 'M12 8v4l3 3' },
];

function Sidebar({ filter, onFilterChange, onSettingsClick, speedHistory, stats, style }) {
  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col h-full shrink-0" style={{ ...style, WebkitAppRegion: 'drag' }}>
      {/* Logo */}
      <div className="p-6 border-b border-slate-800" style={{ WebkitAppRegion: 'drag' }}>
        <h1 className="text-xl font-bold bg-gradient-to-r from-accent to-purple-500 bg-clip-text text-transparent">
          IDMM
        </h1>
        <p className="text-xs text-slate-500 mt-1">Download Manager</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1" style={{ WebkitAppRegion: 'no-drag' }}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onFilterChange(item.key)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
              filter === item.key
                ? 'nav-active text-accent font-medium'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Settings */}
      <div className="p-3 border-t border-slate-800 space-y-1" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={onSettingsClick}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          <span>Settings</span>
        </button>
        <a
          href="https://github.com/GlitchWorlds/IDMM"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          <span>Help</span>
        </a>
      </div>
    </aside>
  );
}

export default memo(Sidebar);
