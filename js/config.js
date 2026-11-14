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
  // Account endpoints on the site Worker (worker/auth.js). The Google client id lives in worker/wrangler.toml.
  authBase: '/api/auth',
};
