// Export CLI: moving all notes to another account - '-m export' / '-m import'.
//
// Account A holds every kind of note (rich text, pictures / audio, uploads with
// the browser's own MIME labels - also one whose label differs from its content
// -, an uploaded .html file, sensitive notes of every kind, odd / unicode names,
// an empty note, a note from before the metadata existed, two notes with the
// same name, a 3 MB upload). '-m export' saves them; '-m import' adds them to
// account B (which has a clashing note and one identical note already).
// Checked: the transfer folder (one file per note, private, nothing readable,
// no note names, opens only with A's master password), every imported note
// EXACTLY as in A (name, metadata incl. dates, content) - only re-encrypted with
// B's file password -, nothing existing changed, round trip via the normal
// export, re-runs and partial failures (nothing added twice), sub-folders and
// other files ignored, every prompt / error path, other options ignored,
// Node 18, and token / passwords hidden in a real terminal.
// Usage: node tests/cli/transfer.mjs   (or via tests/run-all.mjs)
import { spawnSync } from "child_process";
import fs from "fs"; import path from "path"; import os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { PARTS } from "./transfer.parts.mjs";

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CLI_DIR, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FF = path.join(CLI_DIR, "fakefetch.cjs");
const N18 = path.join(CLI_DIR, "node18sim.cjs");
const FN = path.join(CLI_DIR, "fakenow.cjs"); // FAKE_NOW (fixed clock), FAKE_LATE_FOLDER
const HERE = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-cli-transfer-"));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL " + m); } else console.log("  PASS " + m); };

const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
const C = await imp("www/js/crypto/crypto.js"); await C.cryptoReady;
const E = await imp("www/js/lib/noteExport.js");
const S = await imp("www/js/lib/sensitiveNote.js");
const tryDec = (c, p) => { try { return C.decryptData(c, p); } catch { return null; } };

// ---------------- the two accounts ----------------
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n").toString("base64");
const BIG = Buffer.alloc(3 * 1024 * 1024); for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 2654435761) >>> 24;
const embed = (b64, mime) => `<span class="media-embed" contenteditable="false"><img src="data:${mime};base64,${b64}"></span>`;
const meta = (created, modified, how, type, sensitive) => ({ DateTimeCreated: created, DateTimeModified: modified, CreationMethod: how, FileType: type, ...(sensitive ? { Sensitive: "yes" } : {}) });
const sens = (content, pw) => S.wrapSensitive(C.encryptVerified(content, pw));
// [name, stored content (after the file-password layer), appProperties]
const A_NOTES = [
    ["plain-text", "<div>Plain PIN-1111 café ✓ &lt;tag&gt;</div><div><br></div>", meta("2024-03-01T09:15", "2025-07-04T18:30", "new", "richtext")],
    ["rich", `<div><b>Bold</b></div>${embed(PNG, "image/png")} ${embed(GIF, "image/gif")}<span class="media-embed" contenteditable="false"><audio controls="" src="data:audio/mpeg;base64,SUQzYXVkaW8="></audio></span>`, meta("2024-03-02T10:00", "2024-03-02T10:05", "new", "richtext")],
    ["photo.png", `data:image/png;base64,${PNG}`, meta("2024-04-01T08:00", "2024-04-01T08:00", "upload", "image")],
    // Uploaded without an extension: the browser labelled it octet-stream; its type (image) came from its content.
    ["scan", `data:application/octet-stream;base64,${PNG}`, meta("2024-04-02T08:00", "2024-04-02T08:00", "upload", "image")],
    ["page.html", `data:text/html;base64,${Buffer.from("<html><body>an uploaded page</body></html>").toString("base64")}`, meta("2024-04-03T08:00", "2024-04-03T08:00", "upload", "UNKNOWN")],
    ["doc.pdf", `data:application/pdf;base64,${PDF}`, meta("2024-04-04T08:00", "2024-04-04T08:00", "upload", "application/pdf")],
    ["big.bin", `data:application/octet-stream;base64,${BIG.toString("base64")}`, meta("2024-04-05T08:00", "2024-04-05T08:00", "upload", "UNKNOWN")],
    ["a:b*c? ✓", "<div>odd name</div>", meta("2024-05-01T00:00", "2024-05-01T00:00", "new", "richtext")],
    ["empty", "", meta("2024-05-02T00:00", "2024-05-02T00:00", "new", "richtext")],
    ["legacy", "[metadata begin]\nDateTimeCreated=2020-01-01T00:00\nCreationMethod=new\nFileType=richtext\n[metadata end]\n<div>from an old version</div>", null],
    ["dup", "<div>first dup</div>", meta("2024-06-01T00:00", "2024-06-01T00:00", "new", "richtext")],
    ["dup", "<div>second dup</div>", meta("2024-06-02T00:00", "2024-06-02T00:00", "new", "richtext")],
    ["s-text", sens("<div>SECRET-1 PIN-2222</div>", "SecretText1"), meta("2024-07-01T00:00", "2024-07-09T00:00", "new", "richtext", true)],
    ["s-photo.png", sens(`data:image/png;base64,${PNG}`, "SecretPhoto2"), meta("2024-07-02T00:00", "2024-07-02T00:00", "upload", "image", true)],
    ["s-noext", sens(`data:application/octet-stream;base64,${GIF}`, "SecretNoExt3"), meta("2024-07-03T00:00", "2024-07-03T00:00", "upload", "image", true)],
    ["s:odd?", sens("<div>SECRET-4</div>", "SecretOdd44"), meta("2024-07-04T00:00", "2024-07-04T00:00", "new", "richtext", true)],
    ["shared", "<div>the same in both accounts</div>", meta("2024-08-01T00:00", "2024-08-01T00:00", "new", "richtext")],
    // Metadata keys this test doesn't know about must travel too (nothing is left out).
    ["future", "<div>has extra metadata</div>", { ...meta("2024-09-01T00:00", "2024-09-02T00:00", "new", "richtext"), FutureKey: "kept ✓", Another: "" }],
];
const MASTER_A = "MasterA123", FP_A = "aaaaaaaa-1111-4ccc-8ddd-aaaaaaaaaaaa";
const MASTER_B = "MasterB456", FP_B = "bbbbbbbb-2222-4ccc-8ddd-bbbbbbbbbbbb";
const B_NOTES = [
    ["plain-text", "<div>B's own plain-text</div>", meta("2026-01-01T00:00", "2026-01-01T00:00", "new", "richtext")],
    A_NOTES.find((n) => n[0] === "shared"), // already in B, identical
];

