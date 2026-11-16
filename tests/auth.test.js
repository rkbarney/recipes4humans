// Google sign-in in the site Worker: ID token checks and the sign-in callback.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  b64urlEncode, b64urlDecode, parseCookies, safeEqual, sha256Hex, verifyIdToken,
  handleLogin, handleCallback, handleMe, handleLogout, handleDeleteAccount, SESSION_COOKIE, OAUTH_COOKIE,
} from '../worker/auth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const enc = (obj) => b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const JWK = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const getKeys = async () => [JWK];

async function makeToken(overrides = {}, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'cook@example.com',
    email_verified: true,
    name: 'Test Cook',
    nonce: 'n0nce',
    iat: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 3600,
    ...overrides,
  };
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

const opts = { clientId: CLIENT_ID, nonce: 'n0nce', getKeys, now: NOW };

describe('helpers', () => {
  test('base64url round trip', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
    assert.deepEqual([...b64urlDecode(b64urlEncode(bytes))], [...bytes]);
    assert.doesNotMatch(b64urlEncode(bytes), /[+/=]/);
  });
  test('parseCookies keeps the first of repeated names', () => {
    assert.deepEqual(parseCookies('a=1; b=two; a=3'), { a: '1', b: 'two' });
    assert.deepEqual(parseCookies(''), {});
  });
  test('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', null), false);
  });
});

