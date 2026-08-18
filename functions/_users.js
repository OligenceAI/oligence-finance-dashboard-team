/* ==========================================================================
 * functions/_users.js — User directory stored in Cloudflare KV (env.USERS)
 *
 * All users live under a single KV key ("users") as a JSON array of
 * { email, passwordHash, role, addedAt }. Reads/writes are simple
 * get-modify-put — fine at admin-panel scale (a handful of accounts,
 * changed rarely), not built for high-concurrency writes.
 *
 * The "owner" role is seeded once from env.OWNER_EMAIL / env.OWNER_PASSWORD
 * if the directory is empty, so there's always a way to sign in and manage
 * members even right after the KV namespace is created.
 * ========================================================================== */

import { hashPassword } from './_auth.js';

const MIN_PASSWORD_LENGTH = 8;

const KV_KEY = 'users';

async function readUsers(env) {
  const raw = await env.USERS.get(KV_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeUsers(env, users) {
  await env.USERS.put(KV_KEY, JSON.stringify(users));
}

export async function getAllUsers(env) {
  let users = await readUsers(env);

  if (users.length === 0 && env.OWNER_EMAIL && env.OWNER_PASSWORD) {
    const passwordHash = await hashPassword(env.OWNER_PASSWORD);
    users = [
      {
        email: env.OWNER_EMAIL.trim().toLowerCase(),
        passwordHash,
        role: 'owner',
        addedAt: new Date().toISOString(),
      },
    ];
    await writeUsers(env, users);
  }

  return users;
}

export async function getUser(env, email) {
  const users = await getAllUsers(env);
  return users.find((u) => u.email === email.trim().toLowerCase()) || null;
}

export async function addUser(env, email, password, role = 'member') {
  const normalizedEmail = email.trim().toLowerCase();
  const users = await getAllUsers(env);

  if (users.some((u) => u.email === normalizedEmail)) {
    throw new Error('A user with this email already exists.');
  }

  const passwordHash = await hashPassword(password);
  users.push({ email: normalizedEmail, passwordHash, role, addedAt: new Date().toISOString() });
  await writeUsers(env, users);
}

export async function removeUser(env, email) {
  const normalizedEmail = email.trim().toLowerCase();
  const users = await getAllUsers(env);
  const target = users.find((u) => u.email === normalizedEmail);

  if (!target) {
    throw new Error('User not found.');
  }
  if (target.role === 'owner') {
    throw new Error('The owner account cannot be removed.');
  }

  await writeUsers(env, users.filter((u) => u.email !== normalizedEmail));
}

export async function resetPassword(env, email, newPassword) {
  const normalizedEmail = email.trim().toLowerCase();
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const users = await getAllUsers(env);
  const target = users.find((u) => u.email === normalizedEmail);
  if (!target) {
    throw new Error('User not found.');
  }

  target.passwordHash = await hashPassword(newPassword);
  await writeUsers(env, users);
}
