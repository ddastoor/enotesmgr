// Export CLI '-m rotate': a NEW file password for the same account, nothing lost.
// Account A (every kind of note: rich text, pictures, uploads, sensitive notes of every kind, odd / unicode
// names, two notes with the same name, an empty one, one from before the metadata existed, unknown metadata
// keys, 1 MB) with its own settings (incl. a key this test doesn't know) is rotated: the backup is A's data
// byte for byte, the saved notes and settings open with A's master password exactly, A's data is deleted
// only after the typed confirmation, and after the "app" set the account up again (the fake Drive adds a
// freshly set-up tree when the new token is used) every note is back EXACTLY (name, metadata incl. dates,
// content) under the NEW file password - which the old one doesn't open - with the settings carried over and
// the new config.json / recovery codes untouched. Then: every guard (nothing deleted unless everything is
// saved and checked, data the rotation wouldn't carry stops it), stopping after the deletion and finishing
// later, failures at every step, settings missing / unreadable, other options, Node 18, usage and help.
// Usage: node tests/cli/rotate.mjs   (or via tests/run-all.mjs; ENOTES_TEST_PART runs one part)
import { spawnSync } from "child_process";
import fs from "fs"; import path from "path"; import os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { PARTS } from "./rotate.parts.mjs";

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CLI_DIR, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FF = path.join(CLI_DIR, "fakefetch.cjs");
const N18 = path.join(CLI_DIR, "node18sim.cjs");
const FN = path.join(CLI_DIR, "fakenow.cjs");
const HERE = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-cli-rotate-"));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL " + m); } else console.log("  PASS " + m); };

const PART = process.env.ENOTES_TEST_PART || "";
if (PART && !PARTS.includes(PART)) { console.error(`ENOTES_TEST_PART must be one of ${PARTS.join(", ")} (or unset), not '${PART}'`); process.exit(2); }
const usedParts = [];
const inPart = (name) => {
    if (!PARTS.includes(name)) throw new Error(`part '${name}' is not in tests/cli/rotate.parts.mjs`);
    usedParts.push(name);
    return !PART || PART === name;
};

const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
const C = await imp("www/js/crypto/crypto.js"); await C.cryptoReady;
const S = await imp("www/js/lib/sensitiveNote.js");
const tryDec = (c, p) => { try { return C.decryptData(c, p); } catch { return null; } };

