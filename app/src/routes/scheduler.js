'use strict';

const express = require('express');
const DownloadScheduler = require('../scheduler');

const router = express.Router();

/**
 * Factory function to create the scheduler router with injected dependencies.
 * @param {Object} deps - { scheduler } where scheduler is a DownloadScheduler instance
 * @returns {express.Router}
 */
function createSchedulerRouter(deps) {
  const schedulerRouter = express.Router();

  /**
   * POST /api/schedule
   *
   * Body: { url, schedule: { type: 'once'|'daily'|'weekly', at: ISO8601 or cron or 'HH:MM', weekday?: 0-7 }, options?: {...} }
   *
   * Creates a scheduled download job.
   */
  schedulerRouter.post('/', (req, res) => {
    try {
      const { url, schedule, options = {} } = req.body || {};

      if (!url) {
        return res.status(400).json({ error: 'url is required' });
      }
      if (!schedule) {
        return res.status(400).json({ error: 'schedule is required' });
      }
      if (!schedule.type) {
        return res.status(400).json({ error: 'schedule.type is required' });
      }
      if (!schedule.at) {
        return res.status(400).json({ error: 'schedule.at is required' });
      }

      const result = deps.scheduler.schedule(url, schedule, options);
      res.status(201).json(result);
    } catch (err) {
      const status = err.message.includes('not found') ? 404
        : err.message.includes('Invalid') ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /**
   * GET /api/scheduled
   *
   * Lists all scheduled jobs.
   */
  schedulerRouter.get('/', (req, res) => {
    try {
      const jobs = deps.scheduler.listScheduled();
      res.json({ jobs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/schedule/:jobId
   *
   * Get a specific scheduled job.
   */
  schedulerRouter.get('/:jobId', (req, res) => {
    try {
      const job = deps.scheduler.getJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: 'Scheduled job not found' });
      }
      res.json(job);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/schedule/:jobId
   *
   * Cancel a scheduled job.
   */
  schedulerRouter.delete('/:jobId', (req, res) => {
    try {
      const result = deps.scheduler.cancel(req.params.jobId);
      res.json(result);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  return schedulerRouter;
}

module.exports = router;
module.exports.createSchedulerRouter = createSchedulerRouter;
