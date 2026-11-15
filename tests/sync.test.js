// Recipe sync: the server rules (worker/sync.js) and the device's merge decisions (js/sync.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runSync, cleanChanges, LIMITS } from '../worker/sync.js';
import { toWire, planApply } from '../js/sync.js';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

/** In-memory version of the store interface d1Store implements. */
function memoryStore() {
  const seq = new Map(); // userId -> n
  const rows = new Map(); // `${userId}/${id}` -> row
  const mine = (userId) => [...rows.values()].filter((r) => r.user_id === userId);
  return {
    rows,
    async getMeta(userId, ids) {
      const m = new Map();
      for (const id of ids) { const r = rows.get(`${userId}/${id}`); if (r) m.set(id, r.updated); }
      return m;
    },
    async getRows(userId, ids) {
      return ids.map((id) => rows.get(`${userId}/${id}`)).filter(Boolean);
    },
    async liveCount(userId) { return mine(userId).filter((r) => !r.deleted).length; },
    async bumpSeq(userId, n) { const v = (seq.get(userId) || 0) + n; seq.set(userId, v); return v; },
    async upsert(userId, list) {
      for (const r of list) {
        const key = `${userId}/${r.id}`;
        const old = rows.get(key);
        if (old && !(r.updated > old.updated)) continue;
        rows.set(key, { user_id: userId, id: r.id, body: r.body, updated: r.updated, deleted: r.deleted ? 1 : 0, seq: r.seq });
      }
    },
    async pull(userId, since, limit) {
      const list = mine(userId).filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows: list.slice(0, limit), more: list.length > limit };
    },
    async currentSeq(userId) { return seq.get(userId) || 0; },
  };
}

const recipe = (id, extra = {}) => ({ id, title: `Recipe ${id}`, text: 'Ingredients\n1 egg\n\nSteps\nBoil the egg.', created: NOW - 1000, checked: {}, ...extra });
const change = (id, updated, extra = {}) => ({ id, updated, deleted: false, body: recipe(id, extra) });

describe('server: runSync', () => {
  test('a new recipe is kept and comes back to another device', async () => {
    const store = memoryStore();
    const a = await runSync(store, 'u1', { since: 0, changes: [change('r1', NOW)] }, NOW);
    assert.equal(a.status, 200);
    assert.equal(a.body.cursor, 1);

    const b = await runSync(store, 'u1', { since: 0, changes: [] }, NOW);
    assert.equal(b.body.changes.length, 1);
    assert.equal(b.body.changes[0].body.title, 'Recipe r1');
    assert.equal(b.body.cursor, 1);

    const again = await runSync(store, 'u1', { since: 1, changes: [] }, NOW);
    assert.deepEqual(again.body.changes, []);
  });

  test("users do not see each other's recipes", async () => {
    const store = memoryStore();
    await runSync(store, 'u1', { since: 0, changes: [change('r1', NOW)] }, NOW);
    const other = await runSync(store, 'u2', { since: 0, changes: [] }, NOW);
    assert.deepEqual(other.body.changes, []);
  });

  test('newest edit wins; an older edit is refused and the server row is sent back', async () => {
    const store = memoryStore();
    await runSync(store, 'u1', { since: 0, changes: [change('r1', NOW, { title: 'Laptop title' })] }, NOW);
    const stale = await runSync(store, 'u1', { since: 1, changes: [change('r1', NOW - 5000, { title: 'Old phone title' })] }, NOW);
    assert.equal(stale.body.cursor, 1, 'nothing new was written');
    assert.equal(stale.body.changes.length, 1);
    assert.equal(stale.body.changes[0].body.title, 'Laptop title');

    const newer = await runSync(store, 'u1', { since: 1, changes: [change('r1', NOW + 5000, { title: 'Newest' })] }, NOW);
    assert.equal(newer.body.cursor, 2);
    assert.equal(newer.body.changes[0].body.title, 'Newest');
  });

  test('ticks travel with the recipe', async () => {
    const store = memoryStore();
    await runSync(store, 'u1', { since: 0, changes: [change('r1', NOW)] }, NOW);
    await runSync(store, 'u1', { since: 1, changes: [change('r1', NOW + 1, { checked: { 'g-1': true } })] }, NOW);
    const other = await runSync(store, 'u1', { since: 1, changes: [] }, NOW);
    assert.deepEqual(other.body.changes[0].body.checked, { 'g-1': true });
  });

  test('a delete is stored as a tombstone and reaches other devices', async () => {
    const store = memoryStore();
    await runSync(store, 'u1', { since: 0, changes: [change('r1', NOW)] }, NOW);
    await runSync(store, 'u1', { since: 1, changes: [{ id: 'r1', updated: NOW + 1, deleted: true }] }, NOW);
    const other = await runSync(store, 'u1', { since: 1, changes: [] }, NOW);
    assert.deepEqual(other.body.changes, [{ id: 'r1', updated: NOW + 1, deleted: true, body: null }]);
  });

  test('an edit time far in the future is clamped so it cannot win forever', async () => {
    const store = memoryStore();
    await runSync(store, 'u1', { since: 0, changes: [change('r1', NOW + 365 * 86400000)] }, NOW);
    assert.equal(store.rows.get('u1/r1').updated, NOW + LIMITS.futureSkewMs);
  });

  test('pulls are paged with a cursor', async () => {
    const store = memoryStore();
    const many = Array.from({ length: LIMITS.pullPerCall + 5 }, (_, i) => change(`r${i}`, NOW));
    for (let i = 0; i < many.length; i += LIMITS.changesPerCall) {
      await runSync(store, 'u1', { since: 0, changes: many.slice(i, i + LIMITS.changesPerCall) }, NOW);
    }
    const first = await runSync(store, 'u1', { since: 0, changes: [] }, NOW);
    assert.equal(first.body.more, true);
    assert.equal(first.body.changes.length, LIMITS.pullPerCall);
    const second = await runSync(store, 'u1', { since: first.body.cursor, changes: [] }, NOW);
    assert.equal(second.body.more, false);
    assert.equal(second.body.changes.length, 5);
  });

  test('a full library refuses new recipes', async () => {
    const store = memoryStore();
    store.liveCount = async () => LIMITS.recipesPerUser;
    const res = await runSync(store, 'u1', { since: 0, changes: [change('r1', NOW)] }, NOW);
    assert.equal(res.status, 413);
  });
});

