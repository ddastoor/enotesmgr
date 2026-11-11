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
| `sensitive` | `sensitive.test.mjs` | sensitive notes without a browser: the envelope format, both encryption layers (note password inside, file password outside), the shared export rules (`<name>.sensitive`), the CLI's offline export of a sensitive note |
| `cli-options` | `cli/options.mjs` | the export CLI with EVERY option combination (offline `-c -d`, `-c -n` for every note, `-c -n -d`, every partial wizard and answer, bad / wrong-type / empty paths, wrong master password, ignored extra flags; online `-t`, token prompt, `-t` without a value, empty / bad token, wrong master password, duplicate trees + an older config.json with another key, a momentary Drive miss, config.json missing; `-x` mirror with `-t` / prompt / bad token, offline export from the mirror; Node 18; usage errors; `--help`; and `-m sensitive`: export folder, single files, asked-for / bad path, wrong / master / file password then right, Enter skips, not-a-sensitive-file, `-x` copy files, an original-CLI export, name clashes, no password option, ignored flags, Node 18, password hidden in a real terminal) on four vaults: no sensitive notes, mixed, only sensitive, and output-name clashes. Every export checked file by file; normal notes byte-for-byte the original CLI's output; sensitive notes stay locked (no plaintext anywhere), open only with their note password, to exactly the app's Download (~10 minutes) |
| `cli-transfer` | `cli/transfer.mjs` | moving all notes to another account (`-m export`, `-m import`): account A with every kind of note (rich text, pictures / audio, uploads incl. one labelled differently from its content and an uploaded .html, sensitive notes of every kind, odd / unicode names, empty, a note from before the metadata existed, two notes with the same name, 3 MB) exported and imported into account B: the transfer folder (one private file per note, nothing readable, no names, opens only with A's master password), every note EXACTLY as in A (name, metadata incl. dates, content), nothing existing changed, round trip via the normal export, re-runs and partial failures add nothing twice, importing into the same account adds nothing, sub-folders / other files / other-password / damaged files, every prompt and error, other options ignored, Node 18, secrets hidden in a real terminal |
| `cli-regression` | `cli/regression.mjs` | the export CLI's existing modes behave EXACTLY as before `-m export` / `-m import` were added: the CLI from main (`518db4b`) and the current one run side by side with identical inputs in every mode and option combination of `-m on`, `-m on -x`, `-m off`, `-m sensitive`, on vaults without / with / with only sensitive notes - same exit code, same console output, byte-identical files and permissions, Drive untouched; the help only gains the new modes |
| `app-core` | `browser/app-core.test.cjs` | setup, unlock, notes, recovery codes, wall-clock session timeout, CSP, mobile image popup |
| `features` | `browser/features.test.cjs` | uploads/downloads, rename, search, save prompts, settings, menu; Argon2 runs for every recovery file; secrets not left in WASM memory; spellcheck off |
| `framing` | `browser/framing.test.cjs` | the app refuses to run inside another site's frame |
| `password-rules` | `browser/password-rules.test.cjs` | master password rules on setup and reset |
| `recovery-lockout` | `browser/recovery-lockout.test.cjs` | never locked out: 0/1 codes left, last-code reset, complete code sets, failure handling |
| `cli-roundtrip` | `browser/cli-roundtrip.test.cjs` | data created by the current app (notes, uploads, renames, deletes, recovery codes, a password reset) is exported by the current CLI in every mode, byte-for-byte equal to the app's own Download |
| `sensitive-notes` | `browser/sensitive-notes.test.cjs` | sensitive notes in the app: created sensitive with the padlock New / Upload buttons (password rules, cancel creates nothing), what Drive stores (two layers from the first write, no plaintext, `Sensitive` metadata, padlock in the file list), asked for its password every time it is opened (dropdown, search or Refresh; Cancel or a wrong password aborts and stays on the shown note), padlock always shown while open, a tampered note refused, save / refresh / switch prompts, download warning, password forgotten on leaving the page / logout, failure handling, no way to toggle, existing notes untouched byte-for-byte, CLI export as `<name>.sensitive` (current and pre-feature CLI), the PC-only "Decrypt Sensitive File" tool (local decrypt, no Drive calls), mobile |
| `cli-matrix` | `browser/cli-matrix.test.cjs` | end to end: the app makes normal and sensitive notes (text, text with embedded images, uploads), then the real CLI runs in every mode and option combination on that data (online `-t` / prompt / `-t` without a value / Node 18 / Drive miss / duplicate data / missing config / bad or empty token, `-x` mirror, offline folder / single file / `-c -n -d` / every partial wizard / bad paths / non-note files, wrong master password, usage errors). Normal notes = the app's Download byte-for-byte; sensitive notes = `<name>.sensitive` with no plaintext / image data, which decrypt (in Node and with the app's "Decrypt Sensitive File") to exactly the app's Download - also with the CLI's own `-m sensitive`, including the fully offline chain `-x` copy -> `-m off` -> `-m sensitive` |
| `media-parity` | `browser/media-parity.test.cjs` | a sensitive note can do everything a normal note can: the same steps in a normal and a sensitive rich text note give the same result at every step - Ctrl+V of a picture from the real clipboard (right after creating / reopening, and a screenshot-sized one), Ctrl+V of text, Insert Image, Insert Audio, pasting image / audio files, ✕ and Delete removal, Ctrl+Z / Ctrl+Y, the Undo / Redo / Bold / Italic / Underline buttons, Ctrl+S and "Nothing to save..", save + reopen, Search, Rename, Download, Delete; both end byte-identical (the sensitive one double encrypted); mobile ✕ with confirm and tap-to-open |
| `new-user` | `browser/new-user.test.cjs` | a brand-new user sees no change: the app from before sensitive notes (main, from git history) and the current app each set up a new account and are used the same way, side by side. The setup code is byte-for-byte unchanged; login, setup, unlock, settings and recovery-codes screens identical; setup writes the same Drive tree (folders, files, metadata, sizes, decrypted config / settings / recovery files, recovery-codes download) with the same Drive calls; normal notes (New, picture, Save, Upload, Rename, Delete, Settings) store byte-identical data with no `Sensitive` metadata; the main page / menu / `?` help only gain the new items; data made by either version opens unchanged in the other |
| `transfer` | `browser/transfer.test.cjs` | end to end: account A makes every kind of note in the app (normal and sensitive; text, pictures, audio, uploads incl. one without an extension and an .html file), `-m export`, a brand-new account B set up in the app (with a clashing note), `-m import`: in B's Drive every note is exactly A's (metadata incl. dates, content); in the app as B every note shows, opens (sensitive ones with their note password) and downloads exactly as in A; B's own note untouched; imported notes edit and save; importing again adds only what changed since |
| `google-signin` | `browser/google-signin.test.cjs` | Google's real sign-in script loads and opens its popup under the app's CSP with no violations (needs internet; skipped when offline) |
| `fonts` | `browser/fonts.test.cjs` | the font is self-hosted: no Google Fonts requests, CSP allows only local fonts, files match their recorded SHA-256, and (needs internet; skipped offline) text renders pixel-identical to Google Fonts' Nunito |
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
