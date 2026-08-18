/* ==========================================================================
 * config.js — Editable runtime configuration
 *
 * Static sites (no Node/build step) can't read a real .env file in the
 * browser, so this file plays that role: a single, obvious place to edit
 * the n8n webhook URL. Loaded before data.js / app.js in index.html.
 * ========================================================================== */

window.N8N_WEBHOOK_URL = 'https://primary-production-fc21a.up.railway.app/webhook/dashboard-data';