// ---------------- account A, and the same account set up again ----------------
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const BIG = Buffer.alloc(1024 * 1024); for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 2654435761) >>> 24;
const embed = (b64, mime) => `<span class="media-embed" contenteditable="false"><img src="data:${mime};base64,${b64}"></span>`;
const meta = (created, modified, how, type, sensitive) => ({ DateTimeCreated: created, DateTimeModified: modified, CreationMethod: how, FileType: type, ...(sensitive ? { Sensitive: "yes" } : {}) });
const sens = (content, pw) => S.wrapSensitive(C.encryptVerified(content, pw));
// [name, stored content (after the file-password layer), appProperties]
const NOTES = [
    ["plain-text", "<div>Plain PIN-1111 café ✓ &lt;tag&gt;</div>", meta("2024-03-01T09:15", "2025-07-04T18:30", "new", "richtext")],
    ["rich", `<div><b>Bold</b></div>${embed(PNG, "image/png")} ${embed(GIF, "image/gif")}`, meta("2024-03-02T10:00", "2024-03-02T10:05", "new", "richtext")],
    ["photo.png", `data:image/png;base64,${PNG}`, meta("2024-04-01T08:00", "2024-04-01T08:00", "upload", "image")],
    ["scan", `data:application/octet-stream;base64,${PNG}`, meta("2024-04-02T08:00", "2024-04-02T08:00", "upload", "image")],
    ["big.bin", `data:application/octet-stream;base64,${BIG.toString("base64")}`, meta("2024-04-05T08:00", "2024-04-05T08:00", "upload", "UNKNOWN")],
    ["a:b*c? ✓", "<div>odd name</div>", meta("2024-05-01T00:00", "2024-05-01T00:00", "new", "richtext")],
    ["empty", "", meta("2024-05-02T00:00", "2024-05-02T00:00", "new", "richtext")],
    ["legacy", "[metadata begin]\nDateTimeCreated=2020-01-01T00:00\nCreationMethod=new\nFileType=richtext\n[metadata end]\n<div>from an old version</div>", null],
    ["dup", "<div>first dup</div>", meta("2024-06-01T00:00", "2024-06-01T00:00", "new", "richtext")],
    ["dup", "<div>second dup</div>", meta("2024-06-02T00:00", "2024-06-02T00:00", "new", "richtext")],
    ["s-text", sens("<div>SECRET-1 PIN-2222</div>", "SecretText1"), meta("2024-07-01T00:00", "2024-07-09T00:00", "new", "richtext", true)],
    ["s-photo.png", sens(`data:image/png;base64,${PNG}`, "SecretPhoto2"), meta("2024-07-02T00:00", "2024-07-02T00:00", "upload", "image", true)],
    ["s:odd?", sens("<div>SECRET-4</div>", "SecretOdd44"), meta("2024-07-04T00:00", "2024-07-04T00:00", "new", "richtext", true)],
    ["future", "<div>has extra metadata</div>", { ...meta("2024-09-01T00:00", "2024-09-02T00:00", "new", "richtext"), FutureKey: "kept ✓", Another: "" }],
];
const SETTINGS = { session_timeout_seconds: 900, app_theme: "Dark", extra_setting: "kept ✓" };
const SETTINGS_META = { DateTimeCreated: "2024-01-01T00:00", DateTimeModified: "2025-02-02T00:00", CreationMethod: "app", FileType: "settings" };
const MASTER = "MasterA123", FP = "aaaaaaaa-1111-4ccc-8ddd-aaaaaaaaaaaa";
const NEW_MASTER = "MasterN789", NEW_FP = "nnnnnnnn-9999-4ccc-8ddd-nnnnnnnnnnnn";
const EMAIL = "tester@gmail.com";
const FOLDER = "application/vnd.google-apps.folder";

