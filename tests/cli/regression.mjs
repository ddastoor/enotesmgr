// Export CLI regression: the modes that already existed behave EXACTLY as before.
// The CLI as it was on main before '-m export' / '-m import' were added (commit
// REFERENCE) and the current CLI are run side by side with identical inputs, in
// every mode and option combination of '-m on', '-m on -x', '-m off' and
// '-m sensitive' - on vaults without, with and with only sensitive notes. Both
// must give the same exit code, the same console output and byte-identical
// files (same names, same permissions), and leave the (fake) Drive unchanged.
// Only the usage / help text may differ (it now lists the two new modes).
// Usage: node tests/cli/regression.mjs   (or via tests/run-all.mjs)
import { spawnSync } from "child_process";
import fs from "fs"; import path from "path"; import os from "os"; import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import { VAULTS, MODES, PARTS } from "./regression.parts.mjs";

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CLI_DIR, "..", "..");
const NEWCLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FF = path.join(CLI_DIR, "fakefetch.cjs");
const N18 = path.join(CLI_DIR, "node18sim.cjs");
const REFERENCE = "518db4b"; // main before '-m export' / '-m import'
const HERE = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-cli-regression-"));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL " + m); } else console.log("  PASS " + m); };

const ref = spawnSync("git", ["-C", ROOT, "show", `${REFERENCE}:www/enotesmgr-export-cli.js`], { maxBuffer: 64 * 1024 * 1024 });
if (ref.status !== 0) { console.error(`Could not read the reference CLI from git (${REFERENCE}). A full clone is needed.`); process.exit(1); }
const OLDCLI = path.join(HERE, "reference-cli.js");
fs.writeFileSync(OLDCLI, ref.stdout);

const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
const C = await imp("www/js/crypto/crypto.js"); await C.cryptoReady;
const S = await imp("www/js/lib/sensitiveNote.js");

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const embed = (b64, mime) => `<span class="media-embed" contenteditable="false"><img src="data:${mime};base64,${b64}"></span>`;
const NORMAL = [
    ["plain", "<div>Plain PIN 1111 café ✓</div>"],
    ["rich", `<div><b>B</b></div>${embed(PNG, "image/png")} ${embed(GIF, "image/gif")}`],
    ["photo.png", `data:image/png;base64,${PNG}`],
    ["doc.pdf", `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64")}`],
    ["noext", `data:image/png;base64,${PNG}`],
    ["a:b*c?", "<div>odd</div>"],
    ["empty", ""],
    ["bank.html", "<div>clashes with bank</div>"],
    ["bank", "<div>bank</div>"],
];
const SENSITIVE = [
    ["s-text", "<div>SECRET-1</div>", "SecretText1"],
    ["s-photo.png", `data:image/gif;base64,${GIF}`, "SecretPhoto2"],
    ["s:odd?", "<div>SECRET-3</div>", "SecretOdd33"],
];
const MASTER = "Master123", FP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
function buildVault(label, normal, sensitive) {
    const dir = path.join(HERE, label);
    fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
    const config = C.encryptVerified(JSON.stringify({ file_password: FP }), MASTER);
    fs.writeFileSync(path.join(dir, "config.json"), config);
    const tree = []; let n = 0;
    const add = (name, parent, content, folder) => { const id = `${label}-${++n}`; tree.push({ id, name, parents: [parent], mimeType: folder ? "application/vnd.google-apps.folder" : "text/plain", content: content || "" }); return id; };
    const mgr = add("eNotes Manager", "appDataFolder", "", true);
    const cfg = add("Config", mgr, "", true), ent = add("Entries", mgr, "", true), rec = add("Recovery", mgr, "", true);
    add("config.json", cfg, config); add("settings.json", cfg, C.encryptData("{}", FP)); add("recovery-1", rec, C.encryptData(JSON.stringify({ file_password: FP }), "1234567812345678"));
    for (const [name, content, pw] of [...normal, ...sensitive]) {
        const cipher = C.encryptData(pw ? S.wrapSensitive(C.encryptVerified(content, pw)) : content, FP);
        add(name, ent, cipher);
        fs.writeFileSync(path.join(dir, "notes", name), cipher);
    }
    const write = (f, t) => { fs.writeFileSync(path.join(dir, f), JSON.stringify(t)); return path.join(dir, f); };
    const dups = JSON.parse(JSON.stringify(tree));
    dups.unshift({ id: label + "-dc", name: "config.json", parents: [cfg], mimeType: "text/plain", content: C.encryptData(JSON.stringify({ file_password: "another" }), MASTER), appProperties: { DateTimeCreated: "2020-01-01T00:00" } });
    dups.unshift({ id: label + "-dM", name: "eNotes Manager", parents: ["appDataFolder"], mimeType: "application/vnd.google-apps.folder", content: "" });
    return { label, dir, config: path.join(dir, "config.json"), notes: path.join(dir, "notes"), names: [...normal, ...sensitive].map((x) => x[0]), pws: Object.fromEntries(sensitive.map((x) => [x[0], x[2]])),
        drive: write("drive.json", tree), dups: write("drive-dups.json", dups), noconfig: write("drive-noconfig.json", tree.filter((f) => f.name !== "config.json")) };
}

