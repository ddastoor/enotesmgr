# Notes for Claude

## Tests (standing rule from the repo owner)

- Every new test you write - unit, CLI or browser, including one-off checks
  written to verify a change - goes into the `tests/` hierarchy (see
  `tests/README.md` for the layout), is wired into `tests/run-all.mjs`, and is
  committed and pushed together with the change it covers. Don't leave tests
  only in a scratch / temporary folder.
- Browser suites live in `tests/browser/*.test.cjs` and share
  `tests/browser/lib/harness.cjs` (fake Google Drive with failure injection,
  stubbed Google sign-in, page helpers). Add a new suite to `BROWSER_SUITES`
  in `tests/run-all.mjs` and to the table in `tests/README.md`.
- Run `node tests/run-all.mjs` (or the relevant `--only <suite>`) before
  pushing a change, and say which suites passed.
- Tests must never touch a real Google account and must not write into the
  repository (use the OS temp folder).

## Deployment

- `main` is served directly by GitHub Pages: every push to `main` goes live.
- The app lives in `www/`; the export CLI bundle `www/enotesmgr-export-cli.js`
  must be rebuilt (`cd src/export && node build.mjs`) whenever its inputs change
  (`node src/export/verify.mjs` checks this).
- The specs in `instructions/` describe intended behaviour; update them along
  with behaviour changes.