function vault(prefix, notes, { settings = SETTINGS, settingsKey = FP, extra = null } = {}) {
    const t = []; let n = 0;
    const add = (name, parent, content, folder, ap) => { const id = `${prefix}${++n}`; t.push({ id, name, parents: [parent], mimeType: folder ? FOLDER : "text/plain", content: content || "", ...(ap ? { appProperties: ap } : {}) }); return id; };
    const mgr = add("eNotes Manager", "appDataFolder", "", true);
    const cfg = add("Config", mgr, "", true), ent = add("Entries", mgr, "", true), rec = add("Recovery", mgr, "", true);
    add("config.json", cfg, C.encryptVerified(JSON.stringify({ file_password: FP }), MASTER), false, meta("2024-01-01T00:00", "2024-01-01T00:00", "app", "config"));
    if (settings) add("settings.json", cfg, C.encryptData(JSON.stringify(settings), settingsKey), false, SETTINGS_META);
    for (let i = 1; i <= 3; i++) add(`recovery-${prefix}${i}`, rec, C.encryptData(JSON.stringify({ file_password: FP }), `123456781234567${i}`), false, meta("2024-01-01T00:00", "2024-01-01T00:00", "app", "recovery"));
    for (const [name, content, ap] of notes) add(name, ent, C.encryptData(content, FP), false, ap);
    if (extra) extra({ add, mgr, cfg, ent, rec });
    return { tree: t, entries: ent, config: cfg };
}
// The same account, set up again in the app: a new config.json (new file password), the default settings,
// new recovery codes, no notes.
const SETUP_SETTINGS_META = { DateTimeCreated: "2026-11-13T09:00", DateTimeModified: "2026-11-13T09:00", CreationMethod: "app", FileType: "settings" };
const SETUP = (() => {
    const t = [];
    const add = (id, name, parent, content, folder, ap) => t.push({ id, name, parents: [parent], mimeType: folder ? FOLDER : "text/plain", content: content || "", ...(ap ? { appProperties: ap } : {}) });
    add("n1", "eNotes Manager", "appDataFolder", "", true);
    add("n2", "Config", "n1", "", true); add("n3", "Entries", "n1", "", true); add("n4", "Recovery", "n1", "", true);
    add("n5", "config.json", "n2", C.encryptVerified(JSON.stringify({ file_password: NEW_FP }), NEW_MASTER), false, meta("2026-11-13T09:00", "2026-11-13T09:00", "app", "config"));
    add("n6", "settings.json", "n2", C.encryptData(JSON.stringify({ session_timeout_seconds: 300, app_theme: "Light" }), NEW_FP), false, SETUP_SETTINGS_META);
    for (let i = 1; i <= 2; i++) add(`n${6 + i}`, `recovery-n${i}`, "n4", C.encryptData(JSON.stringify({ file_password: NEW_FP }), `876543218765432${i}`), false, meta("2026-11-13T09:00", "2026-11-13T09:00", "app", "recovery"));
    return t;
})();
const writeJson = (file, obj) => { fs.writeFileSync(file, JSON.stringify(obj)); return file; };
const A = vault("a", NOTES);
const setupFile = writeJson(path.join(HERE, "setup.json"), SETUP);
// A fresh copy of a fake Drive, for one scenario (all its runs use and change it).
const driveCopy = (tree) => writeJson(path.join(fs.mkdtempSync(path.join(HERE, "drive-")), "drive.json"), tree);
const readDrive = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function run(args, input, { drive, env = {}, preload = [], cwd = null } = {}) {
    const dir = cwd || fs.mkdtempSync(path.join(HERE, "run-"));
    const pre = [...preload, ...(drive ? [FF] : [])].flatMap((p) => ["-r", p]);
    const r = spawnSync(process.execPath, [...pre, CLI, ...args], {
        cwd: dir, input, encoding: "utf8", timeout: 5 * 60 * 1000,
        env: { ...process.env, FAKE_DRIVE: drive || "", FAKE_EMAIL: EMAIL, FAKE_SETUP_TREE: setupFile, ...env },
    });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), cwd: dir };
}
const rotationIn = (cwd) => fs.readdirSync(cwd).filter((d) => d.startsWith("eNotes Manager Rotation_")).map((d) => path.join(cwd, d));
const stateOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "rotation.json"), "utf8"));
const WIPE = `WIPE ${EMAIL}`;
const ALL_THE_WAY = `GOODTOKEN\n${MASTER}\n${WIPE}\nNEWTOKEN\n${NEW_MASTER}\n`;
const SECRETS = [MASTER, NEW_MASTER, FP, NEW_FP, "GOODTOKEN", "NEWTOKEN", "PIN-1111", "SECRET-", "first dup"];
const isPrivate = (p) => process.platform === "win32" || fs.readdirSync(p, { recursive: true }).map((f) => path.join(p, f)).concat([p])
    .every((f) => (fs.statSync(f).mode & 0o777) === (fs.statSync(f).isDirectory() ? 0o700 : 0o600));
const kidsOf = (tree, parent) => tree.filter((f) => f.parents.includes(parent));