function vault(prefix, master, fp, notes, { noConfig = false, corrupt = null } = {}) {
    const t = []; let n = 0;
    const add = (name, parent, content, folder, ap) => { const id = `${prefix}${++n}`; t.push({ id, name, parents: [parent], mimeType: folder ? "application/vnd.google-apps.folder" : "text/plain", content: content || "", ...(ap ? { appProperties: ap } : {}) }); return id; };
    const mgr = add("eNotes Manager", "appDataFolder", "", true);
    const cfg = add("Config", mgr, "", true), ent = add("Entries", mgr, "", true), rec = add("Recovery", mgr, "", true);
    if (!noConfig) add("config.json", cfg, C.encryptVerified(JSON.stringify({ file_password: fp }), master), false, meta("2024-01-01T00:00", "2024-01-01T00:00", "app", "config"));
    add("settings.json", cfg, C.encryptData(JSON.stringify({ session_timeout_seconds: 300, app_theme: "Light" }), fp));
    add("recovery-1", rec, C.encryptData(JSON.stringify({ file_password: fp }), "1234567812345678"));
    for (const [name, content, ap] of notes) add(name, ent, name === corrupt ? "bm90IGEgbm90ZQ==" : C.encryptData(content, fp), false, ap);
    return { tree: t, entries: `${prefix}3` };
}
const writeJson = (file, obj) => { fs.writeFileSync(file, JSON.stringify(obj)); return file; };
const A = vault("a", MASTER_A, FP_A, A_NOTES);
const B = vault("b", MASTER_B, FP_B, B_NOTES);
const driveA = writeJson(path.join(HERE, "A.json"), A.tree);
const driveB = writeJson(path.join(HERE, "B.json"), B.tree);

// Run the CLI on a COPY of a fake Drive (import writes into it).
function run(args, input, { drive = null, env = {}, preload = [], cwd = null } = {}) {
    const dir = cwd || fs.mkdtempSync(path.join(HERE, "run-"));
    const driveFile = drive ? writeJson(path.join(fs.mkdtempSync(path.join(HERE, "drive-")), "drive.json"), JSON.parse(fs.readFileSync(drive, "utf8"))) : "";
    const pre = [...preload, ...(drive ? [FF] : [])].flatMap((p) => ["-r", p]);
    const r = spawnSync(process.execPath, [...pre, CLI, ...args], { cwd: dir, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveFile, ...env } });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), cwd: dir, after: drive ? JSON.parse(fs.readFileSync(driveFile, "utf8")) : null };
}
const transferIn = (parent) => fs.readdirSync(parent).filter((d) => d.startsWith("eNotes Manager Transfer_")).map((d) => path.join(parent, d));
const isPrivate = (dir) => process.platform === "win32" || ((fs.statSync(dir).mode & 0o777) === 0o700 && fs.readdirSync(dir).every((f) => (fs.statSync(path.join(dir, f)).mode & 0o777) === 0o600));
const LEAKS = ["PIN-1111", "SECRET-", "café", "first dup", "B's own", PNG.slice(0, 20), "plain-text", "photo.png", "a:b*c?", "s-text"];

