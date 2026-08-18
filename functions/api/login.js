/* ==========================================================================
 * functions/api/login.js — POST { email, password } → sets session cookie
 *
 * Credentials are checked against the user directory in KV (env.USERS),
 * managed via the "Add User" tab / functions/api/users.js. The very first
 * account (the owner) is seeded on demand from env.OWNER_EMAIL /
 * env.OWNER_PASSWORD — see functions/_users.js.
 * ========================================================================== */

import { createSessionCookie, verifyPassword } from '../_auth.js';
import { getUser } from '../_users.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.AUTH_SECRET || !env.USERS) {
    return new Response(
      JSON.stringify({ error: 'Login is not configured. Set AUTH_SECRET and bind the USERS KV namespace.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await getUser(env, email);
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!ok) {
    return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cookie = await createSessionCookie(env, user.email);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}