describe('server: cleanChanges', () => {
  test('drops malformed items and duplicates', () => {
    const out = cleanChanges([
      change('ok', NOW),
      change('ok', NOW + 1), // duplicate id
      { id: 'bad id!', updated: NOW, body: recipe('bad id!') },
      { id: 'noupdated', body: recipe('noupdated') },
      { id: 'mismatch', updated: NOW, body: recipe('other') },
      { id: 'nobody', updated: NOW },
      { id: 'gone', updated: NOW, deleted: true },
      null,
    ], NOW);
    assert.deepEqual(out.map((c) => c.id), ['ok', 'gone']);
    assert.equal(out[1].body, null);
  });
  test('refuses oversized bodies', () => {
    const big = change('big', NOW, { text: 'x'.repeat(LIMITS.bodyBytes + 1) });
    assert.deepEqual(cleanChanges([big], NOW), []);
  });
});

describe('device: toWire and planApply', () => {
  test('toWire keeps sync fields out of the body', () => {
    const w = toWire({ ...recipe('r1'), updated: NOW, dirty: true });
    assert.equal(w.updated, NOW);
    assert.equal(w.deleted, false);
    assert.ok(!('dirty' in w.body) && !('updated' in w.body));
    assert.deepEqual(toWire({ id: 'r2', deleted: true, updated: NOW, dirty: true }), { id: 'r2', updated: NOW, deleted: true });
  });

  const remote = (extra = {}, updated = NOW) => ({ id: 'r1', updated, deleted: false, body: recipe('r1', extra) });

  test('a recipe this device does not have is added', () => {
    const act = planApply(undefined, remote(), undefined);
    assert.equal(act.type, 'put');
    assert.equal(act.record.updated, NOW);
    assert.ok(!act.record.dirty);
  });

  test('the server answer replaces what this device sent', () => {
    const local = { ...recipe('r1', { title: 'Mine' }), updated: NOW - 10, dirty: true };
    const act = planApply(local, remote({ title: 'Theirs' }), NOW - 10);
    assert.equal(act.type, 'put');
    assert.equal(act.record.title, 'Theirs');
  });

  test('an edit made here while the request was out is kept', () => {
    const local = { ...recipe('r1', { title: 'Edited meanwhile' }), updated: NOW + 50, dirty: true };
    assert.deepEqual(planApply(local, remote(), NOW - 10), { type: 'keep' });
    assert.deepEqual(planApply(local, remote(), undefined), { type: 'keep' });
  });

  test('a remote delete removes the recipe here', () => {
    const local = { ...recipe('r1'), updated: NOW - 10 };
    assert.deepEqual(planApply(local, { id: 'r1', updated: NOW, deleted: true, body: null }, undefined), { type: 'remove' });
    assert.deepEqual(planApply(undefined, { id: 'r1', updated: NOW, deleted: true, body: null }, undefined), { type: 'keep' });
  });

  test('an unchanged recipe is left alone', () => {
    const local = { ...recipe('r1'), updated: NOW };
    assert.deepEqual(planApply(local, remote(), undefined), { type: 'keep' });
  });

  test('a garbled server body is ignored', () => {
    assert.deepEqual(planApply(undefined, { id: 'r1', updated: NOW, deleted: false, body: { nope: true } }, undefined), { type: 'keep' });
  });

  test('a full re-download restores fields an older version dropped (stars)', () => {
    const local = { ...recipe('r1'), updated: NOW }; // same edit time, but no star
    const starred = remote({ starred: true });
    assert.deepEqual(planApply(local, starred, undefined), { type: 'keep' });
    const act = planApply(local, starred, undefined, { full: true });
    assert.equal(act.type, 'put');
    assert.equal(act.record.starred, true);
  });

  test('a full re-download still keeps edits made here', () => {
    const local = { ...recipe('r1'), updated: NOW + 50, dirty: true };
    assert.deepEqual(planApply(local, remote({ starred: true }), undefined, { full: true }), { type: 'keep' });
  });
});
