# Changelog

All notable changes to `@nuraly/lumenjs` are documented here.
Releases are driven by the `publish-lumenjs` workflow: every merged
commit with a `feat(lumenjs)` / `fix(lumenjs)` scope bumps the version
on the next push to `main`.

## Next patch

Fixes already on `main` that were authored with a `fix(all)` scope and
therefore missed the automatic version bump. They ship together in this
release:

- #1167 — layout SSE subscriptions torn down and re-created on every navigation; live data gap when layouts persist
- #1226 — client-side and server-side route matching used different priority algorithms, causing SSR/CSR hydration mismatch for mixed static/dynamic routes
- #1299 — HEAD requests to API routes returned 405 when only GET was exported; now falls back to GET per HTTP spec
- #1300 — `application/x-www-form-urlencoded` POST bodies not parsed; handlers received the raw string
- #1317 — `llms.txt` did not indicate auth-protected pages; `hasAuth` dropped from `LlmsPage`
- #1319 — `lumenjs.plugins.js` loaded only in dev; no equivalent hook for registering custom Connect middleware in production
- #1320 — production middleware could not rewrite `req.url`; pathname was captured before the middleware chain ran
- #1321 — user middleware ran before locale resolution; `req.locale` unavailable for i18n-aware gates
