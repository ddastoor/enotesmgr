// Export CLI: EVERY option combination x vaults WITH and WITHOUT sensitive notes.
//
// Vaults (built here with the app's own crypto, like the app stores them):
//   none      - only normal notes (rich text, text + embedded images + audio,
//               uploads: png / pdf / unknown / no extension, odd names, empty)
//   mixed     - those plus the same kinds as SENSITIVE notes (double encrypted)
//   sensitive - only sensitive notes
//   clash     - output-name clashes between normal and sensitive notes
// Modes / options: offline -c -d, -c -n (every note), -c -n -d (-d wins), every
// partial wizard (-c only, -d only, -n only, nothing; 'd' / 'f' / default
// answers), bad preset and typed paths (re-prompted), empty path (abort), wrong
// master password, extra flags that don't apply (ignored); online -t, token at
// the prompt, '-t' without a value, empty token, bad token, wrong master
// password, -x mirror (with -t / prompt / bad token), duplicate Drive trees +
// an older config.json with another key, a momentary Drive miss, config.json
// missing; Node 18; usage errors; --help; and '-m sensitive' (decrypting the
// .sensitive files: whole export folder, single file, asked-for path, bad path,
// wrong password then right, Enter skips, not-a-sensitive-file, -x copy files,
// an older CLI's .html exports, name clashes, no password option, ignored extra
// flags, Node 18, password hidden in a real terminal).
// Every successful export is checked file by file: normal notes = what the
// app's Download gives (and, where the vault allows it, byte-for-byte what the
// ORIGINAL CLI from git history writes); sensitive notes = "<name>.sensitive",
// still locked (no plaintext anywhere in the output), opening with their note
// password - and only with it - to exactly the app's Download. Output private
// (700 / 600), and the "N sensitive note(s)" hint only when there are some.
// Usage: node tests/cli/options.mjs   (or via tests/run-all.mjs)
import { spawnSync } from "child_process";
import fs from "fs"; import path from "path"; import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CLI_DIR, "..", "..");
const NEWCLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FF = path.join(CLI_DIR, "fakefetch.cjs");
const N18 = path.join(CLI_DIR, "node18sim.cjs");
const BASELINE_COMMIT = "419c522"; // the original CLI (same as tests/cli/run.mjs)
const HERE = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-cli-options-"));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL " + m); } else if (process.env.VERBOSE) console.log("  PASS " + m); };
const section = (t) => console.log(t);

const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
const C = await imp("www/js/crypto/crypto.js"); await C.cryptoReady;
const E = await imp("www/js/lib/noteExport.js");
const S = await imp("www/js/lib/sensitiveNote.js");

const OLDCLI = path.join(HERE, "original-cli.js");
const base = spawnSync("git", ["-C", ROOT, "show", `${BASELINE_COMMIT}:www/enotesmgr-export-cli.js`], { maxBuffer: 64 * 1024 * 1024 });
if (base.status !== 0) { console.error("Could not read the original CLI from git (" + BASELINE_COMMIT + "). A full clone is needed."); process.exit(1); }
fs.writeFileSync(OLDCLI, base.stdout);

