import { memo } from 'react';
import { formatSpeed } from '../api';

const FILTER_BTNS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Done' },
  { key: 'paused', label: 'Paused' },
];

function Header({ search, onSearchChange, totalSpeed, onAddClick, activeCount, completedCount }) {
  return (
    <header className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 px-6 py-3 shrink-0 flex-none" style={{ paddingRight: '140px', WebkitAppRegion: 'drag' }}>
      <div className="flex items-center gap-4" style={{ WebkitAppRegion: 'no-drag' }}>
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search downloads..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
          />
        </div>

        {/* Speed Indicator */}
        {totalSpeed > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-sm font-medium text-accent">{formatSpeed(totalSpeed)}</span>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-slate-400">
          {activeCount > 0 && <span>{activeCount} active</span>}
          {completedCount > 0 && <span>{completedCount} done</span>}
        </div>

        {/* Add Button */}
        <button
          onClick={onAddClick}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-dim text-white text-sm font-medium hover:bg-accent transition-colors glow-green"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add
        </button>
      </div>
    </header>
  );
}

export default memo(Header);
