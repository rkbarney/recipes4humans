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
  // Address of the deployed page-fetcher Worker (see worker/README.md), for example
  // 'https://recipes4humans-proxy.<account>.workers.dev'. It must be set to the real deployed URL before
  // "import from a link" works; while it is empty the app tells people to paste the recipe text instead.
  proxyUrl: 'https://recipes4humans-proxy.rkbarney.workers.dev',
};
