// Export CLI tests: runs the ORIGINAL CLI (from git history, before any of the
// security hardening) and the CURRENT www/enotesmgr-export-cli.js side by side in
// every mode, and checks the exported files are byte-for-byte identical, plus
// the hardening (private file modes, hidden token prompt, safe mirror paths,
// Node 18). Online mode uses an in-process fake Google Drive (fakefetch.cjs).
// Everything runs in a temporary folder that is deleted afterwards.
// Usage: node tests/cli/run.mjs   (or via tests/run-all.mjs)
import { spawnSync } from "child_process";
import fs from "fs"; import path from "path"; import crypto from "crypto"; import os from "os";
import { fileURLToPath } from "url";
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CLI_DIR, "..", "..");
const BASELINE_COMMIT = "419c522"; // last commit before the hardening work
const NEWCLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const HERE = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-cli-test-"));
const OLDCLI = path.join(HERE, "baseline-cli.js");
const base = spawnSync("git", ["-C", ROOT, "show", `${BASELINE_COMMIT}:www/enotesmgr-export-cli.js`], { maxBuffer: 64 * 1024 * 1024 });
if (base.status !== 0) {
  console.error(`Could not read the baseline CLI from git (${BASELINE_COMMIT}). A full clone of the repo is needed.\n` + base.stderr);
  process.exit(1);
}
fs.writeFileSync(OLDCLI, base.stdout);
const seed = spawnSync(process.execPath, [path.join(CLI_DIR, "mkseed.mjs"), path.join(ROOT, "www", "js", "crypto")], { cwd: HERE, encoding: "utf8" });
if (seed.status !== 0) { console.error("Seeding test data failed:\n" + seed.stdout + seed.stderr); process.exit(1); }
let fails = 0; const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };

function run(cli, args, input, env = {}, preload = []) {
  const cwd = fs.mkdtempSync(path.join(HERE, "run-"));
  const r = spawnSync("node", [...preload.flatMap((p) => ["-r", p]), cli, ...args], { cwd, input, env: { ...process.env, ...env }, encoding: "utf8" });
  return { cwd, code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
// Snapshot of every file under the run dir: relative path (timestamp folder normalised) -> sha256, plus modes.
function tree(cwd) {
  const files = {}, modes = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name); const rel = path.relative(cwd, p).replace(/_\d{8}_\d{4}/, "_<stamp>");
    modes[rel] = (fs.statSync(p).mode & 0o777).toString(8);
    if (e.isDirectory()) walk(p); else files[rel] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } };
  walk(cwd); return { files, modes };
}
const same = (a, b) => JSON.stringify(a.files) === JSON.stringify(b.files);
const allPrivate = (t) => Object.entries(t.modes).every(([, m]) => m === "700" || m === "600");
const FF = path.join(CLI_DIR, "fakefetch.cjs");
const N18 = path.join(CLI_DIR, "node18sim.cjs");
const off = (p) => path.join(HERE, "offline", p);

console.log("1. Offline, whole folder (-c -d)");
let a = run(OLDCLI, ["-m", "off", "-c", off("config.json"), "-d", off("notes")], "Master123\n");
let b = run(NEWCLI, ["-m", "off", "-c", off("config.json"), "-d", off("notes")], "Master123\n");
let ta = tree(a.cwd), tb = tree(b.cwd);
ok(a.code === 0 && b.code === 0, `both succeed (exit ${a.code}/${b.code})`);
ok(Object.keys(tb.files).length === 8, "8 notes exported: " + Object.keys(tb.files).map((f) => path.basename(f)).join(" | "));
ok(same(ta, tb), "new output is byte-for-byte identical to the original CLI's");
ok(allPrivate(tb), "new: folder 700, files 600  (original: " + [...new Set(Object.values(ta.modes))].join("/") + ")");

console.log("2. Offline, single file (-c -n)");
a = run(OLDCLI, ["-m", "off", "-c", off("config.json"), "-n", off("notes/photo.png")], "Master123\n");
b = run(NEWCLI, ["-m", "off", "-c", off("config.json"), "-n", off("notes/photo.png")], "Master123\n");
ta = tree(a.cwd); tb = tree(b.cwd);
ok(b.code === 0 && same(ta, tb) && Object.keys(tb.files).length === 1, "identical single-file export");

