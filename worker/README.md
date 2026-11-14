# worker/

The site Worker for recipes4humans.com. It serves the static site from `_site/` (the `ASSETS` binding),
redirects `www.recipes4humans.com` to the bare domain, and answers the API under `/api/`. No logging,
no storage.

## /api/fetch

Fetches a recipe page for the app, because browsers cannot read other sites' pages directly. It returns
the page text; the app reads the schema.org Recipe data itself.

Protections: GET only, the Referer must be a page on the same host (or an origin in `ALLOWED_ORIGINS`),
http and https only, private and loopback addresses blocked (also on redirects), per-IP rate limit,
2 MB size cap, 10 second timeout. It identifies itself as
`recipes4humans/1.0 (+https://github.com/rkbarney/recipes4humans)`.

## Run and deploy

From the project folder:

- `npm run dev`: copies the site into `_site/` and runs it at http://localhost:8787.
- `npm run deploy`: copies the site and deploys the Worker to recipes4humans.com (needs `wrangler login`).

Pushes to `main` deploy through `.github/workflows/deploy.yml`, which needs the repository secrets
`CLOUDFLARE_API_TOKEN` (an API token with Workers edit permission) and `CLOUDFLARE_ACCOUNT_ID`.

The old `recipes4humans-proxy` Worker still serves the GitHub Pages copy of the site. Delete it from the
Cloudflare dashboard once nobody uses that copy.

## Checking real sites

`npm run live` (from the project folder, on your own computer) reads `local-recipes/probe-urls.txt`, fetches
each link through the deployed Worker, extracts the recipe, runs the engine and the stress-test invariants, and
writes `local-recipes/live-report.md`. The first link in the file is the control and must work. It needs the
network, so it is not part of `npm test`; nothing it saves is committed (`local-recipes/` is git-ignored).
