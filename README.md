# recipes4humans

A mobile web app that rewrites a recipe into a cooking view: one action per line, the amount on every use, hidden prep made explicit, and safe "meanwhile" suggestions during waits. Version 1 uses rules only (no AI), so it is free to run and gives the same output every time; the engine runs in the browser and pasted text never leaves the phone.

The full spec is in [docs/SPEC.md](docs/SPEC.md). Engine stage contracts are in [js/engine/README.md](js/engine/README.md).

## Tests

    npm test

Uses `node --test`; no dependencies. Fixture format is documented in [tests/fixtures/README.md](tests/fixtures/README.md).

`tests/golden.test.js` and `tests/patterns.test.js` are marked `todo` until the engine exists. To un-skip them, set `const ENGINE_READY = true;` at the top of each file.

## Serve locally

    python3 -m http.server 8000

then open http://localhost:8000/ (any static file server works; there is no build step).

## Real recipes

Never commit recipes copied from websites or cookbooks. Put them in `local-recipes/`, which git ignores, and use them for manual checks only. All committed fixtures are written in original wording.
