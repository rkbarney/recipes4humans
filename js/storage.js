// Saved recipes in IndexedDB, settings in localStorage, JSON export and import (task 7).
//
// A saved recipe holds the original text (or the two parts), never the engine output, so engine
// improvements apply to old recipes when they are opened. Every storage call is wrapped: when
// IndexedDB or localStorage is unavailable the app falls back to memory for this page load.
//
// Record: { id, title, text?, parts?: {ingredients, steps}, sourceUrl?, created, checked: {lineId: true}, collapsed: {sectionOrStepKey: true},
//          starred?, updated?, dirty?, deleted? }
//
// Sync fields (Version 2): `updated` is the time of the last edit on any device (ms); `dirty` marks an edit
// made here that the server has not taken yet; a delete keeps a tombstone { id, deleted: true, updated, dirty }
// so it reaches other devices. listRecipes and getRecipe hide tombstones.

import { CONFIG } from './config.js';

// ---------- Pure helpers (no browser APIs; unit-tested under node) ----------

/** New recipe id. `now` and `rand` are injectable for tests. */
export function newId(now = Date.now(), rand = Math.random()) {
  return `${now.toString(36)}-${rand.toString(36).slice(2, 8)}`;
}

function isStringOrStrings(v) {
  return typeof v === 'string' || (Array.isArray(v) && v.every((s) => typeof s === 'string'));
}

/**
 * Validate and clean one recipe record (from an import file). Returns null when unusable.
 * Unknown fields are dropped.
 */
export function normalizeRecipe(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const hasText = typeof raw.text === 'string' && raw.text.trim() !== '';
  const p = raw.parts;
  const hasParts = !!p && typeof p === 'object' && isStringOrStrings(p.ingredients) && isStringOrStrings(p.steps);
  if (!hasText && !hasParts) return null;
  const checked = {};
  if (raw.checked && typeof raw.checked === 'object') {
    for (const [k, v] of Object.entries(raw.checked)) if (v === true) checked[k] = true;
  }
  const collapsed = {};
  if (raw.collapsed && typeof raw.collapsed === 'object') {
    for (const [k, v] of Object.entries(raw.collapsed)) if (v === true) collapsed[k] = true;
  }
  const rec = {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled recipe',
    created: Number.isFinite(raw.created) ? raw.created : now,
    checked,
  };
  if (Object.keys(collapsed).length) rec.collapsed = collapsed;
  if (hasText) rec.text = raw.text;
  else rec.parts = { ingredients: p.ingredients, steps: p.steps };
  if (typeof raw.sourceUrl === 'string' && raw.sourceUrl) rec.sourceUrl = raw.sourceUrl;
  if (raw.starred === true) rec.starred = true;
  if (Number.isFinite(raw.updated)) rec.updated = raw.updated;
  return rec;
}

/** Library order: starred recipes first, then newest first. */
export function sortRecipes(list) {
  return [...list].sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (b.created || 0) - (a.created || 0));
}

/** The JSON object written by "Export all". */
export function buildExport(recipes, now = Date.now()) {
  return {
    app: CONFIG.exportApp,
    version: CONFIG.exportVersion,
    exported: new Date(now).toISOString(),
    recipes: recipes.map(({ dirty, deleted, ...r }) => ({ ...r })),
  };
}

/**
 * Read an export file's text. Accepts the export object or a bare array of recipes.
 * @returns {{recipes: object[], invalid: number, error?: string}}
 */
export function parseImport(jsonText, now = Date.now()) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { recipes: [], invalid: 0, error: 'That file is not valid JSON.' };
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.recipes) ? data.recipes : null;
  if (!list) return { recipes: [], invalid: 0, error: 'That file does not look like a recipes4humans export.' };
  const recipes = [];
  let invalid = 0;
  for (const raw of list) {
    const rec = normalizeRecipe(raw, now);
    if (rec) recipes.push(rec);
    else invalid++;
  }
  return { recipes, invalid };
}

/**
 * Merge imported recipes into the existing ones by id. Existing recipes win; duplicates, including
 * repeats inside the incoming list, are skipped.
 * @returns {{toAdd: object[], skipped: number}}
 */
export function mergeRecipes(existing, incoming) {
  const seen = new Set(existing.map((r) => r.id));
  const toAdd = [];
  let skipped = 0;
  for (const rec of incoming) {
    if (seen.has(rec.id)) {
      skipped++;
    } else {
      seen.add(rec.id);
      toAdd.push(rec);
    }
  }
  return { toAdd, skipped };
}

// ---------- Settings (localStorage, memory fallback) ----------

const memorySettings = {};

function readSettings() {
  try {
    const raw = localStorage.getItem(CONFIG.settingsKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...parsed, ...memorySettings };
  } catch {
    return { ...memorySettings };
  }
}

export function getSetting(key, fallback) {
  const v = readSettings()[key];
  return v === undefined ? fallback : v;
}

export function setSetting(key, value) {
  memorySettings[key] = value;
  try {
    const raw = localStorage.getItem(CONFIG.settingsKey);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[key] = value;
    localStorage.setItem(CONFIG.settingsKey, JSON.stringify(parsed));
  } catch {
    // Storage unavailable: the value lives in memory for this page load.
  }
}

