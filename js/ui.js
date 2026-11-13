// DOM rendering: landing page, paste screen, cooking view and library (tasks 6 and 7).
//
// The first half of this file is pure formatting with no DOM access, so it imports under node
// (tests/ui-format.test.js). The second half builds DOM; it touches `document` only inside functions.

// ---------- Pure helpers ----------

const FRACTIONS = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
];
const GLYPH_VALUE = Object.fromEntries(FRACTIONS.map(([v, g]) => [g, v]));

/** 0.75 -> "¾", 1.5 -> "1½", 2 -> "2", 0.4 -> "0.4". */
export function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const whole = Math.floor(n + 0.01);
  const frac = n - whole;
  if (Math.abs(frac) < 0.01) return String(whole);
  for (const [v, g] of FRACTIONS) {
    if (Math.abs(frac - v) < 0.011) return (whole ? String(whole) : '') + g;
  }
  return String(Math.round(n * 100) / 100);
}

/** A number or a [min, max] range. Ranges read "5 to 7". */
export function formatQty(qty) {
  if (Array.isArray(qty)) {
    const [a, b] = qty;
    return a === b ? formatNumber(a) : `${formatNumber(a)} to ${formatNumber(b)}`;
  }
  return formatNumber(qty);
}

const PLURAL_UNITS = { cup: 'cups', clove: 'cloves', can: 'cans', stick: 'sticks', slice: 'slices', pinch: 'pinches' };

/** Unit with a plural when the quantity is more than 1 ("cup" -> "cups" for 2; tsp, tbsp, lb stay). */
export function formatUnit(unit, qty) {
  if (!unit) return '';
  const max = Array.isArray(qty) ? Math.max(...qty) : qty;
  return max > 1 && PLURAL_UNITS[unit] ? PLURAL_UNITS[unit] : unit;
}

/** "¾ cup", "2" (no unit), or "" when there is no quantity. */
export function formatAmount({ qty, unit } = {}) {
  if (qty === undefined || qty === null) return '';
  return [formatQty(qty), formatUnit(unit, qty)].filter(Boolean).join(' ');
}

const UNIT_ALIASES = {
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml', l: 'l', pinch: 'pinch', clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', stick: 'stick', sticks: 'stick', slice: 'slice', slices: 'slice',
};

function parseQtyText(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/))) return +m[1] + GLYPH_VALUE[m[2]];
  if (GLYPH_VALUE[s]) return GLYPH_VALUE[s];
  if (/^\d+(?:\.\d+)?$/.test(s)) return +s;
  return undefined;
}

const QTY_SRC = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?\\s*[¼½¾⅓⅔⅛⅜⅝⅞]|[¼½¾⅓⅔⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?)';
const LEADING_RE = new RegExp(`^\\s*(${QTY_SRC})(?:\\s*(?:to|-|–)\\s*(${QTY_SRC}))?(?:\\s+([A-Za-z]+))?`);

/**
 * The amount at the start of an ingredient line, as {qty, unit}, or null. Used for the Gather total
 * when the portions cannot be added up (for example a divided ingredient whose portions are partial).
 * A line with "plus" has no single leading total.
 */
export function leadingAmount(raw) {
  if (!raw || /\bplus\b/i.test(raw)) return null;
  const m = raw.match(LEADING_RE);
  if (!m) return null;
  const a = parseQtyText(m[1]);
  if (a === undefined) return null;
  let qty = a;
  if (m[2]) {
    const b = parseQtyText(m[2]);
    if (b === undefined) return null;
    qty = [a, b];
  }
  const unit = m[3] ? UNIT_ALIASES[m[3].toLowerCase()] : undefined;
  return unit ? { qty, unit } : { qty };
}

/**
 * Number the actions: Prep and Cook continue one sequence. Prep actions placed in a window
 * (result.deferred) get no number of their own; they map to the cook action that holds them.
 * @returns {{numbers: Map<string, number>, windowOf: Map<string, string>, total: number}}
 */
export function numberSteps(result) {
  const numbers = new Map();
  let n = 0;
  for (const a of [...(result.prep || []), ...(result.cook || [])]) numbers.set(a.id, ++n);
  const windowOf = new Map();
  for (const a of result.cook || []) for (const id of a.meanwhile || []) windowOf.set(id, a.id);
  return { numbers, windowOf, total: n };
}

/** Step number for any action id, including a deferred one (it takes its window's number). */
export function stepNumberFor(id, numbering) {
  if (numbering.numbers.has(id)) return numbering.numbers.get(id);
  const w = numbering.windowOf.get(id);
  return w ? numbering.numbers.get(w) : undefined;
}