// Everything a finished rotation must have done. notes / settings: what account A had.
function checkRotated(label, r, driveFile, cwd, { notes = NOTES, settings = SETTINGS, before = A.tree } = {}) {
    const after = readDrive(driveFile);
    const [rot] = rotationIn(cwd);
    ok(r.code === 0 && r.out.includes(`Rotation finished for ${EMAIL}`) && rot, `${label}: exit 0, 'Rotation finished'` + (r.code === 0 ? "" : `: ${r.out.slice(-700)}`));
    if (!rot) return;
    const st = stateOf(rot);
    ok(st.phase === "done" && st.account === EMAIL && st.notes === notes.length && st.settings === !!settings && SECRETS.every((x) => !JSON.stringify(st).includes(x)),
        `${label}: rotation.json: done, ${EMAIL}, ${notes.length} notes, settings ${!!settings} - and no secret in it`);
    ok(isPrivate(rot), `${label}: the rotation folder is private (folders 700, files 600)`);
    // The backup: A's data byte for byte, folder by folder.
    const sameFolder = (driveFolder, localDir) => {
        const want = kidsOf(before, driveFolder).map((f) => f.content).sort();
        const got = fs.existsSync(localDir) ? fs.readdirSync(localDir).map((f) => fs.readFileSync(path.join(localDir, f), "utf8")).sort() : [];
        return JSON.stringify(want) === JSON.stringify(got);
    };
    const mgr = before.find((f) => f.name === "eNotes Manager");
    const sub = (name) => before.find((f) => f.name === name && f.parents.includes(mgr.id)).id;
    ok(["Config", "Entries", "Recovery"].every((n) => sameFolder(sub(n), path.join(rot, "backup", n))), `${label}: backup/ is the account's data byte for byte (Config, Entries, Recovery - still encrypted)`);
    // The saved notes and settings.
    const tdir = path.join(rot, "transfer");
    const recs = fs.readdirSync(tdir).sort().map((f) => {
        const text = fs.readFileSync(path.join(tdir, f), "utf8");
        return text.startsWith("eNotesMgr transfer v1\n") ? JSON.parse(tryDec(text.slice(22).trim(), MASTER) || "null") : null;
    });
    ok(recs.length === notes.length && notes.every(([name, content, ap], i) => recs[i] && recs[i].name === name && recs[i].content === content && JSON.stringify(recs[i].appProperties) === JSON.stringify(ap)),
        `${label}: transfer/ holds every note exactly (name, metadata, stored content), locked with the master password`);
    if (settings) {
        const text = fs.readFileSync(path.join(rot, "settings.enotes-settings"), "utf8");
        const back = JSON.parse(tryDec(text.slice("eNotesMgr settings v1\n".length).trim(), MASTER) || "null");
        ok(back && back.format === "eNotesMgr settings" && JSON.stringify(back.settings) === JSON.stringify(settings), `${label}: the settings file holds the settings exactly, locked with the master password`);
    }
    // Google Drive now: the old data gone, the set-up account with every note back under the NEW file password.
    ok(!after.some((f) => before.some((b) => b.id === f.id)), `${label}: the old data is gone from Drive - nothing of it is left`);
    const entries = kidsOf(after, "n3");
    let exact = 0;
    for (const [name, content, ap] of notes) {
        const f = entries.find((x) => x.name === name && tryDec(x.content, NEW_FP) === content && JSON.stringify(x.appProperties || null) === JSON.stringify(ap));
        if (f) exact++;
    }
    ok(entries.length === notes.length && exact === notes.length, `${label}: every note is back EXACTLY - same name, metadata incl. dates, content (${exact}/${notes.length})`);
    ok(entries.every((f) => tryDec(f.content, FP) === null && tryDec(f.content, NEW_FP) !== null), `${label}: every note opens with the NEW file password, none with the old one`);
    ok(entries.every((f) => JSON.stringify(Object.keys(f).filter((k) => k !== "appProperties").sort()) === '["content","id","mimeType","name","parents"]' && f.mimeType === "text/plain"),
        `${label}: each note's Drive record is what the app makes (a text/plain file in Entries)`);
    const sj = after.find((f) => f.id === "n6");
    if (settings) {
        ok(JSON.stringify(JSON.parse(tryDec(sj.content, NEW_FP) || "null")) === JSON.stringify(settings), `${label}: settings.json holds the old settings exactly, under the new file password`);
        ok(sj.appProperties.DateTimeCreated === SETUP_SETTINGS_META.DateTimeCreated && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(sj.appProperties.DateTimeModified) &&
            sj.appProperties.CreationMethod === "app" && sj.appProperties.FileType === "settings",
            `${label}: settings.json's metadata as the app writes it on a save (created kept, modified now, app / settings)`);
    } else {
        ok(sj.content === SETUP.find((f) => f.id === "n6").content, `${label}: no settings carried: settings.json is the set-up's, untouched`);
    }
    ok(["n1", "n2", "n3", "n4", "n5", "n7", "n8"].every((id) => JSON.stringify(after.find((f) => f.id === id)) === JSON.stringify(SETUP.find((f) => f.id === id))) &&
        after.filter((f) => f.name === "settings.json").length === 1,
        `${label}: the new config.json and the new recovery codes are untouched; one settings.json`);
    ok(SECRETS.every((x) => !r.out.includes(x)), `${label}: nothing secret printed (passwords, file passwords, tokens, note content)`);
}

