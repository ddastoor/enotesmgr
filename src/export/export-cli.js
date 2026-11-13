// enotesmgr-export-cli — entry source for the self-contained Node export CLI.
//
// build.mjs bundles this (+ the canonical www/ crypto + the WASI shim) and
// inlines the base64 wasm into a single www/enotesmgr-export-cli.js that runs
// with `node enotesmgr-export-cli.js` and needs NO npm install (only Node 18+
// built-ins).
//
// It decrypts the user's eNotes notes and dumps them to a fresh output dir, in
// three modes (run it with --help for the full help):
//   online    (-m on):  read every note from Google Drive using an export token,
//                       and write them DECRYPTED locally — OR, with -x, mirror the
//                       whole 'eNotes Manager' Drive tree locally, still encrypted.
//   offline   (-m off): read a local config.json + local encrypted note file(s).
//   sensitive (-m sensitive): decrypt "<name>.sensitive" files (sensitive notes
//                       that the other modes wrote still locked with their own
//                       note password) - asks each note's password.
//   export    (-m export) / import (-m import): move all notes to another
//                       account. Export writes every note EXACTLY as the app
//                       stores it (name, metadata, content) into transfer files
//                       locked with the account's master password; import adds
//                       them to another account as they were. Import only ever
//                       ADDS notes.
//   rotate    (-m rotate): give an account a NEW file password: back up, save and
//                       check everything, then (after a typed confirmation) delete
//                       the account's data, let the app set it up anew, and put
//                       every note and the settings back. Import and rotate are the
//                       only modes that write to Drive.
//
// Online auth = token hand-off (no OAuth in the CLI, the most future-proof
// option): the SPA already signs in via Google's maintained GIS library and
// holds a valid Drive access token (drive.appdata by default, or drive.file —
// see STORAGE_MODE below). The user copies it from the app's menu ("Copy Export
// Token", PC-only) and pastes it here (or passes -t <token>). The CLI just calls
// the Drive REST API with that token — so it has zero OAuth surface to be
// deprecated, and needs no client id, secret, or redirect URI.
import { cryptoReady, decryptData, encryptVerified } from "../../www/js/crypto/crypto.js";
// The note -> output-file decision (type, filename, html wrapping, byte decoding)
// is shared with the in-app Download button so the two produce identical output.
import { buildNoteExport, sanitizeName } from "../../www/js/lib/noteExport.js";
import { isSensitiveContent, findSensitivePayload, sensitiveBaseName } from "../../www/js/lib/sensitiveNote.js";
// The metadata the app writes on its own files (settings.json): -m rotate writes it the same way.
import { createAppMeta, updateAppMeta } from "../../www/js/lib/meta.js";
import {
    mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import readline from "node:readline";

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

// WHERE the "eNotes Manager" tree lives in Drive. Must match the web app's
// www/js/lib/driveConfig.js (the CLI keeps its own copy because it is a
// self-contained bundle). "appdata" -> hidden Application Data folder
// (appDataFolder), the default; "drivefile" -> visible Drive root.
const STORAGE_MODE = "appdata"; // "appdata" | "drivefile"
const STORAGE = {
    appdata: { rootParent: "appDataFolder", spaces: "appDataFolder" },
    drivefile: { rootParent: "root", spaces: "drive" },
}[STORAGE_MODE];

// --- CLI args ----------------------------------------------------------------
function parseArgs(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        const v = argv[i + 1];
        switch (k) {
            case "-m": a.m = v; i++; break;
            case "-t": a.t = v; i++; break;
            case "-c": a.c = v; i++; break;
            case "-n": a.n = v; i++; break;
            case "-d": a.d = v; i++; break;
            case "-s": a.s = v; i++; break;
            case "-x": a.x = true; break; // flag, no value
            case "-h": case "--help": a.h = true; break;
        }
    }
    return a;
}

const USAGE =
    "Usage:\n" +
    "  Online:    node enotesmgr-export-cli.js -m on  [-t <export-token>] [-x]\n" +
    "             (get the token from the app menu: 'Copy Export Token' - PC only,\n" +
    "              valid about 1 hour; without -t you are asked to paste it)\n" +
    "             without -x: export all notes, decrypted, into 'eNotes Manager Export_<date>'\n" +
    "             with -x:    download the whole 'eNotes Manager' Drive folder as a dated,\n" +
    "                         still-encrypted LOCAL copy 'eNotes Manager_<date>', then exit\n" +
    "  Offline:   node enotesmgr-export-cli.js -m off   (interactive wizard; optionally\n" +
    "             pre-fill with -c <config.json> and -n <note-file> | -d <notes-dir>)\n" +
    "             Works on a local copy made earlier with '-m on -x' (no internet needed):\n" +
    "               -c \"eNotes Manager_<date>/Config/config.json\"\n" +
    "               -d \"eNotes Manager_<date>/Entries\"\n" +
    "             config.json is not downloadable from the Google Drive website (the app\n" +
    "             keeps its data in Drive's hidden app-data area): '-m on -x' is the way.\n" +
    "             Use the master password that was in use when that copy was made.\n" +
    "  Sensitive: node enotesmgr-export-cli.js -m sensitive [-s <file.sensitive | folder>]\n" +
    "             decrypt sensitive notes, which the modes above export still locked with\n" +
    "             their own password as <name>.sensitive (asks each note's password).\n" +
    "             In the app (PC): menu > 'Decrypt Sensitive File' does the same.\n" +
    "  Move all notes to another account (online; everything is asked):\n" +
    "             node enotesmgr-export-cli.js -m export   (logged in as the OLD account)\n" +
    "             node enotesmgr-export-cli.js -m import   (logged in as the NEW account)\n" +
    "  Rotate the file password (online; everything is asked):\n" +
    "             node enotesmgr-export-cli.js -m rotate\n" +
    "  Help:      node enotesmgr-export-cli.js --help\n";

function usageExit(msg) {
    if (msg) console.error("Error: " + msg + "\n");
    console.error(USAGE + "\nRun 'node enotesmgr-export-cli.js --help' for the full help.\n");
    process.exit(1);
}

