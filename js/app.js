// App entry point: routes between the paste screen, the cooking view and the library, runs the engine,
// and keeps the screen awake while a recipe is open.

import { rewrite, rewriteParts } from './engine/index.js';
import * as storage from './storage.js';
import * as ui from './ui.js';
import { CONFIG } from './config.js';
import { extractRecipe } from './extract.js';
import { buildPdf } from './pdf.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';

// ---------- Account ----------

// What the Worker sent back after Google sign-in (?signin=ok|failed|cancelled), shown once in the library.
const SIGNIN_MESSAGES = {
  ok: 'Signed in.',
  failed: 'Sign-in did not work. Please try again.',
  cancelled: '',
};
let pendingSigninMessage;
if (params.has('signin')) {
  const msg = SIGNIN_MESSAGES[params.get('signin')];
  params.delete('signin');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  pendingSigninMessage = msg;
}

/** The signed-in user, null when signed out, or undefined when the account service cannot be reached. */
async function loadAccount() {
  if (location.protocol === 'file:') return undefined;
  try {
    const res = await fetch(`${CONFIG.authBase}/me`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (res.status === 401) return null;
    if (!res.ok) return undefined;
    return (await res.json()).user || null;
  } catch {
    return undefined;
  }
}

async function signOut() {
  try {
    await fetch(`${CONFIG.authBase}/logout`, { method: 'POST', signal: AbortSignal.timeout(8000) });
    libraryMessage = 'Signed out.';
  } catch {
    libraryMessage = 'Could not sign out. Check the connection and try again.';
  }
  showLibrary();
}

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
    if (!recipe.parts) return rewrite(recipe.text);
    // A recipe imported from a link carries its title and source with it.
    return rewriteParts(recipe.sourceUrl ? { ...recipe.parts, title: recipe.title, sourceUrl: recipe.sourceUrl } : recipe.parts);
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

let home = null;
let navToken = 0;

const MSG_NOT_ON = 'Link import is not switched on yet. Paste the recipe text instead.';
const MSG_BAD_LINK = 'That does not look like a web link. It should start with http:// or https://.';

function showHome(message) {
  releaseWakeLock();
  home = ui.renderHome(root, { onSubmit: (text) => submit({ text }), onParts: showParts, onLink: importLink, message });
}

/** The link as a URL object when it is an http or https address, else null. */
function parseHttpUrl(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

async function importLink(link) {
  const screen = home;
  if (!screen) return;
  const url = parseHttpUrl(link);
  if (!url) {
    screen.setLinkStatus(MSG_BAD_LINK);
    return;
  }
  if (!CONFIG.proxyUrl) {
    screen.setLinkStatus(MSG_NOT_ON);
    screen.openText();
    return;
  }
  const token = navToken;
  screen.setBusy(true);
  screen.setLinkStatus('Reading the page...');
  let found = null;
  let status = null;
  let gotPage = false;
  let ownRefusal = false;
  try {
    const res = await fetch(`${CONFIG.proxyUrl}?url=${encodeURIComponent(url.href)}`, { signal: AbortSignal.timeout(20000) });
    status = res.status;
    if (res.status === 200) {
      found = extractRecipe(await res.text(), url.href);
      gotPage = !found;
    } else if (res.status === 403) {
      ownRefusal = /origin-not-allowed/.test(await res.text());
    }
  } catch {
    found = null;
  }
  if (token !== navToken) return; // the person went to another screen while we waited
  if (!found) {
    screen.setBusy(false);
    screen.setLinkStatus(ui.linkFailureMessage(status, url.hostname, gotPage, ownRefusal));
    screen.openText(true);
    return;
  }
  await submit({ parts: { ingredients: found.ingredients, steps: found.steps }, title: found.title, sourceUrl: found.sourceUrl });
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
    created: Date.now(),
    checked: {},
    ...input,
    title: result.title || input.title || (input.text !== undefined ? ui.fallbackTitle(input.text) : 'Untitled recipe'),
  };
  if (!rec.sourceUrl && result.sourceUrl) rec.sourceUrl = result.sourceUrl;
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
    onCollapse: (key, on) => {
      if (!rec.collapsed) rec.collapsed = {};
      if (on) rec.collapsed[key] = true;
      else delete rec.collapsed[key];
      scheduleSave(rec);
    },
    onReset: () => {
      rec.checked = {};
      rec.collapsed = {};
      scheduleSave(rec);
      showRecipe(id);
    },
    onPrint: () => printRecipe(rec, result),
  });
  keepAwake();
}

/**
 * Print. iPhone Safari blocks window.print() ("blocked from automatically printing") and a home-screen
 * app ignores it, so on iOS we share a PDF of the recipe instead: the share sheet offers Print (and Save to Files, Mail, AirDrop).
 */
function printRecipe(rec, result) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || !navigator.canShare) {
    window.print();
    return;
  }
  const doc = ui.printDoc(rec, result);
  const name = (doc.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'recipe') + '.pdf';
  const file = new File([buildPdf(doc)], name, { type: 'application/pdf' });
  if (!navigator.canShare({ files: [file] })) {
    window.print();
    return;
  }
  navigator.share({ files: [file], title: doc.title }).catch(() => { /* cancelled or not allowed */ });
}

let libraryMessage = '';

async function showLibrary() {
  releaseWakeLock();
  const token = navToken;
  let recipes = [];
  try { recipes = await storage.listRecipes(); } catch { recipes = []; }
  const user = await loadAccount();
  if (token !== navToken) return; // the person went to another screen while we waited
  if (pendingSigninMessage !== undefined) {
    libraryMessage = libraryMessage || pendingSigninMessage;
    pendingSigninMessage = undefined;
  }
  const message = libraryMessage;
  libraryMessage = '';
  ui.renderLibrary(root, {
    recipes,
    message,
    user,
    signInUrl: `${CONFIG.authBase}/login`,
    onSignOut: signOut,
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
  navToken++;
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