// ======================================================================================
if (inPart("full")) {
    console.log("1. A whole rotation in one go");
    const drive = driveCopy(A.tree);
    const r = run(["-m", "rotate"], ALL_THE_WAY, { drive });
    checkRotated("rotation", r, drive, r.cwd);
    ok(r.out.split("(hidden): ").length - 1 === 4 && r.out.includes(`type exactly: ${WIPE}`), "asks: token, master password, the typed confirmation, the new token and the new master password");
    ok(["1. Backing up", "2. Saving every note and your settings", "3. Checking", "Every note and the settings opens again", "Deleted.", "set eNotesMgr up", "Copy Export Token",
        "Putting your 14 note(s) back", "settings put back", "Checking every note in Google Drive", "its file password is NEW", "old codes no longer work"].every((x) => r.out.includes(x)),
        "says what it does at every step, and what it did");
    ok(r.out.indexOf("3. Checking") < r.out.indexOf("type exactly") && r.out.indexOf("type exactly") < r.out.indexOf("Deleted."), "the deletion comes only after the check and the confirmation");
    // The transfer folder is a normal one: -m import takes it.
    const [rot] = rotationIn(r.cwd);
    const other = driveCopy(SETUP);
    const im = run(["-m", "import"], `${path.join(rot, "transfer")}\n${MASTER}\nGOODTOKEN\n${NEW_MASTER}\ny\n`, { drive: other });
    ok(im.code === 0 && im.out.includes(`Imported ${NOTES.length} of ${NOTES.length} note(s)`), "its transfer/ folder is a normal transfer folder: '-m import' adds every note from it");
    console.log("   ... on Node 18");
    const d18 = driveCopy(A.tree);
    const r18 = run(["-m", "rotate"], ALL_THE_WAY, { drive: d18, preload: [N18] });
    checkRotated("on Node 18", r18, d18, r18.cwd);
}

