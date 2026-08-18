/* ==========================================================================
 * functions/_middleware.js — Gate every request behind a valid session
 *
 * Runs before any static asset (index.html, app.js, data.js, config.js) is
 * served, so the dashboard and its data never reach the browser without a
 * valid session cookie. /login.html and the /api/* auth endpoints stay public.
 * ========================================================================== */

import { isSessionValid } from './_auth.js';

// Cloudflare Pages canonicalizes /login.html -> /login (308), so both must be public
// or the redirect loops: middleware sends /login.html, Pages redirects to /login,
// middleware (not recognizing /login) sends back to /login.html, forever.
const PUBLIC_PATHS = ['/login', '/login.html', '/api/login', '/api/logout'];

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);

  if (PUBLIC_PATHS.includes(url.pathname)) {
    return next();
  }

  const authed = await isSessionValid(request, env);
  if (!authed) {
    // API calls expect JSON they can handle in a fetch() catch block, not an
    // HTML redirect that fetch would silently follow and then fail to parse.
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const loginUrl = new URL('/login', url.origin);
    if (url.pathname !== '/') {
      loginUrl.searchParams.set('redirect', url.pathname + url.search);
    }
    return Response.redirect(loginUrl.toString(), 302);
  }

  return next();
}