// ---------------- note contents (as the app stores them) ----------------
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// Only sensitive notes use these, so their presence in any output = a leak.
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const SECRET_AUDIO = Buffer.from("ID3secret-audio-bytes").toString("base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n").toString("base64");
const embedImg = (b64, mime) => `<span class="media-embed" contenteditable="false"><img src="data:${mime};base64,${b64}"></span>`;
const embedAudio = (b64) => `<span class="media-embed" contenteditable="false"><audio controls="" src="data:audio/mpeg;base64,${b64}"></audio></span>`;
const normalNotes = [
    { name: "plain-text", content: "<div>Plain text PIN 1111 café ✓ &lt;tag&gt;</div><div><br></div><div>line 2</div>" },
    { name: "rich-images", content: `<div><b>Bold</b> <i>it</i> <u>un</u> with pictures </div>${embedImg(PNG, "image/png")} ${embedImg(PNG, "image/png")} ${embedAudio(Buffer.from("ID3plain-audio").toString("base64"))} end` },
    { name: "photo.png", content: `data:image/png;base64,${PNG}` },
    { name: "doc.pdf", content: `data:application/pdf;base64,${PDF}` },
    { name: "unknown.bin", content: `data:application/octet-stream;base64,${Buffer.from("no magic here").toString("base64")}` },
    { name: "noext", content: `data:image/png;base64,${PNG}` },
    { name: "a:b*c?", content: "<div>odd name</div>" },
    { name: "empty", content: "" },
];
const sensitiveNotes = [
    { name: "s-text", pw: "SecretText1", content: "<div>SECRET-1 PIN 2222 café ✓</div>" },
    { name: "s-rich-images", pw: "SecretRich2", content: `<div>SECRET-2 <b>bold</b></div>${embedImg(GIF, "image/gif")} ${embedImg(GIF, "image/gif")} ${embedAudio(SECRET_AUDIO)} end` },
    { name: "s-photo.png", pw: "SecretPhoto3", content: `data:image/gif;base64,${GIF}` },
    { name: "s-doc.pdf", pw: "SecretDoc44", content: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nSECRET-4\n%%EOF\n").toString("base64")}` },
    { name: "s-noext", pw: "SecretNoExt5", content: `data:image/gif;base64,${GIF}` },
    { name: "s:odd?", pw: "SecretOdd666", content: "<div>SECRET-6 odd name</div>" },
    { name: "s-empty", pw: "SecretEmpty7", content: "" },
];
const clashNotes = [
    { name: "bank", content: "<div>normal bank</div>" },              // bank.html
    { name: "bank.html", content: "<div>also bank.html</div>" },      // bank.html -> bank (1).html
    { name: "safe", pw: "SafePass88", content: "<div>SECRET-8</div>" }, // safe.sensitive
    { name: "safe.sensitive", content: `data:text/plain;base64,${Buffer.from("a normal upload").toString("base64")}` }, // safe.sensitive -> safe (1).sensitive
    { name: "x.sensitive", pw: "XPass9999", content: "<div>SECRET-9</div>" }, // x.sensitive.sensitive
];
const LEAKS = ["SECRET-", GIF, SECRET_AUDIO];

// ---------------- vault builder (local files + fake Drive) ----------------
const FP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", MASTER = "Master123";
function buildVault(label, notes) {
    const dir = path.join(HERE, label);
    fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
    const config = C.encryptVerified(JSON.stringify({ file_password: FP }), MASTER);
    fs.writeFileSync(path.join(dir, "config.json"), config);
    const drive = []; let n = 0;
    const add = (name, parent, content, folder, appProperties) => {
        const f = { id: label + "-" + (++n), name, parents: [parent], mimeType: folder ? "application/vnd.google-apps.folder" : "text/plain", content: content || "" };
        if (appProperties) f.appProperties = appProperties;
        drive.push(f); return f.id;
    };
    const mgr = add("eNotes Manager", "appDataFolder", "", true);
    const cfg = add("Config", mgr, "", true), ent = add("Entries", mgr, "", true), rec = add("Recovery", mgr, "", true);
    add("config.json", cfg, config, false, { DateTimeCreated: "2026-01-01T10:00", CreationMethod: "app", FileType: "config" });
    add("settings.json", cfg, C.encryptData(JSON.stringify({ session_timeout_seconds: 300, app_theme: "Light" }), FP));
    add("recovery-1", rec, C.encryptData(JSON.stringify({ file_password: FP }), "1234567812345678"));
    const stored = {};
    for (const note of notes) {
        // A sensitive note: content locked with its note password, marked, then
        // encrypted with the file password - exactly what the app writes.
        const inner = note.pw ? S.wrapSensitive(C.encryptVerified(note.content, note.pw)) : note.content;
        const cipher = C.encryptData(inner, FP);
        add(note.name, ent, cipher, false, note.pw ? { Sensitive: "yes" } : undefined);
        fs.writeFileSync(path.join(dir, "notes", note.name), cipher);
        stored[note.name] = { inner, cipher };
    }
    const write = (file, tree) => { fs.writeFileSync(path.join(dir, file), JSON.stringify(tree)); return path.join(dir, file); };
    const files = {
        drive: write("drive.json", drive),
        noconfig: write("drive-noconfig.json", drive.filter((f) => f.name !== "config.json")),
    };
    // Duplicates listed first: an empty 2nd tree and an OLDER config.json with a
    // different key under the same master password (only "the key that opens the
    // notes" picks right - for sensitive notes too, whose outer layer it opens).
    const dups = JSON.parse(JSON.stringify(drive));
    dups.unshift({ id: label + "-dupcfg", name: "config.json", parents: [cfg], mimeType: "text/plain",
        content: C.encryptData(JSON.stringify({ file_password: "another-key" }), MASTER), appProperties: { DateTimeCreated: "2020-01-01T00:00" } });
    dups.unshift({ id: label + "-dupE", name: "Entries", parents: [label + "-dupM"], mimeType: "application/vnd.google-apps.folder", content: "" });
    dups.unshift({ id: label + "-dupM", name: "eNotes Manager", parents: ["appDataFolder"], mimeType: "application/vnd.google-apps.folder", content: "" });
    files.dups = write("drive-dups.json", dups);
    return { label, dir, notes, stored, config: path.join(dir, "config.json"), notesDir: path.join(dir, "notes"), driveTree: drive, ...files };
}

// ---------------- running the CLI ----------------
function run(cli, args, input, { driveFile = null, preload = [], env = {} } = {}) {
    const cwd = fs.mkdtempSync(path.join(HERE, "run-"));
    const pre = [...preload, ...(driveFile ? [FF] : [])].flatMap((p) => ["-r", p]);
    const r = spawnSync(process.execPath, [...pre, cli, ...args], {
        cwd, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveFile || "", ...env },
    });
    const files = {}, modes = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        modes.push(fs.statSync(p).mode & 0o777);
        if (e.isDirectory()) walk(p); else files[path.relative(cwd, p).replace(/^[^/\\]+[/\\]/, "")] = fs.readFileSync(p);
    });
    walk(cwd);
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), cwd, files, modes };
}
const isPrivate = (r) => process.platform === "win32" || r.modes.every((m) => m === 0o700 || m === 0o600);