if (inPart("guards")) {
    console.log("\n2. Nothing is deleted unless everything is saved and checked and confirmed");
    const untouched = (file, tree = A.tree) => JSON.stringify(readDrive(file)) === JSON.stringify(tree);
    for (const [label, answer] of [["a wrong confirmation", `wipe ${EMAIL}`], ["just Enter", ""], ["another e-mail", "WIPE someone@gmail.com"]]) {
        const drive = driveCopy(A.tree);
        const r = run(["-m", "rotate"], `GOODTOKEN\n${MASTER}\n${answer}\n`, { drive });
        const [rot] = rotationIn(r.cwd);
        ok(r.code === 0 && r.out.includes("Stopped: nothing was deleted") && untouched(drive) && rot && stateOf(rot).phase === "cancelled" && !r.out.includes("Deleted."),
            `${label} at the confirmation: stops, nothing deleted, Drive untouched (the saved copy is left for the user to delete)`);
    }
    const noFolder = (r) => fs.readdirSync(r.cwd).length === 0;
    for (const [label, input, want] of [["wrong master password", `GOODTOKEN\nWrongPass9\n${WIPE}\n`, "Could not decrypt config.json"],
        ["bad token", `BADTOKEN\n${MASTER}\n${WIPE}\n`, "rejected the export token"], ["empty token", "\n", "needs an export token"], ["no input at all", "", "needs an export token"]]) {
        const drive = driveCopy(A.tree);
        const r = run(["-m", "rotate"], input, { drive });
        ok(r.code === 1 && r.out.includes(want) && r.out.includes("Rotation failed") && untouched(drive) && noFolder(r), `${label}: clear error, nothing written, Drive untouched`);
    }
    let drive = driveCopy([{ id: "x", name: "Other", parents: ["appDataFolder"], mimeType: FOLDER, content: "" }]);
    let r = run(["-m", "rotate"], ALL_THE_WAY, { drive });
    ok(r.code === 1 && r.out.includes("has no eNotesMgr data yet") && r.out.includes("eNotes Manager Rotation_<date>") && noFolder(r), "an account without eNotesMgr data: says so (and where a stopped rotation is continued), nothing written");
    // A note that can't be read: it couldn't be saved, so nothing is deleted.
    const bad = vault("c", NOTES); bad.tree.find((f) => f.name === "rich").content = "bm90IGEgbm90ZQ==";
    drive = driveCopy(bad.tree);
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive });
    ok(r.code === 1 && r.out.includes("1 note(s) could not be read (rich)") && r.out.includes("Nothing was deleted") && untouched(drive, bad.tree) && stateOf(rotationIn(r.cwd)[0]).phase === "stopped" && !r.out.includes("type exactly"),
        "a damaged note in Drive: it can't be saved, so the rotation stops before asking - nothing deleted");
    // Data the rotation would not carry over.
    for (const [label, extra, want] of [
        ["a 2nd 'eNotes Manager' folder with files", ({ add }) => { const m = add("eNotes Manager", "appDataFolder", "", true); add("x", add("Entries", m, "", true), "data"); }, "second 'eNotes Manager' folder"],
        ["a 2nd Entries folder with a note", ({ add, mgr }) => add("lost", add("Entries", mgr, "", true), C.encryptData("<div>x</div>", FP)), "another folder of your eNotesMgr data"],
        ["a file in another folder", ({ add, mgr }) => add("odd.txt", add("Other", mgr, "", true), "x"), "another folder of your eNotesMgr data"],
    ]) {
        const v = vault("d", NOTES.slice(0, 3), { extra });
        drive = driveCopy(v.tree);
        r = run(["-m", "rotate"], `GOODTOKEN\n${MASTER}\n${WIPE}\nNEWTOKEN\n${NEW_MASTER}\n`, { drive });
        ok(r.code === 1 && r.out.includes(want) && r.out.includes("Nothing was done") && untouched(drive, v.tree) && noFolder(r), `${label}: data the rotation would not carry over - it stops before doing anything`);
    }
    // An EMPTY 2nd 'eNotes Manager' folder (a Drive glitch leftover) is deleted too, so the app sets up afresh.
    const withEmpty = vault("e", NOTES.slice(0, 4), { extra: ({ add }) => add("Entries", add("eNotes Manager", "appDataFolder", "", true), "", true) });
    drive = driveCopy(withEmpty.tree);
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive });
    checkRotated("with an empty 2nd 'eNotes Manager' folder", r, drive, r.cwd, { notes: NOTES.slice(0, 4), before: withEmpty.tree });
    ok(readDrive(drive).filter((f) => f.name === "eNotes Manager").length === 1, "  ... and that empty leftover folder is deleted too (only the new set-up remains)");
    // Same minute: a rotation folder of this minute is already here.
    const cwd = fs.mkdtempSync(path.join(HERE, "same-"));
    fs.mkdirSync(path.join(cwd, "eNotes Manager Rotation_20260304_0506"));
    drive = driveCopy(A.tree);
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive, cwd, preload: [FN], env: { FAKE_NOW: "2026-03-04T05:06:30" } });
    ok(r.code === 1 && r.out.includes("already exists here") && !r.out.includes("Paste the export token") && untouched(drive) && fs.readdirSync(cwd).length === 1,
        "a rotation folder of the same minute already here: stops before asking anything");
    // Every other option is ignored.
    drive = driveCopy(A.tree);
    r = run(["-m", "rotate", "-t", "BADTOKEN", "-x", "-c", "x", "-d", "y", "-n", "z", "-s", "q"], ALL_THE_WAY, { drive });
    checkRotated("with every other option given", r, drive, r.cwd);
}

