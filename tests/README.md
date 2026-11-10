# eNotes tests

Automated tests for the app, the crypto module and the export CLI. They never
touch a real Google account: Google sign-in is stubbed and Google Drive is
replaced by an in-memory fake.

## Run them

One-time setup (needs Node 18+ and Python 3):

```bash
cd tests && npm install && npx playwright install chromium
```

Then, from the repository root:

```bash
node tests/run-all.mjs
```

Run just some suites with `--only` (repeatable), e.g.
`node tests/run-all.mjs --only crypto --only cli`. A full run takes a few
minutes, mostly because recovery codes are checked with the slow Argon2
key derivation on purpose.

## What is covered

| Suite | File | Checks |
|---|---|---|
| `verify` | `src/export/verify.mjs` | the export CLI bundle was rebuilt after its sources changed |
| `crypto` | `crypto.test.mjs` | encrypt/decrypt, data from the original app still decrypts, missing passwords refused, secrets wiped from WASM memory, no insecure random fallback, `crypto.wasm` stripped |
| `cli` | `cli/run.mjs` | every export CLI mode produces byte-for-byte the same files as the original CLI (from git history, commit `419c522`), plus private file modes, hidden token prompt, safe mirror paths, Node 18 |
| `app-core` | `browser/app-core.test.cjs` | setup, unlock, notes, recovery codes, wall-clock session timeout, CSP, mobile image popup |
| `features` | `browser/features.test.cjs` | uploads/downloads, rename, search, save prompts, settings, menu; Argon2 runs for every recovery file; secrets not left in WASM memory; spellcheck off |
| `framing` | `browser/framing.test.cjs` | the app refuses to run inside another site's frame |
| `password-rules` | `browser/password-rules.test.cjs` | master password rules on setup and reset |
| `recovery-lockout` | `browser/recovery-lockout.test.cjs` | never locked out: 0/1 codes left, last-code reset, complete code sets, failure handling |
| `data-safety` | `browser/data-safety.test.cjs` | Drive glitches and duplicate / missing files never create a second config.json, never start setup over existing data, never delete the only key to the notes |

## Notes

- The browser suites serve `www/` with `serve.py` on a free local port and
  drive it with Playwright (Chromium). Shared fake-Drive / sign-in code lives in
  `browser/lib/harness.cjs`, which can also make Drive calls fail on purpose to
  test error handling.
- `fixtures/ciphertext-from-original-app.txt` was encrypted by the app's
  original code (password `MyMasterPassw0rd!!`); it guards compatibility with
  data already stored in Drive.
- The CLI tests need the full git history (they read the original CLI from
  commit `419c522`) and use a pseudo-terminal check that is skipped on Windows.