// What a decrypting export must contain for `notes` (order-independent: a name
// clash gets " (n)" before the extension, in whatever order the notes come).
// fromMirror: exported offline from a -x mirror, where a note file is named with
// the filesystem-safe name (e.g. "a:b*c?" -> "a_b_c_"), so that is the only name
// the CLI knows - it shows in a rich text note's html <title>. (Same in the
// original CLI; a .sensitive file has no title.)
function expectedFor(vault, notes, fromMirror = false) {
    return notes.map((n) => {
        const out = E.buildNoteExport(fromMirror ? E.sanitizeName(n.name) : n.name, vault.stored[n.name].inner);
        return { note: n, filename: out.filename, bytes: Buffer.from(out.bytes) };
    });
}
const clashName = (want, got) => {
    if (got === want) return true;
    const ext = path.extname(want), stem = want.slice(0, want.length - ext.length);
    return new RegExp("^" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\(\\d+\\)" + ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$").test(got);
};
// Check one decrypting export of `notes` from `vault`.
function checkExport(label, r, vault, notes, fromMirror = false) {
    const exp = expectedFor(vault, notes, fromMirror);
    const got = Object.entries(r.files);
    const used = new Set();
    let matched = 0;
    for (const e of exp) {
        const hit = got.find(([f, b]) => !used.has(f) && clashName(e.filename, f) && Buffer.compare(b, e.bytes) === 0);
        if (hit) { used.add(hit[0]); matched++; e.got = hit[0]; }
    }
    ok(r.code === 0, `${label}: exit 0` + (r.code === 0 ? "" : ` (exit ${r.code}: ${r.out.slice(-400)})`));
    ok(matched === exp.length && got.length === exp.length,
        `${label}: exactly the ${exp.length} expected file(s), right names and bytes (got ${got.length}: ${got.map(([f]) => f).sort().join(", ")})`);
    ok(got.every(([, b]) => LEAKS.every((m) => !b.includes(m))), `${label}: no sensitive plaintext / picture / audio in any output file`);
    const sens = exp.filter((e) => e.note.pw);
    for (const e of sens) {
        if (!e.got) continue;
        const file = r.files[e.got].toString();
        const payload = S.findSensitivePayload(file);
        let content = null; try { content = C.decryptData(payload, e.note.pw); } catch { /* wrong */ }
        const app = E.buildNoteExport(e.note.name, e.note.content); // what the app's Download gives
        const viaTool = content === null ? null : E.buildNoteExport(e.note.name, content);
        ok(viaTool && Buffer.compare(Buffer.from(viaTool.bytes), Buffer.from(app.bytes)) === 0,
            `${label}: ${e.got} + its note password = the app's Download of '${e.note.name}'`);
        let others = 0;
        for (const pw of [MASTER, FP, "WrongPass9"]) { try { C.decryptData(payload, pw); } catch { others++; } }
        ok(others === 3, `${label}: ${e.got} does not open with the master / file / a wrong password`);
        if (e.got === e.filename) {
            const tool = E.buildNoteExport(S.sensitiveBaseName(e.got), content);
            ok(tool.filename === app.filename, `${label}: 'Decrypt Sensitive File' names ${e.got} -> ${tool.filename} (= app Download name)`);
        }
    }
    ok(sens.length ? r.out.includes(`${sens.length} sensitive note(s)`) && r.out.includes("Decrypt Sensitive File") : !r.out.includes("sensitive note(s)"),
        `${label}: ` + (sens.length ? `says ${sens.length} sensitive note(s) need 'Decrypt Sensitive File'` : "no sensitive-note hint"));
    ok(isPrivate(r), `${label}: output private (700 / 600)`);
}
// Same files as the ORIGINAL CLI for the normal notes (the sensitive feature
// changes nothing for them).
function checkVsOriginal(label, rNew, rOld, vault) {
    const normals = expectedFor(vault, vault.notes.filter((n) => !n.pw)).map((e) => e.filename);
    ok(normals.every((f) => rOld.files[f] && rNew.files[f] && Buffer.compare(rOld.files[f], rNew.files[f]) === 0),
        `${label}: normal notes byte-for-byte what the ORIGINAL CLI writes (${normals.length} files)`);
}

const vaults = {
    none: buildVault("none", normalNotes),
    mixed: buildVault("mixed", [...normalNotes, ...sensitiveNotes]),
    sensitive: buildVault("sensitive", sensitiveNotes),
    clash: buildVault("clash", clashNotes),
};

