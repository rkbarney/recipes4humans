/**
 * recipes4humans page fetcher.
 *
 * A small Cloudflare Worker. The browser cannot read other sites' pages (CORS), so the app asks this
 * Worker to fetch a recipe page and hand back the text; the app then reads the schema.org Recipe data
 * itself. No logging, no storage. It says plainly who it is in the User-Agent and does not pretend to
 * be a browser.
 *
 * Protections: GET only, Referer must be an allowed origin, http/https only, private and loopback
 * addresses blocked (also after each redirect), per-IP rate limit, 2 MB response cap, 10 s timeout.
 */

// Only pages loaded from these origins may use the proxy.
const ALLOWED_ORIGINS = [
  'http://localhost:8080',
  // TODO: add the production origin once it is decided, for example 'https://recipes.example'.
  // 'https://PRODUCTION-ORIGIN-NOT-DECIDED-YET',
];

const USER_AGENT = 'recipes4humans/1.0 (+https://github.com/rkbarney/recipes4humans)';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function reply(body, status, type = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { 'Content-Type': type, ...CORS_HEADERS } });
}

function jsonError(message, status) {
  return reply(JSON.stringify({ error: message }), status, 'application/json');
}

function isAllowedReferer(referer) {
  let origin;
  try { origin = new URL(referer).origin; } catch { return false; }
  return ALLOWED_ORIGINS.includes(origin);
}

const BLOCKED_HOSTS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^0\./,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^(22[4-9]|2[3-5]\d)\./,                      // multicast and reserved
  /^::$/,
  /^::1$/,
  /^::ffff:/i,                                  // IPv4-mapped IPv6
  /^fe[89ab][0-9a-f]:/i,
  /^f[cd][0-9a-f]{2}:/i,
];

function isBlockedHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return !h || BLOCKED_HOSTS.some((p) => p.test(h));
}

/** Read at most MAX_BYTES of a response body. Returns null if it is larger. */
async function readCapped(res) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_BYTES) return null;
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

/** Fetch with manual redirects so every hop is checked against the blocked list. */
async function fetchChecked(start, signal) {
  let target = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!['http:', 'https:'].includes(target.protocol) || isBlockedHost(target.hostname)) return null;
    const res = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      try { target = new URL(res.headers.get('location'), target); } catch { return null; }
      continue;
    }
    return res;
  }
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return jsonError('Method not allowed', 405);

    // Per-IP rate limit: a backstop in case the Referer is faked.
    if (env && env.PROXY_RATE_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const { success } = await env.PROXY_RATE_LIMITER.limit({ key: ip });
      if (!success) return reply('Too Many Requests', 429);
    }

    if (!isAllowedReferer(request.headers.get('Referer') || '')) return reply('Forbidden', 403);

    const param = new URL(request.url).searchParams.get('url');
    if (!param) return jsonError('Missing url parameter', 400);
    let target;
    try { target = new URL(param); } catch { return jsonError('Invalid URL', 400); }
    if (!['http:', 'https:'].includes(target.protocol)) return jsonError('Only http and https URLs are allowed', 400);
    if (isBlockedHost(target.hostname)) return reply('Forbidden', 403);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchChecked(target, controller.signal);
      if (!res) return reply('Forbidden', 403);
      const text = await readCapped(res);
      if (text === null) return jsonError('Page too large', 413);
      return reply(text, res.status);
    } catch (err) {
      return jsonError(err && err.name === 'AbortError' ? 'Timed out' : 'Fetch failed', err && err.name === 'AbortError' ? 504 : 502);
    } finally {
      clearTimeout(timer);
    }
  },
};
