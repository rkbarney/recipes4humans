// App entry point: routes between the paste screen, the cooking view and the library, runs the engine,
// and keeps the screen awake while a recipe is open.

import { rewrite, rewriteParts } from './engine/index.js';
import * as storage from './storage.js';
import * as ui from './ui.js';
import { CONFIG } from './config.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';

// ---------- Engine ----------

function isNotImplemented(err) {
  return !!err && /not implemented/i.test(String(err.message || err));
}

/** The engine could not find the ingredient and step blocks in pasted text. */
function isNoSections(err) {
  return !!err && (err.code === 'no-sections' || /\b(sections?|headings?)\b/i.test(String(err.message || '')));
}

async function fetchSample() {
  const res = await fetch(CONFIG.sampleResultUrl);
  if (!res.ok) throw new Error('Could not load the sample result.');
  return res.json();
}

/** Run the engine on a saved recipe. While the engine is unfinished, ?demo=1 shows the saved sample. */
async function runEngine(recipe) {
  try {
    return recipe.parts ? rewriteParts(recipe.parts) : rewrite(recipe.text);
  } catch (err) {
    if (isNotImplemented(err) && DEMO) return fetchSample();
    throw err;
  }
}

// ---------- Wake lock ----------

let wakeWanted = false;
let wakeLock = null;

async function acquireWakeLock() {
  if (!wakeWanted || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    if (!wakeWanted) releaseWakeLock();
  } catch {
    wakeLock = null; // Fails silently: unsupported, low battery, or not allowed.
  }
}

function releaseWakeLock() {
  wakeWanted = false;
  const lock = wakeLock;
  wakeLock = null;
  try { if (lock) lock.release().catch(() => {}); } catch { /* ignore */ }
}

function keepAwake() {
  wakeWanted = true;
  acquireWakeLock();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquireWakeLock();
});

// ---------- Screens ----------

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function showHome(message) {
  releaseWakeLock();
  ui.renderHome(root, { onSubmit: (text) => submit({ text }), onParts: showParts, message });
}

function showParts(message) {
  releaseWakeLock();
  ui.renderParts(root, { onSubmit: (parts) => submit({ parts }), onBack: () => showHome(), message: typeof message === 'string' ? message : '' });
}

function showError(err, input) {
  releaseWakeLock();
  const back = ui.h('button', { type: 'button', onclick: () => go('#/') }, 'Back');
  if (isNotImplemented(err)) {
    ui.renderMessage(root, {
      title: 'The rewriter is not ready',
      text: 'This version has the screens but not the rewriting engine yet, so it cannot rewrite recipes. Add ?demo=1 to the address to see a sample.',
      actions: [back],
    });
  } else {
    ui.renderMessage(root, { title: 'Could not rewrite this recipe', text: String((err && err.message) || err), actions: [back] });
  }
}

async function submit(input) {
  let result;
  try {
    result = await runEngine(input);
  } catch (err) {
    if (input.text !== undefined && isNoSections(err)) {
      showParts('Could not tell where the ingredients end and the steps begin. Paste the two parts separately.');
    } else {
      showError(err, input);
    }
    return;
  }
  const rec = {
    id: storage.newId(),
    title: result.title || (input.text !== undefined ? ui.fallbackTitle(input.text) : 'Untitled recipe'),
    created: Date.now(),
    checked: {},
    ...input,
  };
  if (result.sourceUrl) rec.sourceUrl = result.sourceUrl;
  try { await storage.saveRecipe(rec); } catch { /* the page still works from memory */ }
  go(`#/recipe/${encodeURIComponent(rec.id)}`);
}

let saveTimer = null;

function scheduleSave(rec) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { storage.saveRecipe(rec).catch(() => {}); }, 200);
}

async function showRecipe(id) {
  releaseWakeLock();
  let rec;
  try { rec = await storage.getRecipe(id); } catch { rec = null; }
  if (!rec) {
    ui.renderMessage(root, {
      title: 'Recipe not found',
      text: 'It may have been deleted, or it was saved in another browser.',
      actions: [ui.h('button', { type: 'button', onclick: () => go('#/library') }, 'Library')],
    });
    return;
  }
  let result;
  try {
    result = await runEngine(rec);
  } catch (err) {
    showError(err, rec);
    return;
  }
  const steps = Array.isArray(result.steps) ? result.steps : ui.stepsFromInput(rec);
  ui.renderRecipe(root, {
    recipe: rec,
    result,
    steps,
    onToggle: (lineId, on) => {
      if (on) rec.checked[lineId] = true;
      else delete rec.checked[lineId];
      scheduleSave(rec);
    },
    onReset: () => {
      rec.checked = {};
      scheduleSave(rec);
      showRecipe(id);
    },
  });
  keepAwake();
}

let libraryMessage = '';

async function showLibrary() {
  releaseWakeLock();
  let recipes = [];
  try { recipes = await storage.listRecipes(); } catch { recipes = []; }
  const message = libraryMessage;
  libraryMessage = '';
  ui.renderLibrary(root, {
    recipes,
    message,
    theme: storage.getSetting('theme', 'system'),
    persistent: storage.isPersistent(),
    onTheme: (t) => { storage.setSetting('theme', t); ui.setTheme(t); },
    onDelete: async (rec) => {
      if (!window.confirm(`Delete "${rec.title}"? This cannot be undone.`)) return;
      try { await storage.deleteRecipe(rec.id); } catch { /* ignore */ }
      showLibrary();
    },
    onExport: async () => {
      try {
        const data = await storage.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `recipes4humans-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch {
        libraryMessage = 'Export failed.';
        showLibrary();
      }
    },
    onImport: async (file) => {
      try {
        const r = await storage.importFromText(await file.text());
        libraryMessage = r.error
          || `Imported ${r.added} recipe${r.added === 1 ? '' : 's'}, skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}${r.invalid ? `, ignored ${r.invalid} unreadable` : ''}.`;
      } catch {
        libraryMessage = 'Import failed.';
      }
      showLibrary();
    },
  });
}

function route() {
  const hash = location.hash || '#/';
  let m;
  if ((m = hash.match(/^#\/recipe\/(.+)$/))) showRecipe(decodeURIComponent(m[1]));
  else if (hash === '#/library') showLibrary();
  else showHome();
}

// ---------- iPhone hint ----------

function maybeShowIosHint() {
  const container = document.getElementById('hint');
  if (!container) return;
  const standalone = !!navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const show = ui.shouldShowIosHint({
    ua: navigator.userAgent,
    platform: navigator.platform,
    touchPoints: navigator.maxTouchPoints || 0,
    standalone,
    dismissed: storage.getFlag(CONFIG.iosHintKey),
  });
  if (!show) return;
  ui.renderIosHint(container, () => {
    storage.setFlag(CONFIG.iosHintKey);
    container.replaceChildren();
  });
}

// ---------- Start ----------

ui.setTheme(storage.getSetting('theme', 'system'));
window.addEventListener('hashchange', route);
route();
maybeShowIosHint();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  // On localhost the cache-first worker would serve stale files while developing; opt in with ?sw=1.
  if (!local || params.get('sw') === '1') {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}