for (const v of Object.values(vaults)) {
    const V = v.label;
    const all = v.notes;
    const sens = all.filter((n) => n.pw).length;
    section(`\n=== vault '${V}': ${all.length} notes, ${sens} sensitive ===`);
    const offArgs = ["-m", "off", "-c", v.config, "-d", v.notesDir];

    section("  offline");
    let r = run(NEWCLI, offArgs, `${MASTER}\n`);
    checkExport(`[${V}] off -c -d`, r, v, all);
    if (V !== "clash") checkVsOriginal(`[${V}] off -c -d`, r, run(OLDCLI, offArgs, `${MASTER}\n`), v);
    for (const n of all) {
        const f = path.join(v.notesDir, n.name);
        const one = run(NEWCLI, ["-m", "off", "-c", v.config, "-n", f], `${MASTER}\n`);
        checkExport(`[${V}] off -c -n '${n.name}'`, one, v, [n]);
        if (!n.pw) checkVsOriginal(`[${V}] off -c -n '${n.name}'`, one, run(OLDCLI, ["-m", "off", "-c", v.config, "-n", f], `${MASTER}\n`), { ...v, notes: [n] });
    }
    checkExport(`[${V}] off -c -n -d (-d wins)`, run(NEWCLI, ["-m", "off", "-c", v.config, "-n", path.join(v.notesDir, all[0].name), "-d", v.notesDir], `${MASTER}\n`), v, all);
    checkExport(`[${V}] off -c only, answer 'd'`, run(NEWCLI, ["-m", "off", "-c", v.config], `d\n${v.notesDir}\n${MASTER}\n`), v, all);
    checkExport(`[${V}] off -c only, default answer`, run(NEWCLI, ["-m", "off", "-c", v.config], `\n${v.notesDir}\n${MASTER}\n`), v, all);
    checkExport(`[${V}] off -c only, answer 'directory'`, run(NEWCLI, ["-m", "off", "-c", v.config], `directory\n${v.notesDir}\n${MASTER}\n`), v, all);
    const last = all[all.length - 1];
    checkExport(`[${V}] off -c only, answer 'f'`, run(NEWCLI, ["-m", "off", "-c", v.config], `f\n${path.join(v.notesDir, last.name)}\n${MASTER}\n`), v, [last]);
    checkExport(`[${V}] off -c only, answer 'file'`, run(NEWCLI, ["-m", "off", "-c", v.config], `file\n${path.join(v.notesDir, last.name)}\n${MASTER}\n`), v, [last]);
    checkExport(`[${V}] off -d only (asks for config)`, run(NEWCLI, ["-m", "off", "-d", v.notesDir], `${v.config}\n${MASTER}\n`), v, all);
    checkExport(`[${V}] off -n only (asks for config)`, run(NEWCLI, ["-m", "off", "-n", path.join(v.notesDir, last.name)], `${v.config}\n${MASTER}\n`), v, [last]);
    checkExport(`[${V}] off, full wizard 'd'`, run(NEWCLI, ["-m", "off"], `${v.config}\nd\n${v.notesDir}\n${MASTER}\n`), v, all);
    checkExport(`[${V}] off, full wizard 'f'`, run(NEWCLI, ["-m", "off"], `${v.config}\nf\n${path.join(v.notesDir, all[0].name)}\n${MASTER}\n`), v, [all[0]]);
    const bad = path.join(HERE, "does-not-exist");
    r = run(NEWCLI, ["-m", "off", "-c", bad, "-d", v.notesDir], `${v.config}\n${MASTER}\n`);
    checkExport(`[${V}] off, bad -c path (re-asked)`, r, v, all);
    ok(r.out.includes("File not found: " + bad), `[${V}] off, bad -c path: says 'File not found'`);
    r = run(NEWCLI, ["-m", "off", "-c", v.config, "-d", bad], `${v.notesDir}\n${MASTER}\n`);
    checkExport(`[${V}] off, bad -d path (re-asked)`, r, v, all);
    ok(r.out.includes("Folder not found: " + bad), `[${V}] off, bad -d path: says 'Folder not found'`);
    r = run(NEWCLI, ["-m", "off", "-c", v.config, "-n", bad], `${path.join(v.notesDir, last.name)}\n${MASTER}\n`);
    checkExport(`[${V}] off, bad -n path (re-asked)`, r, v, [last]);
    checkExport(`[${V}] off, -d given a file (re-asked)`, run(NEWCLI, ["-m", "off", "-c", v.config, "-d", v.config], `${v.notesDir}\n${MASTER}\n`), v, all);
    checkExport(`[${V}] off, -n given a folder (re-asked)`, run(NEWCLI, ["-m", "off", "-c", v.config, "-n", v.notesDir], `${path.join(v.notesDir, last.name)}\n${MASTER}\n`), v, [last]);
    checkExport(`[${V}] off, wizard: wrong paths typed first`, run(NEWCLI, ["-m", "off"], `${bad}\n${v.config}\nd\n${bad}\n${v.notesDir}\n${MASTER}\n`), v, all);
    r = run(NEWCLI, ["-m", "off"], `\n`);
    ok(r.code === 1 && r.out.includes("No path entered") && !Object.keys(r.files).length, `[${V}] off, empty path: aborts, nothing written`);
    r = run(NEWCLI, offArgs, "WrongPass9\n");
    ok(r.code === 1 && r.out.includes("Could not decrypt config.json") && !Object.keys(r.files).length, `[${V}] off, wrong master password: clear error, nothing written`);
    checkExport(`[${V}] off with -t / -x too (ignored)`, run(NEWCLI, [...offArgs, "-t", "GOODTOKEN", "-x"], `${MASTER}\n`), v, all);
    checkExport(`[${V}] off on Node 18`, run(NEWCLI, offArgs, `${MASTER}\n`, { preload: [N18] }), v, all);
    // A folder that also holds files that aren't notes (config.json, junk).
    const messy = path.join(HERE, V + "-messy");
    fs.cpSync(v.notesDir, messy, { recursive: true });
    fs.copyFileSync(v.config, path.join(messy, "config.json"));
    fs.writeFileSync(path.join(messy, "README.txt"), "not a note");
    r = run(NEWCLI, ["-m", "off", "-c", v.config, "-d", messy], `${MASTER}\n`);
    checkExport(`[${V}] off -d, folder with non-note files`, r, v, all);
    ok(r.out.includes("SKIPPED config.json") && r.out.includes("SKIPPED README.txt"), `[${V}] off -d, non-note files: listed as SKIPPED`);

    section("  online");
    const D = { driveFile: v.drive };
    r = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, D);
    checkExport(`[${V}] on -t`, r, v, all);
    if (V !== "clash") checkVsOriginal(`[${V}] on -t`, r, run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, D), v);
    checkExport(`[${V}] on, token at the prompt (stray spaces)`, run(NEWCLI, ["-m", "on"], `  GOODTOKEN  \n${MASTER}\n`, D), v, all);
    checkExport(`[${V}] on, '-t' without a value (asks)`, run(NEWCLI, ["-m", "on", "-t"], `GOODTOKEN\n${MASTER}\n`, D), v, all);
    checkExport(`[${V}] on with -c / -n / -d too (ignored)`, run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN", "-c", v.config, "-n", v.config, "-d", v.notesDir], `${MASTER}\n`, D), v, all);
    checkExport(`[${V}] on on Node 18`, run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { ...D, preload: [N18] }), v, all);
    checkExport(`[${V}] on, duplicate tree + older config.json with another key`, run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { driveFile: v.dups }), v, all);
    checkExport(`[${V}] on, momentary Drive miss`, run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { ...D, env: { FAKE_HIDE_ONCE: "eNotes Manager,Config,Entries,config.json" } }), v, all);
    r = run(NEWCLI, ["-m", "on"], `\n`, D);
    ok(r.code === 1 && r.out.includes("needs an export token"), `[${V}] on, empty token: usage error`);
    r = run(NEWCLI, ["-m", "on", "-t", "BADTOKEN"], `${MASTER}\n`, D);
    ok(r.code === 1 && r.out.includes("rejected the export token") && !Object.keys(r.files).length, `[${V}] on, bad token: clear error, nothing written`);
    r = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], "WrongPass9\n", D);
    ok(r.code === 1 && r.out.includes("Could not decrypt config.json") && !Object.keys(r.files).length, `[${V}] on, wrong master password: clear error, nothing written`);
    r = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { driveFile: v.noconfig });
    ok(r.code === 1 && r.out.includes("recovery codes"), `[${V}] on, config.json missing: points to the recovery-code fix`);

    section("  mirror (-x)");
    const expectMirror = (label, m, tree) => {
        const mroot = fs.readdirSync(m.cwd).find((d) => d.startsWith("eNotes Manager_"));
        const notesOk = all.every((n) => fs.readFileSync(path.join(m.cwd, mroot, "Entries", n.name.replace(/[\/\\:*?"<>|]/g, "_").trim()), "utf8") === v.stored[n.name].cipher);
        ok(m.code === 0 && Object.keys(m.files).length === all.length + 3 && notesOk,
            `${label}: ${all.length} notes + config + settings + recovery, every note byte-for-byte as stored (sensitive: still double encrypted)`);
        ok(m.files["Config/config.json"] && m.files["Config/config.json"].toString() === tree.find((f) => f.name === "config.json").content, `${label}: config.json as stored`);
        ok(!m.out.includes("sensitive note(s)") && Object.values(m.files).every((b) => LEAKS.every((x) => !b.includes(x))) && isPrivate(m),
            `${label}: nothing decrypted, no plaintext, private`);
    };
    r = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", D);
    expectMirror(`[${V}] on -x -t`, r, v.driveTree);
    if (V !== "clash") {
        const o = run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", D);
        ok(Object.keys(o.files).length === Object.keys(r.files).length && Object.entries(o.files).every(([f, b]) => r.files[f] && Buffer.compare(b, r.files[f]) === 0),
            `[${V}] on -x: byte-for-byte the ORIGINAL CLI's mirror`);
    }
    expectMirror(`[${V}] on -x, token at the prompt`, run(NEWCLI, ["-m", "on", "-x"], "GOODTOKEN\n", D), v.driveTree);
    expectMirror(`[${V}] on -x on Node 18`, run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", { ...D, preload: [N18] }), v.driveTree);
    r = run(NEWCLI, ["-m", "on", "-t", "BADTOKEN", "-x"], "", D);
    ok(r.code === 1 && r.out.includes("rejected the export token"), `[${V}] on -x, bad token: clear error`);
    // Offline export FROM the mirror = the online export.
    const m = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", D);
    const mroot = fs.readdirSync(m.cwd).find((d) => d.startsWith("eNotes Manager_"));
    checkExport(`[${V}] off -c -d from the -x mirror`, run(NEWCLI, ["-m", "off", "-c", path.join(m.cwd, mroot, "Config", "config.json"), "-d", path.join(m.cwd, mroot, "Entries")], `${MASTER}\n`), v, all, true);

    section("  -m sensitive (decrypting the .sensitive files)");
    const exportDirOf = (r) => path.join(r.cwd, fs.readdirSync(r.cwd).find((d) => d.startsWith("eNotes Manager Export_")));
    const expRun = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, D);
    const expDir = exportDirOf(expRun);
    const sensNotes = all.filter((n) => n.pw);
    // The CLI's order: the folder's .sensitive / .html files, sorted, that hold a sensitive note.
    const lockedIn = (dir) => fs.readdirSync(dir).filter((f) => /\.(sensitive|html?)$/i.test(f)).sort()
        .filter((f) => S.findSensitivePayload(fs.readFileSync(path.join(dir, f), "utf8")));
    const noteOf = (file) => {
        const payload = S.findSensitivePayload(fs.readFileSync(file, "utf8"));
        return sensNotes.find((n) => { try { C.decryptData(payload, n.pw); return true; } catch { return false; } });
    };
    const sensOut = (r) => {
        const d = fs.readdirSync(r.cwd).find((x) => x.startsWith("eNotes Manager Sensitive_"));
        return d ? path.join(r.cwd, d) : null;
    };
    // Check a -m sensitive run that decrypted `files` (paths of .sensitive files).
    const checkDecrypt = (label, r, files) => {
        const exp = files.map((f) => {
            const n = noteOf(f);
            const out = E.buildNoteExport(S.sensitiveBaseName(path.basename(f)), n.content);
            return { n, f, filename: out.filename, bytes: Buffer.from(out.bytes) };
        });
        const got = Object.entries(r.files);
        const used = new Set();
        let matched = 0;
        for (const e of exp) {
            const hit = got.find(([g, b]) => !used.has(g) && clashName(e.filename, g) && Buffer.compare(b, e.bytes) === 0);
            if (hit) { used.add(hit[0]); matched++; e.got = hit[0]; }
        }
        ok(r.code === 0 && matched === exp.length && got.length === exp.length,
            `${label}: exit 0, ${exp.length} readable file(s) with the right names and bytes (got ${got.map(([g]) => g).sort().join(", ")})` + (r.code === 0 ? "" : ` (exit ${r.code}: ${r.out.slice(-300)})`));
        for (const e of exp) {
            const app = E.buildNoteExport(e.n.name, e.n.content); // the app's Download
            if (E.sanitizeName(e.n.name) === e.n.name && e.got === app.filename) {
                ok(Buffer.compare(r.files[e.got], Buffer.from(app.bytes)) === 0, `${label}: ${e.got} is byte-for-byte the app's Download of '${e.n.name}'`);
            }
        }
        ok(r.out.includes(`Decrypted ${exp.length} of`) && isPrivate(r), `${label}: says 'Decrypted ${exp.length} of ...'; output private`);
        ok(LEAKS.every((m) => !r.out.includes(m)) && sensNotes.every((n) => !r.out.includes(n.pw)), `${label}: no note content and no password printed`);
        if (exp.length) ok(r.out.includes("NOT encrypted"), `${label}: reminds that the decrypted files are not encrypted`);
    };
    if (!sensNotes.length) {
        r = run(NEWCLI, ["-m", "sensitive", "-s", expDir], "");
        ok(r.code === 1 && r.out.includes("No sensitive notes") && !Object.keys(r.files).length, `[${V}] -m sensitive on an export without sensitive notes: says so, exit 1, nothing written`);
        ok(!expRun.out.includes("-m sensitive"), `[${V}] export without sensitive notes: no '-m sensitive' hint`);
    } else {
        ok(expRun.out.includes(`-m sensitive -s "${path.basename(expDir)}"`), `[${V}] the export's hint gives the exact '-m sensitive -s' command for its folder`);
        const files = lockedIn(expDir).map((f) => path.join(expDir, f));
        ok(files.length === sensNotes.length && files.every((f) => noteOf(f)), `[${V}] the export folder holds ${sensNotes.length} sensitive file(s)`);
        const pwds = files.map((f) => noteOf(f).pw);
        checkDecrypt(`[${V}] -m sensitive -s <export folder>`, run(NEWCLI, ["-m", "sensitive", "-s", expDir], pwds.join("\n") + "\n"), files);
        checkDecrypt(`[${V}] -m sensitive, folder asked for`, run(NEWCLI, ["-m", "sensitive"], `${expDir}\n` + pwds.join("\n") + "\n"), files);
        const bad = path.join(HERE, "does-not-exist");
        r = run(NEWCLI, ["-m", "sensitive", "-s", bad], `${expDir}\n` + pwds.join("\n") + "\n");
        checkDecrypt(`[${V}] -m sensitive, bad -s path (asked again)`, r, files);
        ok(r.out.includes("Not found: " + bad), `[${V}] -m sensitive, bad -s path: says 'Not found'`);
        for (const f of files) {
            checkDecrypt(`[${V}] -m sensitive -s ${path.basename(f)}`, run(NEWCLI, ["-m", "sensitive", "-s", f], noteOf(f).pw + "\n"), [f]);
        }
        const f0 = files[0];
        r = run(NEWCLI, ["-m", "sensitive", "-s", f0], `WrongPass9\n${MASTER}\n${FP}\n${noteOf(f0).pw}\n`);
        checkDecrypt(`[${V}] -m sensitive, wrong / master / file password first, then right`, r, [f0]);
        ok((r.out.match(/Wrong password/g) || []).length === 3, `[${V}] -m sensitive: each wrong password says 'Wrong password' (master and file password don't open it)`);
        r = run(NEWCLI, ["-m", "sensitive", "-s", expDir], files.map(() => "").join("\n") + "\n");
        ok(r.code === 0 && !Object.keys(r.files).length && !sensOut(r) && r.out.includes(`Decrypted 0 of ${files.length}`) && r.out.includes("skipped"),
            `[${V}] -m sensitive, Enter for every note: all skipped, exit 0, no folder created`);
        if (files.length > 1) {
            const mixedPw = files.map((f, i) => (i % 2 ? "" : noteOf(f).pw));
            checkDecrypt(`[${V}] -m sensitive, some skipped`, run(NEWCLI, ["-m", "sensitive", "-s", expDir], mixedPw.join("\n") + "\n"), files.filter((f, i) => i % 2 === 0));
        }
        r = run(NEWCLI, ["-m", "sensitive", "-s", f0, "-p", noteOf(f0).pw], "");
        ok(r.code === 0 && !Object.keys(r.files).length && r.out.includes("Decrypted 0 of 1"), `[${V}] -m sensitive: no password option ('-p <pw>' ignored, nothing typed -> skipped)`);
        checkDecrypt(`[${V}] -m sensitive with -t / -x / -c / -n / -d too (ignored)`,
            run(NEWCLI, ["-m", "sensitive", "-s", expDir, "-t", "GOODTOKEN", "-x", "-c", v.config, "-n", f0, "-d", v.notesDir], pwds.join("\n") + "\n"), files);
        checkDecrypt(`[${V}] -m sensitive on Node 18`, run(NEWCLI, ["-m", "sensitive", "-s", expDir], pwds.join("\n") + "\n", { preload: [N18] }), files);
        // Exports of other modes give the same .sensitive files.
        const offRun = run(NEWCLI, ["-m", "off", "-c", v.config, "-d", v.notesDir], `${MASTER}\n`);
        const offDir = exportDirOf(offRun);
        ok(lockedIn(offDir).join() === lockedIn(expDir).join() && lockedIn(offDir).every((f) => Buffer.compare(fs.readFileSync(path.join(offDir, f)), fs.readFileSync(path.join(expDir, f))) === 0),
            `[${V}] offline export: the same .sensitive files as online`);
        // Files that are not sensitive notes.
        const normal = fs.readdirSync(expDir).find((f) => !lockedIn(expDir).includes(f));
        if (normal) {
            r = run(NEWCLI, ["-m", "sensitive", "-s", path.join(expDir, normal)], "");
            ok(r.code === 1 && r.out.includes("is not a sensitive note") && !Object.keys(r.files).length, `[${V}] -m sensitive on a normal note's export (${normal}): says so, exit 1`);
        }
        const mirrorNote = path.join(m.cwd, mroot, "Entries", sensNotes[0].name.replace(/[\/\\:*?"<>|]/g, "_"));
        r = run(NEWCLI, ["-m", "sensitive", "-s", mirrorNote], "");
        ok(r.code === 1 && r.out.includes("is not a sensitive note") && r.out.includes("-m off"), `[${V}] -m sensitive on a still-encrypted -x copy file: explains to export it with '-m off' first`);
        // An older CLI's export (.html wrapping the locked note) decrypts the same.
        if (V !== "clash") {
            const oldRun = run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, D);
            const oldDir = exportDirOf(oldRun);
            const oldFiles = lockedIn(oldDir).map((f) => path.join(oldDir, f));
            ok(oldFiles.length === sensNotes.length && oldFiles.every((f) => f.endsWith(".html")), `[${V}] the ORIGINAL CLI wrote the sensitive notes as .html wrappers (${oldFiles.length})`);
            checkDecrypt(`[${V}] -m sensitive on an ORIGINAL-CLI export folder`, run(NEWCLI, ["-m", "sensitive", "-s", oldDir], oldFiles.map((f) => noteOf(f).pw).join("\n") + "\n"), oldFiles);
            // The same note twice in one folder (new .sensitive + old .html): both
            // decrypt, the second as "<name> (1).<ext>" - nothing overwritten.
            const both = path.join(HERE, V + "-both");
            fs.mkdirSync(both);
            fs.copyFileSync(files[0], path.join(both, path.basename(files[0])));
            const twin = oldFiles.find((f) => noteOf(f) === noteOf(files[0]));
            fs.copyFileSync(twin, path.join(both, path.basename(twin)));
            const bothFiles = lockedIn(both).map((f) => path.join(both, f));
            checkDecrypt(`[${V}] -m sensitive, the same note as .sensitive and old .html (name clash)`, run(NEWCLI, ["-m", "sensitive", "-s", both], bothFiles.map((f) => noteOf(f).pw).join("\n") + "\n"), bothFiles);
        }
    }
}

section("\n=== usage errors ===");
for (const [label, args] of [["no arguments", []], ["-m missing", ["-t", "GOODTOKEN"]], ["-m bogus", ["-m", "maybe"]], ["-m without a value", ["-m"]], ["-m ON (case)", ["-m", "ON"]]]) {
    const r = run(NEWCLI, args, "");
    ok(r.code === 1 && r.out.includes("Usage:") && r.out.includes("-m must be 'on', 'off' or 'sensitive'") && !Object.keys(r.files).length, `${label}: usage message, exit 1, nothing written`);
    ok(r.out.includes("-m sensitive") && r.out.includes("--help"), `${label}: usage lists '-m sensitive' and points to --help`);
    ok(r.out.includes("'-m on -x'") && r.out.includes("Config/config.json") && r.out.includes("/Entries") && r.out.includes("hidden app-data area")
        && r.out.includes("master password that was in use") && r.out.includes("Decrypt Sensitive File"),
        `${label}: usage explains where config.json comes from (a '-m on -x' copy), which master password, and .sensitive files`);
}

section("\n=== --help ===");
const helpParts = ["USAGE", "MODES", "OPTIONS", "WHERE config.json COMES FROM", "WHAT YOU GET", "SECURITY", "EXAMPLES",
    "-m on", "-m off", "-m sensitive", "-t <token>", "-x ", "-c <file>", "-d <folder>", "-n <file>", "-s <path>", "-h, --help",
    "Copy Export Token", "eNotes Manager Export_<date>", "eNotes Manager_<date>", "eNotes Manager Sensitive_<date>",
    "hidden app-data area", "Decrypt Sensitive File", "hidden prompts", "folders 700, files 600", "NOT encrypted", "never changes or deletes"];
for (const [label, args] of [["--help", ["--help"]], ["-h", ["-h"]], ["-m on --help", ["-m", "on", "--help"]], ["-m bogus -h", ["-m", "bogus", "-h"]], ["-m sensitive -s x --help", ["-m", "sensitive", "-s", "x", "--help"]]]) {
    const r = spawnSync(process.execPath, [NEWCLI, ...args], { cwd: fs.mkdtempSync(path.join(HERE, "help-")), input: "", encoding: "utf8" });
    const missing = helpParts.filter((p) => !r.stdout.includes(p));
    ok(r.status === 0 && !missing.length && !r.stderr && !r.stdout.includes("Done."), `${label}: full help on stdout, exit 0, nothing else happens` + (missing.length ? ` (missing: ${missing.join(", ")})` : ""));
}

section("\n=== -m sensitive in a real terminal: the note password is hidden ===");
if (process.platform === "win32") {
    console.log("  SKIP (needs a POSIX pseudo-terminal)");
} else {
    const work = fs.mkdtempSync(path.join(HERE, "pty-"));
    const sfile = path.join(work, "bank.sensitive");
    fs.writeFileSync(sfile, S.wrapSensitive(C.encryptVerified("<div>SECRET-pty</div>", "PtyNotePass1")));
    const pty = spawnSync("python3", [path.join(CLI_DIR, "pty_sensitive.py"), NEWCLI, sfile, "PtyNotePass1", work], { encoding: "utf8" });
    if (pty.status !== 0 && !pty.stdout) console.log("  SKIP (python3 not available): " + (pty.stderr || "").trim());
    else {
        ok(pty.stdout.includes("password visible on screen: False") && pty.stdout.includes("prompt shown: True") && pty.stdout.includes("decrypted: True"),
            "the typed note password is not shown on screen, and the note is decrypted: " + pty.stdout.trim());
    }
}

fs.rmSync(HERE, { recursive: true, force: true });
console.log(`\n${checks} checks` + (fails ? `, ${fails} FAILURE(S)` : ", ALL PASSED"));
process.exitCode = fails ? 1 : 0;