console.log("3. Offline interactive wizard (no flags, answers piped in)");
for (const choice of ["d", "f"]) {
  const answers = choice === "d" ? `${off("config.json")}\nd\n${off("notes")}\nMaster123\n` : `${off("config.json")}\nf\n${off("notes/bank")}\nMaster123\n`;
  a = run(OLDCLI, ["-m", "off"], answers); b = run(NEWCLI, ["-m", "off"], answers);
  ta = tree(a.cwd); tb = tree(b.cwd);
  ok(b.code === 0 && same(ta, tb) && Object.keys(tb.files).length > 0, `wizard '${choice}': identical output (${Object.keys(tb.files).length} files)`);
}

console.log("4. Wrong master password");
a = run(OLDCLI, ["-m", "off", "-c", off("config.json"), "-d", off("notes")], "nope\n");
b = run(NEWCLI, ["-m", "off", "-c", off("config.json"), "-d", off("notes")], "nope\n");
ok(a.code === 1 && b.code === 1 && b.out.includes("Could not decrypt config.json"), "fails with the same message and exit code 1");

console.log("5. Online (fake Drive), token with -t");
const env = { FAKE_DRIVE: path.join(HERE, "drive.json") };
a = run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", env, [FF]);
b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", env, [FF]);
ta = tree(a.cwd); tb = tree(b.cwd);
ok(a.code === 0 && b.code === 0 && same(ta, tb) && Object.keys(tb.files).length === 8, "identical online export (8 notes)");
ok(allPrivate(tb), "new: folder 700, files 600");

console.log("6. Online, token pasted at the prompt (with stray spaces)");
a = run(OLDCLI, ["-m", "on"], "  GOODTOKEN  \nMaster123\n", env, [FF]);
b = run(NEWCLI, ["-m", "on"], "  GOODTOKEN  \nMaster123\n", env, [FF]);
ta = tree(a.cwd); tb = tree(b.cwd);
ok(a.code === 0 && b.code === 0 && same(ta, tb), "identical output");

console.log("7. Online, bad token");
b = run(NEWCLI, ["-m", "on", "-t", "BADTOKEN"], "Master123\n", env, [FF]);
ok(b.code === 1 && b.out.includes("rejected the export token"), "clear error, exit code 1");

console.log("8. Online mirror (-x), still-encrypted copy");
a = run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", env, [FF]);
b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", env, [FF]);
ta = tree(a.cwd); tb = tree(b.cwd);
ok(a.code === 0 && b.code === 0 && same(ta, tb) && Object.keys(tb.files).length === 11, `identical mirror (${Object.keys(tb.files).length} files = config + settings + 1 recovery + 8 notes)`);
ok(allPrivate(tb), "new: folders 700, files 600");

console.log("9. Mirror with hostile folder names '.' and '..'");
const evilEnv = { FAKE_DRIVE: path.join(HERE, "drive-evil.json") };
a = run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", evilEnv, [FF]);
b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", evilEnv, [FF]);
const escaped = (cwd) => fs.existsSync(path.join(cwd, "ESCAPED.txt"));
ok(escaped(a.cwd), "original CLI: file escaped the mirror folder (the bug)");
ok(!escaped(b.cwd) && b.code === 0, "new CLI: nothing written outside the mirror folder");
tb = tree(b.cwd);
ok(Object.keys(tb.files).some((f) => f.endsWith("_../ESCAPED.txt")) && Object.keys(tb.files).some((f) => f.endsWith("_./DOT.txt")), "new CLI: kept them inside as '_..' and '_.'");

console.log("10. Node 18 (no globalThis.crypto)");
b = run(NEWCLI, ["-m", "off", "-c", off("config.json"), "-d", off("notes")], "Master123\n", {}, [N18]);
ok(b.code === 0 && Object.keys(tree(b.cwd).files).length === 8, "offline export works");
b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", env, [N18, FF]);
ok(b.code === 0 && Object.keys(tree(b.cwd).files).length === 8, "online export works");

