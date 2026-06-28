// mynotes-export — entry source for the self-contained Node export CLI.
//
// build.mjs bundles this (+ the canonical www/ crypto + the WASI shim) and
// inlines the base64 wasm into a single www/mynotes-export.js that runs with
// `node mynotes-export.js` and needs NO npm install (only Node 18+ built-ins).
//
// It decrypts the user's eNotes notes and dumps them to a fresh output dir, in
// two modes:
//   online  (-m on):  read every note from Google Drive using an export token,
//                     and write them DECRYPTED locally — OR, with -x, mirror the
//                     whole 'eNotes Manager' Drive tree locally, still encrypted.
//   offline (-m off): read a local config.json + local encrypted note file(s).
//
// Online auth = token hand-off (no OAuth in the CLI, the most future-proof
// option): the SPA already signs in via Google's maintained GIS library and
// holds a valid Drive access token (drive.appdata by default, or drive.file —
// see STORAGE_MODE below). The user copies it from the app's menu ("Copy Export
// Token", PC-only) and pastes it here (or passes -t <token>). The CLI just calls
// the Drive REST API with that token — so it has zero OAuth surface to be
// deprecated, and needs no client id, secret, or redirect URI.
import { cryptoReady, decryptData } from "../../www/js/crypto/crypto.js";
// The note -> output-file decision (type, filename, html wrapping, byte decoding)
// is shared with the in-app Download button so the two produce identical output.
import { buildNoteExport, sanitizeName } from "../../www/js/lib/noteExport.js";
import {
    mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import readline from "node:readline";

const DRIVE = "https://www.googleapis.com/drive/v3";

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
            case "-x": a.x = true; break; // flag, no value
        }
    }
    return a;
}

function usageExit(msg) {
    if (msg) console.error("Error: " + msg + "\n");
    console.error(
        "Usage:\n" +
        "  Online:  node mynotes-export.js -m on  [-t <export-token>] [-x]\n" +
        "           (get the token from the app menu: 'Copy Export Token')\n" +
        "           (-x: download the whole 'eNotes Manager' Drive folder as a\n" +
        "            dated, still-encrypted LOCAL backup, then exit)\n" +
        "  Offline: node mynotes-export.js -m off   (interactive wizard; optionally\n" +
        "           pre-fill with -c <config.json> and -n <note-file> | -d <notes-dir>)\n"
    );
    process.exit(1);
}

// --- prompts -----------------------------------------------------------------
// One shared readline interface with a persistent line queue. Using a fresh
// interface (or rl.question) per prompt drops buffered stdin between prompts,
// which breaks the offline wizard when answers are piped in. Here a single
// 'line' listener feeds a queue, and each prompt pulls the next line. We write
// the query ourselves and mute echo for hidden inputs. Must be closed at the end
// or the open stdin keeps the process alive.
let _rl = null, _muting = false, _waiter = null;
const _queue = [];
function initRl() {
    if (_rl) return;
    _rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    _rl._writeToOutput = (s) => { if (!_muting) _rl.output.write(s); };
    _rl.on("line", (line) => {
        if (_waiter) { const w = _waiter; _waiter = null; w(line); }
        else _queue.push(line);
    });
    _rl.on("close", () => { if (_waiter) { const w = _waiter; _waiter = null; w(""); } });
}
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
const pad = (n) => String(n).padStart(2, "0");
function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function makeRootDir() {
    const dir = `my-notes-export_${stamp()}`;
    mkdirSync(dir, { recursive: true });
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
    writeFileSync(out, bytes);
    return out;
}

// --- Drive REST (online) -----------------------------------------------------
async function driveGet(url, token) {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 401) throw new Error("Drive rejected the export token (expired or invalid). In the app, log in again and re-copy the token (it is valid ~1 hour).");
    if (!r.ok) throw new Error(`Drive request failed (${r.status}): ${url}`);
    return r;
}
const escQ = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findChild(name, parentId, token, folderOnly) {
    let q = `name='${escQ(name)}' and '${parentId}' in parents and trashed=false`;
    if (folderOnly) q += ` and mimeType='application/vnd.google-apps.folder'`;
    const url = `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=${STORAGE.spaces}`;
    const j = await (await driveGet(url, token)).json();
    return j.files && j.files[0];
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

// Recursively mirror a Drive folder subtree onto the LOCAL filesystem under
// `destDir`, downloading each file AS-IS (its stored encrypted ciphertext, not
// decrypted) and recreating subfolders. Returns the number of files written.
async function replicateTreeLocal(srcId, destDir, token) {
    mkdirSync(destDir, { recursive: true });
    let count = 0;
    for (const c of await listChildren(srcId, token)) {
        if (c.mimeType === FOLDER_MIME) {
            count += await replicateTreeLocal(c.id, join(destDir, sanitizeName(c.name)), token);
        } else {
            writeFileSync(join(destDir, sanitizeName(c.name)), await downloadText(c.id, token), "utf8");
            count++;
        }
    }
    return count;
}

// --- modes -------------------------------------------------------------------
async function runOnline(args) {
    // Token hand-off: the app's "Copy Export Token" menu gives a live Drive
    // access token; we use it directly (no OAuth in the CLI).
    const token = args.t || await promptVisible(
        "Paste your export token (from the app menu 'Copy Export Token'): ");
    if (!token) usageExit("online mode needs an export token (paste it, or pass -t <token>).");

    // -x: replicate the whole 'eNotes Manager' tree (still encrypted) on Drive,
    // then exit. No decryption, so no master password needed.
    if (args.x) return runReplicate(token);

    const rootDir = makeRootDir();
    console.log("Output directory: " + rootDir);

    const manager = await findChild("eNotes Manager", STORAGE.rootParent, token, true);
    if (!manager) throw new Error("Could not find the 'eNotes Manager' folder for this account.");
    const configFolder = await findChild("Config", manager.id, token, true);
    const entriesFolder = await findChild("Entries", manager.id, token, true);
    if (!configFolder || !entriesFolder) throw new Error("Config/Entries folder missing.");

    const configFile = await findChild("config.json", configFolder.id, token, false);
    if (!configFile) throw new Error("config.json not found.");
    const filePassword = await unlockFilePassword(await downloadText(configFile.id, token));

    const entries = await listChildren(entriesFolder.id, token);
    console.log(`Found ${entries.length} note(s). Exporting...`);
    for (const e of entries) {
        try {
            const content = decryptData(await downloadText(e.id, token), filePassword);
            console.log("  saved " + writeNote(rootDir, e.name, content));
        } catch (err) {
            console.warn(`  SKIPPED ${e.name}: ${err.message}`);
        }
    }
}

// Replicate the entire 'eNotes Manager' Drive folder, as-is (still encrypted),
// onto the LOCAL device into a dated folder 'eNotes Manager_<YYYYMMDD_HHMM>',
// preserving the folder structure and file contents.
async function runReplicate(token) {
    const src = await findChild("eNotes Manager", STORAGE.rootParent, token, true);
    if (!src) throw new Error("Could not find the 'eNotes Manager' folder for this account.");
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

// --- main --------------------------------------------------------------------
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.m !== "on" && args.m !== "off") usageExit("-m must be 'on' or 'off'.");

    await cryptoReady;

    if (args.m === "on") await runOnline(args);
    else await runOffline(args);

    console.log("Done.");
}

main()
    .catch((err) => {
        console.error("\nExport failed: " + (err && err.message ? err.message : err));
        process.exitCode = 1;
    })
    .finally(closeRl); // release stdin so the process can exit
