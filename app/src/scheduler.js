'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const JOBS_FILE = path.join(__dirname, '..', '..', 'data', 'scheduled-jobs.json');
const DEFAULT_CRON_TIMEZONE = 'Asia/Jakarta';

/**
 * DownloadScheduler - manages scheduled download jobs.
 *
 * Supports:
 *  - One-time scheduled downloads (via setTimeout)
 *  - Recurring downloads (daily/weekly via setInterval)
 *  - Cron expression parsing (simple subset: "* * * * *" -> min hour day month weekday)
 *
 * Stores job state in a JSON file for persistence across restarts.
 * Emits 'job-fired' event with { jobId, url } when a job triggers.
 */
class DownloadScheduler extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.downloader - DownloadManager instance
   * @param {string} [options.jobsFile] - Path to jobs JSON file
   */
  constructor({ downloader, jobsFile } = {}) {
    super();
    this.downloader = downloader;
    this.jobsFile = jobsFile || JOBS_FILE;
    this.jobs = new Map(); // jobId -> { id, url, schedule, options, timer, nextRun, createdAt }
    this._timers = new Map(); // jobId -> timeout/interval handle

    this._loadJobs();
  }

  /**
   * Load persisted jobs from JSON file.
   * Re-arms recurring jobs. One-time jobs that are past their schedule are marked as 'expired'.
   * @private
   */
  _loadJobs() {
    try {
      if (!fs.existsSync(this.jobsFile)) {
        return;
      }
      const raw = fs.readFileSync(this.jobsFile, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data.jobs)) return;

      for (const job of data.jobs) {
        // Don't re-arm completed one-time jobs
        if (job.schedule.type === 'once' && job.status === 'completed') continue;

        // Re-arm if the job is still active
        if (job.status === 'active') {
          this.jobs.set(job.id, { ...job, timer: null });
          this._armJob(job.id);
        } else {
          this.jobs.set(job.id, { ...job, timer: null });
        }
      }
    } catch (err) {
      console.error('[Scheduler] Failed to load jobs:', err.message);
    }
  }

  /**
   * Persist current jobs to JSON file.
   * @private
   */
  async _saveJobs() {
    try {
      const dir = path.dirname(this.jobsFile);
      if (!fs.existsSync(dir)) {
        await fsp.mkdir(dir, { recursive: true });
      }

      const data = {
        jobs: Array.from(this.jobs.values()).map(j => ({
          id: j.id,
          url: j.url,
          schedule: j.schedule,
          options: j.options,
          status: j.status,
          nextRun: j.nextRun,
          lastRun: j.lastRun,
          createdAt: j.createdAt,
        })),
      };

      await fsp.writeFile(this.jobsFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Scheduler] Failed to save jobs:', err.message);
    }
  }

  /**
   * Generate a unique job ID.
   * @private
   */
  _generateId() {
    return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Parse a simple cron expression and compute the next run time.
   * Supports: "* * * * *" (min hour day month weekday)
   * Each field can be: "*" (every), a number, or "*\/N" (every N).
   *
   * For simplicity, this implements a subset:
   * - Daily at a specific time: "0 HH * * *" (e.g. "0 14 * * *" = every day at 14:00)
   * - Weekly: "0 HH * * D" (e.g. "0 14 * * 1" = every Monday at 14:00)
   * - Every N minutes: "*\/N * * * *"
   *
   * @param {string} cronExpr
   * @returns {Date} Next run time
   * @private
   */
  _parseCronNextRun(cronExpr) {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: ${cronExpr}`);
    }

    const [minField, hourField, , , weekdayField] = parts;
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);

    // Handle "*/N" minute pattern
    if (minField.startsWith('*/')) {
      const n = parseInt(minField.slice(2), 10);
      if (isNaN(n) || n <= 0) throw new Error(`Invalid cron minute field: ${minField}`);
      next.setMinutes(now.getMinutes() + n);
      return next;
    }

    // Handle specific minute
    const targetMin = minField === '*' ? null : parseInt(minField, 10);
    const targetHour = hourField === '*' ? null : parseInt(hourField, 10);
    const targetWeekday = weekdayField === '*' ? null : parseInt(weekdayField, 10);

    // If specific hour and minute, compute next occurrence
    if (targetHour !== null && targetMin !== null) {
      next.setHours(targetHour, targetMin, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      // If weekday specified, advance to matching day
      if (targetWeekday !== null) {
        // JS getDay: 0=Sunday ... 6=Saturday, cron: 0=Sunday ... 7=Sunday
        const targetDay = targetWeekday === 7 ? 0 : targetWeekday;
        while (next.getDay() !== targetDay) {
          next.setDate(next.getDate() + 1);
        }
      }
      return next;
    }

    // If only minute specified (every hour at that minute)
    if (targetMin !== null) {
      next.setMinutes(targetMin, 0, 0);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
      return next;
    }

    // Default: next minute
    next.setMinutes(next.getMinutes() + 1);
    return next;
  }

  /**
   * Compute the next run time for a job based on its schedule config.
   * @param {Object} schedule - { type, at }
   * @returns {Date}
   * @private
   */
  _computeNextRun(schedule) {
    if (schedule.type === 'once') {
      const target = new Date(schedule.at);
      if (isNaN(target.getTime())) {
        throw new Error(`Invalid date for schedule.at: ${schedule.at}`);
      }
      return target;
    }

    // For daily/weekly, `at` can be a cron expression or ISO time
    if (typeof schedule.at === 'string' && schedule.at.includes('*')) {
      return this._parseCronNextRun(schedule.at);
    }

    // Parse as "HH:MM" time string
    if (typeof schedule.at === 'string' && /^\d{1,2}:\d{2}$/.test(schedule.at)) {
      const [hours, minutes] = schedule.at.split(':').map(Number);
      const next = new Date();
      next.setHours(hours, minutes, 0, 0);
      if (next <= new Date()) {
        next.setDate(next.getDate() + 1);
      }
      if (schedule.type === 'weekly') {
        // Advance to next Monday if not specified
        const day = schedule.weekday !== undefined ? schedule.weekday : 1;
        const targetDay = day === 7 ? 0 : day;
        while (next.getDay() !== targetDay) {
          next.setDate(next.getDate() + 1);
        }
      }
      return next;
    }

    // Try ISO 8601 date
    const parsed = new Date(schedule.at);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    throw new Error(`Cannot parse schedule.at: ${schedule.at}`);
  }

  /**
   * Arm a job's timer based on its next run time.
   * @param {string} jobId
   * @private
   */
  _armJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Clear existing timer
    this._clearTimer(jobId);

    const now = Date.now();
    const delay = job.nextRun - now;

    if (delay <= 0) {
      // Fire immediately if past due
      this._fireJob(jobId);
      return;
    }

    const timer = setTimeout(() => {
      this._fireJob(jobId);
    }, delay);

    // Don't keep the process alive just for this timer
    if (timer.unref) timer.unref();
    this._timers.set(jobId, timer);
  }

  /**
   * Clear a job's timer.
   * @param {string} jobId
   * @private
   */
  _clearTimer(jobId) {
    const timer = this._timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(jobId);
    }
  }

  /**
   * Fire a scheduled job - triggers the download and re-arms if recurring.
   * @param {string} jobId
   * @private
   */
  async _fireJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'active') return;

    try {
      this.emit('job-fired', { jobId, url: job.url });
      await this.downloader.startDownload({
        url: job.url,
        ...job.options,
      });
      job.lastRun = new Date().toISOString();
    } catch (err) {
      console.error(`[Scheduler] Job ${jobId} failed:`, err.message);
      this.emit('job-error', { jobId, url: job.url, error: err.message });
    }

    // Re-arm or complete
    if (job.schedule.type === 'once') {
      job.status = 'completed';
      this._saveJobs();
    } else {
      // Recurring - compute next run
      try {
        job.nextRun = this._computeNextRun(job.schedule).toISOString();
        this._armJob(jobId);
      } catch (err) {
        console.error(`[Scheduler] Failed to re-arm job ${jobId}:`, err.message);
        job.status = 'error';
        job.error = err.message;
      }
      this._saveJobs();
    }
  }

  /**
   * Schedule a new download job.
   * @param {string} url - URL to download
   * @param {Object} schedule - { type: 'once'|'daily'|'weekly', at: ISO8601|cron|'HH:MM', weekday?: 0-7 }
   * @param {Object} [options={}] - Download options (filename, save_to, threads, etc.)
   * @returns {{ id: string, nextRun: string, status: string }}
   */
  schedule(url, schedule, options = {}) {
    if (!url) throw new Error('URL is required');
    if (!schedule || !schedule.type || !schedule.at) {
      throw new Error('Schedule must include type and at');
    }

    const validTypes = ['once', 'daily', 'weekly'];
    if (!validTypes.includes(schedule.type)) {
      throw new Error(`Invalid schedule type: ${schedule.type}. Must be one of: ${validTypes.join(', ')}`);
    }

    const nextRun = this._computeNextRun(schedule);
    const jobId = this._generateId();

    const job = {
      id: jobId,
      url,
      schedule,
      options,
      status: 'active',
      nextRun: nextRun.toISOString(),
      lastRun: null,
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);
    this._armJob(jobId);
    this._saveJobs();

    return { id: jobId, nextRun: job.nextRun, status: job.status };
  }

  /**
   * List all scheduled jobs.
   * @returns {Array}
   */
  listScheduled() {
    return Array.from(this.jobs.values()).map(j => ({
      id: j.id,
      url: j.url,
      schedule: j.schedule,
      options: j.options,
      status: j.status,
      nextRun: j.nextRun,
      lastRun: j.lastRun,
      createdAt: j.createdAt,
    }));
  }

  /**
   * Cancel a scheduled job.
   * @param {string} jobId
   * @returns {{ id: string, cancelled: boolean }}
   */
  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    this._clearTimer(jobId);
    job.status = 'cancelled';
    this._saveJobs();

    return { id: jobId, cancelled: true };
  }

  /**
   * Get a single job by ID.
   * @param {string} jobId
   * @returns {Object|null}
   */
  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      id: job.id,
      url: job.url,
      schedule: job.schedule,
      options: job.options,
      status: job.status,
      nextRun: job.nextRun,
      lastRun: job.lastRun,
      createdAt: job.createdAt,
    };
  }

  /**
   * Stop all timers and persist state.
   */
  shutdown() {
    for (const [jobId] of this._timers) {
      this._clearTimer(jobId);
    }
    this._saveJobs();
  }
}

module.exports = DownloadScheduler;
