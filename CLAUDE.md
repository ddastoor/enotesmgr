# Notes for Claude

## Feature workflow (standing rule from the repo owner)

Pushing `main` deploys the live password manager, so `main` only changes when
the owner says so.

1. Build every new feature or change on its own branch, e.g.
   `feature/<short-name>` - never directly on `main`.
2. Add tests to `tests/` (see below), run the FULL suite
   (`node tests/run-all.mjs`), then commit and push ONLY that branch. Tell the
   owner the branch name, which suites passed, and how to try it locally:
   `git fetch origin`, `git switch <branch>`, `python3 serve.py`, then open
   http://localhost:8000. (Manual testing there uses the owner's real vault:
   for risky changes suggest signing in with a second Google account.)
3. Changes the owner asks for go on the same branch as new commits (the owner
   runs `git pull`). Never force-push or rewrite a branch the owner may have
   checked out.
4. Do NOT merge into `main` or push `main` until the owner explicitly asks
   (e.g. "merge feature/x into main and push"). Then: update from
   `origin/main`, merge the branch, run the full suite again, push `main`,
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

## Running the tests (standing rule from the repo owner)

- Always run the tests with the fast parallel runner, `node tests/run-all.mjs`:
  several suites at once (by default half the CPU threads; `--jobs N` to
  choose), the slowest first, `cli-options` split into parts, each suite's
  output in one piece with its time. A targeted run is the same command with
  `--only <suite>` (repeatable) - still in parallel.
- Don't run suites one at a time for a test run you report (not
  `--jobs 1`, not `node tests/<suite>` by hand); `--jobs 1` is only for
  watching a single suite's output live while debugging.
