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
  // Milestone 2: URL of the fetcher Worker. Empty until then; the URL box stays disabled.
  workerUrl: '',
};
