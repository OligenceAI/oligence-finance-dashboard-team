/* ==========================================================================
 * data.js — Live data fetch (n8n webhook only, no mock/sample data)
 *
 * fetchDashboardData({ range, startDate, endDate }) POSTs to
 * window.N8N_WEBHOOK_URL (set in config.js) and returns the parsed JSON
 * response verbatim. Nothing here invents, defaults, or backfills values —
 * whatever the webhook doesn't send back is left missing, and app.js is
 * responsible for rendering that as an empty state instead of a fake number.
 * ========================================================================== */

async function fetchDashboardData(params) {
  const url = window.N8N_WEBHOOK_URL;
  if (!url) {
    throw new Error('N8N_WEBHOOK_URL is not configured (see config.js).');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });

  if (!res.ok) {
    throw new Error(`Webhook request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}
