// One tiny pure helper shared by storage.js and ui.js (no imports, so it loads under node tests too).

/** True when the text is an http or https web address. Anything else (javascript:, data:, junk) is not. */
export function isHttpUrl(text) {
  if (typeof text !== 'string') return false;
  try {
    const protocol = new URL(text).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
