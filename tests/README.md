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

(On Linux, `npx playwright install --with-deps chromium` also installs the
system libraries Chromium needs; it asks for your sudo password.)

Run just some suites with `--only` (repeatable), e.g.
`node tests/run-all.mjs --only crypto --only cli`. An unknown suite name is
refused (with the list of suites), so a typo never quietly runs nothing.

Several jobs run at once - by default one per CPU thread (10 on a 12-thread
machine with 15 GB), at most one per 1.5 GB of memory, at most 32. Each suite
is its own process with its own temp folder and fake Drive, each browser
suite gets its own `serve.py`, the slowest jobs start first, and each job's
output is printed in one piece when it ends, with its time; the summary lists
every suite's time. Choose the number with `--jobs N` (or `-j N`). `--jobs 1`
runs the suites one at a time in the listed order, whole, with the output shown
live, as before - handy when watching a single suite.

The long suites run as several parts at once, so the whole run gets faster
with every core added: a suite with a file `<suite>.parts.mjs` next to it
(e.g. `cli/options.parts.mjs`, `browser/recovery-lockout.test.parts.mjs`)
exporting `PARTS` is split into those parts - each its own job, chosen with the
environment variable `ENOTES_TEST_PART` (also handy to run one part by hand).
Each split suite checks that its parts file lists exactly its parts. To prove
that the parts together run exactly what the whole suite runs:

```bash
node tests/run-all.mjs --check-parts
```

runs every split suite both whole and in its parts (add `--only <suite>` for
one) and requires the same number of checks, all passing. Run it after
changing how a suite is split. Most of the time goes into checking recovery
codes and every export with the slow Argon2 key derivation, on purpose.

## What is covered

