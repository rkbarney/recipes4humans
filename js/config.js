// App configuration constants (storage names, file locations).

export const CONFIG = {
  dbName: 'recipes4humans-db',
  dbVersion: 1,
  storeRecipes: 'recipes',
  settingsKey: 'recipes4humans-settings',
  iosHintKey: 'recipes4humans-ios-hint-dismissed',
  exportApp: 'recipes4humans',
  exportVersion: 1,
  // Saved engine result for the golden recipe, used by ?demo=1 while the engine is unfinished.
  sampleResultUrl: 'tests/fixtures/golden/sample-result.json',
  // The page fetcher, served by the site Worker on the same origin (see worker/README.md). While it is
  // empty the app tells people to paste the recipe text instead.
  proxyUrl: '/api/fetch',
  // Google OAuth web client (Google Cloud project "recipes4humans"). Not a secret: it appears in every
  // sign-in page. The Worker checks ID tokens against the same value.
  googleClientId: '713845423648-vg9qb0nnl9fmph13g5tln0us1kliera6.apps.googleusercontent.com',
};