// Run one CLI in a fresh folder on a COPY of the fake Drive; snapshot everything it did.
function run(cli, args, input, { drive = null, env = {}, preload = [], setup = null } = {}) {
    const cwd = fs.mkdtempSync(path.join(HERE, "run-"));
    if (setup) setup(cwd);
    const before = new Set(fs.readdirSync(cwd));
    const driveCopy = drive ? path.join(fs.mkdtempSync(path.join(HERE, "d-")), "drive.json") : "";
    if (drive) fs.copyFileSync(drive, driveCopy);
    const pre = [...preload, ...(drive ? [FF] : [])].flatMap((p) => ["-r", p]);
    const r = spawnSync(process.execPath, [...pre, cli, ...args.map((a) => a.replace("{cwd}", cwd))], { cwd, input: input.replaceAll("{cwd}", cwd), encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveCopy, ...env } });
    const files = {};
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        const rel = path.relative(cwd, p).replace(/_\d{8}_\d{4}/g, "_<stamp>");
        if (d === cwd && before.has(e.name)) return; // made by setup
        const mode = (fs.statSync(p).mode & 0o777).toString(8);
        if (e.isDirectory()) { files[rel + "/"] = mode; walk(p); }
        else files[rel] = mode + " " + crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    });
    walk(cwd);
    const norm = (s) => (s || "").replaceAll(cwd, "<cwd>").replace(/_\d{8}_\d{4}/g, "_<stamp>");
    return { code: r.status, out: norm(r.stdout) + "\n--stderr--\n" + norm(r.stderr), files, driveSame: !drive || fs.readFileSync(driveCopy, "utf8") === fs.readFileSync(drive, "utf8") };
}
// The usage text (shown after a usage error) now also lists the two new modes:
// everything before it must be identical, and every line of the old usage text
// must still be in the new one.
const USAGE_AT = "Usage:\n";
function sameOutput(a, b) {
    const ia = a.indexOf(USAGE_AT), ib = b.indexOf(USAGE_AT);
    if (ia === -1 || ib === -1) return a === b;
    const newLines = new Set(b.slice(ib).split("\n"));
    return a.slice(0, ia) === b.slice(0, ib) && a.slice(ia).split("\n").every((l) => newLines.has(l));
}
function same(label, args, input, opts = {}) {
    const a = run(OLDCLI, args, input, opts), b = run(NEWCLI, args, input, opts);
    const okCode = a.code === b.code, okOut = sameOutput(a.out, b.out), okFiles = JSON.stringify(a.files) === JSON.stringify(b.files);
    ok(okCode && okOut && okFiles && a.driveSame && b.driveSame,
        `${label}: same exit (${b.code}), same output, same ${Object.keys(b.files).length} file(s)` +
        (okCode ? "" : ` | exit ${a.code} vs ${b.code}`) + (okOut ? "" : ` | output differs:\n---before---\n${a.out.slice(-600)}\n---now---\n${b.out.slice(-600)}`) +
        (okFiles ? "" : ` | files differ: ${JSON.stringify(a.files)} vs ${JSON.stringify(b.files)}`) + (b.driveSame ? "" : " | Drive changed!"));
    return b;
}