| Suite | File | Checks |
|---|---|---|
| `verify` | `src/export/verify.mjs` | the export CLI bundle was rebuilt after its sources changed |
| `crypto` | `crypto.test.mjs` | encrypt/decrypt, data from the original app still decrypts, missing passwords refused, secrets wiped from WASM memory, no insecure random fallback, `crypto.wasm` stripped |
| `runner` | `runner.test.mjs` | the test runner itself (`run-all.mjs`, `lib/pool.mjs`, `lib/serve.mjs`): never more than `--jobs` jobs at once, every suite once, results in order, a failure stops new starts; `--jobs` / `-j` / `--jobs=` and bad values refused; the default (one per CPU thread, memory-capped, 1-32); each browser suite's own `serve.py` - several at once on different ports, and when handed a port another server holds it notices the answer isn't its own and moves on; suites split into parts: the parts file found next to a suite (`<suite>.parts.mjs`), a bad one refused, `cli-options`' parts (each vault's groups + the rest), an unknown part refused, checks counted from a suite's output, `--check-parts`; unknown `--only` names refused; end to end: `--jobs 1` live output as before, several suites at once (browser + node) each printed in one unbroken block, summary with times |
| `cli` | `cli/run.mjs` | every export CLI mode produces byte-for-byte the same files as the original CLI (from git history, commit `419c522`) - on notes holding real pictures, an audio clip, a PDF and a video, each exported file checked against its sample by SHA-256 - plus private file modes, hidden token prompt, safe mirror paths, Node 18 |
| `sensitive` | `sensitive.test.mjs` | sensitive notes without a browser: the envelope format, both encryption layers (note password inside, file password outside), the shared export rules (`<name>.sensitive`), the CLI's offline export of a sensitive note; every real sample as an upload (exported byte for byte, with or without an extension), as a sensitive note (two layers, nothing readable without the note password, back byte for byte with it) and all pictures and clips in one rich text note (exported in order, byte for byte) |
| `cli-options` | `cli/options.mjs` | the export CLI with EVERY option combination (offline `-c -d`, `-c -n` for every note, `-c -n -d`, every partial wizard and answer, bad / wrong-type / empty paths, wrong master password, ignored extra flags; online `-t`, token prompt, `-t` without a value, empty / bad token, wrong master password, duplicate trees + an older config.json with another key, a momentary Drive miss, config.json missing; `-x` mirror with `-t` / prompt / bad token, offline export from the mirror; Node 18; usage errors; `--help`; and `-m sensitive`: export folder, single files, asked-for / bad path, wrong / master / file password then right, Enter skips, not-a-sensitive-file, `-x` copy files, an original-CLI export, name clashes, no password option, ignored flags, Node 18, password hidden in a real terminal) on four vaults: no sensitive notes, mixed, only sensitive, and output-name clashes. Every export checked file by file; normal notes byte-for-byte the original CLI's output; sensitive notes stay locked (no plaintext anywhere), open only with their note password, to exactly the app's Download (~10 minutes) |
| `cli-transfer` | `cli/transfer.mjs` | moving all notes to another account (`-m export`, `-m import`): account A with every kind of note (rich text, pictures / audio, uploads incl. one labelled differently from its content and an uploaded .html, sensitive notes of every kind, odd / unicode names, empty, a note from before the metadata existed, two notes with the same name, 3 MB) exported and imported into account B: the transfer folder (made where the command is run, named with the date and time - no folder asked, never written into if it already exists; one private file per note, nothing readable, no names, opens only with A's master password), every note EXACTLY as in A (name, metadata incl. dates, content), nothing existing changed, round trip via the normal export, re-runs and partial failures add nothing twice, importing into the same account adds nothing, sub-folders / other files / other-password / damaged files, every prompt and error, other options ignored, Node 18, secrets hidden in a real terminal |
| `cli-regression` | `cli/regression.mjs` | the export CLI's existing modes behave EXACTLY as before `-m export` / `-m import` were added: the CLI from main (`518db4b`) and the current one run side by side with identical inputs in every mode and option combination of `-m on`, `-m on -x`, `-m off`, `-m sensitive`, on vaults without / with / with only sensitive notes - same exit code, same console output, byte-identical files and permissions, Drive untouched; the help only gains the new modes; and `-m export` / `-m import` EXACTLY as the CLI on main before `-m rotate` (`2b77f16`), side by side (export of three vaults, every error, other options, Node 18; import into another account with a name clash, answers n / Enter, again, into its own account, notes Drive refuses, wrong passwords, bad token, wrong folders, Node 18): same exit code and output, the same files with the same permissions and the same notes in them, the same Drive afterwards |
| `cli-rotate` | `cli/rotate.mjs` | `-m rotate`, a new file password for the same account: an account with EVERY kind of note, made from the REAL sample files (see Notes) - rich text (text only; text with pictures; text with audio clips; text, pictures and clips all mixed up, a video among them; pictures only; clips only; pictures and clips; empty) and uploads (JPEG, PNG, GIF, WebP, a picture without an extension, MP3, WAV, Ogg, M4A, MP4, WebM, PDF, text file, web page, binary data, 1 MB file), each normal AND sensitive, plus odd / unicode names, two notes with the same name, one from before the metadata existed, unknown metadata keys (53 notes) and its own settings is rotated - the backup is the account's data byte for byte, the saved notes and settings open with the master password exactly, the data is deleted only after the check and the typed `WIPE <e-mail>`, and after the (fake) set-up every note is back EXACTLY (same names, also the two same-named ones, metadata incl. dates, content - also compared as SHA-256 fingerprints before, in the saved copy and after; and every picture, clip and file inside every note - sensitive ones opened with their note password - byte for byte its original sample, in order) under the NEW file password (the old one opens none), the settings carried over with the app's metadata, the new config.json / recovery codes untouched, the rotation folder private, nothing secret printed; its transfer/ is a normal `-m import` folder. Every guard: a wrong / empty confirmation, wrong password, bad / no token, no data, a damaged note, data it wouldn't carry over (2nd tree with files, 2nd Entries, other folders) - nothing deleted; an empty leftover tree deleted too; same minute; other options ignored. Stopping after the deletion and finishing later (no token, answer n, wrong passwords, the old token before the set-up, another account's token, saved notes damaged); failures: the deletion, notes Drive refuses, the settings - each then finished by running it again, nothing twice. Settings missing / unreadable, no notes, Node 18, usage, help |
| `app-core` | `browser/app-core.test.cjs` | setup, unlock, notes, recovery codes, wall-clock session timeout, CSP, mobile image popup |
| `features` | `browser/features.test.cjs` | uploads/downloads of real files (a picture, an audio clip, a video, a PDF, a text file: each shown as it should be - pictures decode at their size, clips play for their length - and downloaded byte for byte), a real picture and clip inserted in a note, rename, search, save prompts, settings, menu; Argon2 runs for every recovery file; secrets (the master password, a note's text and its picture) not left in WASM memory; spellcheck off |
| `framing` | `browser/framing.test.cjs` | the app refuses to run inside another site's frame |
| `password-rules` | `browser/password-rules.test.cjs` | master password rules on setup and reset |
| `recovery-lockout` | `browser/recovery-lockout.test.cjs` | never locked out: 0/1 codes left, last-code reset, complete code sets, failure handling |
| `cli-roundtrip` | `browser/cli-roundtrip.test.cjs` | data created by the current app (notes with a real picture and audio clip, real uploads - picture, PDF, video -, renames, deletes, recovery codes, a password reset) is exported by the current CLI in every mode, byte-for-byte equal to the app's own Download |
| `sensitive-notes` | `browser/sensitive-notes.test.cjs` | sensitive notes in the app: created sensitive with the padlock New / Upload buttons (password rules, cancel creates nothing), what Drive stores (two layers from the first write, no plaintext, `Sensitive` metadata, padlock in the file list), asked for its password every time it is opened (dropdown, search or Refresh; Cancel or a wrong password aborts and stays on the shown note), padlock always shown while open, a tampered note refused, save / refresh / switch prompts, download warning, password forgotten on leaving the page / logout, failure handling, no way to toggle, existing notes untouched byte-for-byte, CLI export as `<name>.sensitive` (current and pre-feature CLI), the PC-only "Decrypt Sensitive File" tool (local decrypt, no Drive calls), mobile |
| `cli-matrix` | `browser/cli-matrix.test.cjs` | end to end: the app makes normal and sensitive notes from real sample files (text, text with embedded pictures and an audio clip, uploads), then the real CLI runs in every mode and option combination on that data (online `-t` / prompt / `-t` without a value / Node 18 / Drive miss / duplicate data / missing config / bad or empty token, `-x` mirror, offline folder / single file / `-c -n -d` / every partial wizard / bad paths / non-note files, wrong master password, usage errors). Normal notes = the app's Download byte-for-byte; sensitive notes = `<name>.sensitive` with no plaintext / image data, which decrypt (in Node and with the app's "Decrypt Sensitive File") to exactly the app's Download - also with the CLI's own `-m sensitive`, including the fully offline chain `-x` copy -> `-m off` -> `-m sensitive` |
| `media-parity` | `browser/media-parity.test.cjs` | a sensitive note can do everything a normal note can: the same steps in a normal and a sensitive rich text note give the same result at every step - Ctrl+V of a picture from the real clipboard (right after creating / reopening, and a screenshot-sized one), Ctrl+V of text, Insert Image, Insert Audio, pasting image / audio files, ✕ and Delete removal, Ctrl+Z / Ctrl+Y, the Undo / Redo / Bold / Italic / Underline buttons, Ctrl+S and "Nothing to save..", save + reopen, Search, Rename, Download, Delete; both end byte-identical (the sensitive one double encrypted); mobile ✕ with confirm and tap-to-open |
| `new-user` | `browser/new-user.test.cjs` | a brand-new user sees no change: the app from before sensitive notes (main, from git history) and the current app each set up a new account and are used the same way, side by side. The setup code is byte-for-byte unchanged; login, setup, unlock, settings and recovery-codes screens identical; setup writes the same Drive tree (folders, files, metadata, sizes, decrypted config / settings / recovery files, recovery-codes download) with the same Drive calls; normal notes (New, picture, Save, Upload, Rename, Delete, Settings) store byte-identical data with no `Sensitive` metadata; the main page / menu / `?` help only gain the new items; data made by either version opens unchanged in the other |
| `transfer` | `browser/transfer.test.cjs` | end to end: account A makes every kind of note in the app from real sample files (normal and sensitive; text, pictures, audio clips, uploads - pictures, one without an extension, PDF, video, audio, an .html file - each checked: pictures decode at their size, clips play for their length, all byte for byte), `-m export`, a brand-new account B set up in the app (with a clashing note), `-m import`: in B's Drive every note is exactly A's (metadata incl. dates, content); in the app as B every note shows, opens (sensitive ones with their note password) and downloads exactly as in A; B's own note untouched; imported notes edit and save; importing again adds only what changed since |
| `rotate` | `browser/rotate.test.cjs` | end to end, in three parts (rich text notes / uploaded pictures and audio clips / uploaded videos and documents, each the whole rotation): an account makes in the app, from the REAL sample files (see Notes), every kind of note of its part - rich text (text only; text with pictures; text with audio clips; text, pictures and clips all mixed up, a video among them; pictures only; clips only; pictures and clips; empty) or uploads (JPEG, PNG, GIF, WebP, a picture without an extension, MP3, WAV, Ogg, M4A / MP4, WebM, PDF, text file, web page, binary data) - each normal AND sensitive; every note is checked against its samples (every picture decodes at its size, every clip plays for its length, each is byte for byte its sample by SHA-256, an upload downloads as exactly its file, nothing readable in Drive); it sets a dark theme and a longer timeout; `-m rotate` deletes its data after the checks and the confirmation and stops for the set-up; the app sets the account up again (a NEW file password, new recovery codes); `-m rotate` run again finishes. In Drive every note is exactly as before under the new file password (also by SHA-256 of every note's content), which the old one doesn't open; in the app the same file list, every note shows, opens (sensitive ones with their note password) and downloads exactly as before (SHA-256 of every Download) and is still exactly its samples, the theme and timeout are back, a sensitive note edits / a sensitive file uploads and saves; recovery codes: in Drive all 10 new codes each open their own recovery file holding the NEW file password (the put-back deleted / changed none), none of the 10 old codes opens anything, the app refuses an old code, a new code resets the master password and the notes (normal and sensitive, real samples) open exactly as before after it, that code is then used up and the other 9 still work |
| `lifecycle` | `browser/lifecycle.test.cjs` | everything together, in seven parts (rich text / uploaded pictures and audio clips / uploaded videos and documents, each normal and sensitive, and one account with all of them mixed - each the whole chain): the notes are made in the app from the REAL sample files (see Notes) - every kind: text only; text with pictures; text with audio clips; text, pictures and clips all mixed up, a video among them; pictures only; clips only; pictures and clips; empty; and every sample uploaded - and first checked against their samples: the samples are real (every picture decodes at its size, every audio / video clip plays for its length, the PDF has its 2 pages and their text), in the app every picture decodes and every clip plays as its sample, each byte for byte its sample by SHA-256 in order, every upload downloads as exactly its file, nothing readable anywhere in Drive. The app's own Download of each is then the truth every step is compared with, by SHA-256: `-m on` (sensitive notes still locked, no plaintext; `-m sensitive` opens them to exactly the Download); `-m on -x` = Drive byte for byte, then `-m off` on that copy (whole folder and every note on its own) and `-m sensitive`; `-m export`, a second account set up in the app, `-m import` - in the app every note shows, opens and downloads exactly as before and is still exactly its samples; `-m rotate` on that account (set up again with a new master password) - the same in the app, the old file password opens nothing; then `-m on`, `-m on -x` + `-m off` on the rotated account, and the first copy offline again - all exactly the same |
| `google-signin` | `browser/google-signin.test.cjs` | Google's real sign-in script loads and opens its popup under the app's CSP with no violations (needs internet; skipped when offline) |
| `fonts` | `browser/fonts.test.cjs` | the font is self-hosted: no Google Fonts requests, CSP allows only local fonts, files match their recorded SHA-256, and (needs internet; skipped offline) text renders pixel-identical to Google Fonts' Nunito |
| `settings` | `browser/settings.test.cjs` | the Settings page re-reads the settings from Drive when it opens; while it does (the lookup, then the download, both slowed down on purpose in the fake Drive) the timeout field, the theme and Save are disabled and typing changes nothing, Cancel / Escape work; then Drive's copy is shown. A change made at once is never undone by that read; leaving while it loads, coming back and saving: the late read is ignored (nothing more read, no 'Loading...' over the main page); a failed read leaves the settings usable; validation unchanged. The same steps on the app before the fix (`518db4b`) must show the old bug (the change lost, or the save undone in the app) - proof the checks catch it |
| `data-safety` | `browser/data-safety.test.cjs` | Drive glitches and duplicate / missing files never create a second config.json, never start setup over existing data, never delete the only key to the notes |

## Notes

- The browser suites serve `www/` with `serve.py` on a free local port and
  drive it with Playwright (Chromium). Shared fake-Drive / sign-in code lives in
  `browser/lib/harness.cjs`, which can also make Drive calls fail on purpose to
  test error handling.
- `fixtures/media/` holds REAL sample files (240 KB): pictures (JPEG 320x240,
  PNG 200x150 with transparency, animated GIF, WebP), audio clips (MP3 2 s, WAV
  1 s, Ogg Opus 1.5 s, M4A / AAC 1 s), video clips with sound (MP4 H.264 + AAC,
  WebM VP9 + Opus, 2 s), a two-page PDF with text and a picture (and a one-page
  one only sensitive notes hold), a UTF-8 text file, a web page and random
  binary data. `make-media.sh` there shows how they
  were made (ffmpeg, Pillow, reportlab - only to remake them; the tests just
  read them). `lib/media.cjs` pins each file's SHA-256 (a changed sample stops
  the tests), lists the kinds of note made from them (`RICH`, `UPLOADS`) and has
  the checks the end-to-end suites share: the samples are real (decode / play
  in the browser, the PDF's pages and text), what an open note shows (every
  picture's decoded size, every clip's length, each matched to its sample by
  SHA-256) and that no plaintext of them leaks. EVERY suite that uses a picture,
  audio / video clip or file uses these samples (the only stand-ins left are
  deliberate: crafted attack strings in `app-core`'s security checks, tiny edge
  cases in `sensitive`'s format checks, and pictures the browser draws for the
  real-clipboard paste in `media-parity`).
- `fixtures/ciphertext-from-original-app.txt` was encrypted by the app's
  original code (password `MyMasterPassw0rd!!`); it guards compatibility with
  data already stored in Drive.
- The CLI tests need the full git history (they read the original CLI from
  commit `419c522`) and use a pseudo-terminal check that is skipped on Windows.