/** The prep actions an action's `meanwhile` ids point to, in order. Unknown ids are skipped. */
export function resolveMeanwhile(action, result) {
  const pool = new Map();
  for (const a of [...(result.prep || []), ...(result.deferred || [])]) pool.set(a.id, a);
  return (action.meanwhile || []).map((id) => pool.get(id)).filter(Boolean);
}

function sameUnit(portions) {
  const unit = portions[0].unit;
  return portions.every((p) => p.unit === unit);
}

/** Total amount to show for an ingredient in Gather, as {qty, unit} or null. */
export function ingredientTotal(ing) {
  if (ing.total && ing.total.qty !== undefined) return ing.total;
  const main = (ing.portions || []).filter((p) => p.tag !== 'serving');
  if (main.length && main.every((p) => typeof p.qty === 'number') && sameUnit(main)) {
    return { qty: main.reduce((s, p) => s + p.qty, 0), unit: main[0].unit };
  }
  return leadingAmount(ing.raw);
}

/** Notes that name no step: "more to season" is a seasoning use at the end, not a use in one step. */
const STEPLESS_NOTES = new Set(['more to season', 'more']);

/**
 * One portion of a split: "¼ cup for step 4", "½ diced", "more to season".
 * Prep words are shown only when `showPrep` is set (the portions differ by prep); then the prep names the portion and no step is given.
 */
export function portionLabel(p, numbering, { showPrep = true } = {}) {
  const amount = formatAmount(p);
  let label = amount || p.note || (p.tag === 'serving' ? 'more' : 'some');
  if (p.prep && showPrep) label += ` ${p.prep}`;
  if (p.tag === 'serving') label += ' for serving';
  else if (p.usedIn && !(p.prep && showPrep) && !(!amount && STEPLESS_NOTES.has(p.note))) {
    const n = stepNumberFor(p.usedIn, numbering);
    if (n) label += ` for step ${n}`;
  }
  return label;
}

/**
 * The Gather line for one ingredient, for example
 *   "¾ cup rolled oats: ¼ cup for step 4, ½ cup for step 12"
 *   "½ tsp red-pepper flakes, plus more for serving"
 */
export function gatherLine(ing, numbering) {
  const portions = ing.portions || [];
  const main = portions.filter((p) => p.tag !== 'serving');
  const serving = portions.filter((p) => p.tag === 'serving');
  const total = ingredientTotal(ing);
  const name = [ing.name, ...(ing.alternates || [])].join(' or ');
  let text = [total ? formatAmount(total) : '', name].filter(Boolean).join(' ');
  if (main.length > 1) {
    // Prep words name a portion only when the portions differ by prep ("½ diced, ½ grated"); otherwise it is by step.
    const showPrep = new Set(main.map((p) => p.prep || '')).size > 1;
    text += `: ${main.map((p) => portionLabel(p, numbering, { showPrep })).join(', ')}`;
  }
  if (serving.length) {
    const amt = serving.map((p) => formatAmount(p)).filter(Boolean).join(' plus ');
    text += `, plus ${amt || 'more'} for serving`;
  }
  return text;
}

/** Split a block of steps into an array, stripping "1." numbering. */
export function splitStepsText(str) {
  const lines = String(str).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const numbered = lines.every((l) => /^\d+[.)]\s+/.test(l));
  return numbered ? lines.map((l) => l.replace(/^\d+[.)]\s+/, '')) : [lines.join(' ')];
}

/**
 * Fallback for the "original" control when the engine result carries no `steps`: recover the step
 * texts from the saved input. Prefer `result.steps` when present.
 */
export function stepsFromInput(recipe) {
  if (recipe.parts) {
    const s = recipe.parts.steps;
    return Array.isArray(s) ? s : splitStepsText(s);
  }
  const lines = String(recipe.text || '').split('\n');
  const at = lines.findIndex((l) => /^\s*(preparation|instructions|directions|method|steps)\s*:?\s*$/i.test(l));
  return at < 0 ? [] : splitStepsText(lines.slice(at + 1).join('\n'));
}

/**
 * The recipe's own wording for an action, or null. Actions that came from an ingredient line
 * (prep notes) have original.step 0; they show the ingredient line instead.
 * @returns {{label: string, text: string} | null}
 */
export function originalFor(action, steps, ingredients) {
  const o = action.original;
  if (o && o.step >= 1 && Array.isArray(steps) && typeof steps[o.step - 1] === 'string') {
    const text = steps[o.step - 1].slice(o.start, o.end);
    if (text) return { label: `Step ${o.step} of the recipe`, text };
  }
  const first = (action.uses || [])[0];
  const ing = first && (ingredients || []).find((i) => i.id === first.ingredientId);
  if (ing && ing.raw) return { label: 'Ingredient line', text: ing.raw };
  return null;
}