/** Small per-viewer flags kept outside the settings object (e.g. a dismissed hint). */
export function getFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return !!memorySettings[key];
  }
}

export function setFlag(key) {
  memorySettings[key] = true;
  try {
    localStorage.setItem(key, '1');
  } catch {
    // ignore
  }
}

// ---------- Recipes (IndexedDB, memory fallback) ----------

const changeListeners = new Set();

/** Call `cb` after any edit made on this device (not after records written by sync). */
export function onLocalChange(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

function localChanged() {
  for (const cb of changeListeners) {
    try { cb(); } catch { /* ignore */ }
  }
}

const memoryRecipes = new Map();
let db = null;
let idbBroken = false;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const timer = setTimeout(() => reject(new Error('IndexedDB timed out')), 4000);
    let req;
    try {
      req = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB blocked')); };
    req.onsuccess = () => { clearTimeout(timer); db = req.result; resolve(db); };
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(CONFIG.storeRecipes)) {
        database.createObjectStore(CONFIG.storeRecipes, { keyPath: 'id' });
      }
    };
  });
}

/** Run an IndexedDB operation; on any failure switch to memory for the rest of this page load. */
async function run(idbOp, memOp) {
  if (!idbBroken) {
    try {
      return await idbOp(await openDB());
    } catch {
      idbBroken = true;
    }
  }
  return memOp();
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** True while recipes are really being kept in IndexedDB (false after a failure). */
export function isPersistent() {
  return !idbBroken;
}

/** Every record, tombstones included (for sync). */
export async function allRecords() {
  const list = await run(
    (d) => request(d.transaction(CONFIG.storeRecipes, 'readonly').objectStore(CONFIG.storeRecipes).getAll()),
    () => [...memoryRecipes.values()]
  );
  return list || [];
}

export async function listRecipes() {
  return sortRecipes((await allRecords()).filter((r) => !r.deleted));
}

/** One record, tombstones included (for sync). */
export async function getRecord(id) {
  return run(
    (d) => request(d.transaction(CONFIG.storeRecipes, 'readonly').objectStore(CONFIG.storeRecipes).get(id)),
    () => memoryRecipes.get(id)
  );
}

export async function getRecipe(id) {
  const rec = await getRecord(id);
  return rec && !rec.deleted ? rec : undefined;
}

/** Save an edit made on this device: stamps the edit time and marks it for sync. */
export async function saveRecipe(rec) {
  rec.updated = Date.now();
  rec.dirty = true;
  const saved = await putRecord(rec);
  localChanged();
  return saved;
}

/** Write a record exactly as given (used by sync; does not mark it for sync). */
export async function putRecord(rec) {
  return run(
    async (d) => {
      const tx = d.transaction(CONFIG.storeRecipes, 'readwrite');
      tx.objectStore(CONFIG.storeRecipes).put(rec);
      await txDone(tx);
      return rec;
    },
    () => { memoryRecipes.set(rec.id, rec); return rec; }
  );
}

export async function saveMany(recs) {
  return run(
    async (d) => {
      const tx = d.transaction(CONFIG.storeRecipes, 'readwrite');
      for (const r of recs) tx.objectStore(CONFIG.storeRecipes).put(r);
      await txDone(tx);
      return recs.length;
    },
    () => { for (const r of recs) memoryRecipes.set(r.id, r); return recs.length; }
  );
}

/** Delete on this device: leaves a tombstone so the delete reaches other devices. */
export async function deleteRecipe(id) {
  await putRecord({ id, deleted: true, updated: Date.now(), dirty: true });
  localChanged();
}

/** Remove a record completely (used by sync once a tombstone is no longer needed). */
export async function removeRecord(id) {
  return run(
    async (d) => {
      const tx = d.transaction(CONFIG.storeRecipes, 'readwrite');
      tx.objectStore(CONFIG.storeRecipes).delete(id);
      await txDone(tx);
    },
    () => { memoryRecipes.delete(id); }
  );
}

/** Remove every recipe from this device (signing out). */
export async function clearRecipes() {
  return run(
    async (d) => {
      const tx = d.transaction(CONFIG.storeRecipes, 'readwrite');
      tx.objectStore(CONFIG.storeRecipes).clear();
      await txDone(tx);
    },
    () => { memoryRecipes.clear(); }
  );
}

// ---------- Export and import ----------

export async function exportAll() {
  return buildExport(await listRecipes());
}

/** Import the text of an export file. @returns {{added: number, skipped: number, invalid: number, error?: string}} */
export async function importFromText(jsonText) {
  const parsed = parseImport(jsonText);
  if (parsed.error) return { added: 0, skipped: 0, invalid: 0, error: parsed.error };
  const existing = await listRecipes();
  const { toAdd, skipped } = mergeRecipes(existing, parsed.recipes);
  if (toAdd.length) {
    const now = Date.now();
    await saveMany(toAdd.map((r) => ({ ...r, updated: now, dirty: true })));
    localChanged();
  }
  return { added: toAdd.length, skipped, invalid: parsed.invalid };
}
