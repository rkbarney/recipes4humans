# worker/

A small Cloudflare Worker that fetches a recipe page for the app, because browsers cannot read other
sites' pages directly. It returns the page text with CORS headers. No logging, no storage.

Protections: GET only, Referer must be in `ALLOWED_ORIGINS`, http and https only, private and loopback
addresses blocked (also on redirects), per-IP rate limit, 2 MB size cap, 10 second timeout. It
identifies itself as `recipes4humans/1.0 (+https://github.com/rkbarney/recipes4humans)`.

## Deploy

1. `npx wrangler login`
2. Edit `ALLOWED_ORIGINS` in `index.js`: add the production origin of the site (scheme and host, no
   path, for example `https://recipes.example`). The production origin is not decided yet; until it
   is, only `http://localhost:8080` works.
3. From this folder: `npx wrangler deploy`
4. Copy the `https://recipes4humans-proxy.<account>.workers.dev` address it prints into `proxyUrl` in
   `js/config.js`.

To try it from a script, see `scripts/probe-sites.js`.

## Checking real sites

`npm run live` (from the project folder, on your own computer) reads `local-recipes/probe-urls.txt`, fetches
each link through the deployed Worker, extracts the recipe, runs the engine and the stress-test invariants, and
writes `local-recipes/live-report.md`. The first link in the file is the control and must work. It needs the
network, so it is not part of `npm test`; nothing it saves is committed (`local-recipes/` is git-ignored).
