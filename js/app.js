// App entry point: routes between the paste screen, the cooking view and the library, runs the engine,
// and keeps the screen awake while a recipe is open.

import { rewrite, rewriteParts } from './engine/index.js';
import * as storage from './storage.js';
import * as sync from './sync.js';
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

/** Signing out sends any last edits, then removes this device's recipes (they stay in the account). */
async function signOut() {
  if (!window.confirm('Sign out? Your recipes will be removed from this device. They stay in your account and come back when you sign in again.')) return;
  await sync.syncNow();
  if ((await sync.hasUnsynced())
    && !window.confirm('Some changes on this device have not reached your account yet (are you offline?). Sign out anyway and lose them?')) return;
  try {
    const res = await fetch(`${CONFIG.authBase}/logout`, { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    libraryMessage = 'Could not sign out. Check the connection and try again.';
    showLibrary();
    return;
  }
  sync.stop();
  try { await storage.clearRecipes(); } catch { /* ignore */ }
  libraryMessage = 'Signed out. Your recipes were removed from this device.';
  showLibrary();
}

/** Delete the account on the server. Recipes on this device stay here. */
async function deleteAccount() {
  if (!window.confirm('Delete your account? Your recipes are removed from the server and stop syncing. Recipes on this device stay here.')) return;
  try {
    const res = await fetch(CONFIG.deleteAccountUrl, { method: 'POST', signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    libraryMessage = 'Could not delete the account. Check the connection and try again.';
    showLibrary();
    return;
  }
  sync.stop();
  libraryMessage = 'Your account was deleted. Recipes on this device are still here.';
  showLibrary();
}

/** Start syncing if signed in. Called at startup and whenever the library learns the account state. */
function startSyncFor(user) {
  if (user && !sync.status().enabled) sync.start(user).catch(() => {});
}

// When a sync brings in changes, refresh what is on screen: the library, or the open recipe (keeping
// the scroll position) so ticks made on another device show up and are not overwritten by a stale copy.
sync.onSynced(({ changed, ids }) => {
  if (!changed) return;
  if (location.hash === '#/library') {
    showLibrary();
    return;
  }
  if (!location.hash || location.hash === '#/') {
    if (!document.activeElement || !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) showHome();
    return;
  }
  const m = location.hash.match(/^#\/recipe\/(.+)$/);
  const id = m && decodeURIComponent(m[1]);
  if (!id || !ids.has(id)) return;
  if (pendingSave && pendingSave.id === id) return; // an edit here is about to be saved and sent; it wins
  const y = window.scrollY;
  showRecipe(id).then(() => window.scrollTo(0, y));
});

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

async function showHome(message) {
  releaseWakeLock();
  const token = navToken;
  let recipes = [];
  try { recipes = await storage.listRecipes(); } catch { recipes = []; }
  if (token !== navToken) return;
  home = ui.renderHome(root, {
    onSubmit: (text) => submit({ text }),
    onParts: showParts,
    onLink: importLink,
    message,
    recipes,
    onStar: (rec) => toggleStar(rec).then(() => { if (token === navToken) showHome(); }),
    onDelete: (rec) => removeRecipe(rec).then((gone) => { if (gone && token === navToken) showHome(); }),
    signInUrl: `${CONFIG.authBase}/login`,
  });
  const screen = home;
  loadAccount().then((user) => {
    if (home === screen && token === navToken) screen.setAccount(user);
    startSyncFor(user);
  });
}

// ---------- Stars, deleting, sharing ----------

async function toggleStar(rec) {
  if (rec.starred) delete rec.starred;
  else rec.starred = true;
  try { await storage.saveRecipe(rec); } catch { /* ignore */ }
}

async function removeRecipe(rec) {
  if (!window.confirm(`Delete "${rec.title}"? This cannot be undone.`)) return false;
  try { await storage.deleteRecipe(rec.id); } catch { /* ignore */ }
  return true;
}

const SITE_URL = 'https://recipes4humans.com/';

/** Open the system share sheet; where there is none, copy to the clipboard instead. */
async function share({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share(url ? { title, text, url } : { title, text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // the person closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
    ui.toast(url ? 'Link copied.' : 'Copied.');
  } catch {
    ui.toast('Sharing is not available in this browser.');
  }
}

function shareSite() {
  return share({ title: 'recipes4humans', text: 'Recipes reformatted for your phone: one step per line, amounts where you need them.', url: SITE_URL });
}

/**
 * A recipe from a link is shared as a recipes4humans link that opens it ready to cook; the recipe
 * text itself is not uploaded anywhere. A pasted recipe is shared as its text.
 */
function shareRecipe(rec) {
  const title = rec.title || 'Recipe';
  if (rec.sourceUrl) {
    return share({ title, text: `${title}, ready to cook on recipes4humans:`, url: `${SITE_URL}?import=${encodeURIComponent(rec.sourceUrl)}` });
  }
  const body = rec.text !== undefined
    ? rec.text
    : [].concat(rec.parts.ingredients).join('\n') + '\n\n' + [].concat(rec.parts.steps).join('\n');
  return share({ title, text: `${title}\n\n${body.trim()}\n\nReformat recipes for your phone: ${SITE_URL}` });
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
let pendingSave = null;

function scheduleSave(rec) {
  clearTimeout(saveTimer);
  pendingSave = rec;
  saveTimer = setTimeout(flushSave, 200);
}

/** Write a scheduled save now, if there is one. */
async function flushSave() {
  clearTimeout(saveTimer);
  const rec = pendingSave;
  pendingSave = null;
  if (rec) await storage.saveRecipe(rec).catch(() => {});
}

// Leaving the app (switching away, locking the phone): save the last tick now so it can be synced.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pendingSave) flushSave().then(() => sync.flush());
});

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
    onShare: () => shareRecipe(rec),
    onStar: async () => {
      await flushSave();
      await toggleStar(rec);
      const y = window.scrollY;
      showRecipe(id).then(() => window.scrollTo(0, y));
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
  startSyncFor(user);
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
    sync: sync.status(),
    signInUrl: `${CONFIG.authBase}/login`,
    onSignOut: signOut,
    theme: storage.getSetting('theme', 'system'),
    persistent: storage.isPersistent(),
    onTheme: (t) => { storage.setSetting('theme', t); ui.setTheme(t); },
    onDelete: async (rec) => {
      if (await removeRecipe(rec)) showLibrary();
    },
    onStar: async (rec) => {
      await toggleStar(rec);
      showLibrary();
    },
    onDeleteAccount: deleteAccount,
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
  if ((m = hash.match(/^#\/recipe\/(.+)$/))) return showRecipe(decodeURIComponent(m[1]));
  if (hash === '#/library') return showLibrary();
  return showHome();
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

// A shared recipe link (?import=<recipe page>) opens straight into that recipe.
const importParam = params.get('import');
if (importParam) {
  params.delete('import');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}#/`);
}
route().then(() => { if (importParam) importLink(importParam); });
maybeShowIosHint();
if (location.hash && location.hash !== '#/') loadAccount().then(startSyncFor); // home starts sync itself

const shareButton = document.getElementById('share-site');
if (shareButton) shareButton.addEventListener('click', shareSite);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  // On localhost the cache-first worker would serve stale files while developing; opt in with ?sw=1.
  if (!local || params.get('sw') === '1') {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}