/** "Nov 12, 2026" from a millisecond timestamp. */
export function formatDate(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Title for a recipe whose engine result has none: the first line of the pasted text. */
export function fallbackTitle(text) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return first.length > 80 ? first.slice(0, 77) + '...' : first || 'Untitled recipe';
}

/** True on iPhone/iPad Safari that is not yet installed to the home screen and not dismissed. */
export function shouldShowIosHint({ ua = '', platform = '', touchPoints = 0, standalone = false, dismissed = false } = {}) {
  if (standalone || dismissed) return false;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  if (!isIos) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/** Group flags: by action id, by ingredient id (flags with no action), and the rest. */
export function groupFlags(flags) {
  const byAction = new Map();
  const byIngredient = new Map();
  const other = [];
  const push = (m, k, f) => m.set(k, [...(m.get(k) || []), f]);
  for (const f of flags || []) {
    if (f.actionId) push(byAction, f.actionId, f);
    else if (f.ingredientId) push(byIngredient, f.ingredientId, f);
    else other.push(f);
  }
  return { byAction, byIngredient, other };
}

// ---------- DOM ----------

/** Tiny element builder. Text is always set as text, never as HTML. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function setTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#121212' : '#ffffff');
}

function mount(root, ...nodes) {
  root.replaceChildren(...nodes.filter(Boolean));
  window.scrollTo(0, 0);
}

export function renderMessage(root, { title, text, actions = [] }) {
  mount(root, h('h1', null, title), h('p', null, text), h('p', { class: 'row' }, actions));
}

// --- Landing / paste ---

const EXAMPLE_BEFORE = [
  'Ingredients: 2 cups rice, 1 tbsp butter, 1 onion (diced), 3 cups water',
  '',
  'Melt the butter in a pot, add the rice and onion, then pour in the water and simmer 15 minutes.',
].join('\n');

const EXAMPLE_AFTER = [
  'Prep',
  '1. Dice 1 onion.',
  'Cook',
  '2. Melt 1 tbsp butter in a pot.',
  '3. Add 2 cups rice and the diced onion.',
  '4. Pour in 3 cups water and simmer 15 minutes.',
].join('\n');

const FIXES = [
  ['"Add the salt." How much?', 'The amount is on every line that uses it.'],
  ['One step, five jobs.', 'One action per line. Tick it off, move on.'],
  ['The prep nobody mentioned.', '"1 onion, diced" becomes a step, before the pan is hot.'],
  ['"Use the remaining cheese." What remaining cheese?', 'Every split is shown up front: 5 oz for the sauce, 1 oz for the top.'],
  ['Standing around while it simmers.', 'It tells you what to prep while you wait.'],
  ['Lost your place again.', "Tap a line when it's done. It's still ticked when you pick the phone back up."],
  ['The life story, the ads, the pop-up video.', 'None of it. Plain text.'],
  ['Another account to create.', 'No sign-up. Your recipes stay on your phone.'],
];

/**
 * @param {HTMLElement} root
 * @param {{onSubmit: (text: string) => void, onParts: () => void, onLink: (url: string) => void, message?: string}} opts
 * @returns {{setLinkStatus: (text: string) => void, setBusy: (busy: boolean) => void, openText: (focus?: boolean) => void}}
 */
export function renderHome(root, { onSubmit, onParts, onLink, message }) {
  const url = h('input', { id: 'url', type: 'url', placeholder: 'Paste a recipe link', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'url' });
  const linkButton = h('button', { type: 'submit', class: 'primary' }, 'Rewrite');
  const linkStatus = h('p', { class: 'message', role: 'status' }, message || '');
  const linkForm = h('form', {
    class: 'link-form',
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      onLink(url.value.trim());
    },
  },
    h('label', { for: 'url', class: 'sr-only' }, 'Recipe link'),
    h('div', { class: 'link-row' }, url, linkButton),
    linkStatus);

  const text = h('textarea', { id: 'paste', rows: 10, placeholder: 'Paste the ingredients and the steps here', autocapitalize: 'off', spellcheck: 'false' });
  const textStatus = h('p', { class: 'message', role: 'status' });
  const textForm = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      if (!text.value.trim()) {
        textStatus.textContent = 'Paste a recipe first.';
        return;
      }
      onSubmit(text.value);
    },
  },
    h('label', { for: 'paste', class: 'sr-only' }, 'Recipe text'),
    text,
    h('div', { class: 'row' },
      h('button', { type: 'submit', class: 'primary' }, 'Rewrite'),
      h('button', { type: 'button', class: 'link', onclick: onParts }, 'Paste ingredients and steps separately')),
    textStatus);

  const details = h('details', { class: 'text-option', id: 'text-option' },
    h('summary', null, 'Or paste the recipe text'),
    textForm);

  mount(root,
    h('h1', null, 'Recipes that read the way your mind works.'),
    h('p', { class: 'lede' }, 'Paste a recipe link and get started.'),
    linkForm,
    details,
    h('h2', null, 'Before and after'),
    h('div', { class: 'example' },
      h('div', null, h('h3', null, 'The recipe says'), h('pre', null, EXAMPLE_BEFORE)),
      h('div', null, h('h3', null, 'You cook from'), h('pre', null, EXAMPLE_AFTER))),
    h('h2', null, 'What it fixes'),
    h('ul', { class: 'fixes' }, FIXES.map(([complaint, line]) =>
      h('li', null, h('strong', null, complaint), ' ', line))));

  return {
    setLinkStatus: (t) => { linkStatus.textContent = t; },
    setBusy: (busy) => {
      linkButton.disabled = busy;
      url.disabled = busy;
    },
    openText: (focus) => {
      details.open = true;
      if (focus) text.focus();
    },
  };
}

