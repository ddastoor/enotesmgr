#!/usr/bin/env node
// Runs every test suite and prints a summary. See tests/README.md.
//
//   node tests/run-all.mjs                 # everything
//   node tests/run-all.mjs --only crypto   # one suite (repeat --only for more)
//   node tests/run-all.mjs --jobs 1        # one suite at a time, output shown live
//
// Suites: verify, crypto, cli, sensitive, cli-options, app-core, features, framing, password-rules,
// recovery-lockout, data-safety, cli-roundtrip, sensitive-notes, cli-matrix, media-parity, new-user, google-signin, fonts. The browser suites run against the app in ./www served by
// ./serve.py on a free local port, with Google sign-in stubbed and Google Drive
// faked in memory - no real Google account is ever used.
//
// Several jobs run at once (--jobs N; default: one per CPU thread, see
// lib/pool.mjs): each suite is its own process with its own temp folder and its
// own in-memory fake Drive, each browser suite gets its own serve.py, a suite
// with a "<suite>.parts.mjs" file next to it runs as several parts at once, the
// slowest start first, and each job's output is printed in one piece when it
// ends (never mixed with another's). --jobs 1 runs the suites one at a time in
// the order listed, whole, output live. --check-parts runs every split suite
// both whole and in its parts, and checks that the parts run exactly as many
// checks as the whole. The 'runner' suite tests this runner.
import { spawn } from "child_process";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { runPool, parseJobs, defaultJobs, duration, expandParts, loadParts, countChecks } from "./lib/pool.mjs";
import { startServer } from "./lib/serve.mjs";

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS, "..");

const only = process.argv.flatMap((a, i, all) => (a === "--only" && all[i + 1] ? [all[i + 1]] : []));
const want = (name) => only.length === 0 || only.includes(name);

const NODE_SUITES = [
    { name: "verify", desc: "export CLI bundle is up to date", args: [path.join(ROOT, "src/export/verify.mjs")] },
    { name: "crypto", desc: "crypto module", args: [path.join(TESTS, "crypto.test.mjs")] },
    { name: "runner", desc: "this test runner: suites at once, --jobs / --only, its own server per browser suite", args: [path.join(TESTS, "runner.test.mjs")] },
    { name: "cli", desc: "export CLI (vs. the original CLI)", args: [path.join(TESTS, "cli/run.mjs")] },
    { name: "sensitive", desc: "sensitive notes: envelope, two layers, export rules, CLI", args: [path.join(TESTS, "sensitive.test.mjs")] },
    { name: "cli-options", desc: "export CLI: every option combination x vaults with / without sensitive notes", args: [path.join(TESTS, "cli/options.mjs")] },
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
    { name: "new-user", desc: "a new user: setup and normal use identical to main (before sensitive notes)" },
    { name: "google-signin", desc: "real Google sign-in script works under the CSP (needs internet)" },
    { name: "fonts", desc: "self-hosted font: no Google Fonts, untampered, looks identical" },
];

// --- what to run --------------------------------------------------------------
const ALL = [...NODE_SUITES.map((s) => ({ ...s, browser: false })), ...BROWSER_SUITES.map((s) => ({ ...s, browser: true }))];
const unknown = only.filter((n) => !ALL.some((s) => s.name === n));
if (unknown.length) {
    // A typo must not quietly run nothing and report "ALL SUITES PASSED".
    console.error(`Unknown suite(s): ${unknown.join(", ")}\nSuites: ${ALL.map((s) => s.name).join(", ")}`);
    process.exit(2);
}
const jobsGiven = parseJobs(process.argv.slice(2));
if (Number.isNaN(jobsGiven)) {
    console.error("--jobs needs a whole number of 1 or more, e.g. --jobs 4 (--jobs 1 = one suite at a time, output live)");
    process.exit(2);
}
const cpus = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
const JOBS = jobsGiven ?? defaultJobs({ cpus, totalmem: os.totalmem() });
const CHECK_PARTS = process.argv.includes("--check-parts");
const LIVE = JOBS === 1 && !CHECK_PARTS;

// Suites that can run in parts at once (each part its own process, chosen with the environment
// variable ENOTES_TEST_PART; the suite passes when every part passes): those with a
// "<suite>.parts.mjs" file next to them (see lib/pool.mjs). Only when several run at once - with
// --jobs 1 a suite runs whole, as always.
const scriptOf = (s) => (s.browser ? path.join(TESTS, "browser", `${s.name}.test.cjs`) : s.args[0]);
const partEnv = (part) => (part ? { ENOTES_TEST_PART: part } : {});
const PARTS = {};
for (const s of ALL) {
    const parts = await loadParts(scriptOf(s));
    if (parts) PARTS[s.name] = parts;
}