if (inPart("resume")) {
    console.log("\n3. Stopped after the deletion, finished later");
    const drive = driveCopy(A.tree);
    const cwd = fs.mkdtempSync(path.join(HERE, "resume-"));
    let r = run(["-m", "rotate"], `GOODTOKEN\n${MASTER}\n${WIPE}\n`, { drive, cwd });
    const [rot] = rotationIn(cwd);
    ok(r.code === 1 && r.out.includes("The rotation is NOT finished") && r.out.includes("Nothing is lost") && r.out.includes("-m rotate") && stateOf(rot).phase === "wiped" &&
        !readDrive(drive).some((f) => f.name === "eNotes Manager"), "no new token (input ended) after the deletion: stops, says nothing is lost and how to finish");
    r = run(["-m", "rotate"], "n\n", { drive, cwd });
    ok(r.code === 1 && r.out.includes("Continue it? (Y/n)") && r.out.includes("finish that rotation first") && stateOf(rot).phase === "wiped" && rotationIn(cwd).length === 1,
        "run again, answering 'n': does nothing - and never starts a new rotation over an unfinished one");
    r = run(["-m", "rotate"], `y\nWrongPass9\n`, { drive, cwd });
    ok(r.code === 1 && r.out.includes("does not open with that password") && stateOf(rot).phase === "wiped", "the wrong master password for the saved notes: clear error, still unfinished");
    r = run(["-m", "rotate"], `y\n${MASTER}\nGOODTOKEN\nNEWTOKEN\nWrongPass9\n`, { drive, cwd, env: { FAKE_NEW_EMAIL: EMAIL } });
    ok(r.code === 1 && r.out.includes("is not set up yet") && r.out.includes("Rotation stopped: Could not decrypt config.json") && r.out.includes("NOT finished") && stateOf(rot).phase === "wiped",
        "the old token (account not set up yet): asks again; then a wrong new master password: stops, how to finish");
    r = run(["-m", "rotate"], `\n${MASTER}\nNEWTOKEN\n`, { drive, cwd, env: { FAKE_NEW_EMAIL: "someone.else@gmail.com" } });
    ok(r.code === 1 && r.out.includes("That token is for someone.else@gmail.com, but this rotation is for " + EMAIL) && stateOf(rot).phase === "wiped",
        "a token of ANOTHER account: refused (asks again), nothing put there");
    r = run(["-m", "rotate"], `\n${MASTER}\nNEWTOKEN\n${NEW_MASTER}\n`, { drive, cwd });
    checkRotated("finished later (Enter = continue)", r, drive, cwd);
    ok(r.out.includes("Continuing the rotation of " + EMAIL) && r.out.includes("14 note(s) and your settings are ready to be put back"), "  ... it continued the stopped rotation");
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive: driveCopy(SETUP), cwd });
    ok(!r.out.includes("Continue it?"), "a finished rotation is not offered again");
    // The saved notes damaged after the deletion: refused - the backup is untouched.
    const d2 = driveCopy(A.tree), cwd2 = fs.mkdtempSync(path.join(HERE, "resume2-"));
    run(["-m", "rotate"], `GOODTOKEN\n${MASTER}\n${WIPE}\n`, { drive: d2, cwd: cwd2 });
    const [rot2] = rotationIn(cwd2);
    fs.rmSync(path.join(rot2, "transfer", "note-0003.enotes"));
    r = run(["-m", "rotate"], `\n${MASTER}\nNEWTOKEN\n${NEW_MASTER}\n`, { drive: d2, cwd: cwd2 });
    ok(r.code === 1 && r.out.includes("it is not complete") && r.out.includes("backup") && !readDrive(d2).some((f) => f.parents.includes("n3")), "a saved note missing: refuses to continue (puts nothing back), points to the backup");
}

