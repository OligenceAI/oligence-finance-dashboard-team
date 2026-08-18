/* ==========================================================================
 * functions/api/users.js — Owner-only user management (list / add / remove / reset password)
 *
 * Every handler re-derives the caller's identity from their own session
 * cookie (never trusts a client-supplied email) and rejects anyone whose
 * role isn't "owner" with 403, before touching KV.
 * ========================================================================== */

import { getSession } from '../_auth.js';
import { getAllUsers, getUser, addUser, removeUser, resetPassword } from '../_users.js';

async function requireOwner(request, env) {
  const session = await getSession(request, env);
  if (!session) return { error: new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) };

  const user = await getUser(env, session.email);
  if (!user || user.role !== 'owner') {
    return { error: new Response(JSON.stringify({ error: 'Owner access required' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) };
  }
  return { email: session.email };
}

export async function onRequestGet({ request, env }) {
  const { error } = await requireOwner(request, env);
  if (error) return error;

  const users = await getAllUsers(env);
  const safe = users.map(({ email, role, addedAt }) => ({ email, role, addedAt }));
  return new Response(JSON.stringify({ users: safe }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  const { error } = await requireOwner(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Enter a valid email address.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await addUser(env, email, password);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch({ request, env }) {
  const { error } = await requireOwner(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email) {
    return new Response(JSON.stringify({ error: 'Missing email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await resetPassword(env, email, password);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete({ request, env }) {
  const { error } = await requireOwner(request, env);
  if (error) return error;

  const url = new URL(request.url);
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();

  if (!email) {
    return new Response(JSON.stringify({ error: 'Missing email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await removeUser(env, email);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
