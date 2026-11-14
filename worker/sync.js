/**
 * Recipe sync for the site Worker (Version 2, task 11).
 *
 * POST /api/sync  { since, changes: [{ id, updated, deleted, body }] }
 *   1. Each change is kept if the server has no row for it or the change's `updated` is newer
 *      (last write wins, per recipe). A kept change gets the user's next sequence number.
 *   2. The reply lists every row whose sequence number is after `since`, plus the server's row for
 *      each change it did not keep, and a new cursor. The server is the source of truth: a device
 *      adopts these rows unless it has edited the recipe again since it sent the request.
 *
 * Sequence numbers come from a per-user counter, never a device clock, so a phone with the wrong time
 * cannot make another device miss changes. An `updated` far in the future is clamped to now so one bad
 * clock cannot win every conflict forever.
 */

import { currentUser, sameOrigin } from './auth.js';

export const LIMITS = {
  changesPerCall: 200,
  pullPerCall: 500,
  bodyBytes: 1024 * 1024,
  requestBytes: 8 * 1024 * 1024,
  recipesPerUser: 2000,
  futureSkewMs: 24 * 3600 * 1000,
};

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** Validate and clean the incoming changes. Bad items are dropped. */
export function cleanChanges(raw, now) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const c of raw.slice(0, LIMITS.changesPerCall)) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !ID_RE.test(c.id) || seen.has(c.id)) continue;
    if (!Number.isFinite(c.updated) || c.updated <= 0) continue;
    const deleted = c.deleted === true;
    let body = null;
    if (!deleted) {
      if (!c.body || typeof c.body !== 'object' || Array.isArray(c.body) || c.body.id !== c.id) continue;
      body = JSON.stringify(c.body);
      if (body.length > LIMITS.bodyBytes) continue;
    }
    seen.add(c.id);
    out.push({ id: c.id, updated: Math.min(Math.floor(c.updated), now + LIMITS.futureSkewMs), deleted, body });
  }
  return out;
}

/**
 * The sync rules, over a small store interface (D1 in production, memory in tests).
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runSync(store, userId, input, now = Date.now()) {
  const since = Number.isInteger(input && input.since) && input.since >= 0 ? input.since : 0;
  const changes = cleanChanges(input && input.changes, now);

  const existing = await store.getMeta(userId, changes.map((c) => c.id)); // Map id -> updated
  const accepted = changes.filter((c) => !existing.has(c.id) || c.updated > existing.get(c.id));
  const rejected = changes.filter((c) => !accepted.includes(c));

  const newLive = accepted.filter((c) => !existing.has(c.id) && !c.deleted).length;
  if (newLive && (await store.liveCount(userId)) + newLive > LIMITS.recipesPerUser) {
    return { status: 413, body: { error: 'library-full', limit: LIMITS.recipesPerUser } };
  }

  if (accepted.length) {
    const end = await store.bumpSeq(userId, accepted.length);
    await store.upsert(userId, accepted.map((c, i) => ({ ...c, seq: end - accepted.length + 1 + i })));
  }

  const { rows, more } = await store.pull(userId, since, LIMITS.pullPerCall);
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (rejected.length) {
    for (const r of await store.getRows(userId, rejected.map((c) => c.id))) if (!byId.has(r.id)) byId.set(r.id, r);
  }
  const cursor = more ? rows[rows.length - 1].seq : await store.currentSeq(userId);

  return {
    status: 200,
    body: {
      cursor,
      more,
      changes: [...byId.values()].map((r) => ({
        id: r.id,
        updated: r.updated,
        deleted: !!r.deleted,
        body: r.body ? JSON.parse(r.body) : null,
      })),
    },
  };
}

// ---------- D1 store ----------

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function d1Store(db) {
  const inList = (n) => Array(n).fill('?').join(',');
  return {
    async getMeta(userId, ids) {
      const map = new Map();
      for (const part of chunks(ids, 50)) {
        const { results } = await db.prepare(`SELECT id, updated FROM recipes WHERE user_id = ? AND id IN (${inList(part.length)})`)
          .bind(userId, ...part).all();
        for (const r of results) map.set(r.id, r.updated);
      }
      return map;
    },
    async getRows(userId, ids) {
      const out = [];
      for (const part of chunks(ids, 50)) {
        const { results } = await db.prepare(`SELECT id, body, updated, deleted, seq FROM recipes WHERE user_id = ? AND id IN (${inList(part.length)})`)
          .bind(userId, ...part).all();
        out.push(...results);
      }
      return out;
    },
    async liveCount(userId) {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id = ? AND deleted = 0').bind(userId).first();
      return r ? r.n : 0;
    },
    async bumpSeq(userId, n) {
      const r = await db.prepare('UPDATE users SET seq = seq + ? WHERE id = ? RETURNING seq').bind(n, userId).first();
      return r.seq;
    },
    async upsert(userId, rows) {
      const stmt = db.prepare(
        `INSERT INTO recipes (user_id, id, body, updated, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, id) DO UPDATE SET body = excluded.body, updated = excluded.updated,
           deleted = excluded.deleted, seq = excluded.seq
         WHERE excluded.updated > recipes.updated`,
      );
      await db.batch(rows.map((r) => stmt.bind(userId, r.id, r.body, r.updated, r.deleted ? 1 : 0, r.seq)));
    },
    async pull(userId, since, limit) {
      const { results } = await db.prepare('SELECT id, body, updated, deleted, seq FROM recipes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
        .bind(userId, since, limit + 1).all();
      return { rows: results.slice(0, limit), more: results.length > limit };
    },
    async currentSeq(userId) {
      const r = await db.prepare('SELECT seq FROM users WHERE id = ?').bind(userId).first();
      return r ? r.seq : 0;
    },
  };
}

// ---------- Handler ----------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function handleSync(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!sameOrigin(request)) return json({ error: 'origin-not-allowed' }, 403);
  if (Number(request.headers.get('content-length')) > LIMITS.requestBytes) return json({ error: 'too-large' }, 413);
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'signed-out' }, 401);
  let input;
  try { input = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
  const { status, body } = await runSync(d1Store(env.DB), user.id, input);
  return json(body, status);
}