if (inPart("failures")) {
    console.log("\n4. Failures along the way");
    // The deletion fails: everything is still in Drive.
    let drive = driveCopy(A.tree), cwd = fs.mkdtempSync(path.join(HERE, "fail-"));
    let r = run(["-m", "rotate"], ALL_THE_WAY, { drive, cwd, env: { FAKE_FAIL_DELETE: "1" } });
    const [rot] = rotationIn(cwd);
    ok(r.code === 1 && r.out.includes("could not delete the data") && r.out.includes("Your notes are safe") && JSON.stringify(readDrive(drive)) === JSON.stringify(A.tree) && stateOf(rot).phase === "wiping",
        "the deletion fails: clear error, all data still in Drive");
    r = run(["-m", "rotate"], `\n${MASTER}\nGOODTOKEN\n${WIPE}\nNEWTOKEN\n${NEW_MASTER}\n`, { drive, cwd });
    ok(r.out.includes("still has its OLD eNotesMgr data") && r.out.includes("the deletion did not happen"), "run again: sees the old data is still there, asks to confirm the deletion again");
    checkRotated("after a failed deletion", r, drive, cwd);
    // Putting the notes back fails for some: run again adds just those.
    drive = driveCopy(A.tree); cwd = fs.mkdtempSync(path.join(HERE, "fail2-"));
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive, cwd, env: { FAKE_FAIL_CREATE: "rich,s-text" } });
    ok(r.code === 1 && r.out.includes("2 note(s) could not be put back: rich, s-text") && r.out.includes("NOT finished") && stateOf(rotationIn(cwd)[0]).phase === "wiped" &&
        readDrive(drive).filter((f) => f.parents.includes("n3")).length === NOTES.length - 2, "2 notes can't be put back: stops (the others are back), says how to finish");
    r = run(["-m", "rotate"], `\n${MASTER}\nNEWTOKEN\n${NEW_MASTER}\n`, { drive, cwd });
    ok(r.out.includes(`2 note(s) to add, ${NOTES.length - 2} already there`), "run again: adds just the 2 missing notes - nothing twice");
    checkRotated("after failed notes", r, drive, cwd);
    // Saving the settings fails.
    drive = driveCopy(A.tree); cwd = fs.mkdtempSync(path.join(HERE, "fail3-"));
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive, cwd, env: { FAKE_FAIL_UPDATE: "1" } });
    ok(r.code === 1 && r.out.includes("the settings could not be saved") && stateOf(rotationIn(cwd)[0]).phase === "wiped", "the settings can't be saved: stops, says how to finish");
    r = run(["-m", "rotate"], `\n${MASTER}\nNEWTOKEN\n${NEW_MASTER}\n`, { drive, cwd });
    checkRotated("after failed settings", r, drive, cwd);
}

if (inPart("settings-and-rest")) {
    console.log("\n5. Settings missing or unreadable; no notes; usage and help");
    let v = vault("f", NOTES.slice(0, 5), { settings: null });
    let drive = driveCopy(v.tree);
    let r = run(["-m", "rotate"], ALL_THE_WAY, { drive });
    ok(r.out.includes("this account has no saved settings") && !fs.existsSync(path.join(rotationIn(r.cwd)[0], "settings.enotes-settings")), "no settings.json: says so, nothing saved for them");
    checkRotated("without settings", r, drive, r.cwd, { notes: NOTES.slice(0, 5), settings: null, before: v.tree });
    v = vault("g", NOTES.slice(0, 5), { settingsKey: "another-key" });
    drive = driveCopy(v.tree);
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive });
    ok(r.out.includes("the saved settings could not be read"), "settings.json that doesn't open: says so, the rotation goes on");
    checkRotated("with unreadable settings", r, drive, r.cwd, { notes: NOTES.slice(0, 5), settings: null, before: v.tree });
    v = vault("h", []);
    drive = driveCopy(v.tree);
    r = run(["-m", "rotate"], ALL_THE_WAY, { drive });
    checkRotated("an account with no notes", r, drive, r.cwd, { notes: [], before: v.tree });
    for (const [label, args] of [["-m bogus", ["-m", "bogus"]], ["no -m", []]]) {
        const u = run(args, "");
        ok(u.code === 1 && u.out.includes("'on', 'off', 'sensitive', 'export', 'import' or 'rotate'") && u.out.includes("-m rotate"), `${label}: the usage lists -m rotate`);
    }
    const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }).stdout;
    ok(["-m rotate", "eNotes Manager Rotation_<date>", "WIPE <your e-mail>", "new recovery codes", "run '-m rotate' again in the", "never changes or deletes"].every((x) => help.includes(x)),
        "--help documents -m rotate (and still: the utility never changes or deletes anything otherwise)");
}

if (!PART && usedParts.join() !== PARTS.join()) throw new Error(`tests/cli/rotate.parts.mjs must list exactly the parts, in order: ${usedParts.join(", ")}`);
fs.rmSync(HERE, { recursive: true, force: true });
console.log(`\n${checks} checks` + (fails ? `, ${fails} FAILURE(S)` : ", ALL PASSED"));
process.exitCode = fails ? 1 : 0;