// Roughly how long each suite (or part) takes, in seconds, so the slowest start first when several
// run at once - the whole run can't end before its slowest one. Measured with 4 at once on a
// 4-core machine (all suites, incl. those of other branches); only the order matters. Unlisted: 60.
const EXPECTED_SECONDS = {
    "cli-regression": 267, "cli-options [mixed]": 196, "cli-transfer": 172, "cli-options [sensitive]": 165,
    "recovery-lockout": 109, "settings": 75, "cli-options [clash]": 63, "sensitive-notes": 57, "cli-matrix": 53,
    "transfer": 47, "cli-options [none]": 46, "new-user": 41, "media-parity": 35, "cli": 34, "data-safety": 34,
    "app-core": 31, "features": 23, "cli-roundtrip": 14, "runner": 12, "fonts": 10, "password-rules": 9,
    "google-signin": 5, "cli-options [rest]": 3, "crypto": 3, "sensitive": 2, "framing": 2, "verify": 1,
};

// --- running one suite -----------------------------------------------------------
// A suite that hangs is killed after SUITE_TIMEOUT_MS and fails (more time when sharing the CPU).
const SUITE_TIMEOUT_MS = (LIVE ? 15 : 30) * 60 * 1000;
const running = new Set(); // child processes and servers, stopped if the runner is stopped

// -> { code, out, ms }. Live: output goes straight to the terminal (out is ""). Otherwise it is
// collected (stdout and stderr in arrival order) and printed in one piece by the caller.
function runNode(args, cwd = ROOT, env = {}) {
    return new Promise((resolve) => {
        const start = Date.now(), chunks = [];
        const p = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: LIVE ? "inherit" : ["ignore", "pipe", "pipe"] });
        running.add(p);
        if (!LIVE) { p.stdout.on("data", (c) => chunks.push(c)); p.stderr.on("data", (c) => chunks.push(c)); }
        let note = "";
        const timer = setTimeout(() => {
            note = `\n  TIMED OUT after ${SUITE_TIMEOUT_MS / 60000} minutes - stopping this suite\n`;
            if (LIVE) console.log(note.trimEnd());
            p.kill("SIGKILL");
        }, SUITE_TIMEOUT_MS);
        p.on("error", (err) => { note += `\n  could not start: ${err.message}\n`; });
        p.on("close", (code) => {
            clearTimeout(timer);
            running.delete(p);
            resolve({ code: code === null ? 1 : code, out: LIVE ? "" : Buffer.concat(chunks).toString("utf8") + note, ms: Date.now() - start });
        });
    });
}

// A browser suite gets its own serve.py, stopped when the suite ends.
async function runBrowser(s, part) {
    const { proc, url } = await startServer({ root: ROOT, dir: path.join(ROOT, "www") });
    running.add(proc);
    try {
        return await runNode([scriptOf(s), url], path.join(TESTS, "browser"), partEnv(part));
    } finally {
        proc.kill();
        running.delete(proc);
    }
}

async function runSuite(s, part = null) {
    const start = Date.now();
    try {
        return await (s.browser ? runBrowser(s, part) : runNode(s.args, ROOT, partEnv(part)));
    } catch (err) {
        if (LIVE) console.log(`  could not run: ${err.message}`);
        return { code: 1, out: `  could not run: ${err.message}\n`, ms: Date.now() - start };
    }
}

const stopAll = (signalCode) => { for (const p of running) { try { p.kill("SIGKILL"); } catch { /* gone */ } } process.exit(signalCode); };
process.on("SIGINT", () => stopAll(130));
process.on("SIGTERM", () => stopAll(143));

// --- run them -------------------------------------------------------------------
const wanted = ALL.filter((s) => want(s.name));
const results = new Map(); // name -> { ok, ms, note }
let toRun = wanted;
if (wanted.some((s) => s.browser)) {
    let playwrightOk = true;
    try { createRequire(path.join(TESTS, "browser", "x.cjs")).resolve("playwright"); }
    catch { playwrightOk = false; }
    if (!playwrightOk) {
        console.log("\nPlaywright is not installed. Run once:  cd tests && npm install && npx playwright install chromium");
        for (const s of wanted.filter((x) => x.browser)) results.set(s.name, { ok: false, note: "Playwright not installed" });
        toRun = wanted.filter((s) => !s.browser);
    }
}