// ENOTES_TEST_PART: run just one part (the list: ./transfer.parts.mjs; tests/run-all.mjs runs them
// at once). Every part works with the same transfer folder, made below. Unset: all, in order.
const PART = process.env.ENOTES_TEST_PART || "";
if (PART && !PARTS.includes(PART)) { console.error(`ENOTES_TEST_PART must be one of ${PARTS.join(", ")} (or unset), not '${PART}'`); process.exit(2); }
const usedParts = [];
const inPart = (name) => {
    if (!PARTS.includes(name)) throw new Error(`part '${name}' is not in tests/cli/transfer.parts.mjs`);
    usedParts.push(name);
    return !PART || PART === name;
};

// The transfer folder that every part works with: A's notes, exported (the 'export' part checks it).
const OUT = fs.mkdtempSync(path.join(HERE, "out-"));
const NOW = "2026-03-04T05:06:30", T_NAME = "eNotes Manager Transfer_20260304_0506";
let r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveA, cwd: OUT, preload: [FN], env: { FAKE_EMAIL: "old@example.com", FAKE_NOW: NOW } });
const [T] = transferIn(OUT);
const tFiles = fs.readdirSync(T).sort();
const raw = tFiles.map((f) => fs.readFileSync(path.join(T, f), "utf8"));
const driveNone = writeJson(path.join(HERE, "none.json"), [{ id: "x", name: "Other", parents: ["appDataFolder"], mimeType: "application/vnd.google-apps.folder", content: "" }]);
const bEntries = (tree) => tree.filter((f) => (f.parents || [])[0] === B.entries);
const created = (after) => after.filter((f) => !B.tree.some((x) => x.id === f.id));
const untouched = (after) => B.tree.every((f) => JSON.stringify(after.find((x) => x.id === f.id)) === JSON.stringify(f));
const IMPORT = `${T}\n${MASTER_A}\nGOODTOKEN\n${MASTER_B}\ny\n`;
const added = A_NOTES.length - 1; // 'shared' is already in B
const dirOf = (x) => path.join(x.cwd, fs.readdirSync(x.cwd).find((d) => d.startsWith("eNotes Manager Export_")));
let fa = null; // A's normal export (made by 'import'; 'import-errors' makes its own when it runs without it)

