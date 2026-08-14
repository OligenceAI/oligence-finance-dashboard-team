/* ==========================================================================
 * config.js — Editable runtime configuration
 *
 * Static sites (no Node/build step) can't read a real .env file in the
 * browser, so this file plays that role: a single, obvious place to edit
 * the n8n webhook URL. Loaded before mock-data.js / app.js in index.html.
 *
 * To go live in Phase 2: flip USE_LIVE_WEBHOOK to true in mock-data.js
 * (search "USE_LIVE_WEBHOOK"). Until then this URL is unused.
 * ========================================================================== */

window.N8N_WEBHOOK_URL = 'https://primary-production-fc21a.up.railway.app/webhook/dashboard-data';
