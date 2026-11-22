'use strict';

const express = require('express');

const router = express.Router();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Factory function to create the history router with injected dependencies.
 * @param {Object} deps - { db } where db is an IDMMDatabase instance
 * @returns {express.Router}
 */
function createHistoryRouter(deps) {
  const historyRouter = express.Router();

  /**
   * GET /api/downloads/history?page=1&limit=20&search=keyword&status=completed
   *
   * Paginated download history with optional search and status filter.
   *
   * Query params:
   *  - page: Page number (default 1)
   *  - limit: Items per page (default 20, max 100)
   *  - search: Search keyword (matches filename or url)
   *  - status: Filter by status (pending, downloading, paused, completed, failed, cancelled)
   *
   * Response: { items: [...], total: N, page: P, limit: L, totalPages: T }
   */
  historyRouter.get('/', (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || DEFAULT_PAGE, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const search = req.query.search ? String(req.query.search) : null;
      const status = req.query.status ? String(req.query.status) : null;

      // Validate status if provided
      const validStatuses = ['pending', 'downloading', 'paused', 'completed', 'failed', 'cancelled', 'merging'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Valid values: ${validStatuses.join(', ')}` });
      }

      // Call the DB pagination method (added by another agent)
      // Expected return: { ok, data: { items, total, page, limit, totalPages } }
      const result = deps.db.getDownloadsWithPagination(page, limit, search, status);

      if (!result.ok) {
        return res.status(500).json({ error: result.error || 'Failed to retrieve download history' });
      }

      const data = result.data || { items: [], total: 0, page, limit, totalPages: 0 };

      res.json({
        items: data.items || [],
        total: data.total || 0,
        page: data.page || page,
        limit: data.limit || limit,
        totalPages: data.totalPages || Math.ceil((data.total || 0) / limit),
      });
    } catch (err) {
      console.error('[History] Error:', err.message);
      res.status(500).json({ error: 'Failed to retrieve download history' });
    }
  });

  return historyRouter;
}

module.exports = router;
module.exports.createHistoryRouter = createHistoryRouter;