// -h / --help: the full documentation, on stdout.
const HELP = `eNotesMgr export utility  -  enotesmgr-export-cli.js

  Saves your eNotesMgr notes as files on this computer, moves them to another
  account, or gives your account a new file password.
  It needs only Node.js 18 or newer: nothing to install, no other files.


USAGE - what do you want to do?

  Save all my notes as readable files:
      node enotesmgr-export-cli.js -m on

  Keep an encrypted copy of my data (a backup):
      node enotesmgr-export-cli.js -m on -x

  Read notes from that copy, offline:
      node enotesmgr-export-cli.js -m off

  Open my sensitive notes (<name>.sensitive files):
      node enotesmgr-export-cli.js -m sensitive

  Move all my notes to another account:
      node enotesmgr-export-cli.js -m export     (logged in as the OLD account)
      node enotesmgr-export-cli.js -m import     (logged in as the NEW account)

  Give my account a new file password (and new recovery codes):
      node enotesmgr-export-cli.js -m rotate

  Show this help:
      node enotesmgr-export-cli.js --help

  The utility asks for everything it needs. Passwords and the export token
  are typed at hidden prompts.


THE EXPORT TOKEN

  The online modes (-m on, -m export, -m import, -m rotate) need an export
  token: open the app on a PC, log in, open the menu and pick
  'Copy Export Token', then paste it when asked. It is valid about 1 hour.


MODES

  -m on
      Reads all your notes from Google Drive and saves them, decrypted, in a
      new folder 'eNotes Manager Export_<date>'.
      Asks for: the export token and your master password.

  -m on -x
      Downloads your whole 'eNotes Manager' data from Google Drive, still
      encrypted, into a new folder 'eNotes Manager_<date>': a copy for backup
      and for offline use.
      Asks for: the export token only (nothing is decrypted).

  -m off
      Works offline (no internet): decrypts notes from a copy made with
      '-m on -x' and saves them in a new folder 'eNotes Manager Export_<date>'.
      Asks for: the copy's config.json, one note file or the whole folder of
      notes, and the master password that was in use when the copy was made
      (anything not given as an option).

  -m sensitive
      Opens sensitive notes. The modes above save a sensitive note still
      locked with its own note password, as <name>.sensitive. This mode asks
      for each note's password (just Enter skips a note) and saves the
      readable notes in a new folder 'eNotes Manager Sensitive_<date>'.
      No internet, no master password needed.
      (In the app, on a PC: menu > 'Decrypt Sensitive File' does the same.)

  -m export
      Saves ALL notes of an account, for moving them to another account: one
      file per note, exactly as the app stores it (name, content, type, dates,
      sensitive or not), in a new folder 'eNotes Manager Transfer_<date>'.
      The files are locked with that account's master password. Only reads
      Google Drive.
      Asks for: the export token and the master password.

  -m import
      Adds the notes of such a transfer folder to an account (set it up in the
      app first), each exactly as it was - as if made there by hand.
      - A note that is already there, identical, is skipped: running it again
        adds nothing twice.
      - A note whose name is taken gets " (1)", " (2)"... before its extension.
      - Existing notes are never changed or deleted.
      - Only the folder's own transfer files are read (not sub-folders).
      Asks for: the transfer folder, the master password of the OLD account
      (that locked the files), the export token and the master password of
      the NEW account, and a final yes.

  -m rotate
      Gives your account a NEW file password - the key all your notes are
      encrypted with - and new recovery codes. Every note (name, content,
      details) and your settings (theme, session timeout) stay exactly as
      they are. Everything is kept in one new folder
      'eNotes Manager Rotation_<date>':
        1. it backs up your data, still encrypted (like -m on -x);
        2. it saves every note and your settings, locked with your master
           password;
        3. it reads it all back to check it;
        4. only then, after you type 'WIPE <your e-mail>', it deletes your
           eNotesMgr data in Google Drive (like the app's 'Wipe all App Data');
        5. you set the account up again in the app - that makes the new file
           password and new recovery codes - and paste a new export token;
        6. it puts every note and your settings back, and checks them.
      If it stops after step 4, nothing is lost: run '-m rotate' again in the
      same folder to finish. Close eNotesMgr on your other devices first.
      Asks for: the export token, the master password, the confirmation, then
      the new export token and the new master password.


OPTIONS

  -t <token>    (-m on) the export token. Without it you are asked to paste it.
  -x            (-m on) make the encrypted copy instead of decrypting.
  -c <file>     (-m off) the config.json of a copy, e.g.
                "eNotes Manager_<date>/Config/config.json"
  -d <folder>   (-m off) a folder of note files, e.g.
                "eNotes Manager_<date>/Entries"
  -n <file>     (-m off) one note file from that folder (if -d is given too,
                -d wins).
  -s <path>     (-m sensitive) a .sensitive file, or a folder holding them
                (e.g. an 'eNotes Manager Export_<date>' folder).
  -h, --help    show this help.

  -m export, -m import and -m rotate take no options: everything is asked.
  Options that don't apply to the chosen mode are ignored. A path that
  doesn't exist is asked for again.


WHERE config.json COMES FROM

  The app keeps its data in Google Drive's hidden app-data area, so
  config.json can't be downloaded from the Google Drive website. Make a local
  copy with
      node enotesmgr-export-cli.js -m on -x
  and give '-m off' its Config/config.json and its Entries folder. A copy is
  a snapshot: run '-m on -x' again to include newer notes. It opens with the
  master password that was in use when the copy was made.


WHAT YOU GET

  Rich text note   ->  <name>.html: looks as it did in the app, with its
                       pictures and audio built in.
  Uploaded file    ->  the original file under its own name (photo.png,
                       doc.pdf...).
  Sensitive note   ->  <name>.sensitive, still locked with its own password;
                       '-m sensitive' turns it into <name>.html or the
                       original file.

  Names that clash get " (1)", " (2)"... - nothing is ever overwritten.


SECURITY

  - Passwords and the export token are only ever typed at hidden prompts.
    There are no options for them on purpose: they would stay in your shell
    history and be visible to other programs.
  - Everything written is private to you (folders 700, files 600; except on
    Windows, which doesn't use these permissions).
  - Decrypted files are NOT encrypted: delete them when you no longer need
    them.
  - Only '-m import' and '-m rotate' write to Google Drive. '-m import' only
    adds new notes. '-m rotate' deletes your eNotesMgr data there only after
    everything is backed up, saved and checked and you typed the
    confirmation, and then puts it all back. Otherwise the utility
    never changes or deletes anything there.


EXAMPLES

  Save everything from Drive, decrypted:
      node enotesmgr-export-cli.js -m on

  Make a local encrypted copy (backup / for offline use):
      node enotesmgr-export-cli.js -m on -x

  Read notes from that copy later, offline:
      node enotesmgr-export-cli.js -m off -c "eNotes Manager_20260110_0930/Config/config.json" -d "eNotes Manager_20260110_0930/Entries"

  Then open the sensitive notes it saved:
      node enotesmgr-export-cli.js -m sensitive -s "eNotes Manager Export_20260110_0945"

  Move all your notes to another account:
      node enotesmgr-export-cli.js -m export
          (asks: token + master password of the OLD account)
      node enotesmgr-export-cli.js -m import
          (asks: the transfer folder, the OLD master password,
           token + master password of the NEW account)

  Give your account a new file password (and new recovery codes):
      node enotesmgr-export-cli.js -m rotate
`;

// --- prompts -----------------------------------------------------------------
// One shared readline interface with a persistent line queue. Using a fresh
// interface (or rl.question) per prompt drops buffered stdin between prompts,
// which breaks the offline wizard when answers are piped in. Here a single
// 'line' listener feeds a queue, and each prompt pulls the next line. We write
// the query ourselves and mute echo for hidden inputs. Must be closed at the end
// or the open stdin keeps the process alive.
let _rl = null, _muting = false, _waiter = null, _inputEnded = false;
const _queue = [];
function initRl() {
    if (_rl) return;
    _rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    _rl._writeToOutput = (s) => { if (!_muting) _rl.output.write(s); };
    _rl.on("line", (line) => {
        if (_waiter) { const w = _waiter; _waiter = null; w(line); }
        else _queue.push(line);
    });
    _rl.on("close", () => { _inputEnded = true; if (_waiter) { const w = _waiter; _waiter = null; w(""); } });
}
// True once the input has ended (e.g. piped input used up) and no answer is left
// to read: a prompt then could only get "". Used by -m rotate to stop cleanly.
const inputUsedUp = () => _inputEnded && !_queue.length;
function nextLine() {
    initRl();
    return _queue.length ? Promise.resolve(_queue.shift())
                         : new Promise((res) => { _waiter = res; });
}
function closeRl() { if (_rl) { _rl.close(); _rl = null; } }

async function promptVisible(query) {
    initRl();
    process.stdout.write(query);
    return (await nextLine()).trim();
}

async function promptHidden(query) {
    initRl();
    process.stdout.write(query);
    _muting = true;
    const line = await nextLine();
    _muting = false;
    process.stdout.write("\n");
    return line;
}

// --- output dir --------------------------------------------------------------
// Everything the CLI writes is private to the current user: folders 0700, files
// 0600 (decrypted notes would otherwise be readable by other users on the same
// machine under a typical 022 umask). Windows ignores these modes.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const pad = (n) => String(n).padStart(2, "0");
function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function makeRootDir(prefix = "eNotes Manager Export") {
    const dir = `${prefix}_${stamp()}`;
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    return dir;
}

// --- output files ----------------------------------------------------------
// Avoid overwriting: if `filename` already exists in `dir`, add a " (n)" suffix.
function uniquePath(dir, filename) {
    let candidate = join(dir, filename);
    if (!existsSync(candidate)) return candidate;
    const ext = extname(filename);
    const stem = filename.slice(0, filename.length - ext.length);
    for (let i = 1; ; i++) {
        candidate = join(dir, `${stem} (${i})${ext}`);
        if (!existsSync(candidate)) return candidate;
    }
}

// Decrypted `content` -> a file in the output dir. The type/filename/bytes are
// decided by the shared buildNoteExport (same logic the app's Download uses).
// Returns the path written.
function writeNote(rootDir, noteName, content) {
    const { filename, bytes } = buildNoteExport(noteName, content);
    const out = uniquePath(rootDir, filename);
    writeFileSync(out, bytes, { mode: FILE_MODE });
    if (isSensitiveContent(content)) sensitiveCount++;
    return out;
}

// Sensitive notes (an extra per-note password, see sensitive-notes.md) can only be
// unlocked with the file password here: they are written still locked with
// their note password, as "<name>.sensitive". Tell the user how to open them.
let sensitiveCount = 0;
function sensitiveHint(rootDir) {
    if (!sensitiveCount) return;
    console.log(`\n${sensitiveCount} sensitive note(s) were saved still locked with their own note password (*.sensitive).` +
        `\nTo read them: node enotesmgr-export-cli.js -m sensitive -s "${rootDir}"` +
        `\n(or open eNotesMgr on a PC, menu > 'Decrypt Sensitive File', pick the file and enter that note's password).`);
}

