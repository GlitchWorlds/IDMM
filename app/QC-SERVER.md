# QC Audit — IDRAMServer (server.js)

Date: 2026-07-15 | Audited by: Manager Agent (subagent)

---

## Summary

| Severity | Count |
|----------|-------|
| ❌ Critical | 1 |
| ⚠️ Warning | 5 |
| ✅ OK | 8 |

---

## Function-by-Function Audit

| # | Function | Verdict | Notes |
|---|----------|---------|-------|
| 1 | `constructor({db, downloader})` | ✅ | Clean init, null-guards present, calls setup in correct order. No issues. |
| 2 | `_setupMiddleware()` | ⚠️ | **Rate limiter leaks memory** — `rateLimitMap` never evicts expired entries; under sustained traffic or many IPs the Map grows unbounded. Use a TTL map or periodic cleanup. Otherwise helmet, CORS, and JSON parsing are solid. |
| 3 | `_setupRoutes()` | ⚠️ | See per-route breakdown below. Overall structure is good — error handling present on every route, input validation on download POST. Two concerns surfaced. |
| 4 | `_setupWebSocket()` | ⚠️ | Origin check is good; `init` state on connect is good. **Broadcast timer never checks `ws.isAlive`** — dead TCP connections (no close frame) stay in `wsClients` until OS timeout. Add ping/pong heartbeat per ws spec. |
| 5 | `broadcast(data)` | ✅ | Correct: iterates, checks readyState, removes on error. Safe against concurrent mutation (Set + sync loop). |
| 6 | `_isAllowedOrigin(origin)` | ⚠️ | **Duplicated logic** — exact same rules as the CORS origin callback. If you add a new allowed origin you must update both places. Extract to a shared helper. |
| 7 | `start()` | ✅ | Promise wraps correctly, EADDRINUSE handled, WS setup called after http server created. `onComplete`/`onError` callbacks wired. |
| 8 | `stop()` | ✅ | Clears interval, closes all WS clients with status code, closes server. Graceful. One minor: doesn't reject on server close error, but for a local download manager that's acceptable. |

---

## Route-Level Notes

| Route | Verdict | Notes |
|-------|---------|-------|
| `GET /api/health` | ✅ | Simple, no issues. |
| `POST /api/download` | ✅ | Validates URL, checks concurrent limit, 400/429/500 codes correct. |
| `GET /api/downloads` | ⚠️ | `req.query.status` passed directly to `db.listDownloads(status)` — verify the DB layer parameterizes this (SQL injection risk if query is string-concatenated). Not exploitable over HTTP alone if DB uses prepared statements, but worth confirming. |
| `GET /api/download/:id` | ✅ | 404 on missing, clean. |
| `POST /api/download/:id/pause` | ✅ | Maps error message to status code — fragile but functional. |
| `POST /api/download/:id/resume` | ✅ | Async, error codes appropriate. |
| `POST /api/download/:id/cancel` | ✅ | Clean. |
| `DELETE /api/download/:id` | ⚠️ | **No confirmation/soft-delete** — destructive operation (deletes files from disk). No auth check beyond CORS. For a localhost-only app this is acceptable, but document the blast radius. |
| `GET /api/settings` | ✅ | Clean. |
| `PUT /api/settings` | ✅ | Key whitelist is good security practice. No validation on *values* (e.g., `max_concurrent_downloads` could be set to `"abc"`), but DB/downloader should coerce or reject. |
| `GET /api/stats` | ✅ | Clean. |

---

## Security Summary

| Issue | Severity | Detail |
|-------|----------|--------|
| ❌ **No authentication** | Critical | Anyone on localhost (other processes, malicious extensions, other users on multi-user machine) has full control. Add a token header check (`X-IDMAM-Token`) — the header is already in CORS `allowedHeaders` but never validated. |
| Rate limiter memory leak | Medium | Unbounded Map; replace with LRU or add periodic sweep. |
| WS no ping/pong | Low | Stale connections accumulate; add `ws.isAlive` heartbeat. |
| `DELETE` is destructive with no auth | Medium | Acceptable for localhost-only, but combine with auth token above. |
| `err.message` exposed to client | Low | Internal error messages sent verbatim in 500 responses. For a local app this aids debugging; for production, sanitize. |

---

## Recommendations (Priority Order)

1. **Add token auth** — Generate a random token at startup, require `X-IDMAM-Token` header on all API routes. Pass it to the frontend via env/config. This is the single highest-impact security fix.
2. **Extract shared origin validator** — Deduplicate CORS origin logic into `_isAllowedOrigin()` and call it from both the CORS middleware and WS connection handler.
3. **Add WS ping/pong** — `setInterval` ping every 30s, terminate clients that don't pong back.
4. **Sweep rate limiter** — Add a 60s interval to delete entries older than the window from `rateLimitMap`.
5. **Validate settings values** — Type-check numeric settings before passing to `Object.assign`.