if (inPart("export")) {
    console.log("1. '-m export' (account A)");
    ok(r.code === 0 && T && r.out.includes(`Exported ${A_NOTES.length} of ${A_NOTES.length} note(s) (4 sensitive)`), `exit 0, ${A_NOTES.length} notes exported` + (r.code === 0 ? "" : `: ${r.out.slice(-400)}`));
    ok(fs.readdirSync(OUT).join("|") === T_NAME && T === path.join(OUT, T_NAME),
        `no folder is asked for: it makes '${T_NAME}' (date and time, like the other modes' folders) in the folder it is run in - and writes nothing else there`);
    ok(r.out.split("(hidden): ").length - 1 === 2 && !r.out.includes("Folder to save") && r.out.includes(`Transfer folder: ${T}\n`) && r.out.includes(`into '${T}'.`) && r.out.includes("(it asks for this transfer folder)"),
        "asks only for the export token and the master password; shows the transfer folder's full path (the import asks for it)");
    ok(r.out.includes("old@example.com") && r.out.includes("-m import"), "names the account, and says how to import");
    ok(JSON.stringify(r.after) === JSON.stringify(A.tree), "account A's Drive is unchanged (export only reads)");
    ok(tFiles.length === A_NOTES.length && tFiles.every((f, i) => f === `note-${String(i + 1).padStart(4, "0")}.enotes`), `one file per note in 'eNotes Manager Transfer_<date>': ${tFiles[0]} ... ${tFiles.at(-1)}`);
    ok(isPrivate(T), "transfer folder 700, files 600");
    ok(raw.every((x) => x.startsWith("eNotesMgr transfer v1\n")) && raw.every((x) => LEAKS.every((m) => !x.includes(m))),
        "every file: the 'eNotesMgr transfer v1' marker, then only ciphertext - no note names, no content");
    const recs = raw.map((x) => tryDec(x.slice("eNotesMgr transfer v1\n".length).trim(), MASTER_A));
    ok(recs.every(Boolean) && raw.every((x) => [FP_A, MASTER_B, "wrong"].every((p) => tryDec(x.slice(22).trim(), p) === null)),
        "the files open with A's master password - not with A's file password, B's master password or a wrong one");
    const parsed = recs.map((x) => JSON.parse(x));
    ok(A_NOTES.every(([name, content, ap], i) => { const p = parsed[i]; return p.format === "eNotesMgr transfer" && p.version === 1 && p.name === name && p.content === content && JSON.stringify(p.appProperties) === JSON.stringify(ap); }),
        "each file holds its note EXACTLY: name (odd / unicode), stored content (sensitive: still locked), metadata incl. dates (null for the old-format note)");
    ok(!r.out.includes(MASTER_A) && !r.out.includes("GOODTOKEN") && LEAKS.slice(0, 5).every((m) => !r.out.includes(m)), "nothing secret printed");
    // Every file and folder under `dir` (path, content, mode) - to prove nothing changed.
    const snapshot = (dir) => JSON.stringify(fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
        const p = path.join(dir, f), st = fs.statSync(p);
        return [f, st.isDirectory() ? "<dir>" : fs.readFileSync(p, "base64"), st.mode];
    }));
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveA, cwd: OUT, preload: [FN], env: { FAKE_NOW: "2026-03-04T05:07:10" } }); // again, a minute later
    const both = transferIn(OUT);
    ok(r.code === 0 && both.map((d) => path.basename(d)).sort().join("|") === `${T_NAME}|eNotes Manager Transfer_20260304_0507` && both.every((d) => fs.readdirSync(d).length === A_NOTES.length) &&
        fs.readdirSync(T).every((f, i) => fs.readFileSync(path.join(T, f), "utf8") === raw[i]),
        "exporting again later makes a second dated folder ('..._0507') - the first one is never touched");
    const sameMinute = snapshot(OUT);
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveA, cwd: OUT, preload: [FN], env: { FAKE_NOW: "2026-03-04T05:07:50" } }); // the same minute as the second one
    ok(r.code === 1 && r.out.includes("A folder 'eNotes Manager Transfer_20260304_0507' already exists here") && r.out.includes("Nothing was written - wait a minute") &&
        !r.out.includes("Paste the export token") && snapshot(OUT) === sameMinute && transferIn(OUT).length === 2,
        "again in the SAME minute: stops at once with a clear message, before asking anything - nothing written, no ' (1)' folder, the existing folders untouched");
    const late = fs.mkdtempSync(path.join(HERE, "out-"));
    fs.mkdirSync(path.join(late, T_NAME)); fs.writeFileSync(path.join(late, T_NAME, "mine.txt"), "keep me");
    const lateBefore = snapshot(late);
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveA, cwd: late, preload: [FN], env: { FAKE_NOW: NOW, FAKE_LATE_FOLDER: "1" } });
    ok(r.code === 1 && r.out.includes(`A folder '${T_NAME}' already exists here`) && r.out.includes("Paste the export token") && snapshot(late) === lateBefore,
        "and if such a folder only appears while it runs (after its first look): it still never writes into it - stops, nothing written");
}