// ENOTES_TEST_PART: run just one part - one mode of one vault ("<vault>:<mode>"), or "rest" (usage /
// help); the list is in ./regression.parts.mjs. tests/run-all.mjs runs the parts at once. Unset: all.
const PART = process.env.ENOTES_TEST_PART || "";
if (PART && !PARTS.includes(PART)) { console.error(`ENOTES_TEST_PART must be one of ${PARTS.join(", ")} (or unset), not '${PART}'`); process.exit(2); }
const vaultDefs = { none: [NORMAL, []], mixed: [NORMAL, SENSITIVE], sensitive: [[], SENSITIVE] };
if (Object.keys(vaultDefs).join() !== VAULTS.join()) { console.error(`tests/cli/regression.parts.mjs must list exactly the vaults: ${Object.keys(vaultDefs).join(", ")}`); process.exit(2); }
const usedModes = new Set();
for (const [vaultLabel, [normal, sensitive]] of Object.entries(vaultDefs)) {
    if (PART && !PART.startsWith(vaultLabel + ":")) continue;
    // One mode's checks: they run unless just another part was asked for.
    const inMode = (mode) => {
        if (!MODES.includes(mode)) throw new Error(`mode '${mode}' is not in tests/cli/regression.parts.mjs`);
        usedModes.add(mode);
        return !PART || PART === `${vaultLabel}:${mode}`;
    };
    const v = buildVault(vaultLabel, normal, sensitive);
    console.log(`\n=== vault '${v.label}' (${v.names.length} notes) ===`);
    const M = `${MASTER}\n`, D = { drive: v.drive };
    const bad = path.join(HERE, "nope");
    if (inMode("on")) {
        console.log("  -m on");
        same("on -t", ["-m", "on", "-t", "GOODTOKEN"], M, D);
        same("on, token at the prompt", ["-m", "on"], `  GOODTOKEN  \n${MASTER}\n`, D);
        same("on, '-t' without a value", ["-m", "on", "-t"], `GOODTOKEN\n${MASTER}\n`, D);
        same("on with -c / -n / -d / -s too", ["-m", "on", "-t", "GOODTOKEN", "-c", v.config, "-n", v.config, "-d", v.notes, "-s", v.notes], M, D);
        same("on, bad token", ["-m", "on", "-t", "BADTOKEN"], M, D);
        same("on, empty token", ["-m", "on"], "\n", D);
        same("on, wrong master password", ["-m", "on", "-t", "GOODTOKEN"], "WrongPass9\n", D);
        same("on, duplicate data", ["-m", "on", "-t", "GOODTOKEN"], M, { drive: v.dups });
        same("on, momentary Drive miss", ["-m", "on", "-t", "GOODTOKEN"], M, { ...D, env: { FAKE_HIDE_ONCE: "eNotes Manager,Config,Entries,config.json" } });
        same("on, config.json missing", ["-m", "on", "-t", "GOODTOKEN"], M, { drive: v.noconfig });
        same("on, Node 18", ["-m", "on", "-t", "GOODTOKEN"], M, { ...D, preload: [N18] });
    }
    if (inMode("on-x")) {
        console.log("  -m on -x");
        same("on -x -t", ["-m", "on", "-t", "GOODTOKEN", "-x"], "", D);
        same("on -x, token at the prompt", ["-m", "on", "-x"], "GOODTOKEN\n", D);
        same("on -x, bad token", ["-m", "on", "-t", "BADTOKEN", "-x"], "", D);
        same("on -x, duplicate data", ["-m", "on", "-t", "GOODTOKEN", "-x"], "", { drive: v.dups });
    }
    if (inMode("off")) {
        console.log("  -m off");
        same("off -c -d", ["-m", "off", "-c", v.config, "-d", v.notes], M);
        for (const n of v.names) same(`off -c -n '${n}'`, ["-m", "off", "-c", v.config, "-n", path.join(v.notes, n)], M);
        same("off -c -n -d", ["-m", "off", "-c", v.config, "-n", path.join(v.notes, v.names[0]), "-d", v.notes], M);
        for (const [label, input] of [["d", `d\n${v.notes}\n${MASTER}\n`], ["default", `\n${v.notes}\n${MASTER}\n`], ["f", `f\n${path.join(v.notes, v.names[0])}\n${MASTER}\n`], ["file", `file\n${path.join(v.notes, v.names[0])}\n${MASTER}\n`]]) {
            same(`off -c only, wizard '${label}'`, ["-m", "off", "-c", v.config], input);
        }
        same("off -d only", ["-m", "off", "-d", v.notes], `${v.config}\n${MASTER}\n`);
        same("off -n only", ["-m", "off", "-n", path.join(v.notes, v.names[0])], `${v.config}\n${MASTER}\n`);
        same("off, full wizard", ["-m", "off"], `${v.config}\nd\n${v.notes}\n${MASTER}\n`);
        same("off, bad paths re-asked", ["-m", "off", "-c", bad, "-d", bad], `${v.config}\n${v.notes}\n${MASTER}\n`);
        same("off, -d given a file / -n given a folder", ["-m", "off", "-c", v.config, "-d", v.config], `${v.notes}\n${MASTER}\n`);
        same("off, empty path", ["-m", "off"], "\n");
        same("off, wrong master password", ["-m", "off", "-c", v.config, "-d", v.notes], "WrongPass9\n");
        same("off with -t / -x / -s too", ["-m", "off", "-c", v.config, "-d", v.notes, "-t", "GOODTOKEN", "-x", "-s", v.notes], M);
        same("off, folder with non-note files", ["-m", "off", "-c", v.config, "-d", "{cwd}/messy"], M, { setup: (cwd) => { fs.cpSync(v.notes, path.join(cwd, "messy"), { recursive: true }); fs.writeFileSync(path.join(cwd, "messy", "README.txt"), "x"); } });
        same("off, Node 18", ["-m", "off", "-c", v.config, "-d", v.notes], M, { preload: [N18] });
    }
    if (inMode("sensitive")) {
        console.log("  -m sensitive");
        // The .sensitive files to decrypt: from an export (made fresh in each run's folder).
        const withExport = (cwd) => {
            spawnSync(process.execPath, [NEWCLI, "-m", "off", "-c", v.config, "-d", v.notes], { cwd, input: M, encoding: "utf8" });
            fs.renameSync(path.join(cwd, fs.readdirSync(cwd).find((d) => d.startsWith("eNotes Manager Export_"))), path.join(cwd, "exp"));
        };
        const sensFiles = Object.keys(v.pws).map((n) => n.replace(/[\/\\:*?"<>|]/g, "_") + ".sensitive").sort();
        const pwOf = (f) => v.pws[Object.keys(v.pws).find((n) => n.replace(/[\/\\:*?"<>|]/g, "_") + ".sensitive" === f)];
        const allPw = sensFiles.map(pwOf).join("\n") + "\n";
        same("sensitive -s <folder>", ["-m", "sensitive", "-s", "{cwd}/exp"], allPw, { setup: withExport });
        same("sensitive, folder asked", ["-m", "sensitive"], `{cwd}/exp\n${allPw}`, { setup: withExport });
        same("sensitive, bad path re-asked", ["-m", "sensitive", "-s", bad], `{cwd}/exp\n${allPw}`, { setup: withExport });
        for (const f of sensFiles) same(`sensitive -s ${f}, wrong then right`, ["-m", "sensitive", "-s", `{cwd}/exp/${f}`], `WrongPass9\n${pwOf(f)}\n`, { setup: withExport });
        same("sensitive, all skipped", ["-m", "sensitive", "-s", "{cwd}/exp"], sensFiles.map(() => "").join("\n") + "\n", { setup: withExport });
        same("sensitive with -p / -t / -x too", ["-m", "sensitive", "-s", "{cwd}/exp", "-p", "x", "-t", "GOODTOKEN", "-x"], allPw, { setup: withExport });
        same("sensitive, a normal export file", ["-m", "sensitive", "-s", `{cwd}/exp/${v.names[0] === "plain" ? "plain.html" : "nothing"}`], "", { setup: withExport });
        same("sensitive, a still-encrypted note file", ["-m", "sensitive", "-s", path.join(v.notes, v.names[0])], "");
        same("sensitive, Node 18", ["-m", "sensitive", "-s", "{cwd}/exp"], allPw, { setup: withExport, preload: [N18] });
    }
}

// '-m export' and '-m import' were moved into code they now share with '-m rotate'. They must behave EXACTLY
// as the CLI on main before '-m rotate' (TRANSFER_REFERENCE): both run side by side with identical inputs -
// same exit code, same output, the same files with the same permissions, the same notes in them (transfer
// files are encrypted with a fresh random nonce every time, so they are compared opened), and the same Drive
// afterwards (compared by name, place, metadata and opened content - new files get random ids).
if (!PART || PART === "export-import") {
    const TRANSFER_REFERENCE = "2b77f16"; // main before '-m rotate'
    const ref2 = spawnSync("git", ["-C", ROOT, "show", `${TRANSFER_REFERENCE}:www/enotesmgr-export-cli.js`], { maxBuffer: 64 * 1024 * 1024 });
    if (ref2.status !== 0) { console.error(`Could not read the reference CLI from git (${TRANSFER_REFERENCE}). A full clone is needed.`); process.exit(1); }
    const OLDCLI2 = path.join(HERE, "transfer-reference-cli.js");
    fs.writeFileSync(OLDCLI2, ref2.stdout);
    console.log(`\n=== -m export / -m import: exactly as the CLI on main before -m rotate (${TRANSFER_REFERENCE}) ===`);
    const tryOpen = (c, pw) => { try { return C.decryptData(c, pw); } catch { return null; } };
    const runX = (cli, args, input, { drive = null, env = {}, preload = [] } = {}) => {
        const cwd = fs.mkdtempSync(path.join(HERE, "x-"));
        const copy = drive ? path.join(fs.mkdtempSync(path.join(HERE, "xd-")), "drive.json") : "";
        if (drive) fs.copyFileSync(drive, copy);
        const pre = [...preload, ...(drive ? [FF] : [])].flatMap((p) => ["-r", p]);
        const r = spawnSync(process.execPath, [...pre, cli, ...args], { cwd, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: copy, ...env } });
        const norm = (t) => (t || "").replaceAll(cwd, "<cwd>").replace(/_\d{8}_\d{4}/g, "_<stamp>");
        return { code: r.status, out: norm(r.stdout) + "\n--stderr--\n" + norm(r.stderr), cwd, drive: copy };
    };
    // Every file the run wrote: its path, permissions and - for a transfer file - the note in it, opened.
    const filesView = (cwd) => {
        const out = {};
        const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
            const p = path.join(d, e.name), rel = path.relative(cwd, p).replace(/_\d{8}_\d{4}/g, "_<stamp>");
            const mode = (fs.statSync(p).mode & 0o777).toString(8);
            if (e.isDirectory()) { out[rel + "/"] = mode; walk(p); return; }
            const text = fs.readFileSync(p, "utf8");
            out[rel] = mode + " " + (text.startsWith("eNotesMgr transfer v1\n") ? tryOpen(text.slice(22).trim(), MASTER) : crypto.createHash("sha256").update(text).digest("hex"));
        });
        walk(cwd);
        return JSON.stringify(out);
    };
    // The Drive: every item by its place, name, type, metadata and opened content (ids left out).
    const driveView = (file) => {
        if (!file) return "";
        const items = JSON.parse(fs.readFileSync(file, "utf8"));
        const byId = new Map(items.map((f) => [f.id, f]));
        const place = (f) => { const p = byId.get(f.parents[0]); return (p ? place(p) + "/" : "") + f.name; };
        return JSON.stringify(items.map((f) => ({ at: place(f), mime: f.mimeType, ap: f.appProperties || null,
            content: f.mimeType === "text/plain" ? (tryOpen(f.content, FP) ?? tryOpen(f.content, MASTER) ?? "RAW " + f.content) : "" })).map((x) => JSON.stringify(x)).sort());
    };
    const sameT = (label, args, input, opts = {}) => {
        const a = runX(OLDCLI2, args, input, opts), b = runX(NEWCLI, args, input, opts);
        const okCode = a.code === b.code, okOut = a.out === b.out, okFiles = filesView(a.cwd) === filesView(b.cwd), okDrive = driveView(a.drive) === driveView(b.drive);
        ok(okCode && okOut && okFiles && okDrive, `${label}: same exit (${b.code}), same output, same files and notes, same Drive` +
            (okCode ? "" : ` | exit ${a.code} vs ${b.code}`) + (okOut ? "" : ` | output differs:\n---before---\n${a.out.slice(-700)}\n---now---\n${b.out.slice(-700)}`) +
            (okFiles ? "" : " | files differ") + (okDrive ? "" : " | Drive differs"));
        return b;
    };
    const vx = buildVault("x-mixed", NORMAL, SENSITIVE), vn = buildVault("x-none", NORMAL, []), vs = buildVault("x-sens", [], SENSITIVE);
    const ME = `GOODTOKEN\n${MASTER}\n`;
    console.log("  -m export");
    for (const v of [vx, vn, vs]) sameT(`export, vault '${v.label}'`, ["-m", "export"], ME, { drive: v.drive });
    sameT("export, wrong master password", ["-m", "export"], "GOODTOKEN\nWrongPass9\n", { drive: vx.drive });
    sameT("export, bad token", ["-m", "export"], `BADTOKEN\n${MASTER}\n`, { drive: vx.drive });
    sameT("export, empty token", ["-m", "export"], "\n", { drive: vx.drive });
    sameT("export, no input at all", ["-m", "export"], "", { drive: vx.drive });
    sameT("export, other options given (ignored)", ["-m", "export", "-t", "BADTOKEN", "-x", "-c", "x", "-d", "y", "-n", "z", "-s", "q"], ME, { drive: vx.drive });
    sameT("export, duplicate data", ["-m", "export"], ME, { drive: vx.dups });
    sameT("export, config.json missing", ["-m", "export"], ME, { drive: vx.noconfig });
    sameT("export, a momentary Drive miss", ["-m", "export"], ME, { drive: vx.drive, env: { FAKE_HIDE_ONCE: "Config,config.json" } });
    sameT("export, Node 18", ["-m", "export"], ME, { drive: vx.drive, preload: [N18] });
    console.log("  -m import");
    // A transfer folder of vault x-mixed (made once), imported into account B (x-b: two notes, one of
    // whose names is taken by a note of x-mixed).
    const made = runX(NEWCLI, ["-m", "export"], ME, { drive: vx.drive });
    const T = path.join(made.cwd, fs.readdirSync(made.cwd).find((d) => d.startsWith("eNotes Manager Transfer_")));
    const vb = buildVault("x-b", [["plain", "<div>B's own plain</div>"], ["only-b", "<div>B</div>"]], []);
    const IM = `${T}\n${MASTER}\nGOODTOKEN\n${MASTER}\ny\n`;
    sameT("import into another account (a name taken)", ["-m", "import"], IM, { drive: vb.drive });
    sameT("import, answer 'n'", ["-m", "import"], `${T}\n${MASTER}\nGOODTOKEN\n${MASTER}\nn\n`, { drive: vb.drive });
    sameT("import, just Enter at the question", ["-m", "import"], `${T}\n${MASTER}\nGOODTOKEN\n${MASTER}\n\n`, { drive: vb.drive });
    const once = runX(NEWCLI, ["-m", "import"], IM, { drive: vb.drive });
    sameT("import again (every note already there)", ["-m", "import"], IM, { drive: once.drive });
    sameT("import into the account it came from", ["-m", "import"], IM, { drive: vx.drive });
    sameT("import, some notes refused by Drive", ["-m", "import"], IM, { drive: vb.drive, env: { FAKE_FAIL_CREATE: "rich,s-text" } });
    sameT("import, wrong OLD master password", ["-m", "import"], `${T}\nWrongPass9\nGOODTOKEN\n${MASTER}\ny\n`, { drive: vb.drive });
    sameT("import, wrong NEW master password", ["-m", "import"], `${T}\n${MASTER}\nGOODTOKEN\nWrongPass9\ny\n`, { drive: vb.drive });
    sameT("import, bad token", ["-m", "import"], `${T}\n${MASTER}\nBADTOKEN\n${MASTER}\ny\n`, { drive: vb.drive });
    sameT("import, a folder that doesn't exist first", ["-m", "import"], `${path.join(HERE, "nope")}\n${IM}`, { drive: vb.drive });
    const junk = fs.mkdtempSync(path.join(HERE, "junk-")); fs.writeFileSync(path.join(junk, "x.txt"), "x");
    sameT("import, a folder without transfer files", ["-m", "import"], `${junk}\n${MASTER}\nGOODTOKEN\n${MASTER}\ny\n`, { drive: vb.drive });
    sameT("import, other options given (ignored)", ["-m", "import", "-t", "BADTOKEN", "-x", "-c", "x"], IM, { drive: vb.drive });
    sameT("import, Node 18", ["-m", "import"], IM, { drive: vb.drive, preload: [N18] });
}

if (!PART && [...usedModes].join() !== MODES.join()) { console.error(`tests/cli/regression.parts.mjs must list exactly the modes: ${[...usedModes].join(", ")}`); process.exit(2); }
if (PART && PART !== "rest") { // just one mode of one vault: done
    fs.rmSync(HERE, { recursive: true, force: true });
    console.log(`\n${checks} checks` + (fails ? `, ${fails} FAILURE(S)` : ", ALL PASSED"));
    process.exit(fails ? 1 : 0);
}


console.log("\n=== usage / help: only the text about the new modes is new ===");
for (const args of [[], ["-m", "bogus"], ["-m"], ["-t", "GOODTOKEN"]]) {
    const a = run(OLDCLI, args, ""), b = run(NEWCLI, args, "");
    const oldUsage = a.out.slice(a.out.indexOf(USAGE_AT)).split("\n"), newUsage = new Set(b.out.slice(b.out.indexOf(USAGE_AT)).split("\n"));
    ok(a.code === 1 && b.code === 1 && !Object.keys(b.files).length && b.out.includes("Usage:") && oldUsage.every((l) => newUsage.has(l)) && b.out.includes("-m export") && b.out.includes("-m import"),
        `${JSON.stringify(args)}: still a usage error (exit 1, nothing written); the usage keeps every old line and adds -m export / -m import`);
}
// The help was rewritten to be easier to read, so its lines changed - but nothing it said may be lost:
// every mode and option, every section, every example command, and the key facts of the old help.
const helpOld = spawnSync(process.execPath, [OLDCLI, "--help"], { encoding: "utf8" }).stdout;
const helpNew = spawnSync(process.execPath, [NEWCLI, "--help"], { encoding: "utf8" }).stdout;
const oldFlags = helpOld.split("\n").map((l) => /^  (-h, --help|-[a-z](?: <[a-z]+>| [a-z]+)?)\s/.exec(l)).filter(Boolean).map((m) => m[1]);
const oldExamples = helpOld.split("\n").filter((l) => l.startsWith("      node enotesmgr-export-cli.js"));
const sections = ["USAGE", "MODES", "OPTIONS", "WHERE config.json COMES FROM", "WHAT YOU GET", "SECURITY", "EXAMPLES"];
const facts = ["Copy Export Token", "valid about 1 hour", "eNotes Manager Export_<date>", "eNotes Manager_<date>", "eNotes Manager Sensitive_<date>", "hidden app-data area",
    "Decrypt Sensitive File", "just Enter skips", "hidden prompts", "shell", "folders 700, files 600", "NOT encrypted", "nothing is ever overwritten", "master password that was in use",
    "doesn't exist is asked for again", "are ignored", "-d wins", "never changes or deletes"];
const lost = [...oldFlags, ...oldExamples, ...sections, ...facts].filter((x) => !helpNew.includes(x));
ok(oldFlags.length >= 10 && oldExamples.length >= 4 && lost.length === 0,
    `--help (rewritten to be easier to read): still has every mode and option (${oldFlags.length}), every example command (${oldExamples.length}), every section and the key facts of the old help` +
    (lost.length ? `; missing: ${JSON.stringify(lost)}` : ""));

fs.rmSync(HERE, { recursive: true, force: true });
console.log(`\n${checks} checks` + (fails ? `, ${fails} FAILURE(S)` : ", ALL PASSED"));
process.exitCode = fails ? 1 : 0;