// --- Drive REST (online) -----------------------------------------------------
async function driveGet(url, token) {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 401) throw new Error("Drive rejected the export token (expired or invalid). In the app, log in again and re-copy the token (it is valid ~1 hour).");
    if (!r.ok) throw new Error(`Drive request failed (${r.status}): ${url}`);
    return r;
}
const escQ = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// ALL items named `name` under parentId (Drive allows same-named duplicates).
async function findChildren(name, parentId, token, folderOnly) {
    let q = `name='${escQ(name)}' and '${parentId}' in parents and trashed=false`;
    if (folderOnly) q += ` and mimeType='application/vnd.google-apps.folder'`;
    const url = `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,appProperties)&spaces=${STORAGE.spaces}`;
    const j = await (await driveGet(url, token)).json();
    return j.files || [];
}

// --- choosing folders / config.json the SAME way the app does --------------
// (www/js/flow.js and www/js/pages/masterPassword.js; see
// instructions/data-storage.md "Never lose existing data"). With exactly one of
// each - the normal case - this is simply that one. The CLI only reads.
const RECHECK_DELAY_MS = 1200;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// If nothing is found, look again once after a short pause (a momentary Drive
// miss must not make the export fail or pick the wrong thing).
async function findAllConfirmed(name, parentId, token, folderOnly) {
    const found = await findChildren(name, parentId, token, folderOnly);
    if (found.length) return found;
    await pause(RECHECK_DELAY_MS);
    return findChildren(name, parentId, token, folderOnly);
}

// The "eNotes Manager" tree holding the data: one with a config.json first,
// then the most notes; ties: the first listed. Returns { manager, others }.
async function pickManager(token) {
    const managers = await findAllConfirmed("eNotes Manager", STORAGE.rootParent, token, true);
    if (!managers.length) throw new Error("Could not find the 'eNotes Manager' folder for this account.");
    if (managers.length === 1) return { manager: managers[0], others: 0 };
    let best = managers[0], bestScore = -1;
    for (const m of managers) {
        let score = 0;
        const cfg = (await findChildren("Config", m.id, token, true))[0];
        if (cfg && (await findChildren("config.json", cfg.id, token, false)).length) score += 1e6;
        const ent = (await findChildren("Entries", m.id, token, true))[0];
        if (ent) score += (await listChildren(ent.id, token)).length;
        if (score > bestScore) { best = m; bestScore = score; }
    }
    return { manager: best, others: managers.length - 1 };
}

// A subfolder of the tree; of duplicates, the one with the most items.
async function pickSubfolder(name, managerId, token) {
    const found = await findAllConfirmed(name, managerId, token, true);
    if (found.length <= 1) return found[0];
    let best = found[0], bestCount = -1;
    for (const f of found) {
        const n = (await listChildren(f.id, token)).length;
        if (n > bestCount) { best = f; bestCount = n; }
    }
    return best;
}

// The file password, from the config.json copies (normally exactly one). Of the
// copies that open with the master password: the one whose key opens the notes
// (up to 5 tried), else the oldest (DateTimeCreated), else the first.
// opts.master: the master password, already asked by the caller (export /
// import label the prompt themselves); otherwise it is asked here.
async function pickFilePassword(configFiles, entries, token, opts = {}) {
    const master = opts.master !== undefined ? opts.master : await promptHidden("Master password (hidden): ");
    const opened = [];
    for (const f of configFiles) {
        try {
            const fp = JSON.parse(decryptData(await downloadText(f.id, token), master)).file_password;
            if (typeof fp === "string" && fp) opened.push({ f, fp });
        } catch { /* not this password's copy */ }
    }
    if (!opened.length) throw new Error("Could not decrypt config.json — wrong master password or wrong/corrupt config file.");
    const byAge = [...opened].sort((a, b) =>
        ((a.f.appProperties || {}).DateTimeCreated || "9999").localeCompare((b.f.appProperties || {}).DateTimeCreated || "9999"));
    const keys = [...new Set(opened.map((o) => o.fp))];
    if (keys.length > 1) {
        for (const e of entries.slice(0, 5)) {
            let cipher;
            try { cipher = await downloadText(e.id, token); } catch { continue; }
            const opens = keys.filter((k) => { try { decryptData(cipher, k); return true; } catch { return false; } });
            if (opens.length === 1) return opens[0];
        }
    }
    return byAge[0].fp;
}

async function listChildren(parentId, token) {
    const out = [];
    let pageToken = "";
    do {
        const q = `'${parentId}' in parents and trashed=false`;
        let url = `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,appProperties)&pageSize=1000&spaces=${STORAGE.spaces}`;
        if (pageToken) url += `&pageToken=${pageToken}`;
        const j = await (await driveGet(url, token)).json();
        out.push(...(j.files || []));
        pageToken = j.nextPageToken || "";
    } while (pageToken);
    return out;
}

const downloadText = async (id, token) => (await driveGet(`${DRIVE}/files/${id}?alt=media`, token)).text();

const FOLDER_MIME = "application/vnd.google-apps.folder";

// A Drive name used as a local path component. sanitizeName strips slashes, but
// a name of exactly "." or ".." would still point at the current / PARENT
// folder and let the mirror write outside its destination, so prefix those.
function localName(name) {
    const safe = sanitizeName(name);
    return safe === "." || safe === ".." ? "_" + safe : safe;
}

// Recursively mirror a Drive folder subtree onto the LOCAL filesystem under
// `destDir`, downloading each file AS-IS (its stored encrypted ciphertext, not
// decrypted) and recreating subfolders. Returns the number of files written.
// Drive allows same-named items in one folder (e.g. two config.json): they are
// all kept, the 2nd, 3rd... getting " (1)", " (2)"... before the extension, so
// no copy silently overwrites another in the backup.
async function replicateTreeLocal(srcId, destDir, token) {
    mkdirSync(destDir, { recursive: true, mode: DIR_MODE });
    const used = new Set();
    const nameFor = (driveName) => {
        const base = localName(driveName);
        if (!used.has(base)) { used.add(base); return base; }
        const ext = extname(base), stem = base.slice(0, base.length - ext.length);
        for (let i = 1; ; i++) {
            const candidate = `${stem} (${i})${ext}`;
            if (!used.has(candidate)) { used.add(candidate); return candidate; }
        }
    };
    let count = 0;
    for (const c of await listChildren(srcId, token)) {
        if (c.mimeType === FOLDER_MIME) {
            count += await replicateTreeLocal(c.id, join(destDir, nameFor(c.name)), token);
        } else {
            writeFileSync(join(destDir, nameFor(c.name)), await downloadText(c.id, token), { encoding: "utf8", mode: FILE_MODE });
            count++;
        }
    }
    return count;
}

// --- modes -------------------------------------------------------------------
async function runOnline(args) {
    // Token hand-off: the app's "Copy Export Token" menu gives a live Drive
    // access token; we use it directly (no OAuth in the CLI).
    // Hidden input, like the master password: the token gives ~1 hour of access
    // to your encrypted app data, so don't leave it on screen / in scrollback.
    const token = args.t || (await promptHidden(
        "Paste your export token (from the app menu 'Copy Export Token') (hidden): ")).trim();
    if (!token) usageExit("online mode needs an export token (paste it, or pass -t <token>).");

    // -x: replicate the whole 'eNotes Manager' tree (still encrypted) on Drive,
    // then exit. No decryption, so no master password needed.
    if (args.x) return runReplicate(token);

    const rootDir = makeRootDir();
    console.log("Output directory: " + rootDir);

    const { manager } = await pickManager(token);
    const configFolder = await pickSubfolder("Config", manager.id, token);
    const entriesFolder = await pickSubfolder("Entries", manager.id, token);
    if (!configFolder || !entriesFolder) throw new Error("Config/Entries folder missing.");

    const configFiles = await findAllConfirmed("config.json", configFolder.id, token, false);
    if (!configFiles.length) throw new Error("config.json not found. If the app also says 'Config file missing', unlock there with one of your recovery codes first: that restores it.");
    const entries = await listChildren(entriesFolder.id, token);
    const filePassword = await pickFilePassword(configFiles, entries, token);

    console.log(`Found ${entries.length} note(s). Exporting...`);
    for (const e of entries) {
        try {
            const content = decryptData(await downloadText(e.id, token), filePassword);
            console.log("  saved " + writeNote(rootDir, e.name, content));
        } catch (err) {
            console.warn(`  SKIPPED ${e.name}: ${err.message}`);
        }
    }
    sensitiveHint(rootDir);
}