if (inPart("export-errors")) {
    console.log("\n2. '-m export': prompts, options and errors");
    const noFolder = (x) => fs.readdirSync(x.cwd).length === 0; // nothing at all written where it was run
    const p2 = (n) => String(n).padStart(2, "0");
    const stampOf = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
    const t0 = new Date();
    r = run(["-m", "export", "-t", "BADTOKEN", "-x", "-c", "x", "-d", "y", "-n", "z", "-s", "q", "-i"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveA });
    const t1 = new Date();
    ok(r.code === 0 && transferIn(r.cwd).length === 1 && fs.readdirSync(transferIn(r.cwd)[0]).length === A_NOTES.length, "every other option is ignored (even -t BADTOKEN): everything is asked");
    ok(fs.readdirSync(r.cwd).length === 1 && [stampOf(t0), stampOf(t1)].some((s) => path.basename(transferIn(r.cwd)[0]) === `eNotes Manager Transfer_${s}`),
        `with the real clock: the one folder made is 'eNotes Manager Transfer_<now as YYYYMMDD_HHMM>' (${path.basename(transferIn(r.cwd)[0] || "")})`);
    for (const [label, input, want] of [["wrong master password", "WrongPass9", "Could not decrypt config.json"], ["B's master password", MASTER_B, "Could not decrypt config.json"]]) {
        r = run(["-m", "export"], `GOODTOKEN\n${input}\n`, { drive: driveA });
        ok(r.code === 1 && r.out.includes(want) && noFolder(r), `${label}: clear error, no transfer folder made`);
    }
    r = run(["-m", "export"], `BADTOKEN\n${MASTER_A}\n`, { drive: driveA });
    ok(r.code === 1 && r.out.includes("rejected the export token") && noFolder(r), "bad token: clear error, nothing made");
    r = run(["-m", "export"], "\n", { drive: driveA });
    ok(r.code === 1 && r.out.includes("needs an export token") && noFolder(r), "empty token: clear error, nothing made");
    r = run(["-m", "export"], "", { drive: driveA });
    ok(r.code === 1 && noFolder(r), "no input at all (e.g. Ctrl+D): stops, nothing made");
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveNone });
    ok(r.code === 1 && r.out.includes("has no eNotesMgr data yet") && noFolder(r), "an account that never used the app: clear error");
    const driveNoCfg = writeJson(path.join(HERE, "nocfg.json"), vault("n", MASTER_A, FP_A, A_NOTES.slice(0, 2), { noConfig: true }).tree);
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveNoCfg });
    ok(r.code === 1 && r.out.includes("incomplete") && noFolder(r), "config.json missing: clear error");
    const dupTree = JSON.parse(JSON.stringify(A.tree));
    dupTree.unshift({ id: "dupcfg", name: "config.json", parents: ["a2"], mimeType: "text/plain", content: C.encryptData(JSON.stringify({ file_password: "another-key" }), MASTER_A), appProperties: { DateTimeCreated: "2020-01-01T00:00" } });
    dupTree.unshift({ id: "dupE", name: "Entries", parents: ["dupM"], mimeType: "application/vnd.google-apps.folder", content: "" });
    dupTree.unshift({ id: "dupM", name: "eNotes Manager", parents: ["appDataFolder"], mimeType: "application/vnd.google-apps.folder", content: "" });
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: writeJson(path.join(HERE, "A-dups.json"), dupTree), env: { FAKE_HIDE_ONCE: "Config,config.json" } });
    ok(r.code === 0 && transferIn(r.cwd).length === 1 && fs.readdirSync(transferIn(r.cwd)[0]).length === A_NOTES.length,
        "duplicate data (empty 2nd tree, older config.json with another key) + a momentary Drive miss: exports the real notes");
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: writeJson(path.join(HERE, "A-bad.json"), vault("c", MASTER_A, FP_A, A_NOTES, { corrupt: "rich" }).tree) });
    ok(r.code === 1 && r.out.includes("SKIPPED") && r.out.includes(`Exported ${A_NOTES.length - 1} of ${A_NOTES.length}`) && fs.readdirSync(transferIn(r.cwd)[0]).length === A_NOTES.length - 1,
        "a damaged note in Drive: skipped and reported, the others exported, exit 1");
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: writeJson(path.join(HERE, "A-empty.json"), vault("e", MASTER_A, FP_A, []).tree) });
    ok(r.code === 0 && r.out.includes("Exported 0 of 0") && fs.readdirSync(transferIn(r.cwd)[0]).length === 0, "an account with no notes: an empty transfer folder, exit 0");
    r = run(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { drive: driveA, preload: [N18] });
    ok(r.code === 0 && fs.readdirSync(transferIn(r.cwd)[0]).length === A_NOTES.length, "works on Node 18");
}

