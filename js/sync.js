// Recipe sync with the account (Version 2, task 12). See worker/sync.js for the server side.
//
// While signed in: edits made here are marked `dirty` by storage.js; a sync sends them and takes back
// everything that changed on the server since the last cursor. The server decides conflicts (newest
// edit wins), and this device adopts its answer unless the recipe was edited again here while the
// request was out; that edit is sent on the next round.
//
// Syncs run when the app starts signed in, about two seconds after an edit, when the app comes back to
// the front, and when the device comes back online.

import * as storage from './storage.js';
import { normalizeRecipe } from './storage.js';
import { CONFIG } from './config.js';

const BATCH = 200;

// Bump when a newer app version understands recipe fields an older one threw away (2: stars). A device
// that last synced with an older format downloads the whole library again once and takes the server's
// copy of every recipe it has not changed, so those fields come back.
export const SYNC_FORMAT = 2;
const DEBOUNCE_MS = 2000;
const MAX_ROUNDS = 25;

// ---------- Pure helpers (unit-tested) ----------

/** The form a record is sent in: sync fields outside, the recipe itself in `body`. */
export function toWire(rec) {
  if (rec.deleted) return { id: rec.id, updated: rec.updated, deleted: true };
  const { dirty, deleted, updated, ...body } = rec;
  return { id: rec.id, updated, deleted: false, body };
}

/**
 * What to do with one row from the server.
 * @param {object|undefined} local  this device's record (tombstones included)
 * @param {{id, updated, deleted, body}} remote
 * @param {number|undefined} sentUpdated  the `updated` this device sent for it in this request, if any
 * @param {{full?: boolean}} [opts]  full: a full re-download; replace unchanged copies even when the edit
 *                                   times match (an older app version may have dropped fields)
 * @returns {{type: 'keep'} | {type: 'remove'} | {type: 'put', record: object}}
 */
export function planApply(local, remote, sentUpdated, { full = false } = {}) {
  // Edited again here while the request was out (or never sent): keep it; it goes up next round.
  if (local && local.dirty && local.updated !== sentUpdated) return { type: 'keep' };
  if (remote.deleted) return local ? { type: 'remove' } : { type: 'keep' };
  const rec = normalizeRecipe(remote.body);
  if (!rec || rec.id !== remote.id) return { type: 'keep' };
  if (!full && local && !local.dirty && !local.deleted && local.updated === remote.updated) return { type: 'keep' };
  return { type: 'put', record: { ...rec, updated: remote.updated } };
}

// ---------- State ----------

let enabled = false;
let running = null;
let again = false;
let timer = null;
let lastSynced = 0;
let lastError = '';
const listeners = new Set();

/** `cb({changed, ids})` after each sync: `ids` are the recipes this sync changed on this device. */
export function onSynced(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function status() {
  return { enabled, lastSynced, error: lastError };
}

function emit(ids) {
  for (const cb of listeners) {
    try { cb({ changed: ids.size > 0, ids }); } catch { /* ignore */ }
  }
}

// ---------- Syncing ----------

async function syncOnce(changedIds) {
  const full = storage.getSetting('syncFormat', 1) < SYNC_FORMAT;
  if (full && storage.getSetting('syncCursor', 0) !== 0 && !storage.getSetting('syncFullStarted', false)) {
    storage.setSetting('syncCursor', 0);
    storage.setSetting('syncFullStarted', true);
  }
  for (let round = 0; round < MAX_ROUNDS && enabled; round++) {
    const dirty = (await storage.allRecords()).filter((r) => r.dirty).slice(0, BATCH);
    const sent = new Map(dirty.map((r) => [r.id, r.updated]));
    const body = JSON.stringify({ since: storage.getSetting('syncCursor', 0), changes: dirty.map(toWire) });
    const res = await fetch(CONFIG.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // keepalive lets a small sync finish after the app goes to the background (iPhone).
      keepalive: body.length < 60000,
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 401) {
      enabled = false;
      throw new Error('signed-out');
    }
    if (res.status === 413) throw new Error('Your library is full.');
    if (!res.ok) throw new Error(`Sync failed (${res.status}).`);
    const data = await res.json();

    for (const remote of data.changes || []) {
      const local = await storage.getRecord(remote.id);
      const act = planApply(local, remote, sent.get(remote.id), { full });
      if (act.type === 'put') {
        await storage.putRecord(act.record);
        changedIds.add(remote.id);
      } else if (act.type === 'remove') {
        await storage.removeRecord(remote.id);
        changedIds.add(remote.id);
      }
    }
    storage.setSetting('syncCursor', data.cursor || 0);
    if (!data.more && dirty.length < BATCH) {
      if (full) {
        storage.setSetting('syncFormat', SYNC_FORMAT);
        storage.setSetting('syncFullStarted', false);
      }
      break;
    }
  }
}

/** Sync now (or, if a sync is running, once more right after it). Resolves when done. */
export function syncNow() {
  if (!enabled) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const ids = new Set();
    try {
      do {
        again = false;
        await syncOnce(ids);
      } while (again && enabled);
      lastSynced = Date.now();
      lastError = '';
    } catch (err) {
      lastError = err && err.message === 'signed-out' ? '' : String((err && err.message) || 'Sync failed.');
    } finally {
      running = null;
    }
    emit(ids);
  })();
  return running;
}

function schedule() {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, DEBOUNCE_MS);
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  storage.onLocalChange(schedule);
  // Back in front: fetch what changed elsewhere. Leaving: send edits now rather than after the delay.
  document.addEventListener('visibilitychange', () => { flush(); });
  window.addEventListener('online', () => syncNow());
}

/**
 * Start syncing for this signed-in user. The first time this device syncs with an account, every
 * recipe already here is sent up so it joins the account's library.
 */
export async function start(user) {
  const key = user.email;
  if (storage.getSetting('syncUser', null) !== key) {
    const now = Date.now();
    const recs = await storage.allRecords();
    if (recs.length) await storage.saveMany(recs.map((r) => ({ ...r, updated: r.updated || r.created || now, dirty: true })));
    storage.setSetting('syncCursor', 0);
    storage.setSetting('syncUser', key);
    storage.setSetting('syncFormat', SYNC_FORMAT);
  }
  enabled = true;
  wire();
  return syncNow();
}

/** Sync right away instead of waiting for the delay after an edit. */
export function flush() {
  clearTimeout(timer);
  return syncNow();
}

/** True when this device has edits the server has not taken yet. */
export async function hasUnsynced() {
  return (await storage.allRecords()).some((r) => r.dirty);
}

/** Stop syncing and forget this device's link to the account (signing out). */
export function stop() {
  enabled = false;
  clearTimeout(timer);
  storage.setSetting('syncCursor', 0);
  storage.setSetting('syncUser', null);
  storage.setSetting('syncFullStarted', false);
}
