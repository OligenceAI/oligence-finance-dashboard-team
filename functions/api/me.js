import { getSession } from '../_auth.js';
import { getUser } from '../_users.js';

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not signed in' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await getUser(env, session.email);
  return new Response(JSON.stringify({ email: session.email, role: user?.role || 'member' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
