/* ==========================================================================
 * functions/_auth.js — Session cookies + password hashing for Pages Functions
 *
 * Session cookie carries a signed { email, exp } payload (base64url JSON) so
 * later requests know *who* is logged in, not just *that* someone is.
 * Signed with HMAC-SHA256 using env.AUTH_SECRET — no fallback lives in the
 * repo, so auth fails closed without it.
 *
 * Passwords are never stored in plaintext: hashPassword() salts + PBKDF2s
 * them before they reach KV, verifyPassword() checks a candidate the same way.
 * ========================================================================== */

export const SESSION_COOKIE = 'cf_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const PBKDF2_ITERATIONS = 100000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return decodeURIComponent(escape(atob(padded)));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

// ---------------------------------------------------------------- passwords

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `${toHex(salt)}:${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return timingSafeEqual(toHex(bits), hashHex);
}

// ------------------------------------------------------------------ session

export async function createSessionCookie(env, email) {
  if (!env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET is not configured in Cloudflare Pages environment variables.');
  }
  const payload = base64UrlEncode(JSON.stringify({ email, exp: Date.now() + SESSION_TTL_MS }));
  const signature = await hmac(env.AUTH_SECRET, payload);
  const token = `${payload}.${signature}`;
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function getSession(request, env) {
  if (!env.AUTH_SECRET) return null;

  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;

  const [payload, signature] = match[1].split('.');
  if (!payload || !signature) return null;

  const expected = await hmac(env.AUTH_SECRET, payload);
  if (expected !== signature) return null;

  let parsed;
  try {
    parsed = JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }

  if (!parsed.email || !parsed.exp || Date.now() > parsed.exp) return null;
  return { email: parsed.email, exp: parsed.exp };
}

export async function isSessionValid(request, env) {
  return (await getSession(request, env)) !== null;
}
