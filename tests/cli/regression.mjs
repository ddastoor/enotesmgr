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

const vaults = [buildVault("none", NORMAL, []), buildVault("mixed", NORMAL, SENSITIVE), buildVault("sensitive", [], SENSITIVE)];
for (const v of vaults) {
    console.log(`\n=== vault '${v.label}' (${v.names.length} notes) ===`);
    const M = `${MASTER}\n`, D = { drive: v.drive };
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
    console.log("  -m on -x");
    same("on -x -t", ["-m", "on", "-t", "GOODTOKEN", "-x"], "", D);
    same("on -x, token at the prompt", ["-m", "on", "-x"], "GOODTOKEN\n", D);
    same("on -x, bad token", ["-m", "on", "-t", "BADTOKEN", "-x"], "", D);
    same("on -x, duplicate data", ["-m", "on", "-t", "GOODTOKEN", "-x"], "", { drive: v.dups });
    console.log("  -m off");
    const bad = path.join(HERE, "nope");
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

console.log("\n=== usage / help: only the text about the new modes is new ===");
for (const args of [[], ["-m", "bogus"], ["-m"], ["-t", "GOODTOKEN"]]) {
    const a = run(OLDCLI, args, ""), b = run(NEWCLI, args, "");
    const oldUsage = a.out.slice(a.out.indexOf(USAGE_AT)).split("\n"), newUsage = new Set(b.out.slice(b.out.indexOf(USAGE_AT)).split("\n"));
    ok(a.code === 1 && b.code === 1 && !Object.keys(b.files).length && b.out.includes("Usage:") && oldUsage.every((l) => newUsage.has(l)) && b.out.includes("-m export") && b.out.includes("-m import"),
        `${JSON.stringify(args)}: still a usage error (exit 1, nothing written); the usage keeps every old line and adds -m export / -m import`);
}
const helpOld = spawnSync(process.execPath, [OLDCLI, "--help"], { encoding: "utf8" }).stdout.split("\n");
const helpNew = spawnSync(process.execPath, [NEWCLI, "--help"], { encoding: "utf8" }).stdout.split("\n");
const dropped = helpOld.filter((l) => !helpNew.includes(l));
ok(dropped.every((l) => /only reads from Google Drive|never changes or deletes|anything there\./.test(l)),
    "--help: every line of the old help is still there, except the one about Drive being only read (now: only '-m import' adds notes)" + (dropped.length ? `: ${JSON.stringify(dropped)}` : ""));

fs.rmSync(HERE, { recursive: true, force: true });
console.log(`\n${checks} checks` + (fails ? `, ${fails} FAILURE(S)` : ", ALL PASSED"));
process.exitCode = fails ? 1 : 0;