console.log("11. Exported content is correct (not just identical)");
b = run(NEWCLI, ["-m", "off", "-c", off("config.json"), "-d", off("notes")], "Master123\n");
const dir = fs.readdirSync(b.cwd).find((d) => d.startsWith("eNotes Manager Export_"));
const rd = (f) => fs.readFileSync(path.join(b.cwd, dir, f));
ok(rd("bank.html").toString().includes("<b>PIN</b> 4242 ✓ café"), "bank.html contains the note");
ok(rd("photo.png").subarray(1, 4).toString() === "PNG" && rd("noext.png").subarray(1, 4).toString() === "PNG", "photo.png / noext.png are real PNG bytes");
ok(rd("doc.pdf").toString().startsWith("%PDF"), "doc.pdf is the original PDF");
ok(fs.existsSync(path.join(b.cwd, dir, "bank (1).html")), "name collision handled: 'bank (1).html'");

console.log("12. Duplicates / glitches in Drive: the CLI picks what the app picks (read-only)");
{
  const dupEnv = { FAKE_DRIVE: path.join(HERE, "drive-dups.json") };
  a = run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", dupEnv, [FF]);
  b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", dupEnv, [FF]);
  const normal = tree(run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", env, [FF]).cwd);
  ok(Object.keys(tree(a.cwd).files).length < 8, `original CLI with duplicates listed first: exported ${Object.keys(tree(a.cwd).files).length} of 8 notes (the inconsistency)`);
  ok(b.code === 0 && same(tree(b.cwd), normal), "current CLI: all 8 notes, identical to a normal export (data tree + the config whose key opens the notes)");
  b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", dupEnv, [FF]);
  const mirrored = Object.keys(tree(b.cwd).files);
  ok(b.code === 0 && b.out.includes("1 other 'eNotes Manager' folder(s) exist") && mirrored.length === 12,
    "mirror (-x) with a duplicate tree: mirrors the data tree and says so");
  ok(mirrored.some((f) => f.endsWith("Config/config.json")) && mirrored.some((f) => f.endsWith("Config/config (1).json")),
    "  both config.json copies are kept in the backup ('config.json' + 'config (1).json'), none overwritten");
  const glitchEnv = { FAKE_DRIVE: path.join(HERE, "drive.json"), FAKE_HIDE_ONCE: "eNotes Manager,Config,config.json" };
  a = run(OLDCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", glitchEnv, [FF]);
  b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", glitchEnv, [FF]);
  ok(a.code !== 0, "original CLI fails on a momentary Drive miss");
  ok(b.code === 0 && same(tree(b.cwd), normal), "current CLI looks again and exports everything");
  b = run(NEWCLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", { FAKE_DRIVE: path.join(HERE, "drive-noconfig.json") }, [FF]);
  ok(b.code === 1 && b.out.includes("unlock there with one of your recovery codes"), "config.json really missing: clear message pointing to the recovery-code fix");
}

console.log("13. Token prompt is hidden in a real terminal (pseudo-terminal)");
if (process.platform === "win32") {
  console.log("  SKIP (needs a POSIX pseudo-terminal)");
} else {
  const pty = spawnSync("python3", [path.join(CLI_DIR, "pty_test.py"), OLDCLI, NEWCLI, FF, path.join(HERE, "drive.json")], { encoding: "utf8" });
  if (pty.status !== 0 && !pty.stdout) console.log("  SKIP (python3 not available): " + (pty.stderr || "").trim());
  else {
    const line = (label) => (pty.stdout.split("\n").find((l) => l.startsWith(label)) || "");
    ok(line("original").includes("token visible on screen: True"), "original CLI showed the pasted token (the issue)");
    ok(line("new").includes("token visible on screen: False") && line("new").includes("export finished: True"), "current CLI hides it and still finishes the export");
  }
}

fs.rmSync(HERE, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASSED");
process.exitCode = fails ? 1 : 0;