/** Two boxes, for when the engine cannot tell the ingredients from the steps. */
export function renderParts(root, { onSubmit, onBack, message }) {
  const ing = h('textarea', { id: 'p-ing', rows: 8, placeholder: 'One ingredient per line', spellcheck: 'false' });
  const steps = h('textarea', { id: 'p-steps', rows: 8, placeholder: 'The steps, one per line or as one block', spellcheck: 'false' });
  const status = h('p', { class: 'message', role: 'status' }, message || '');
  mount(root,
    h('h1', null, 'Ingredients and steps'),
    h('p', null, 'Paste the two parts separately.'),
    h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (!ing.value.trim() || !steps.value.trim()) {
          status.textContent = 'Both boxes need some text.';
          return;
        }
        onSubmit({ ingredients: ing.value, steps: steps.value });
      },
    },
      h('label', { for: 'p-ing' }, 'Ingredients'), ing,
      h('label', { for: 'p-steps' }, 'Steps'), steps,
      h('div', { class: 'row' },
        h('button', { type: 'submit', class: 'primary' }, 'Rewrite'),
        h('button', { type: 'button', class: 'link', onclick: onBack }, 'Back')),
      status));
}

// --- Cooking view ---

/**
 * @param {HTMLElement} root
 * @param {{recipe: object, result: object, steps: string[], onToggle: (id: string, on: boolean) => void, onReset: () => void}} ctx
 */