describe('verifyIdToken', () => {
  test('accepts a good token', async () => {
    const p = await verifyIdToken(await makeToken(), opts);
    assert.equal(p.sub, '1234567890');
  });
  test('accepts the issuer without https://', async () => {
    await verifyIdToken(await makeToken({ iss: 'accounts.google.com' }), opts);
  });
  const rejects = [
    ['wrong audience', { aud: 'someone-else' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['expired', { exp: Math.floor(NOW / 1000) - 600 }],
    ['wrong nonce', { nonce: 'other' }],
    ['email not verified', { email_verified: false }],
  ];
  for (const [reason, overrides] of rejects) {
    test(`rejects: ${reason}`, async () => {
      await assert.rejects(verifyIdToken(await makeToken(overrides), opts), new RegExp(reason));
    });
  }
  test('rejects a tampered payload', async () => {
    const [h, , s] = (await makeToken()).split('.');
    await assert.rejects(verifyIdToken(`${h}.${enc({ sub: 'attacker' })}.${s}`, opts), /bad signature/);
  });
  test('rejects an unknown key id, after refetching keys once', async () => {
    let calls = 0;
    const counting = async () => { calls++; return [JWK]; };
    const t = await makeToken({}, { alg: 'RS256', kid: 'nope' });
    await assert.rejects(verifyIdToken(t, { ...opts, getKeys: counting }), /unknown key/);
    assert.equal(calls, 2);
  });
  test('rejects alg none', async () => {
    const t = `${enc({ alg: 'none', kid: 'k1' })}.${enc({ sub: 'x' })}.`;
    await assert.rejects(verifyIdToken(t, opts), /unexpected algorithm/);
  });
  test('rejects garbage', async () => {
    await assert.rejects(verifyIdToken('not-a-token', opts), /malformed/);
    await assert.rejects(verifyIdToken(null, opts), /malformed/);
  });
});

// A tiny stand-in for D1 that understands the handful of statements auth.js runs.
function fakeDB() {
  const users = new Map(); // id -> row
  const sessions = new Map(); // token_hash -> row
  const db = {
    users, sessions,
    async batch(stmts) { for (const st of stmts) await st.run(); },
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (sql.startsWith('SELECT id FROM users WHERE google_sub')) {
            return [...users.values()].find((u) => u.google_sub === args[0]) || null;
          }
          if (sql.startsWith('SELECT u.id')) {
            const s = sessions.get(args[0]);
            if (!s || s.expires <= args[1]) return null;
            const u = users.get(s.user_id);
            return { id: u.id, email: u.email, name: u.name, picture: u.picture };
          }
          throw new Error(`fakeDB: unexpected ${sql}`);
        },
        async run() {
          if (sql.startsWith('INSERT INTO users')) {
            const [id, google_sub, email, name, picture, created, last_login] = args;
            users.set(id, { id, google_sub, email, name, picture, created, last_login });
          } else if (sql.startsWith('UPDATE users')) {
            const [email, name, picture, last_login, id] = args;
            Object.assign(users.get(id), { email, name, picture, last_login });
          } else if (sql.startsWith('INSERT INTO sessions')) {
            const [token_hash, user_id, created, expires] = args;
            sessions.set(token_hash, { token_hash, user_id, created, expires });
          } else if (sql.startsWith('DELETE FROM sessions WHERE token_hash')) {
            sessions.delete(args[0]);
          } else if (sql.startsWith('DELETE FROM sessions WHERE user_id')) {
            for (const [k, v] of sessions) if (v.user_id === args[0]) sessions.delete(k);
          } else if (sql.startsWith('DELETE FROM users')) {
            users.delete(args[0]);
          } else if (sql.startsWith('DELETE FROM recipes')) {
            db.deletedRecipesFor = args[0];
          } else {
            throw new Error(`fakeDB: unexpected ${sql}`);
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return db;
}

function setCookies(res) {
  return res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie')];
}

function callbackRequest({ state = 'st4te', cookieState = 'st4te', nonce = 'n0nce', token, error } = {}) {
  const body = new URLSearchParams();
  if (token) body.set('id_token', token);
  if (state) body.set('state', state);
  if (error) body.set('error', error);
  return new Request('https://recipes4humans.com/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `${OAUTH_COOKIE}=${cookieState}.${nonce}` },
    body,
  });
}

describe('sign-in flow', () => {
  let env;
  beforeEach(() => {
    env = { GOOGLE_CLIENT_ID: CLIENT_ID, PUBLIC_ORIGIN: 'https://recipes4humans.com', DB: fakeDB() };
  });

  test('login redirects to Google with state and nonce, and sets the matching cookie', () => {
    const res = handleLogin(new Request('https://recipes4humans.com/api/auth/login'), env);
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('Location'));
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(loc.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(loc.searchParams.get('redirect_uri'), 'https://recipes4humans.com/api/auth/google');
    assert.equal(loc.searchParams.get('response_type'), 'id_token');
    assert.equal(loc.searchParams.get('response_mode'), 'form_post');
    const c = setCookies(res)[0];
    assert.match(c, new RegExp(`^${OAUTH_COOKIE}=${loc.searchParams.get('state')}\\.${loc.searchParams.get('nonce')};`));
    assert.match(c, /HttpOnly/);
    assert.match(c, /Secure/);
    assert.match(c, /SameSite=None/);
  });

  test('a good callback creates the user and a session, and /me returns the user', async () => {
    const res = await handleCallback(callbackRequest({ token: await makeToken() }), env, { getKeys, now: NOW });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), 'https://recipes4humans.com/?signin=ok');
    const session = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(session, 'session cookie set');
    assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
    const token = session.split(';')[0].split('=')[1];

    assert.equal(env.DB.users.size, 1);
    assert.ok(env.DB.sessions.has(await sha256Hex(token)), 'only the hash is stored');
    assert.ok(!env.DB.sessions.has(token));

    const me = await handleMe(new Request('https://recipes4humans.com/api/auth/me', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }), env);
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).user, { email: 'cook@example.com', name: 'Test Cook', picture: null });
  });

  test('signing in again reuses the same user', async () => {
    await handleCallback(callbackRequest({ token: await makeToken() }), env, { getKeys, now: NOW });
    await handleCallback(callbackRequest({ token: await makeToken({ name: 'Renamed' }) }), env, { getKeys, now: NOW });
    assert.equal(env.DB.users.size, 1);
    assert.equal([...env.DB.users.values()][0].name, 'Renamed');
    assert.equal(env.DB.sessions.size, 2);
  });

  test('a state that does not match the cookie is refused', async () => {
    const res = await handleCallback(callbackRequest({ token: await makeToken(), cookieState: 'other' }), env, { getKeys, now: NOW });
    assert.equal(res.headers.get('Location'), 'https://recipes4humans.com/?signin=failed');
    assert.equal(env.DB.users.size, 0);
  });

  test('a token minted for another nonce is refused', async () => {
    const res = await handleCallback(callbackRequest({ token: await makeToken({ nonce: 'replayed' }) }), env, { getKeys, now: NOW });
    assert.match(res.headers.get('Location'), /signin=failed/);
    assert.equal(env.DB.sessions.size, 0);
  });

  test('cancelling at Google comes back as cancelled', async () => {
    const res = await handleCallback(callbackRequest({ error: 'access_denied' }), env, { getKeys, now: NOW });
    assert.match(res.headers.get('Location'), /signin=cancelled/);
  });

  test('/me without a session is 401', async () => {
    const res = await handleMe(new Request('https://recipes4humans.com/api/auth/me'), env);
    assert.equal(res.status, 401);
  });

  test('logout needs a same-origin POST, then ends the session', async () => {
    const res = await handleCallback(callbackRequest({ token: await makeToken() }), env, { getKeys, now: NOW });
    const token = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0].split('=')[1];
    const headers = { Cookie: `${SESSION_COOKIE}=${token}` };

    const foreign = await handleLogout(new Request('https://recipes4humans.com/api/auth/logout', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } }), env);
    assert.equal(foreign.status, 403);
    assert.equal(env.DB.sessions.size, 1);

    const ok = await handleLogout(new Request('https://recipes4humans.com/api/auth/logout', { method: 'POST', headers: { ...headers, Origin: 'https://recipes4humans.com' } }), env);
    assert.equal(ok.status, 200);
    assert.equal(env.DB.sessions.size, 0);
    assert.match(setCookies(ok)[0], new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`));
  });

  test('delete account removes the user, sessions and recipes, and needs a same-origin POST', async () => {
    const res = await handleCallback(callbackRequest({ token: await makeToken() }), env, { getKeys, now: NOW });
    const token = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0].split('=')[1];
    const headers = { Cookie: `${SESSION_COOKIE}=${token}` };
    const url = 'https://recipes4humans.com/api/account/delete';

    const foreign = await handleDeleteAccount(new Request(url, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } }), env);
    assert.equal(foreign.status, 403);
    assert.equal(env.DB.users.size, 1);

    const userId = [...env.DB.users.keys()][0];
    const ok = await handleDeleteAccount(new Request(url, { method: 'POST', headers: { ...headers, Origin: 'https://recipes4humans.com' } }), env);
    assert.equal(ok.status, 200);
    assert.equal(env.DB.users.size, 0);
    assert.equal(env.DB.sessions.size, 0);
    assert.equal(env.DB.deletedRecipesFor, userId);

    const again = await handleDeleteAccount(new Request(url, { method: 'POST', headers: { ...headers, Origin: 'https://recipes4humans.com' } }), env);
    assert.equal(again.status, 401);
  });
});