// Replicate the entire 'eNotes Manager' Drive folder, as-is (still encrypted),
// onto the LOCAL device into a dated folder 'eNotes Manager_<YYYYMMDD_HHMM>',
// preserving the folder structure and file contents.
async function runReplicate(token) {
    const { manager: src, others } = await pickManager(token);
    if (others) console.log(`Note: ${others} other 'eNotes Manager' folder(s) exist; mirroring the one that holds your data (the same one the app uses).`);
    const destDir = `eNotes Manager_${stamp()}`;
    console.log(`Replicating Drive 'eNotes Manager' -> local '${destDir}' (encrypted, as-is)...`);
    const n = await replicateTreeLocal(src.id, destDir, token);
    console.log(`Replicated ${n} file(s) into '${destDir}'.`);
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

// Return a valid path: use `preset` (a CLI flag value) if it passes `validate`,
// otherwise prompt repeatedly until the user enters a valid one.
async function resolvePath(preset, query, validate, errMsg) {
    if (preset && validate(preset)) return preset;
    if (preset) console.log("  " + errMsg + ": " + preset);
    for (;;) {
        const p = await promptVisible(query);
        if (!p) throw new Error("No path entered — aborting.");
        if (validate(p)) return p;
        console.log("  " + errMsg + ": " + p);
    }
}

// Offline mode is an interactive wizard: any of -c / -n / -d not supplied on the
// command line is asked for at the prompt. (-d still beats -n if both flags are
// given.)
async function runOffline(args) {
    const configPath = await resolvePath(args.c, "Path to your config.json: ", isFile, "File not found");

    let dirPath = args.d || null;
    let filePath = args.n || null;
    if (!dirPath && !filePath) {
        const c = (await promptVisible("Export a single [f]ile or a whole [d]irectory of notes? (f/d) [d]: ")).toLowerCase();
        if (c === "f" || c === "file") {
            filePath = await resolvePath(null, "Path to the encrypted note file: ", isFile, "File not found");
        } else {
            dirPath = await resolvePath(null, "Path to the folder of encrypted note files: ", isDir, "Folder not found");
        }
    } else if (dirPath) {
        dirPath = await resolvePath(dirPath, "Path to the folder of encrypted note files: ", isDir, "Folder not found");
    } else {
        filePath = await resolvePath(filePath, "Path to the encrypted note file: ", isFile, "File not found");
    }

    const rootDir = makeRootDir();
    console.log("Output directory: " + rootDir);
    const filePassword = await unlockFilePassword(readFileSync(configPath, "utf8"));

    const files = dirPath
        ? readdirSync(dirPath).map((f) => join(dirPath, f)).filter((p) => statSync(p).isFile())
        : [filePath];

    console.log(`Exporting ${files.length} note file(s)...`);
    for (const p of files) {
        try {
            const content = decryptData(readFileSync(p, "utf8"), filePassword);
            console.log("  saved " + writeNote(rootDir, basename(p), content));
        } catch (err) {
            console.warn(`  SKIPPED ${basename(p)}: ${err.message}`);
        }
    }
    sensitiveHint(rootDir);
}

// -m sensitive: decrypt "<name>.sensitive" files (or an older CLI's "<name>.html"
// of a sensitive note) with each note's own password, exactly like the app's
// "Decrypt Sensitive File" (same shared code, same output). Local only: no Drive,
// no master password. The password is only ever typed at a hidden prompt, and
// the decrypted content is never printed.
async function runSensitive(args) {
    const target = await resolvePath(args.s, "Path to a .sensitive file, or a folder of them: ", existsSync, "Not found");
    const folder = statSync(target).isDirectory();
    // A folder: its .sensitive files (and .html ones, which an older CLI wrote for
    // sensitive notes); only files that really hold a sensitive note count.
    const candidates = folder
        ? readdirSync(target).filter((f) => /\.(sensitive|html?)$/i.test(f)).sort()
            .map((f) => join(target, f)).filter((p) => statSync(p).isFile())
        : [target];
    const found = [];
    for (const p of candidates) {
        let payload = null;
        try { payload = findSensitivePayload(readFileSync(p, "utf8")); } catch { /* unreadable */ }
        if (payload) found.push({ p, payload });
    }
    if (!found.length) {
        throw new Error(folder
            ? `No sensitive notes (.sensitive files) found in '${target}'.`
            : `'${basename(target)}' is not a sensitive note exported by eNotesMgr (a .sensitive file). ` +
              "Note files of an '-m on -x' copy are still locked with your master password: export them with '-m off' first.");
    }
    console.log(`Found ${found.length} sensitive note(s). Enter each note's password (just Enter skips it).`);
    let rootDir = null, done = 0;
    const skipped = [];
    for (const { p, payload } of found) {
        const name = basename(p);
        let content = null;
        for (;;) {
            const pwd = await promptHidden(`Password for '${name}' (Enter to skip): `);
            if (!pwd) break;
            try { content = decryptData(payload, pwd); break; } catch { console.log("  Wrong password - try again (or just Enter to skip)."); }
        }
        if (content === null) { skipped.push(name); console.log("  skipped " + name); continue; }
        if (!rootDir) { rootDir = makeRootDir("eNotes Manager Sensitive"); console.log("Output directory: " + rootDir); }
        const { filename, bytes } = buildNoteExport(sensitiveBaseName(name), content);
        const out = uniquePath(rootDir, filename);
        writeFileSync(out, bytes, { mode: FILE_MODE });
        console.log("  saved " + out);
        done++;
    }
    console.log(`\nDecrypted ${done} of ${found.length} sensitive note(s)` + (skipped.length ? `; skipped: ${skipped.join(", ")}` : "") + ".");
    if (done) console.log("These files are NOT encrypted: delete them when you no longer need them.");
}

// Decrypt config.json with the master password -> file_password (shared by both
// modes). Prompts for the master password.
async function unlockFilePassword(configCipher) {
    const master = await promptHidden("Master password (hidden): ");
    try {
        const fp = JSON.parse(decryptData(configCipher, master)).file_password;
        if (!fp) throw new Error("no file_password");
        return fp;
    } catch {
        throw new Error("Could not decrypt config.json — wrong master password or wrong/corrupt config file.");
    }
}

// --- moving notes to another account: -m export / -m import ------------------
// A transfer file holds ONE note exactly as the app stores it: its name, its
// appProperties (metadata, or null for a note from before the metadata existed)
// and its content after the file-password layer is removed (a sensitive note's
// content is its envelope, still locked with its note password). The note is
// JSON, encrypted (verified) with the exporting account's master password; a
// plain first line marks the file as a transfer file (it reveals nothing).
const TRANSFER_HEADER = "eNotesMgr transfer v1";
const TRANSFER_FORMAT = "eNotesMgr transfer";
const TRANSFER_EXT = ".enotes";

function isTransferFile(p) {
    try {
        const head = Buffer.alloc(TRANSFER_HEADER.length + 1);
        const fd = openSync(p, "r");
        try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
        return head.toString("utf8") === TRANSFER_HEADER + "\n";
    } catch { return false; }
}
function readTransferFile(p, masterPassword) {
    const cipher = readFileSync(p, "utf8").slice(TRANSFER_HEADER.length + 1).trim();
    const rec = JSON.parse(decryptData(cipher, masterPassword));
    if (rec.format !== TRANSFER_FORMAT || rec.version !== 1 || typeof rec.name !== "string" || typeof rec.content !== "string") {
        throw new Error("not a version-1 transfer file");
    }
    return rec;
}

// Find the account's data like every online mode (same duplicate / glitch rules).
async function accountData(token) {
    const user = ((await (await driveGet(`${DRIVE}/about?fields=user`, token)).json()).user) || {};
    const account = user.emailAddress || "this account";
    let manager;
    try { ({ manager } = await pickManager(token)); } catch {
        throw new Error(`${account} has no eNotesMgr data yet: open the app once with this account and set it up first.`);
    }
    const configFolder = await pickSubfolder("Config", manager.id, token);
    const entriesFolder = await pickSubfolder("Entries", manager.id, token);
    const configFiles = configFolder ? await findAllConfirmed("config.json", configFolder.id, token, false) : [];
    if (!entriesFolder || !configFiles.length) {
        throw new Error(`${account}'s eNotesMgr data is incomplete (no Entries folder or config.json): unlock the app once with this account (a recovery code restores config.json).`);
    }
    return { account, entriesFolder, configFiles, existing: await listChildren(entriesFolder.id, token) };
}

// The transfer folder is made in the folder the command is run in, named with the date and time like the other
// modes' folders. It is always a NEW folder: if one of that name is already there (an export made in the same
// minute) the export stops before writing anything - it never writes into, or mixes with, an existing folder.
const transferDirName = () => `eNotes Manager Transfer_${stamp()}`;
const transferDirTaken = (dir) => new Error(`A folder '${dir}' already exists here (an export made in this same minute). Nothing was written - wait a minute and run the export again.`);

// Write one transfer file per note into `dir` (note-0001.enotes ...): the note exactly as stored, locked with
// `master`. A note that can't be read is reported (SKIPPED) and left out. Used by -m export and -m rotate.
// -> { done, sensitive, failed: [names], recs: [{ file, rec }] }
async function exportNotes(dir, existing, token, filePassword, master) {
    let done = 0, sensitive = 0;
    const failed = [], recs = [];
    for (const [i, e] of existing.entries()) {
        try {
            const content = decryptData(await downloadText(e.id, token), filePassword);
            const rec = { format: TRANSFER_FORMAT, version: 1, name: e.name, appProperties: e.appProperties || null, content };
            const file = join(dir, `note-${String(i + 1).padStart(4, "0")}${TRANSFER_EXT}`);
            writeFileSync(file, `${TRANSFER_HEADER}\n${encryptVerified(JSON.stringify(rec), master)}\n`, { mode: FILE_MODE });
            done++;
            recs.push({ file: basename(file), rec });
            if (isSensitiveContent(content)) sensitive++;
        } catch (err) {
            failed.push(e.name);
            console.warn(`  SKIPPED a note: ${err.message}`);
        }
    }
    return { done, sensitive, failed, recs };
}

async function runExportForTransfer() {
    console.log("Export for moving notes (-m export): saves every note of an account, exactly as stored, locked with its master password. (Other options are ignored.)");
    if (existsSync(transferDirName())) throw transferDirTaken(transferDirName());
    const token = (await promptHidden("Paste the export token of the account to export (in the app, logged in with that account: menu > 'Copy Export Token') (hidden): ")).trim();
    if (!token) throw new Error("Export needs an export token.");
    const { account, configFiles, existing } = await accountData(token);
    console.log(`Exporting the eNotesMgr notes of ${account} (${existing.length} note(s)).`);
    const master = await promptHidden(`Master password of ${account} (hidden): `);
    const filePassword = await pickFilePassword(configFiles, existing, token, { master });

    // A NEW folder, never an existing one (mkdirSync without 'recursive' fails if it exists).
    const dir = transferDirName();
    try { mkdirSync(dir, { mode: DIR_MODE }); } catch (err) { throw err.code === "EEXIST" ? transferDirTaken(dir) : err; }
    const where = join(process.cwd(), dir);
    console.log("Transfer folder: " + where);
    const { done, sensitive, failed } = await exportNotes(dir, existing, token, filePassword, master);
    console.log(`\nExported ${done} of ${existing.length} note(s)` + (sensitive ? ` (${sensitive} sensitive)` : "") + ` into '${where}'.` +
        (failed.length ? ` Not exported: ${failed.length}.` : "") +
        `\nThe files are locked with the master password of ${account}.` +
        "\nTo add them to another account: set that account up in the app, log in with it, menu > 'Copy Export Token', then:" +
        "\n  node enotesmgr-export-cli.js -m import" +
        "\n(it asks for this transfer folder).");
    if (failed.length) process.exitCode = 1;
}

// "bank" taken -> "bank (1)"; "photo.png" taken -> "photo (1).png".
function freeNoteName(name, taken) {
    if (!taken.has(name)) return name;
    const ext = extname(name), stem = name.slice(0, name.length - ext.length);
    for (let i = 1; ; i++) {
        const candidate = `${stem} (${i})${ext}`;
        if (!taken.has(candidate)) return candidate;
    }
}
const sameProps = (a, b) => {
    const norm = (x) => JSON.stringify(Object.entries(x || {}).sort(([k1], [k2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : 0)));
    return norm(a) === norm(b);
};

// Create a new text file in Drive (the same multipart create the app uses).
async function driveCreate(name, content, parentId, appProperties, token) {
    const boundary = "enotes_boundary_" + Math.random().toString(36).slice(2);
    const metadata = { name, parents: [parentId], mimeType: "text/plain" };
    if (appProperties) metadata.appProperties = appProperties;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--`;
    const r = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
    });
    if (r.status === 401) throw new Error("Drive rejected the export token (expired or invalid).");
    if (!r.ok) throw new Error(`Drive did not save it (${r.status})`);
    return r.json();
}

async function runImportFromTransfer() {
    console.log("Import (-m import): adds the notes of a '-m export' transfer folder to an account, exactly as they were. (Other options are ignored.)");
    const dir = await resolvePath(null, "Transfer folder to import (made by '-m export'): ", isDir, "Folder not found");
    // Only the folder's own transfer files (top level); everything else is ignored.
    const files = [], ignored = [];
    for (const f of readdirSync(dir).sort()) {
        const p = join(dir, f);
        const st = statSync(p);
        if (st.isDirectory()) ignored.push(`${f}/ (a sub-folder)`);
        else if (!st.isFile() || !isTransferFile(p)) ignored.push(`${f} (not a transfer file)`);
        else files.push(f);
    }
    ignored.forEach((x) => console.log("  ignoring " + x));
    if (!files.length) throw new Error(`No transfer files (made by '-m export') in '${dir}'.`);
    console.log(`Found ${files.length} exported note(s).`);

    const oldMaster = await promptHidden("Master password of the OLD account - the one these notes were exported from (hidden): ");
    const recs = [], unreadable = [];
    for (const f of files) {
        try { recs.push({ file: f, ...readTransferFile(join(dir, f), oldMaster) }); } catch { unreadable.push(f); }
    }
    if (!recs.length) {
        throw new Error("None of the transfer files opens with that password. Use the master password the OLD account had when they were exported.");
    }
    if (unreadable.length) console.log(`  ${unreadable.length} file(s) don't open with that password (exported with another password, or damaged) and are skipped: ${unreadable.join(", ")}`);

    const token = (await promptHidden("Paste the export token of the NEW account (in the app, logged in with it: menu > 'Copy Export Token') (hidden): ")).trim();
    if (!token) throw new Error("Import needs an export token.");
    const { account, entriesFolder, configFiles, existing } = await accountData(token);
    console.log(`Importing into the eNotesMgr notes of ${account} (${existing.length} note(s) there now).`);
    const newMaster = await promptHidden(`Master password of ${account} - the NEW account (hidden): `);
    const filePassword = await pickFilePassword(configFiles, existing, token, { master: newMaster });

    const r = await addTransferNotes({ recs, token, account, entriesFolder, existing, filePassword, ask: true });
    if (r.nothing) {
        if (unreadable.length) process.exitCode = 1;
        return;
    }
    if (r.declined) return;
    console.log(`\nImported ${r.done} of ${r.toAdd.length} note(s) into ${account}.` + (r.already ? ` ${r.already} were already there.` : "") +
        (r.failed.length ? ` Not imported: ${r.failed.join(", ")} - run the import again to add them.` : "") + "\nReload the app to see them.");
    if (r.failed.length || unreadable.length) process.exitCode = 1;
}

// Add transfer notes (recs: the notes read from transfer files) to an account's Entries folder, each exactly
// as it was. Already there? The same note - name (or a " (n)" copy of it), details and content - is not
// added again, so a re-run (e.g. after a failure) adds only what is missing. ask: ask "Add these...? (y/N)"
// first. Used by -m import and -m rotate.
// exactNames (-m rotate: the same account's own notes coming back): every note keeps its exact name - also
// two notes that had the same name - and each note already there counts for one transfer note only. A
// name is changed (" (1)") only if a note that is NOT one of the transfer notes has it.
// -> { toAdd, already, done, failed: [names], nothing (all already there), declined (answered no) }
async function addTransferNotes({ recs, token, account, entriesFolder, existing, filePassword, ask, exactNames = false }) {
    const plain = new Map(); // existing note id -> its content
    const contentOf = async (e) => {
        if (!plain.has(e.id)) {
            let c = null;
            try { c = decryptData(await downloadText(e.id, token), filePassword); } catch { /* unreadable: not identical */ }
            plain.set(e.id, c);
        }
        return plain.get(e.id);
    };
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const toAdd = [];
    const matched = new Set(); // (exactNames) existing notes already counted for a transfer note
    let already = 0;
    for (const rec of recs) {
        const ext = extname(rec.name), stem = rec.name.slice(0, rec.name.length - ext.length);
        const copy = new RegExp(`^${esc(stem)} \\(\\d+\\)${esc(ext)}$`);
        let found = false;
        for (const e of existing.filter((x) => (x.name === rec.name || copy.test(x.name)) && !matched.has(x.id))) {
            if (sameProps(e.appProperties, rec.appProperties) && (await contentOf(e)) === rec.content) {
                found = true;
                if (exactNames) matched.add(e.id);
                break;
            }
        }
        if (found) already++; else toAdd.push(rec);
    }
    console.log(`${toAdd.length} note(s) to add` + (already ? `, ${already} already there (identical - skipped)` : "") + ".");
    if (!toAdd.length) {
        console.log("Nothing to import: every note is already there.");
        return { toAdd, already, done: 0, failed: [], nothing: true };
    }
    if (ask) {
        const answer = (await promptVisible(`Add these ${toAdd.length} note(s) to ${account}? (y/N): `)).toLowerCase();
        if (answer !== "y" && answer !== "yes") {
            console.log("Nothing imported.");
            return { toAdd, already, done: 0, failed: [], declined: true };
        }
    }
    // exactNames: only the names of notes that are not transfer notes count as taken.
    const taken = new Set(existing.filter((e) => !exactNames || !matched.has(e.id)).map((e) => e.name));
    let done = 0;
    const failed = [];
    for (const rec of toAdd) {
        const name = freeNoteName(rec.name, taken);
        try {
            const cipher = encryptVerified(rec.content, filePassword); // never store what wouldn't decrypt
            await driveCreate(name, cipher, entriesFolder.id, rec.appProperties, token);
            if (!exactNames) taken.add(name);
            done++;
            console.log(`  imported '${name}'` + (name !== rec.name ? ` (the name '${rec.name}' was taken)` : ""));
        } catch (err) {
            failed.push(rec.name);
            console.warn(`  FAILED '${rec.name}': ${err.message}`);
        }
    }
    return { toAdd, already, done, failed };
}

// --- rotating the file password: -m rotate -----------------------------------
// Gives an account a NEW file password - the key every note and the settings are
// encrypted with - and loses nothing:
//   1. back up the account's eNotesMgr data, still encrypted, exactly as -m on -x;
//   2. save every note exactly as stored (as -m export) and the settings, locked
//      with the master password;
//   3. read all of it back and check it;
//   4. only then, and only after the user typed "WIPE <account>", delete the
//      account's eNotesMgr data in Drive, as the app's 'Wipe all App Data' does;
//   5. the user sets the account up again in the app, which makes a new random
//      file password and new recovery codes, and pastes a new export token;
//   6. put every note back (as -m import) and the settings, under the new file
//      password, and check every note and the settings in Drive.
// Everything it writes is in ONE new folder 'eNotes Manager Rotation_<date>':
// backup/ (step 1), transfer/ (the notes - a normal transfer folder, -m import
// takes it too), the settings file, and rotation.json - the progress (no
// secrets). A rotation that stops after the wipe (no token yet, a network
// problem...) is continued by running -m rotate again in the same place.
const ROTATION_PREFIX = "eNotes Manager Rotation";
const ROTATION_FORMAT = "eNotesMgr rotation";
const ROTATION_STATE = "rotation.json";
const SETTINGS_HEADER = "eNotesMgr settings v1";
const SETTINGS_FORMAT = "eNotesMgr settings";
const SETTINGS_FILE = "settings.enotes-settings";

const rotationDirName = () => `${ROTATION_PREFIX}_${stamp()}`;
const rotationDirTaken = (dir) => new Error(`A folder '${dir}' already exists here (a rotation started in this same minute). Nothing was done - wait a minute and run it again.`);

function readRotationState(dir) {
    try {
        const s = JSON.parse(readFileSync(join(dir, ROTATION_STATE), "utf8"));
        return s && s.format === ROTATION_FORMAT && s.version === 1 ? s : null;
    } catch { return null; }
}
function writeRotationState(dir, state) {
    state.updated = new Date().toISOString();
    writeFileSync(join(dir, ROTATION_STATE), JSON.stringify(state, null, 2) + "\n", { mode: FILE_MODE });
}
// Rotations in this folder that stopped after (or while) deleting the account's data - newest first.
function unfinishedRotations() {
    return readdirSync(".").filter((d) => d.startsWith(ROTATION_PREFIX + "_") && isDir(d)).sort().reverse()
        .map((dir) => ({ dir, state: readRotationState(dir) }))
        .filter((x) => x.state && (x.state.phase === "wiping" || x.state.phase === "wiped"));
}

// The settings, locked (verified) with the master password, like a transfer file.
function writeSettingsFile(p, settings, master) {
    const rec = { format: SETTINGS_FORMAT, version: 1, settings };
    writeFileSync(p, `${SETTINGS_HEADER}\n${encryptVerified(JSON.stringify(rec), master)}\n`, { mode: FILE_MODE });
}
function readSettingsFile(p, master) {
    const text = readFileSync(p, "utf8");
    if (!text.startsWith(SETTINGS_HEADER + "\n")) throw new Error("not a settings file");
    const rec = JSON.parse(decryptData(text.slice(SETTINGS_HEADER.length + 1).trim(), master));
    if (rec.format !== SETTINGS_FORMAT || rec.version !== 1 || !rec.settings || typeof rec.settings !== "object") throw new Error("not a version-1 settings file");
    return rec.settings;
}

async function accountEmail(token) {
    return ((((await (await driveGet(`${DRIVE}/about?fields=user`, token)).json()).user) || {}).emailAddress) || "";
}

// Every file under a Drive folder (recursively), with the folder it is in.
async function treeFiles(folderId, token) {
    const out = [];
    for (const c of await listChildren(folderId, token)) {
        if (c.mimeType === FOLDER_MIME) out.push(...await treeFiles(c.id, token));
        else out.push({ ...c, parent: folderId });
    }
    return out;
}

// Delete a file or folder (with everything in it) in Drive.
async function driveDelete(id, token) {
    const r = await fetch(`${DRIVE}/files/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
    if (r.status === 401) throw new Error("Drive rejected the export token (expired or invalid).");
    if (!r.ok && r.status !== 404) throw new Error(`Drive did not delete it (${r.status})`);
}

// Replace a file's content and merge appProperties into its metadata (the same multipart update the app uses).
async function driveUpdate(id, content, appProperties, token) {
    const boundary = "enotes_boundary_" + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ appProperties })}\r\n` +
        `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--`;
    const r = await fetch(`${DRIVE_UPLOAD}/files/${id}?uploadType=multipart&fields=id,name`, {
        method: "PATCH",
        headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
    });
    if (r.status === 401) throw new Error("Drive rejected the export token (expired or invalid).");
    if (!r.ok) throw new Error(`Drive did not save it (${r.status})`);
}

// An account as a rotation sees it. { account, setUp: false } if it has no eNotesMgr data; otherwise its data
// (found like every online mode) plus what the wipe would delete: the tree in use and any other, EMPTY,
// 'eNotes Manager' trees. Anything else that holds files - another tree with files in it, a 2nd Entries
// folder with notes... - is listed in `unexpected`: then the rotation deletes nothing (it would not be in
// the transfer).
async function rotationAccount(token) {
    const account = await accountEmail(token);
    const managers = await findAllConfirmed("eNotes Manager", STORAGE.rootParent, token, true);
    if (!managers.length) return { account, setUp: false };
    const { manager } = await pickManager(token);
    const configFolder = await pickSubfolder("Config", manager.id, token);
    const entriesFolder = await pickSubfolder("Entries", manager.id, token);
    const recoveryFolder = await pickSubfolder("Recovery", manager.id, token);
    const configFiles = configFolder ? await findAllConfirmed("config.json", configFolder.id, token, false) : [];
    if (!configFolder || !entriesFolder || !configFiles.length) {
        throw new Error(`${account}'s eNotesMgr data is incomplete (no Entries folder or config.json): unlock the app once with this account (a recovery code restores config.json).`);
    }
    const existing = await listChildren(entriesFolder.id, token);
    const files = await treeFiles(manager.id, token);
    const known = new Set([entriesFolder.id, configFolder.id, recoveryFolder && recoveryFolder.id].filter(Boolean));
    const unexpected = files.filter((f) => !known.has(f.parent)).map((f) => `'${f.name}' (in another folder of your eNotesMgr data)`);
    const emptyOthers = [];
    for (const m of managers.filter((x) => x.id !== manager.id)) {
        const inside = await treeFiles(m.id, token);
        if (inside.length) unexpected.push(`${inside.length} file(s) in a second 'eNotes Manager' folder`);
        else emptyOthers.push(m);
    }
    return { account, setUp: true, manager, configFolder, entriesFolder, configFiles, existing, files, emptyOthers, unexpected };
}

// The account's settings (settings.json, opened with the file password). -> { settings } or { settings: null, why }
async function readAccountSettings(acc, filePassword, token) {
    const found = await findAllConfirmed("settings.json", acc.configFolder.id, token, false);
    if (!found.length) return { settings: null, why: "this account has no saved settings" };
    for (const f of found) {
        try {
            const s = JSON.parse(decryptData(await downloadText(f.id, token), filePassword));
            if (s && typeof s === "object") return { settings: s };
        } catch { /* not readable with this file password */ }
    }
    return { settings: null, why: "the saved settings could not be read" };
}

const sameRec = (a, b) => a.name === b.name && a.content === b.content && sameProps(a.appProperties, b.appProperties) && !a.appProperties === !b.appProperties;

// Read everything back from the rotation folder with the master password and compare it with what was saved.
function checkSaved(dir, master, recs, settings) {
    const tdir = join(dir, "transfer");
    const onDisk = readdirSync(tdir).sort();
    if (onDisk.length !== recs.length) throw new Error(`the transfer folder holds ${onDisk.length} file(s), not ${recs.length}`);
    for (const { file, rec } of recs) {
        let back;
        try { back = readTransferFile(join(tdir, file), master); } catch { throw new Error(`${file} does not open again`); }
        if (!sameRec(back, rec)) throw new Error(`${file} does not hold its note exactly`);
    }
    if (settings && JSON.stringify(readSettingsFile(join(dir, SETTINGS_FILE), master)) !== JSON.stringify(settings)) {
        throw new Error("the settings file does not hold the settings exactly");
    }
}

// What a rotation folder holds, opened with the master password the notes were saved with. Every transfer
// file must open, and their number must be the one recorded.
function loadRotationFolder(dir, state, master) {
    const tdir = join(dir, "transfer");
    const files = isDir(tdir) ? readdirSync(tdir).sort() : [];
    const recs = [];
    for (const f of files) {
        try { recs.push(readTransferFile(join(tdir, f), master)); } catch {
            throw new Error(`'${join(tdir, f)}' does not open with that password. Use the master password the account had when the rotation started.`);
        }
    }
    if (recs.length !== state.notes) throw new Error(`'${tdir}' holds ${recs.length} note(s), but ${state.notes} were saved: it is not complete. Your backup in '${join(dir, "backup")}' is untouched.`);
    let settings = null;
    if (state.settings) {
        try { settings = readSettingsFile(join(dir, SETTINGS_FILE), master); } catch {
            throw new Error(`'${join(dir, SETTINGS_FILE)}' does not open with that password.`);
        }
    }
    // The old file password(s): from the backup's config.json copies.
    const oldKeys = new Set();
    const cdir = join(dir, "backup", "Config");
    for (const f of isDir(cdir) ? readdirSync(cdir).filter((x) => x.startsWith("config")) : []) {
        try { const fp = JSON.parse(decryptData(readFileSync(join(cdir, f), "utf8"), master)).file_password; if (fp) oldKeys.add(fp); } catch { /* another password's copy */ }
    }
    return { recs, settings, oldKeys };
}

function stopAfterWipe(dir, why) {
    console.log(`\nThe rotation is NOT finished${why ? ` (${why})` : ""}. Nothing is lost: your notes are saved in '${join(process.cwd(), dir)}'.` +
        "\nSet the account up again in the app, then run in THIS folder:" +
        "\n  node enotesmgr-export-cli.js -m rotate" +
        "\nto finish (it asks for the new export token).");
    process.exitCode = 1;
}

async function wipeAccount(acc, token, dir, state) {
    state.phase = "wiping";
    writeRotationState(dir, state);
    console.log(`Deleting the eNotesMgr data of ${acc.account} in Google Drive...`);
    for (const m of [acc.manager, ...acc.emptyOthers]) await driveDelete(m.id, token);
    state.phase = "wiped";
    writeRotationState(dir, state);
    console.log("Deleted.");
}

const wipePhrase = (account) => `WIPE ${account}`;
async function confirmWipe(account) {
    const answer = await promptVisible(`To delete it now, type exactly: ${wipePhrase(account)}\n(anything else stops here, nothing deleted): `);
    return answer === wipePhrase(account);
}

// After the wipe: the user sets the account up again in the app; put the notes and the settings back.
async function finishRotation(dir, state, master, oldKeys, recs, settings) {
    console.log(`\nNow, in the app (in your browser):` +
        `\n  1. Log out (or reload the page) and log in again with the same Google account, ${state.account}.` +
        "\n  2. It asks you to set eNotesMgr up: choose your master password (the same one or a new one)." +
        "\n     It makes your NEW file password and gives you NEW recovery codes - keep them safe; the old codes no longer work." +
        "\n  3. On a PC: menu > 'Copy Export Token'.");
    let token, acc;
    for (;;) {
        if (inputUsedUp()) return stopAfterWipe(dir, "no new export token");
        token = (await promptHidden("Then paste that NEW export token here (hidden): ")).trim();
        if (!token) return stopAfterWipe(dir, "no new export token");
        acc = await rotationAccount(token);
        if (acc.account !== state.account) {
            console.log(`  That token is for ${acc.account || "another account"}, but this rotation is for ${state.account}. Log in to the app with ${state.account} and copy its token.`);
            continue;
        }
        if (!acc.setUp) {
            console.log(`  ${state.account} is not set up yet: set it up in the app first (step 2), then copy a new token.`);
            continue;
        }
        break;
    }
    // Still the OLD data? (its config.json is byte for byte one in the backup: the deletion didn't happen -
    // the rotation stopped while deleting.) No password needed to tell.
    const cdir = join(dir, "backup", "Config");
    const backupConfigs = new Set(isDir(cdir) ? readdirSync(cdir).filter((x) => x.startsWith("config")).map((x) => readFileSync(join(cdir, x), "utf8")) : []);
    let stillOld = false;
    for (const f of acc.configFiles) if (backupConfigs.has(await downloadText(f.id, token))) stillOld = true;
    if (stillOld) {
        console.log(`\n${state.account} still has its OLD eNotesMgr data: the deletion did not happen.`);
        if (acc.unexpected.length) throw new Error(`it also holds data that is not in the saved copy (${acc.unexpected.join("; ")}), so it is not deleted.`);
        if (!(await confirmWipe(state.account))) return stopAfterWipe(dir, "not deleted");
        await wipeAccount(acc, token, dir, state);
        return finishRotation(dir, state, master, oldKeys, recs, settings);
    }
    const newMaster = await promptHidden(`Master password you chose when setting ${state.account} up again (hidden): `);
    const filePassword = await pickFilePassword(acc.configFiles, acc.existing, token, { master: newMaster });
    if (oldKeys.has(filePassword)) {
        throw new Error(`${state.account} still has the same file password as before the rotation. Set it up again in the app (that makes a new one), then run -m rotate here again.`);
    }

    console.log(`\nPutting your ${recs.length} note(s) back into ${state.account}, under the new file password...`);
    const added = await addTransferNotes({ recs, token, account: acc.account, entriesFolder: acc.entriesFolder, existing: acc.existing, filePassword, ask: false, exactNames: true });
    if (added.failed.length) return stopAfterWipe(dir, `${added.failed.length} note(s) could not be put back: ${added.failed.join(", ")}`);
    if (settings) {
        const cipher = encryptVerified(JSON.stringify(settings), filePassword);
        const found = await findAllConfirmed("settings.json", acc.configFolder.id, token, false);
        try {
            if (found.length) for (const f of found) await driveUpdate(f.id, cipher, updateAppMeta("settings"), token);
            else await driveCreate("settings.json", cipher, acc.configFolder.id, createAppMeta("settings"), token);
        } catch (err) {
            return stopAfterWipe(dir, `the settings could not be saved: ${err.message}`);
        }
        console.log("  settings put back (theme, session timeout)");
    }

    // Check it all in Drive: every note there exactly, opening with the new file password; the settings too.
    console.log("Checking every note in Google Drive...");
    const now = await listChildren(acc.entriesFolder.id, token);
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let exact = 0;
    const counted = new Set();
    for (const rec of recs) {
        const ext = extname(rec.name), stem = rec.name.slice(0, rec.name.length - ext.length);
        const copy = new RegExp(`^${esc(stem)} \\(\\d+\\)${esc(ext)}$`);
        for (const e of now.filter((x) => (x.name === rec.name || copy.test(x.name)) && !counted.has(x.id))) {
            let c = null;
            try { c = decryptData(await downloadText(e.id, token), filePassword); } catch { /* not this one */ }
            if (c === rec.content && sameProps(e.appProperties, rec.appProperties)) { exact++; counted.add(e.id); break; }
        }
    }
    if (exact !== recs.length) return stopAfterWipe(dir, `only ${exact} of ${recs.length} note(s) are back exactly`);
    if (settings) {
        let back = null;
        for (const f of await findAllConfirmed("settings.json", acc.configFolder.id, token, false)) {
            try { back = JSON.parse(decryptData(await downloadText(f.id, token), filePassword)); break; } catch { /* next */ }
        }
        if (JSON.stringify(back) !== JSON.stringify(settings)) return stopAfterWipe(dir, "the settings are not back exactly");
    }
    state.phase = "done";
    writeRotationState(dir, state);
    console.log(`\nRotation finished for ${state.account}:` +
        "\n  - its file password is NEW: the old one opens nothing there any more" +
        `\n  - all ${recs.length} note(s) are back, exactly as they were` +
        (settings ? "\n  - your settings are back" : "\n  - settings: the app's defaults (none were carried over)") +
        "\n  - your recovery codes are the NEW ones the app gave you; the old codes no longer work" +
        `\nThe backup and the saved notes are in '${join(process.cwd(), dir)}', locked with the master password of before the rotation:` +
        "\ndelete that folder when you are happy with the result.\nReload the app to see your notes.");
}

async function resumeRotation({ dir, state }) {
    console.log(`Continuing the rotation of ${state.account} in '${dir}' (it stopped after deleting the account's data).`);
    const master = await promptHidden("Master password the notes were saved with (the one the account had when the rotation started) (hidden): ");
    const { recs, settings, oldKeys } = loadRotationFolder(dir, state, master);
    console.log(`  ${recs.length} note(s)` + (settings ? " and your settings" : "") + " are ready to be put back.");
    return finishSafely(dir, state, master, oldKeys, recs, settings);
}

async function runRotate() {
    console.log("Rotate the file password (-m rotate): gives this account a NEW file password - the key all its notes are" +
        "\nencrypted with - and new recovery codes, and puts every note and the settings back exactly as they were." +
        "\nFirst everything is backed up, saved and checked; only then, after you confirm, is the account's eNotesMgr" +
        "\ndata deleted in Google Drive; you set the account up again in the app, and everything is put back." +
        "\nClose eNotesMgr on your other devices and in other tabs first. (Other options are ignored.)\n");
    const pending = unfinishedRotations();
    if (pending.length) {
        const p = pending[0];
        const answer = (await promptVisible(`A rotation of ${p.state.account} stopped after deleting its data ('${p.dir}'). Continue it? (Y/n): `)).toLowerCase();
        if (answer === "" || answer === "y" || answer === "yes") return resumeRotation(p);
        throw new Error(`finish that rotation first (run -m rotate again here and answer y), or move its folder '${p.dir}' away. Nothing was done.`);
    }
    if (existsSync(rotationDirName())) throw rotationDirTaken(rotationDirName());
    const token = (await promptHidden("Paste the export token of the account (in the app, logged in with it: menu > 'Copy Export Token') (hidden): ")).trim();
    if (!token) throw new Error("Rotation needs an export token. Nothing was done.");
    const acc = await rotationAccount(token);
    if (!acc.account) throw new Error("Drive did not say which account this token belongs to. Nothing was done.");
    if (!acc.setUp) {
        throw new Error(`${acc.account} has no eNotesMgr data yet: open the app once with this account and set it up first. ` +
            "(If a rotation stopped after deleting the data, run -m rotate in the folder that holds its 'eNotes Manager Rotation_<date>' folder.) Nothing was done.");
    }
    console.log(`Rotating the file password of ${acc.account} (${acc.existing.length} note(s)).`);
    const master = await promptHidden(`Master password of ${acc.account} (hidden): `);
    const oldFilePassword = await pickFilePassword(acc.configFiles, acc.existing, token, { master });
    if (acc.unexpected.length) {
        throw new Error(`${acc.account}'s eNotesMgr data also holds ${acc.unexpected.join("; ")} - data the rotation would not carry over. ` +
            "It stops here to keep it safe. Nothing was done.");
    }
    const { settings, why } = await readAccountSettings(acc, oldFilePassword, token);

    const dir = rotationDirName();
    try { mkdirSync(dir, { mode: DIR_MODE }); } catch (err) { throw err.code === "EEXIST" ? rotationDirTaken(dir) : err; }
    const state = { format: ROTATION_FORMAT, version: 1, account: acc.account, phase: "saving", started: new Date().toISOString(), notes: acc.existing.length, settings: !!settings };
    writeRotationState(dir, state);
    console.log("Rotation folder: " + join(process.cwd(), dir));
    let recs;
    try {
        console.log(`\n1. Backing up the eNotesMgr data of ${acc.account}, still encrypted...`);
        const n = await replicateTreeLocal(acc.manager.id, join(dir, "backup"), token);
        if (n !== acc.files.length) throw new Error(`the backup holds ${n} file(s), not ${acc.files.length}`);
        console.log(`   ${n} file(s) backed up into '${join(dir, "backup")}'.`);

        console.log(`2. Saving every note${settings ? " and your settings" : ""}, locked with your master password...`);
        mkdirSync(join(dir, "transfer"), { mode: DIR_MODE });
        const ex = await exportNotes(join(dir, "transfer"), acc.existing, token, oldFilePassword, master);
        if (ex.failed.length) throw new Error(`${ex.failed.length} note(s) could not be read (${ex.failed.join(", ")}), so they could not be saved`);
        if (settings) writeSettingsFile(join(dir, SETTINGS_FILE), settings, master);
        else console.log(`   (settings: ${why} - after the rotation they are the app's defaults)`);
        console.log(`   ${ex.done} note(s)` + (ex.sensitive ? ` (${ex.sensitive} sensitive)` : "") + ` saved into '${join(dir, "transfer")}'.`);

        console.log("3. Checking: reading everything back...");
        checkSaved(dir, master, ex.recs, settings);
        recs = ex.recs.map((x) => x.rec);
        console.log("   Every note" + (settings ? " and the settings" : "") + " opens again, exactly as saved.");
    } catch (err) {
        state.phase = "stopped";
        writeRotationState(dir, state);
        throw new Error(`${err.message}. Nothing was deleted: your data in Google Drive is untouched.`);
    }
    state.phase = "saved";
    writeRotationState(dir, state);

    console.log(`\n4. Everything is saved and checked. Next, the eNotesMgr data of ${acc.account} - all ${acc.existing.length} note(s),` +
        "\n   the settings, the file password and the recovery codes - is DELETED in Google Drive, so the app can set it up" +
        "\n   anew (a new file password, new recovery codes); then everything is put back.");
    if (!(await confirmWipe(acc.account))) {
        state.phase = "cancelled";
        writeRotationState(dir, state);
        console.log(`Stopped: nothing was deleted. You can delete the folder '${dir}'.`);
        return;
    }
    try {
        await wipeAccount(acc, token, dir, state);
    } catch (err) {
        throw new Error(`could not delete the data (${err.message}). Your notes are safe: in Google Drive and in '${join(process.cwd(), dir)}'. ` +
            "Run -m rotate again here to try again.");
    }
    return finishSafely(dir, state, master, new Set([oldFilePassword]), recs, settings);
}

// After the wipe nothing may end without saying how to finish: any error ends with the way to continue.
async function finishSafely(dir, state, master, oldKeys, recs, settings) {
    try {
        return await finishRotation(dir, state, master, oldKeys, recs, settings);
    } catch (err) {
        console.error("\nRotation stopped: " + (err && err.message ? err.message : err));
        return stopAfterWipe(dir);
    }
}

// --- main --------------------------------------------------------------------
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.h) {
        process.stdout.write(HELP);
        return;
    }
    if (!["on", "off", "sensitive", "export", "import", "rotate"].includes(args.m)) usageExit("-m must be 'on', 'off', 'sensitive', 'export', 'import' or 'rotate'.");

    await cryptoReady;

    if (args.m === "on") await runOnline(args);
    else if (args.m === "off") await runOffline(args);
    else if (args.m === "sensitive") await runSensitive(args);
    else if (args.m === "export") await runExportForTransfer();
    else if (args.m === "import") await runImportFromTransfer();
    else await runRotate();

    console.log("Done.");
}

main()
    .catch((err) => {
        const argv = process.argv.slice(2).join(" ");
        const what = argv.includes("-m rotate") ? "Rotation" : argv.includes("-m import") ? "Import" : "Export";
        console.error(`\n${what} failed: ` + (err && err.message ? err.message : err));
        process.exitCode = 1;
    })
    .finally(closeRl); // release stdin so the process can exit