if (inPart("import")) {
    console.log("\n3. '-m import' into account B");
    r = run(["-m", "import"], IMPORT, { drive: driveB, env: { FAKE_EMAIL: "new@example.com" } });
    ok(r.code === 0 && r.out.includes(`${added} note(s) to add, 1 already there`) && r.out.includes(`Imported ${added} of ${added} note(s) into new@example.com`),
        `exit 0: ${added} added, 1 already there (identical) skipped` + (r.code === 0 ? "" : `: ${r.out.slice(-500)}`));
    ok(r.out.includes(`Add these ${added} note(s) to new@example.com? (y/N)`), "asks before adding, naming the account");
    ok(untouched(r.after) && created(r.after).length === added, "B's existing data untouched; only new notes added");
    const made = created(r.after);
    ok(made.every((f) => f.parents.length === 1 && f.parents[0] === B.entries && f.mimeType === "text/plain" && tryDec(f.content, FP_B) !== null && tryDec(f.content, FP_A) === null),
        "all in B's Entries folder, encrypted with B's file password only");
    const expectName = (name, i) => name === "plain-text" ? "plain-text (1)" : (name === "dup" && A_NOTES.slice(0, i).some((n) => n[0] === "dup")) ? "dup (1)" : name;
    let exact = 0;
    for (const [i, [name, content, ap]] of A_NOTES.entries()) {
        if (name === "shared") continue;
        const want = expectName(name, i);
        const f = bEntries(r.after).find((x) => x.name === want && made.includes(x));
        if (f && C.decryptData(f.content, FP_B) === content && JSON.stringify(f.appProperties || null) === JSON.stringify(ap)) exact++;
        else console.log(`      not exact: '${name}' -> '${want}'`);
    }
    ok(exact === added, `every note exactly as in A: same name (or ' (1)' when taken), same metadata incl. dates, same content (${exact}/${added})`);
    const fut = bEntries(r.after).find((f) => f.name === "future");
    ok(fut && fut.appProperties.FutureKey === "kept ✓" && fut.appProperties.Another === "" && Object.keys(fut.appProperties).length === 6,
        "metadata keys beyond the known ones travel too, unchanged (nothing is left out)");
    // The whole Drive record of every imported note is what the app itself writes
    // for a note it creates: name, a text/plain file in the Entries folder, the
    // note's metadata, its encrypted content - nothing more, nothing less.
    const aRec = (name) => A.tree.find((f) => f.name === name && f.parents[0] === A.entries);
    ok(made.every((f) => JSON.stringify(Object.keys(f).filter((k) => k !== "appProperties").sort()) === JSON.stringify(["content", "id", "mimeType", "name", "parents"])
        && f.mimeType === aRec(A_NOTES.find((n) => f.name === n[0] || f.name.replace(/ \(\d+\)/, "") === n[0])[0]).mimeType),
        "every imported note's Drive record has exactly the fields a note made in the app has (same type: text/plain)");
    ok(bEntries(r.after).some((f) => f.name === "plain-text (1)") && bEntries(r.after).filter((f) => f.name === "dup" || f.name === "dup (1)").length === 2 && bEntries(r.after).find((f) => f.name === "s:odd?"),
        "taken names: 'plain-text (1)'; A's two 'dup' notes: 'dup' + 'dup (1)'; 's:odd?' keeps its exact name");
    const sNo = bEntries(r.after).find((f) => f.name === "s-noext");
    ok(sNo.appProperties.FileType === "image" && sNo.appProperties.CreationMethod === "upload" && sNo.appProperties.Sensitive === "yes"
        && C.decryptData(S.unwrapSensitive(C.decryptData(sNo.content, FP_B)), "SecretNoExt3") === `data:application/octet-stream;base64,${GIF}`,
        "a sensitive picture without an extension keeps its exact type (image) and its exact content - nothing guessed");
    const pg = bEntries(r.after).find((f) => f.name === "page.html");
    ok(pg.appProperties.CreationMethod === "upload" && C.decryptData(pg.content, FP_B).startsWith("data:text/html;base64,"), "an uploaded .html file stays an uploaded file");
    ok(JSON.stringify(bEntries(r.after).find((f) => f.name === "legacy").appProperties || null) === "null", "the old-format note stays as it was (the app reads it the same way)");
    ok(!r.out.includes(MASTER_A) && !r.out.includes(MASTER_B) && !r.out.includes("GOODTOKEN") && LEAKS.slice(0, 5).every((m) => !r.out.includes(m)), "nothing secret printed");

    console.log("\n4. Round trip and re-runs");
    const driveB2 = writeJson(path.join(HERE, "B-after.json"), r.after);
    const expA = run(["-m", "on", "-t", "GOODTOKEN"], `${MASTER_A}\n`, { drive: driveA });
    const expB = run(["-m", "on", "-t", "GOODTOKEN"], `${MASTER_B}\n`, { drive: driveB2 });
    fa = dirOf(expA);
    const fb = dirOf(expB);
    const comparable = fs.readdirSync(fa).filter((f) => !/^(plain-text|dup)/.test(f));
    ok(comparable.every((f) => fs.existsSync(path.join(fb, f)) && Buffer.compare(fs.readFileSync(path.join(fa, f)), fs.readFileSync(path.join(fb, f))) === 0),
        `the normal export of B gives A's files byte for byte (${comparable.length} files, incl. .sensitive)`);
    r = run(["-m", "import"], IMPORT, { drive: driveB2 });
    ok(r.code === 0 && r.out.includes("Nothing to import: every note is already there") && JSON.stringify(r.after) === JSON.stringify(JSON.parse(fs.readFileSync(driveB2, "utf8"))),
        "importing the same folder again: every note is already there, nothing added");
    r = run(["-m", "import"], IMPORT, { drive: driveB, env: { FAKE_FAIL_CREATE: "rich,s-text,doc.pdf" } });
    ok(r.code === 1 && r.out.includes(`Imported ${added - 3} of ${added}`) && r.out.includes("run the import again") && created(r.after).length === added - 3,
        "Drive refuses 3 notes: the others are added, the 3 are listed, exit 1");
    const partial = writeJson(path.join(HERE, "B-partial.json"), r.after);
    r = run(["-m", "import"], IMPORT, { drive: partial });
    ok(r.code === 0 && r.out.includes(`3 note(s) to add, ${added - 3 + 1} already there`) && created(r.after).length === added && bEntries(r.after).length === B_NOTES.length + added,
        "running it again adds exactly the 3 missing notes - nothing twice");
    r = run(["-m", "import"], `${T}\n${MASTER_A}\nGOODTOKEN\n${MASTER_A}\ny\n`, { drive: driveA });
    ok(r.code === 0 && r.out.includes("every note is already there") && JSON.stringify(r.after) === JSON.stringify(A.tree), "importing into the SAME account it came from: nothing added");
}

