# Notes for Claude

## Feature workflow (standing rule from the repo owner)

Pushing `main` deploys the live password manager, so `main` only changes when
the owner says so.

1. Build every new feature or change on its own branch, e.g.
   `feature/<short-name>` - never directly on `main`.
2. Add tests to `tests/` (see below), run the suites the change can affect
   (see "Which tests to run" below), then commit and push ONLY that branch.
   Tell the owner the branch name, which suites passed (and which were
   skipped, and why), and how to try it locally:
   `git fetch origin`, `git switch <branch>`, `python3 serve.py`, then open
   http://localhost:8000. (Manual testing there uses the owner's real vault:
   for risky changes suggest signing in with a second Google account.)
3. Changes the owner asks for go on the same branch as new commits (the owner
   runs `git pull`). Never force-push or rewrite a branch the owner may have
   checked out.
4. Do NOT merge into `main` or push `main` until the owner explicitly asks
   (e.g. "merge feature/x into main and push"). Then: update from
   `origin/main`, merge the branch, run the FULL suite (if anything fails,
   fix it and run the full suite again until everything passes), push `main`,
   confirm the GitHub Pages deployment succeeded, and offer to delete the
   merged branch.

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
- Tests must never touch a real Google account and must not write into the
  repository (use the OS temp folder).

## Which tests to run (standing rule from the repo owner)

- Before merging into `main`: ALWAYS the full suite (`node tests/run-all.mjs`),
  because `main` is the whole live app. If anything fails, fix it and run the
  full suite again before pushing `main`.
- On a feature branch, before each push: run only the suites the change can
  affect (`node tests/run-all.mjs --only <suite> --only <suite> ...`) - but
  only when 100% sure the rest can't be affected; when in doubt, run the full
  suite. Decide from what actually changed since the branch was last tested
  and pushed, not from a feeling: `git diff origin/<branch> --name-only` (for
  a new branch: `git diff origin/main --name-only`), and whether the app files
  are untouched: `git diff origin/<branch> -- www ':!www/enotesmgr-export-cli.js'`.
  (A branch that already holds several features always differs from `main`
  everywhere, so comparing with `main` would always mean the full suite.)
  - Only docs (`instructions/`, READMEs, this file): `verify`.
  - Only test files: those suites, plus `verify`.
  - Only the export CLI (`src/export/`, `www/enotesmgr-export-cli.js`) with
    the app files unchanged: `verify`, `cli`, `sensitive`,
    `cli-options`, `cli-transfer`, `cli-regression`, and the browser suites
    that run the CLI: `cli-roundtrip`, `cli-matrix`, `sensitive-notes`,
    `transfer`.
  - Code shared by the app AND the CLI (`www/js/crypto/`,
    `www/js/lib/noteExport.js`, `www/js/lib/sensitiveNote.js`): the full suite.
  - Any other app file in `www/`: all browser suites.
- Always say which suites ran and passed, and which were skipped and why.

## Deployment

- `main` is served directly by GitHub Pages: every push to `main` goes live.
- The app lives in `www/`; the export CLI bundle `www/enotesmgr-export-cli.js`
  must be rebuilt (`cd src/export && node build.mjs`) whenever its inputs change
  (`node src/export/verify.mjs` checks this).
- The specs in `instructions/` describe intended behaviour; update them along
  with behaviour changes.

## Running the tests (standing rule from the repo owner)

- Always run the tests with the fast parallel runner, `node tests/run-all.mjs`:
  several jobs at once (by default one per CPU thread; `--jobs N` to choose),
  the slowest first, long suites split into parts (a `<suite>.parts.mjs` file
  next to the suite), each job's output in one piece with its time. A targeted
  run is the same command with `--only <suite>` (repeatable) - still in
  parallel.
- Keep the suites as parallel as possible: when a suite gets long, split it
  into parts (see `tests/README.md`), and after changing how a suite is split
  run `node tests/run-all.mjs --check-parts --only <suite>` - the parts must
  run exactly the checks of the whole suite.
- Don't run suites one at a time for a test run you report (not
  `--jobs 1`, not `node tests/<suite>` by hand); `--jobs 1` is only for
  watching a single suite's output live while debugging.
