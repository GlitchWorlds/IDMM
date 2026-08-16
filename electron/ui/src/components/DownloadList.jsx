import { memo, useState, useCallback } from 'react';
import { pauseDownload, resumeDownload, cancelDownload, deleteDownload, openFolder, formatBytes as formatSize, formatSpeed, formatETA as formatEta } from '../api';

function getStatusColor(status) {
  switch (status) {
    case 'downloading':
    case 'active': return 'text-accent';
    case 'completed': return 'status-completed';
    case 'paused': return 'status-paused';
    case 'error': return 'status-error';
    case 'cancelled': return 'status-cancelled';
    default: return 'text-muted';
  }
}

function getStatusBadge(status) {
  const colors = {
    downloading: 'bg-accent/20 text-accent',
    active: 'bg-accent/20 text-accent',
    completed: 'bg-emerald-500/20 status-completed',
    paused: 'bg-amber-500/20 status-paused',
    queued: 'bg-slate-500/20 text-muted',
    waiting: 'bg-slate-500/20 text-muted',
    cancelled: 'bg-slate-500/20 status-cancelled',
    error: 'bg-red-500/20 status-error',
  };
  return colors[status] || 'bg-slate-500/20 text-muted';
}

function DownloadItem({ download, onRefresh, onOpenDetail }) {
  const { id, filename, url, status, progress, speed, total_size, downloaded, eta, save_to, created_at, completed_at } = download;
  const pct = progress || 0;
  const isActive = status === 'downloading' || status === 'active';
  const isPaused = status === 'paused';
  const isCompleted = status === 'completed';
  const isError = status === 'error';
  const isCancelled = status === 'cancelled';
  const isQueued = status === 'queued' || status === 'waiting';

  const handlePause = async () => {
    try { await pauseDownload(id); onRefresh?.(); } catch (e) { console.error(e); }
  };
  const handleResume = async () => {
    try { await resumeDownload(id); onRefresh?.(); } catch (e) { console.error(e); }
  };
  const handleCancel = async () => {
    try { await cancelDownload(id); onRefresh?.(); } catch (e) { console.error(e); }
  };
  const handleDelete = async (deleteFile = false) => {
    try { await deleteDownload(id, deleteFile); onRefresh?.(); } catch (e) { console.error(e); }
  };
  const handleOpenFolder = async () => {
    try {
      // Kirim full path file — server mengecek keberadaan file,
      // kalau hilang → UI tampilkan dialog "file sudah dihapus".
      const sep = (save_to || '').includes('\\') ? '\\' : '/';
      const fullPath = save_to && filename
        ? `${String(save_to).replace(/[\\/]+$/, '')}${sep}${filename}`
        : save_to;
      const res = await openFolder(fullPath);
      if (res && res.exists === false) {
        // File missing — show modal with delete-history option
        onOpenDetail?.({ type: 'missing', download });
      }
    } catch (e) { console.error(e); }
  };

  // Format Date Helper
  const formatDate = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  // Compact layout for completed/error/cancelled downloads
  if (isCompleted || isError || isCancelled) {
    return (
      <div className="card-hover surface rounded-lg p-3 animate-fade-in border border-transparent hover:border-theme transition-colors">
        <div className="flex items-center gap-4">
          {/* File Icon / Type Indicator */}
          <div className="shrink-0 w-10 h-10 rounded surface-hover flex items-center justify-center text-muted">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>

          {/* Details — click to open detail modal */}
          <button
            className="flex-1 min-w-0 grid grid-cols-12 gap-4 items-center text-left"
            onClick={() => onOpenDetail?.({ type: 'detail', download })}
          >
            {/* Name & URL */}
            <div className="col-span-5 flex flex-col min-w-0">
              <span className="text-sm font-medium text-main truncate" title={filename || url}>
                {filename || 'Unknown file'}
              </span>
              <span className="text-[11px] text-muted truncate" title={url}>
                {url}
              </span>
            </div>

            {/* Size */}
            <div className="col-span-2 text-xs text-muted">
              {total_size ? formatSize(total_size) : '-'}
            </div>

            {/* Date */}
            <div className="col-span-3 text-xs text-muted truncate">
              {formatDate(completed_at || created_at)}
            </div>

            {/* Status Badge */}
            <div className="col-span-2 flex justify-end">
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${getStatusBadge(status)}`}>
                {status}
              </span>
            </div>
          </button>

          {/* Actions */}
          <div className="shrink-0 flex items-center gap-1">
            {(isError || isCancelled) && (
              <>
                <button onClick={() => handleDelete(false)} className="p-1.5 rounded text-muted hover:text-red-400 hover:bg-surface-hover transition-colors" title="Delete History">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <button onClick={() => handleDelete(true)} className="p-1.5 rounded text-muted hover:text-red-400 hover:bg-surface-hover transition-colors" title="Delete History and Temp Files">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            )}
            {isCompleted && (
              <>
                <button onClick={handleOpenFolder} className="p-1.5 rounded text-muted hover:text-emerald-400 hover:bg-surface-hover transition-colors" title="Open Folder">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </button>
                <button onClick={() => handleDelete(false)} className="p-1.5 rounded text-muted hover:text-red-400 hover:bg-surface-hover transition-colors" title="Delete History">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <button onClick={() => handleDelete(true)} className="p-1.5 rounded text-muted hover:text-red-400 hover:bg-surface-hover transition-colors" title="Delete History and File">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            )}
            <button onClick={() => onOpenDetail?.({ type: 'detail', download })} className="p-1.5 rounded text-muted hover:text-accent hover:bg-surface-hover transition-colors" title="Details">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active / Paused / Queued Layout (Detailed)
  return (
    <div className="card-hover surface rounded-xl p-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Filename & Status */}
          <div className="flex items-center gap-3 mb-2">
            <button className="flex-1 min-w-0 text-left" onClick={() => onOpenDetail?.({ type: 'detail', download })}>
              <h3 className="text-sm font-medium text-main truncate">
                {filename || url || 'Unknown file'}
              </h3>
            </button>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusBadge(status)}`}>
              {status || 'unknown'}
            </span>
          </div>

          {/* URL */}
          <p className="text-xs text-muted truncate mb-3">{url}</p>

          {/* Progress Bar */}
          <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden mb-2" style={{ background: 'var(--border-color)' }}>
            <div
              className="progress-bar absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className={getStatusColor(status)}>
              {isQueued ? '—' : `${pct.toFixed(1)}%`}
            </span>
            {downloaded != null && total_size != null && (
              <span>{formatSize(downloaded)} / {formatSize(total_size)}</span>
            )}
            {isActive && speed > 0 && (
              <span className="text-accent">{formatSpeed(speed)}</span>
            )}
            {isActive && <span>ETA: {formatEta(eta)}</span>}
            {isQueued && <span>Waiting for slot...</span>}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isActive && (
            <button onClick={handlePause} className="p-2 rounded-lg text-muted hover:text-amber-400 hover:bg-surface-hover transition-colors" title="Pause">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
              </svg>
            </button>
          )}
          {isPaused && (
            <button onClick={handleResume} className="p-2 rounded-lg text-muted hover:text-accent hover:bg-surface-hover transition-colors" title="Resume">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
              </svg>
            </button>
          )}
          {(isActive || isPaused || isError || isCancelled) && (
            <button onClick={handleCancel} className="p-2 rounded-lg text-muted hover:text-red-400 hover:bg-surface-hover transition-colors" title="Cancel">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {isQueued && (
            <button onClick={handleCancel} className="p-2 rounded-lg text-muted hover:text-red-400 hover:bg-surface-hover transition-colors" title="Remove from queue">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button onClick={() => onOpenDetail?.({ type: 'detail', download })} className="p-2 rounded-lg text-muted hover:text-accent hover:bg-surface-hover transition-colors" title="Details">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
];

function SortBar({ sortKey, sortDir, onSortChange, onDirToggle }) {
  return (
    <div className="flex items-center gap-2 mb-3 px-1 animate-fade-in">
      <span className="text-xs text-muted mr-1">Sort:</span>
      {SORT_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onSortChange(opt.key)}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
            sortKey === opt.key
              ? 'bg-accent/20 text-accent'
              : 'text-muted hover:bg-surface-hover'
          }`}
        >
          {opt.label}
        </button>
      ))}
      <button
        onClick={onDirToggle}
        className="p-1.5 rounded-lg text-muted hover:bg-surface-hover transition-all"
        title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
      >
        {sortDir === 'asc' ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5 4v-12m0 0l-4 4m4-4l4 4" />
          </svg>
        )}
      </button>
    </div>
  );
}

function DownloadList({ downloads, onRefresh, showSortBar, sortKey, sortDir, onSortChange, onDirToggle, onOpenDetail }) {
  if (!downloads || downloads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted" style={{ WebkitAppRegion: 'no-drag' }}>
        <svg className="w-16 h-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm">No downloads</p>
        <p className="text-xs text-muted mt-1 opacity-60">Downloads arrive via the browser extension</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" style={{ WebkitAppRegion: 'no-drag' }}>
      {showSortBar && (
        <SortBar sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} onDirToggle={onDirToggle} />
      )}
      {downloads.map((d) => (
        <DownloadItem key={d.id} download={d} onRefresh={onRefresh} onOpenDetail={onOpenDetail} />
      ))}
    </div>
  );
}

export default memo(DownloadList);