if (inPart("import-errors")) {
    console.log("\n5. '-m import': what is read, prompts, options and errors");
    if (!fa) fa = dirOf(run(["-m", "on", "-t", "GOODTOKEN"], `${MASTER_A}\n`, { drive: driveA })); // without 'import': A's normal export, no checks
    const MIX = path.join(HERE, "mixed"); fs.cpSync(T, MIX, { recursive: true });
    fs.mkdirSync(path.join(MIX, "sub")); fs.copyFileSync(path.join(T, tFiles[0]), path.join(MIX, "sub", "inside.enotes"));
    fs.writeFileSync(path.join(MIX, "README.txt"), "hello"); fs.writeFileSync(path.join(MIX, ".DS_Store"), "x");
    fs.copyFileSync(path.join(fa, "s-text.sensitive"), path.join(MIX, "s-text.sensitive"));
    const otherA = vault("o", "OtherPass1", "fp-o", [["only-in-other", "<div>other</div>", meta("2024-01-01T00:00", "2024-01-01T00:00", "new", "richtext")]]);
    const oo = run(["-m", "export"], `GOODTOKEN\nOtherPass1\n`, { drive: writeJson(path.join(HERE, "other.json"), otherA.tree) }).cwd;
    fs.copyFileSync(path.join(transferIn(oo)[0], "note-0001.enotes"), path.join(MIX, "zz-other-password.enotes"));
    const tampered = raw[1].slice(0, 60) + (raw[1][60] === "A" ? "B" : "A") + raw[1].slice(61);
    fs.writeFileSync(path.join(MIX, "zz-tampered.enotes"), tampered);
    r = run(["-m", "import"], `${MIX}\n${MASTER_A}\nGOODTOKEN\n${MASTER_B}\ny\n`, { drive: driveB });
    ok(r.out.includes("ignoring sub/ (a sub-folder)") && r.out.includes("ignoring README.txt (not a transfer file)") && r.out.includes("ignoring s-text.sensitive (not a transfer file)") && r.out.includes("ignoring .DS_Store"),
        "only the folder's own transfer files are read: sub-folders and other files are ignored (and listed)");
    ok(r.out.includes("2 file(s) don't open with that password") && r.out.includes("zz-other-password.enotes") && r.out.includes("zz-tampered.enotes"),
        "transfer files of another password, or damaged, are reported and skipped");
    ok(r.code === 1 && created(r.after).length === added && !bEntries(r.after).some((f) => f.name === "only-in-other") && !r.after.some((f) => f.name === "inside"),
        "the readable notes are imported; nothing from the sub-folder; exit 1 because of the 2 unreadable files");
    for (const args of [["-m", "import", "-t", "BADTOKEN", "-x", "-c", "x", "-d", "y", "-n", "z", "-s", "q", "-i"]]) {
        r = run(args, IMPORT, { drive: driveB });
        ok(r.code === 0 && created(r.after).length === added, "every other option is ignored (even -t BADTOKEN): everything is asked");
    }
    r = run(["-m", "import"], `${path.join(HERE, "nope")}\n${IMPORT}`, { drive: driveB });
    ok(r.code === 0 && r.out.includes("Folder not found") && created(r.after).length === added, "a folder that doesn't exist is asked for again");
    const EMPTY = fs.mkdtempSync(path.join(HERE, "empty-")); fs.writeFileSync(path.join(EMPTY, "x.txt"), "x");
    r = run(["-m", "import"], `${EMPTY}\n${MASTER_A}\nGOODTOKEN\n${MASTER_B}\ny\n`, { drive: driveB });
    ok(r.code === 1 && r.out.includes("No transfer files") && !r.out.includes("Master password") && untouched(r.after) && created(r.after).length === 0,
        "a folder without transfer files: says so before asking any password, nothing written");
    const nothing = (x) => untouched(x.after) && created(x.after).length === 0;
    r = run(["-m", "import"], `${T}\nWrongPass9\nGOODTOKEN\n${MASTER_B}\ny\n`, { drive: driveB });
    ok(r.code === 1 && r.out.includes("None of the transfer files opens with that password") && !r.out.includes("export token of the NEW") && nothing(r),
        "wrong OLD master password: clear error before asking for the token, nothing written");
    r = run(["-m", "import"], `${T}\n${MASTER_A}\nGOODTOKEN\nWrongPass9\ny\n`, { drive: driveB });
    ok(r.code === 1 && r.out.includes("Could not decrypt config.json") && nothing(r), "wrong NEW master password: clear error, nothing written");
    r = run(["-m", "import"], `${T}\n${MASTER_A}\nBADTOKEN\n${MASTER_B}\ny\n`, { drive: driveB });
    ok(r.code === 1 && r.out.includes("rejected the export token") && nothing(r), "bad token: clear error, nothing written");
    r = run(["-m", "import"], `${T}\n${MASTER_A}\n\n`, { drive: driveB });
    ok(r.code === 1 && r.out.includes("needs an export token") && nothing(r), "empty token: clear error");
    r = run(["-m", "import"], IMPORT, { drive: driveNone });
    ok(r.code === 1 && r.out.includes("has no eNotesMgr data yet") && JSON.stringify(r.after) === fs.readFileSync(driveNone, "utf8"), "an account never set up: 'set it up first', nothing written");
    for (const [label, ans] of [["'n'", "n"], ["just Enter", ""]]) {
        r = run(["-m", "import"], `${T}\n${MASTER_A}\nGOODTOKEN\n${MASTER_B}\n${ans}\n`, { drive: driveB });
        ok(r.code === 0 && r.out.includes("Nothing imported") && nothing(r), `answering ${label} at the confirmation: nothing imported`);
    }
    r = run(["-m", "import"], IMPORT, { drive: writeJson(path.join(HERE, "B-dups.json"), (() => {
        const t = JSON.parse(JSON.stringify(B.tree));
        t.unshift({ id: "dc", name: "config.json", parents: ["b2"], mimeType: "text/plain", content: C.encryptData(JSON.stringify({ file_password: "another-key" }), MASTER_B), appProperties: { DateTimeCreated: "2020-01-01T00:00" } });
        t.unshift({ id: "dE", name: "Entries", parents: ["dM"], mimeType: "application/vnd.google-apps.folder", content: "" });
        t.unshift({ id: "dM", name: "eNotes Manager", parents: ["appDataFolder"], mimeType: "application/vnd.google-apps.folder", content: "" });
        return t; })()) });
    ok(r.code === 0 && created(r.after).filter((f) => !["dc", "dE", "dM"].includes(f.id)).every((f) => f.parents[0] === B.entries && tryDec(f.content, FP_B) !== null),
        "B with duplicate data: imports into the real Entries with the right key");
    r = run(["-m", "import"], IMPORT, { drive: driveB, preload: [N18] });
    ok(r.code === 0 && created(r.after).length === added, "works on Node 18");
}

