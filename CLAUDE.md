# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Cloudflare Pages site: a static, build-free executive finance dashboard (`index.html` + `app.js` + `data.js` + `config.js` + `styles.css`) fronted by Pages Functions (`functions/`) that handle session auth and user management. There is no package.json, bundler, framework, or test suite — scripts are loaded as plain `<script>` tags in order (`config.js` → `data.js` → `app.js`), so everything in them lives on `window` and top-level `const`s are shared globals.

## Commands

```bash
# Local dev WITH Functions/auth (the real thing; needs .dev.vars + a KV binding)
npx --yes wrangler pages dev . --kv USERS --port 8793

# Static-only preview (no auth, no /api/*) — see .claude/launch.json
python -m http.server 8790

# Syntax-check after editing (no build step will catch errors for you)
node --check app.js
```

There are no tests or linters. Verification is manual: run `wrangler pages dev`, log in, and exercise the tab. `curl` against `/api/login` with `-c cookies.txt` then `-b cookies.txt` against `/`, `/api/me`, `/api/users` is the usual way to check the auth paths.

## Deployment

Pushed to GitHub and auto-built by Cloudflare Pages. Two remotes exist (`origin` → `Finance-Dashboard`, `new-origin` → `oligence-finance-dashboard-team`) — confirm which one is wanted before pushing.

Cloudflare Pages must have `AUTH_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD` env vars and the `USERS` KV namespace bound. Locally these come from `.dev.vars` (gitignored).

Because assets are served straight from the repo with no content hashing, **`styles.css` is referenced as `styles.css?v=N` in `index.html`** — bump `N` whenever CSS changes, or Cloudflare/browser caches serve the old file. (`app.js`/`data.js` are currently unversioned.)

## Architecture

### Auth (functions/)
`functions/_middleware.js` runs before *every* request including static assets, so the dashboard HTML/JS never reaches an unauthenticated browser. Only `/login`, `/login.html`, `/api/login`, `/api/logout` are public. Unauthenticated `/api/*` gets JSON 401; everything else gets a 302 to `/login`. Note the comment there: both `/login` and `/login.html` must stay public or Pages' 308 canonicalization creates a redirect loop.

`functions/_auth.js` owns the session cookie (base64url `{email, exp}` + HMAC-SHA256 with `env.AUTH_SECRET`, 12h TTL) and PBKDF2 password hashing. There is deliberately no fallback secret — auth fails closed without `AUTH_SECRET`.

`functions/_users.js` stores the whole user directory as one JSON array under a single KV key `users` (get-modify-put; not concurrency-safe, fine at this scale). The `owner` account is lazily seeded from `OWNER_EMAIL`/`OWNER_PASSWORD` the first time the directory is read empty. Roles are `owner` (can manage users) and `member`.

`functions/api/users.js` re-derives the caller from their own session cookie and requires role `owner` — never trust a client-supplied email in these handlers.

### Frontend data flow
The dashboard fetches **only** from the n8n webhook in `config.js` (`window.N8N_WEBHOOK_URL`), via `fetchDashboardData({range, startDate, endDate})` in `data.js`. `data.js` returns the payload verbatim: no mocks, defaults, or backfilled values anywhere. Missing fields must render as an empty state (`—`, `emptyRow()`, `emptyPanel()`), never as a fabricated number.

There are exactly three fetch triggers (grep `FETCH TRIGGER`): initial load (always `range: 'all'`), the Refresh button, and that's it. Changing the date preset or date inputs updates the UI only — tab switching and filter edits re-render from the already-fetched `state.data`.

`app.js` is one ~1400-line file with a single mutable `state` object and a `render()` switch dispatching to `renderOverview` / `renderBrand('IMFND'|'AS')` / `renderOligenceAI` / `renderCashFlow` / `renderUsersTab`. Rendering is `els.app.innerHTML = template string`, then charts are drawn into the freshly created canvases. Consequences to respect:

- Any user/webhook-derived string interpolated into a template must go through `escapeHtml()`.
- Chart.js instances are tracked in the `charts` map keyed by canvas id; call `destroyChart(id)` before recreating, or the old chart leaks and the canvas misbehaves.
- Event handlers are attached once at module scope to elements that live in `index.html` (topbar, tabbar); handlers for re-rendered content must be re-attached inside the render function or delegated.

Expected payload shape: `{ overview: { kpis: {..., trends}, brandTable }, brands: { IMFND, AS, OligenceAI }, cashFlow: { kpis, moneyIn, moneyOut } }`. Brand objects carry `kpis`, `courses`, `salesReps`, `expenses`, `paymentMethods.{in,out}`, and for Oligence AI `clients`.

### Webhook shape tolerance
The n8n webhook has changed shape over time and `app.js` absorbs both variants rather than requiring the webhook to change — see `clientServices()`, `groupClients()`, `clientTotals()`. A client may arrive with a `services` array or flat `serviceType`/`serviceName`/`method`/`notes` fields; with per-month `months[]` or flat client-level totals; and the same client may span multiple rows (one per service), which `groupClients()` merges while keeping only the first non-empty financial figures so nothing is double-counted. Preserve this tolerance when editing those helpers.

The "Cash in by Service" aggregation in `renderOligenceAI()` deliberately does **not** tolerate a missing service name: rows whose `serviceName` is empty/whitespace are skipped entirely rather than bucketed into an `Other` row, so every row in that table/chart is a real Service Name from the sheet. Its total is therefore lower than the client-level revenue total when the sheet has unnamed services — that gap is expected, not a bug.

## Secrets

`.dev.vars` (owner credentials, `AUTH_SECRET`) and `.mcp.json` (n8n bearer token) are gitignored and contain live secrets — do not read them into output, echo them, or commit them.

update @CLAUDE.md file after each major change and keep
it up to date.