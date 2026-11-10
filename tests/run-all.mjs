#!/usr/bin/env node
// Runs every test suite and prints a summary. See tests/README.md.
//
//   node tests/run-all.mjs                 # everything
//   node tests/run-all.mjs --only crypto   # one suite (repeat --only for more)
//
// Suites: verify, crypto, cli, sensitive, app-core, features, framing, password-rules,
// recovery-lockout, data-safety, cli-roundtrip, sensitive-notes, cli-matrix, media-parity, google-signin, fonts. The browser suites run against the app in ./www served by
// ./serve.py on a free local port, with Google sign-in stubbed and Google Drive
// faked in memory - no real Google account is ever used.
import { spawn, spawnSync } from "child_process";
import net from "net";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS, "..");

const only = process.argv.flatMap((a, i, all) => (a === "--only" && all[i + 1] ? [all[i + 1]] : []));
const want = (name) => only.length === 0 || only.includes(name);

const NODE_SUITES = [
    { name: "verify", desc: "export CLI bundle is up to date", args: [path.join(ROOT, "src/export/verify.mjs")] },
    { name: "crypto", desc: "crypto module", args: [path.join(TESTS, "crypto.test.mjs")] },
    { name: "cli", desc: "export CLI (vs. the original CLI)", args: [path.join(TESTS, "cli/run.mjs")] },
    { name: "sensitive", desc: "sensitive notes: envelope, two layers, export rules, CLI", args: [path.join(TESTS, "sensitive.test.mjs")] },
];
const BROWSER_SUITES = [
    { name: "app-core", desc: "setup, unlock, notes, recovery, timeout, CSP, popup" },
    { name: "features", desc: "uploads, downloads, search, settings, Argon2, memory" },
    { name: "framing", desc: "refuses to run inside other sites' frames" },
    { name: "password-rules", desc: "master password rules" },
    { name: "recovery-lockout", desc: "never locked out, complete code sets" },
    { name: "data-safety", desc: "Drive glitches / duplicates never lose data" },
    { name: "cli-roundtrip", desc: "export CLI exports data made by the current app" },
    { name: "sensitive-notes", desc: "sensitive notes: extra password, CLI export, Decrypt Sensitive File" },
    { name: "cli-matrix", desc: "every CLI mode x text / embedded images x normal / sensitive" },
    { name: "media-parity", desc: "a sensitive note can do everything a normal note can" },
    { name: "google-signin", desc: "real Google sign-in script works under the CSP (needs internet)" },
    { name: "fonts", desc: "self-hosted font: no Google Fonts, untampered, looks identical" },
];

// Run one suite; a suite that hangs is killed after SUITE_TIMEOUT_MS and fails.
const SUITE_TIMEOUT_MS = 15 * 60 * 1000;
function runNode(args, cwd = ROOT) {
    return new Promise((resolve) => {
        const p = spawn(process.execPath, args, { cwd, stdio: "inherit" });
        const timer = setTimeout(() => {
            console.log(`\n  TIMED OUT after ${SUITE_TIMEOUT_MS / 60000} minutes - stopping this suite`);
            p.kill("SIGKILL");
        }, SUITE_TIMEOUT_MS);
        p.on("close", (code) => { clearTimeout(timer); resolve(code === null ? 1 : code); });
    });
}

function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    });
}

function findPython() {
    for (const cmd of ["python3", "python"]) {
        const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
        if (r.status === 0) return cmd;
    }
    return null;
}

async function startServer() {
    const python = findPython();
    if (!python) throw new Error("Python 3 is needed to serve the app (serve.py).");
    const port = await freePort();
    const proc = spawn(python, [path.join(ROOT, "serve.py"), "--port", String(port), "--dir", path.join(ROOT, "www")], { stdio: "ignore" });
    const url = `http://localhost:${port}/`;
    for (let i = 0; i < 50; i++) {
        try { if ((await fetch(url)).ok) return { proc, url }; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    proc.kill();
    throw new Error("serve.py did not start");
}

const results = [];
for (const s of NODE_SUITES) {
    if (!want(s.name)) continue;
    console.log(`\n===== ${s.name}: ${s.desc} =====`);
    results.push({ name: s.name, ok: (await runNode(s.args)) === 0 });
}

const browserWanted = BROWSER_SUITES.filter((s) => want(s.name));
if (browserWanted.length) {
    let playwrightOk = true;
    try { createRequire(path.join(TESTS, "browser", "x.cjs")).resolve("playwright"); }
    catch { playwrightOk = false; }
    if (!playwrightOk) {
        console.log("\nPlaywright is not installed. Run once:  cd tests && npm install && npx playwright install chromium");
        for (const s of browserWanted) results.push({ name: s.name, ok: false, note: "Playwright not installed" });
    } else {
        const { proc, url } = await startServer();
        try {
            for (const s of browserWanted) {
                console.log(`\n===== ${s.name}: ${s.desc} =====`);
                const code = await runNode([path.join(TESTS, "browser", `${s.name}.test.cjs`), url], path.join(TESTS, "browser"));
                results.push({ name: s.name, ok: code === 0 });
            }
        } finally {
            proc.kill();
        }
    }
}

console.log("\n===== Summary =====");
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.note ? "  (" + r.note + ")" : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} suite(s) FAILED` : "\nALL SUITES PASSED");
process.exitCode = failed ? 1 : 0;