if (inPart("rest")) {
    console.log("\n6. Usage");
    for (const [label, args] of [["-m bogus", ["-m", "bogus"]], ["no -m", []]]) {
        const u = run(args, "");
        ok(u.code === 1 && u.out.includes("'on', 'off', 'sensitive', 'export' or 'import'") && u.out.includes("-m export") && u.out.includes("-m import"), `${label}: the usage lists -m export / -m import`);
    }
    const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }).stdout;
    ok(["-m export", "-m import", "eNotes Manager Transfer_<date>", "master password of the OLD", "already there", "Move all your notes to another account"].every((x) => help.includes(x)), "--help documents -m export / -m import");

    console.log("\n7. Token and passwords are hidden in a real terminal");
    if (process.platform === "win32") console.log("  SKIP (needs a POSIX pseudo-terminal)");
    else {
        const one = fs.mkdtempSync(path.join(HERE, "pty-")); fs.copyFileSync(path.join(T, tFiles[0]), path.join(one, "note-0001.enotes"));
        const ptyDrive = writeJson(path.join(fs.mkdtempSync(path.join(HERE, "ptyd-")), "drive.json"), B.tree);
        const pty = spawnSync("python3", [path.join(CLI_DIR, "pty_transfer.py"), CLI, FF, ptyDrive, one, "GOODTOKEN", MASTER_A, MASTER_B], { encoding: "utf8" });
        if (pty.status !== 0 && !pty.stdout) console.log("  SKIP (python3 not available): " + (pty.stderr || "").trim());
        else ok(pty.stdout.includes("token visible: False") && pty.stdout.includes("old password visible: False") && pty.stdout.includes("new password visible: False") && pty.stdout.includes("imported: True"),
            "import: the token and both master passwords are not shown on screen; the import completes: " + pty.stdout.trim());
    }
}

if (usedParts.join() !== PARTS.join()) throw new Error(`tests/cli/transfer.parts.mjs must list exactly the parts, in order: ${usedParts.join(", ")}`);

fs.rmSync(HERE, { recursive: true, force: true });
console.log(`\n${checks} checks` + (fails ? `, ${fails} FAILURE(S)` : ", ALL PASSED"));
process.exitCode = fails ? 1 : 0;
