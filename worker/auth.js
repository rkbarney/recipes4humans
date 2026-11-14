/**
 * Google sign-in for the site Worker (Version 2, task 10).
 *
 * Flow (OpenID Connect, implicit ID token with form_post; no client secret needed):
 *   1. GET  /api/auth/login   sets a short-lived cookie holding a random state and nonce, then redirects
 *                             to Google's account chooser.
 *   2. POST /api/auth/google  Google posts back { id_token, state }. The Worker checks the state against
 *                             the cookie, checks the token's signature against Google's published keys and
 *                             its issuer, audience, expiry and nonce, finds or creates the user, and sets a
 *                             session cookie. Then it sends the browser back to the app.
 *   3. GET  /api/auth/me      the signed-in user, or 401.
 *   4. POST /api/auth/logout  ends the session.
 *
 * The session cookie holds a random token; D1 stores only its SHA-256 hash.
 */

export const SESSION_COOKIE = 'r4h_session';
export const OAUTH_COOKIE = 'r4h_oauth';
export const SESSION_DAYS = 90;
const OAUTH_MINUTES = 10;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CLOCK_SKEW_S = 300;

// ---------- Small helpers (pure; unit-tested) ----------

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookie(name, value, { maxAge, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${value}`, `Path=${path}`, 'HttpOnly', 'Secure', `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

/** Constant-time string comparison, so a wrong state cannot be guessed byte by byte. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Google's signing keys ----------

let keyCache = { keys: null, expires: 0 };

/** Google's current public keys (JWKS), cached for as long as Google's Cache-Control allows. */
export async function googleKeys({ force = false, fetchFn = fetch, now = Date.now() } = {}) {
  if (!force && keyCache.keys && now < keyCache.expires) return keyCache.keys;
  const res = await fetchFn(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`Google keys: HTTP ${res.status}`);
  const { keys } = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1]) || 3600;
  keyCache = { keys, expires: now + maxAge * 1000 };
  return keys;
}

/** For tests. */
export function resetKeyCache() {
  keyCache = { keys: null, expires: 0 };
}

// ---------- ID token check ----------

/**
 * Check a Google ID token. Returns its payload, or throws with a short reason.
 * @param {string} token
 * @param {{clientId: string, nonce: string, getKeys: (force?: boolean) => Promise<object[]>, now?: number}} opts
 */
export async function verifyIdToken(token, { clientId, nonce, getKeys, now = Date.now() }) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new Error('malformed token');
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    throw new Error('malformed token');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected algorithm');

  let jwk = (await getKeys(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(true)).find((k) => k.kid === header.kid); // Google rotated its keys
  if (!jwk) throw new Error('unknown key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('bad signature');

  const nowS = Math.floor(now / 1000);
  if (!GOOGLE_ISSUERS.includes(payload.iss)) throw new Error('wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw new Error('wrong audience');
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) throw new Error('expired');
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_S > nowS) throw new Error('issued in the future');
  if (!safeEqual(payload.nonce, nonce)) throw new Error('wrong nonce');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no subject');
  if (typeof payload.email !== 'string' || payload.email_verified !== true) throw new Error('email not verified');
  return payload;
}

// ---------- Sessions in D1 ----------

async function findOrCreateUser(db, p, now) {
  const existing = await db.prepare('SELECT id FROM users WHERE google_sub = ?').bind(p.sub).first();
  if (existing) {
    await db.prepare('UPDATE users SET email = ?, name = ?, picture = ?, last_login = ? WHERE id = ?')
      .bind(p.email, p.name || null, p.picture || null, now, existing.id).run();
    return existing.id;
  }
  const id = randomToken(12);
  await db.prepare('INSERT INTO users (id, google_sub, email, name, picture, created, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, p.sub, p.email, p.name || null, p.picture || null, now, now).run();
  return id;
}

async function createSession(db, userId, now) {
  const token = randomToken(32);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86400000).run();
  return token;
}

/** The signed-in user for this request, or null. */
export async function currentUser(request, env, now = Date.now()) {
  const token = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  if (!token || !env.DB) return null;
  return env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?',
  ).bind(await sha256Hex(token), now).first();
}

// ---------- Handlers ----------

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function redirect(location, cookies = [], status = 303) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status, headers });
}

function origin(env) {
  return (env.PUBLIC_ORIGIN || 'https://recipes4humans.com').replace(/\/$/, '');
}

/** Same-site check for state-changing calls: the Origin header must be this host. */
export function sameOrigin(request) {
  const o = request.headers.get('Origin');
  if (!o) return false;
  try { return new URL(o).host === new URL(request.url).host; } catch { return false; }
}

export function handleLogin(request, env) {
  const state = randomToken(16);
  const nonce = randomToken(16);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin(env)}/api/auth/google`,
    response_type: 'id_token',
    response_mode: 'form_post',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  // SameSite=None: the cookie must come back on Google's cross-site POST to /api/auth/google.
  const c = cookie(OAUTH_COOKIE, `${state}.${nonce}`, { maxAge: OAUTH_MINUTES * 60, sameSite: 'None', path: '/api/auth' });
  return redirect(`${GOOGLE_AUTH_URL}?${params}`, [c], 302);
}

export async function handleCallback(request, env, { getKeys = (force) => googleKeys({ force }), now = Date.now() } = {}) {
  const back = (result) => `${origin(env)}/?signin=${result}#/library`;
  const clearOauth = cookie(OAUTH_COOKIE, '', { maxAge: 0, sameSite: 'None', path: '/api/auth' });
  if (request.method !== 'POST') return redirect(back('failed'), [clearOauth]);

  let form;
  try { form = await request.formData(); } catch { return redirect(back('failed'), [clearOauth]); }
  if (form.get('error')) return redirect(back('cancelled'), [clearOauth]);

  const [state, nonce] = (parseCookies(request.headers.get('Cookie'))[OAUTH_COOKIE] || '').split('.');
  if (!state || !nonce || !safeEqual(form.get('state'), state)) return redirect(back('failed'), [clearOauth]);

  let payload;
  try {
    payload = await verifyIdToken(form.get('id_token'), { clientId: env.GOOGLE_CLIENT_ID, nonce, getKeys, now });
  } catch {
    return redirect(back('failed'), [clearOauth]);
  }

  const userId = await findOrCreateUser(env.DB, payload, now);
  const token = await createSession(env.DB, userId, now);
  return redirect(back('ok'), [clearOauth, cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 })]);
}

export async function handleMe(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ user: null }, 401);
  return json({ user: { email: user.email, name: user.name, picture: user.picture } });
}

export async function handleLogout(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!sameOrigin(request)) return json({ error: 'origin-not-allowed' }, 403);
  const token = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  if (token && env.DB) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0 }) });
}