export function renderRecipe(root, ctx) {
  const { recipe, result, steps } = ctx;
  const numbering = numberSteps(result);
  const flags = groupFlags(result.flags);
  const checked = recipe.checked || (recipe.checked = {});

  function checkRow(id, content) {
    const btn = h('button', { type: 'button', class: 'check', 'aria-pressed': checked[id] ? 'true' : 'false' }, content);
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.closest('.line').classList.toggle('done', on);
      ctx.onToggle(id, on);
    });
    return btn;
  }

  function toggler(label, panelClass, buildPanel) {
    const panel = h('div', { class: `panel ${panelClass}`, hidden: true }, buildPanel());
    const btn = h('button', { type: 'button', class: 'mini', 'aria-expanded': 'false' }, label);
    btn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    return { btn, panel };
  }

  function flagTool(list) {
    if (!list || !list.length) return null;
    return toggler('flag', 'flag-panel', () => list.map((f) => h('p', null, f.message)));
  }

  function toolsFor(tools) {
    const real = tools.filter(Boolean);
    if (!real.length) return null;
    return [h('div', { class: 'tools' }, real.map((t) => t.btn)), real.map((t) => t.panel)];
  }

  function actionLine(a, number) {
    const orig = originalFor(a, steps, result.ingredients);
    const origTool = orig
      ? toggler('original', 'orig-panel', () => [h('span', { class: 'orig-label' }, orig.label), h('q', null, orig.text)])
      : null;
    const body = [
      number ? h('span', { class: 'num' }, `${number}.`) : null,
      h('span', { class: 'body' },
        h('span', { class: 'text' }, a.text),
        (a.notes || []).map((n) => h('span', { class: 'note' }, n))),
    ];
    const placed = resolveMeanwhile(a, result);
    return h('li', { class: `line${checked[a.id] ? ' done' : ''}${number ? '' : ' sub'}` },
      checkRow(a.id, body),
      toolsFor([origTool, flagTool(flags.byAction.get(a.id))]),
      placed.length
        ? h('div', { class: 'meanwhile' },
            h('div', { class: 'label' }, 'Meanwhile'),
            h('ul', null, placed.map((p) => actionLine(p, null))))
        : null);
  }

  function ingredientLine(ing) {
    const id = `g:${ing.id}`;
    return h('li', { class: `line gather${checked[id] ? ' done' : ''}` },
      checkRow(id, h('span', { class: 'body' }, h('span', { class: 'text' }, gatherLine(ing, numbering)))),
      toolsFor([flagTool(flags.byIngredient.get(ing.id))]));
  }

  const source = recipe.sourceUrl || result.sourceUrl;
  let host = '';
  if (source) {
    try { host = new URL(source).hostname; } catch { host = source; }
  }

  mount(root,
    h('article', { class: 'recipe' },
      h('h1', null, result.title || recipe.title || 'Recipe'),
      source ? h('p', { class: 'source' }, 'Source: ', h('a', { href: source, rel: 'noopener noreferrer' }, host)) : null,
      h('section', null, h('h2', null, 'Gather'), h('ul', { class: 'lines' }, (result.ingredients || []).map(ingredientLine))),
      h('section', null, h('h2', null, 'Prep'), h('ol', { class: 'lines' }, (result.prep || []).map((a) => actionLine(a, numbering.numbers.get(a.id))))),
      h('section', null, h('h2', null, 'Cook'), h('ol', { class: 'lines' }, (result.cook || []).map((a) => actionLine(a, numbering.numbers.get(a.id))))),
      flags.other.length
        ? h('section', null, h('h2', null, 'Notes'), flags.other.map((f) => h('p', { class: 'note-block' }, f.message)))
        : null,
      h('p', { class: 'row' },
        h('button', { type: 'button', class: 'link', onclick: ctx.onReset }, 'Uncheck everything'))));
}

// --- Library ---

/**
 * @param {HTMLElement} root
 * @param {{recipes: object[], theme: string, persistent: boolean, message?: string,
 *   onDelete: (rec: object) => void, onExport: () => void, onImport: (file: File) => void, onTheme: (t: string) => void}} ctx
 */
export function renderLibrary(root, ctx) {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'import-file', tabindex: '-1' });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) ctx.onImport(fileInput.files[0]);
    fileInput.value = '';
  });

  const list = ctx.recipes.length
    ? h('ul', { class: 'library' }, ctx.recipes.map((r) =>
        h('li', null,
          h('a', { href: `#/recipe/${encodeURIComponent(r.id)}`, class: 'rtitle' },
            h('span', null, r.title), h('span', { class: 'date' }, formatDate(r.created))),
          h('button', { type: 'button', class: 'mini', 'aria-label': `Delete ${r.title}`, onclick: () => ctx.onDelete(r) }, 'Delete'))))
    : h('p', null, 'No saved recipes yet. Recipes are saved here when you rewrite them.');

  const themeRadio = (value, label) => {
    const input = h('input', { type: 'radio', name: 'theme', value, checked: ctx.theme === value });
    input.addEventListener('change', () => ctx.onTheme(value));
    return h('label', { class: 'choice' }, input, ' ', label);
  };

  mount(root,
    h('h1', null, 'Library'),
    ctx.persistent ? null : h('p', { class: 'message' }, 'Saving is unavailable in this browser. Recipes will be lost when you close the page; use Export to keep them.'),
    ctx.message ? h('p', { class: 'message', role: 'status' }, ctx.message) : null,
    list,
    h('h2', null, 'Backup'),
    h('p', { class: 'note' }, 'Recipes live only in this browser. Export them to a file to keep a copy or move them to another device.'),
    h('p', { class: 'row' },
      h('button', { type: 'button', onclick: ctx.onExport, disabled: ctx.recipes.length ? null : true }, 'Export all'),
      h('label', { class: 'button', for: 'import-file' }, 'Import'),
      fileInput),
    h('h2', null, 'Theme'),
    h('div', { class: 'choices' }, themeRadio('system', 'System'), themeRadio('light', 'Light'), themeRadio('dark', 'Dark')));
}

// --- iPhone hint ---

export function renderIosHint(container, onDismiss) {
  container.replaceChildren(
    h('div', { class: 'hint', role: 'note' },
      h('p', null, 'To keep your saved recipes, add this app to your home screen: tap the Share button, then "Add to Home Screen". Safari can clear data from sites that are not added.'),
      h('button', { type: 'button', class: 'mini', onclick: onDismiss }, 'Dismiss')));
}
