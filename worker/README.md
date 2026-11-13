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