const started = Date.now();
if (CHECK_PARTS) {
    // Each split suite whole, and each of its parts: the parts together must run exactly the
    // checks of the whole (and all must pass) - so splitting a suite can never lose a check.
    const split = toRun.filter((s) => PARTS[s.name]);
    const jobs = split.flatMap((s) => [{ suite: s, part: null, label: `${s.name} (whole)` },
        ...PARTS[s.name].map((part) => ({ suite: s, part, label: `${s.name} [${part}]` }))]);
    console.log(`Checking ${split.length} split suite(s)${split.length ? " (" + split.map((s) => s.name).join(", ") + ")" : ""}: each whole and in its parts - ${jobs.length} job(s), up to ${JOBS} at a time.`);
    const order = [...jobs].sort((a, b) => (a.part === null ? 0 : 1) - (b.part === null ? 0 : 1) || (EXPECTED_SECONDS[b.label] ?? 60) - (EXPECTED_SECONDS[a.label] ?? 60));
    const got = new Map();
    await runPool(order, JOBS, async (t) => {
        const r = await runSuite(t.suite, t.part);
        const n = countChecks(r.out);
        got.set(t.label, { code: r.code, n });
        console.log(`  ${r.code === 0 ? "PASS" : "FAIL"}  ${t.label}: ${n} checks, ${duration(r.ms)}`);
        if (r.code !== 0) process.stdout.write(r.out.split("\n").slice(-40).join("\n") + "\n");
    });
    console.log("\n===== Summary =====");
    let bad = 0;
    for (const s of split) {
        const whole = got.get(`${s.name} (whole)`);
        const parts = PARTS[s.name].map((p) => got.get(`${s.name} [${p}]`));
        const sum = parts.reduce((a, r) => a + r.n, 0);
        const good = whole.code === 0 && parts.every((r) => r.code === 0) && whole.n > 0 && sum === whole.n;
        if (!good) bad++;
        console.log(`  ${good ? "PASS" : "FAIL"}  ${s.name}: whole ${whole.n} checks${whole.code ? " (FAILED)" : ""}, its ${parts.length} parts ${sum} checks${parts.some((r) => r.code) ? " (a part FAILED)" : ""}`);
    }
    console.log(`\nTook ${duration(Date.now() - started)} with --jobs ${JOBS}.`);
    console.log(bad ? `\n${bad} split suite(s) FAILED the check` : split.length ? "\nEVERY SPLIT SUITE'S PARTS RUN EXACTLY ITS CHECKS" : "\nNo split suites among those asked for.");
    process.exit(bad ? 1 : 0);
}
if (LIVE) {
    for (const s of toRun) {
        console.log(`\n===== ${s.name}: ${s.desc} =====`);
        const r = await runSuite(s);
        results.set(s.name, { ok: r.code === 0, ms: r.ms });
    }
} else {
    // Split suites into their parts, then slowest first (a stable sort keeps the listed order for
    // equal estimates).
    const tasks = expandParts(toRun, PARTS);
    const order = [...tasks].sort((a, b) => (EXPECTED_SECONDS[b.label] ?? 60) - (EXPECTED_SECONDS[a.label] ?? 60));
    console.log(`Running ${toRun.length} suite(s) as ${order.length} job(s), up to ${JOBS} at a time (--jobs ${JOBS}; --jobs 1 = one at a time, output live).`);
    console.log("Each suite's output is shown in one piece when it ends.");
    let done = 0;
    await runPool(order, JOBS, async (t) => {
        console.log(`  started: ${t.label}`);
        const r = await runSuite(t.suite, t.part);
        done++;
        const out = r.out.endsWith("\n") || r.out === "" ? r.out : r.out + "\n";
        process.stdout.write(`\n===== ${t.label}: ${t.suite.desc} =====\n${out}` +
            `----- ${t.label}: ${r.code === 0 ? "PASS" : "FAIL"} in ${duration(r.ms)} (${done} of ${order.length} done) -----\n`);
        // A suite run in parts: it passes when every part passes; its time is its slowest part's.
        const prev = results.get(t.suite.name);
        results.set(t.suite.name, prev
            ? { ok: prev.ok && r.code === 0, ms: Math.max(prev.ms, r.ms), parts: prev.parts + 1 }
            : { ok: r.code === 0, ms: r.ms, parts: 1 });
    });
}

// Summary in the listed order.
console.log("\n===== Summary =====");
const width = Math.max(0, ...wanted.map((s) => s.name.length));
for (const s of wanted) {
    const r = results.get(s.name);
    const parts = r.parts > 1 ? `  (in ${r.parts} parts at once; the slowest part's time)` : "";
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${s.name.padEnd(width)}${r.ms !== undefined ? "  " + duration(r.ms) : ""}${parts}${r.note ? "  (" + r.note + ")" : ""}`);
}
const failed = wanted.filter((s) => !results.get(s.name).ok).length;
console.log(`\nTook ${duration(Date.now() - started)} with --jobs ${JOBS}.`);
console.log(failed ? `\n${failed} suite(s) FAILED` : "\nALL SUITES PASSED");
process.exitCode = failed ? 1 : 0;
