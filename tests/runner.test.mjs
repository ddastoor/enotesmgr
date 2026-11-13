// The test runner itself (tests/run-all.mjs): the pool that runs several suites at once,
// --jobs / --only, its own serve.py per browser suite (never someone else's server on a
// reused port), and run-all end to end on quick suites.
import { spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { runPool, parseJobs, defaultJobs, duration, expandParts, partsFileOf, loadParts, countChecks } from "./lib/pool.mjs";
import { PARTS as OPTIONS_PARTS, VAULTS, GROUPS } from "./cli/options.parts.mjs";
import { startServer, freePort } from "./lib/serve.mjs";

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TESTS, "..");
const RUN_ALL = path.join(TESTS, "run-all.mjs");
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GiB = 1024 ** 3;
const runAll = (args) => {
    const r = spawnSync(process.execPath, [RUN_ALL, ...args], { cwd: ROOT, encoding: "utf8", timeout: 10 * 60 * 1000 });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

console.log("1. The pool: at most N at a time, every item once, results in order");
{
    let active = 0, most = 0;
    const startOrder = [], runs = new Map();
    const items = Array.from({ length: 10 }, (_, i) => i);
    const res = await runPool(items, 3, async (x) => {
        startOrder.push(x); runs.set(x, (runs.get(x) || 0) + 1);
        active++; most = Math.max(most, active);
        await sleep(5 + ((x * 7) % 25));
        active--;
        return x * 2;
    });
    ok(most === 3, `never more than 3 at once, and 3 were used (most at once: ${most})`);
    ok(items.every((x) => runs.get(x) === 1), "every item ran exactly once");
    ok(JSON.stringify(res) === JSON.stringify(items.map((x) => x * 2)), "results come back in the items' order (not in finishing order)");
    ok(JSON.stringify(startOrder) === JSON.stringify(items), "items start in the given order (so the slowest, listed first, start first)");
}
{
    let active = 0, most = 0;
    const order = [];
    await runPool([1, 2, 3, 4], 1, async (x) => { active++; most = Math.max(most, active); order.push(x); await sleep(5); active--; });
    ok(most === 1 && order.join() === "1,2,3,4", "jobs 1: strictly one after another, in order");
}
{
    let active = 0, most = 0;
    const res = await runPool(["a", "b"], 8, async (x) => { active++; most = Math.max(most, active); await sleep(10); active--; return x; });
    ok(most === 2 && res.join() === "a,b", "more jobs than items: all at once, no extra lanes");
    let called = 0;
    const none = await runPool([], 4, async () => { called++; });
    ok(Array.isArray(none) && none.length === 0 && called === 0, "no items: nothing runs");
}
{
    let threw = 0;
    for (const bad of [0, -1, 1.5, NaN, "2", undefined]) { try { await runPool([1], bad, async () => 1); } catch { threw++; } }
    ok(threw === 6, "jobs must be a whole number of 1 or more (0, -1, 1.5, NaN, \"2\", missing are refused)");
}
{
    const started = [], finished = [];
    let err = null, finishedAtReject = null;
    try {
        await runPool([0, 1, 2, 3, 4, 5], 2, async (x) => {
            started.push(x);
            await sleep(x === 1 ? 5 : 30);
            if (x === 1) throw new Error("boom");
            finished.push(x);
        });
    } catch (e) { err = e; finishedAtReject = [...finished]; }
    ok(err && err.message === "boom", "a worker that throws: the pool rejects with that error");
    ok(started.join() === "0,1" && finishedAtReject.join() === "0", "no new item starts after it; the one already running finishes first");
}

console.log("\n2. --jobs, the default number of jobs, durations");
{
    const cases = [
        [[], null], [["--jobs", "4"], 4], [["-j", "2"], 2], [["--jobs=6"], 6], [["--only", "x", "--jobs", "1"], 1],
        [["--jobs", "0"], NaN], [["--jobs"], NaN], [["--jobs", "x"], NaN], [["--jobs", "2.5"], NaN], [["--jobs", "-3"], NaN], [["--jobs="], NaN],
    ];
    const bad = cases.filter(([args, want]) => { const got = parseJobs(args); return !(Object.is(got, want)); });
    ok(bad.length === 0, "--jobs N / --jobs=N / -j N; not given -> default; 0, nothing, x, 2.5, -3 -> refused" + (bad.length ? ": wrong for " + bad.map(([a]) => a.join(" ")).join("; ") : ""));
    const d = [
        [{ cpus: 12, totalmem: 15 * GiB }, 10], [{ cpus: 4, totalmem: 15 * GiB }, 4], [{ cpus: 1, totalmem: 16 * GiB }, 1],
        [{ cpus: 2, totalmem: 8 * GiB }, 2], [{ cpus: 64, totalmem: 256 * GiB }, 32], [{ cpus: 12, totalmem: 3 * GiB }, 2], [{ cpus: 12, totalmem: 1 * GiB }, 1],
    ];
    const wrong = d.filter(([m, want]) => defaultJobs(m) !== want);
    ok(wrong.length === 0, "default: one job per CPU thread, at most one per 1.5 GB of memory, 1 to 32 (12 threads + 15 GB -> 10; 4 -> 4; 64 -> 32; 1 GB -> 1)" +
        (wrong.length ? ": wrong for " + JSON.stringify(wrong.map(([m]) => m)) : ""));
    ok(duration(0) === "0s" && duration(42400) === "42s" && duration(59600) === "1m 00s" && duration(185000) === "3m 05s", "durations read '42s', '3m 05s'");
}

console.log("\n2b. A suite run in parts at once (cli-options)");
{
    const a = { name: "a" }, b = { name: "b" }, c = { name: "c" };
    const jobs = expandParts([a, b, c], { b: ["x", "y"] });
    ok(jobs.map((j) => j.label).join("|") === "a|b [x]|b [y]|c" && jobs.map((j) => j.part).join("|") === "|x|y|" &&
        jobs[1].suite === b && jobs[2].suite === b && jobs[0].suite === a, "a suite with parts becomes one job per part ('b [x]', 'b [y]'), the others one job each, in order");
    ok(expandParts([a], {}).length === 1 && expandParts([], { b: ["x"] }).length === 0, "no parts: one job; no suites: no jobs");
    ok(OPTIONS_PARTS.length === VAULTS.length * GROUPS.length + 1 && OPTIONS_PARTS.join() === [...VAULTS.flatMap((v) => GROUPS.map((g) => `${v}:${g}`)), "rest"].join() && OPTIONS_PARTS[0] === "none:offline",
        `cli-options parts: each of its ${VAULTS.length} vaults' ${GROUPS.length} groups ('none:offline' ...) + 'rest' - ${OPTIONS_PARTS.length}, from cli/options.parts.mjs, which cli-options checks against its vaults and groups`);
    const r = spawnSync(process.execPath, [path.join(TESTS, "cli", "options.mjs")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ENOTES_TEST_PART: "bogus" }, timeout: 60000 });
    ok(r.status === 2 && r.stderr.includes(`ENOTES_TEST_PART must be one of ${OPTIONS_PARTS.join(", ")} (or unset), not 'bogus'`) && !r.stdout.includes("checks"),
        "cli-options with an unknown part: refused at once (a typo can't quietly run nothing)");
}

console.log("\n2c. Finding a suite's parts; counting its checks");
{
    ok(partsFileOf("/t/cli/options.mjs") === "/t/cli/options.parts.mjs" && partsFileOf("/t/browser/x.test.cjs") === "/t/browser/x.test.parts.mjs" && partsFileOf("/t/v.js") === "/t/v.parts.mjs",
        "the parts file is the suite's file with '.parts.mjs' (options.mjs -> options.parts.mjs, x.test.cjs -> x.test.parts.mjs)");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-runner-parts-"));
    const suite = (name, parts) => {
        fs.writeFileSync(path.join(dir, name + ".mjs"), "");
        if (parts !== undefined) fs.writeFileSync(path.join(dir, name + ".parts.mjs"), `export const PARTS = ${JSON.stringify(parts)};`);
        return path.join(dir, name + ".mjs");
    };
    ok(JSON.stringify(await loadParts(suite("good", ["a", "b:c", "d.e-f_g"]))) === '["a","b:c","d.e-f_g"]', "a suite with a parts file: its parts");
    ok(await loadParts(suite("whole")) === null, "a suite without one: null (it runs whole)");
    let refused = 0;
    for (const [name, parts] of [["empty", []], ["dup", ["a", "a"]], ["space", ["a b"]], ["notlist", "a"], ["blank", [""]]]) {
        try { await loadParts(suite(name, parts)); } catch (e) { if (e.message.includes("PARTS must be")) refused++; }
    }
    ok(refused === 5, "a parts file with no parts, the same part twice, a name with a space, not a list or an empty name: refused with a clear error");
    fs.rmSync(dir, { recursive: true, force: true });
    ok(countChecks("x\n2314 checks, ALL PASSED\n") === 2314 && countChecks("1. a\n  PASS one\n  FAIL two\n  PASS three\nALL PASSED") === 3 && countChecks("nothing") === 0,
        "the checks a suite ran: its 'N checks' line, else its PASS / FAIL lines");
    const r = runAll(["--only", "verify", "--only", "crypto", "--check-parts"]);
    ok(r.code === 0 && r.out.includes("Checking 0 split suite(s)") && r.out.includes("No split suites among those asked for."), "--check-parts with no split suite among those asked for: says so, nothing run");
    const all = runAll(["--only", "nosuch", "--check-parts"]);
    ok(all.code === 2 && all.out.includes("Unknown suite(s): nosuch"), "--check-parts with an unknown suite: refused like any run");
}

console.log("\n3. Each browser suite's own serve.py");
const www = path.join(ROOT, "www");
const getText = async (url) => { const r = await fetch(url); return { status: r.status, text: await r.text() }; };
const isApp = (t) => t.status === 200 && t.text.includes("<html") && !t.text.includes("DUMMY SERVER");
{
    const a = await startServer({ root: ROOT, dir: www });
    ok(isApp(await getText(a.url)), `serves the app (${a.url})`);
    const [b, c] = await Promise.all([startServer({ root: ROOT, dir: www }), startServer({ root: ROOT, dir: www })]);
    ok(new Set([a.url, b.url, c.url]).size === 3 && isApp(await getText(b.url)) && isApp(await getText(c.url)), "three at once: three servers on three ports, each serving the app");
    b.proc.kill();
    await sleep(300);
    ok(isApp(await getText(a.url)) && isApp(await getText(c.url)), "stopping one leaves the others serving");
    a.proc.kill(); c.proc.kill();
}
{
    // Another server already has the port the runner was handed.
    const dummyPort = await freePort();
    let dummyHits = 0;
    const handler = (req, res) => { dummyHits++; res.end("<html>DUMMY SERVER</html>"); };
    const dummies = [http.createServer(handler), http.createServer(handler)];
    await new Promise((r) => dummies[0].listen(dummyPort, "127.0.0.1", r));
    await new Promise((r) => { dummies[1].on("error", () => r()); dummies[1].listen(dummyPort, "::1", r); }); // also on IPv6 'localhost', where available
    let handed = 0;
    const pickPort = async () => (handed++ === 0 ? dummyPort : freePort());
    const s = await startServer({ root: ROOT, dir: www, pickPort });
    ok(handed === 2 && !s.url.includes(`:${dummyPort}/`), `handed a port another server holds: notices the answer isn't from its own serve.py and moves to another port (${s.url})`);
    const hitsBefore = dummyHits;
    ok(isApp(await getText(s.url)) && dummyHits === hitsBefore, "and what it then serves is the app - the other server gets nothing");
    s.proc.kill();
    await sleep(300);
    let gone = false;
    try { await fetch(s.url); } catch { gone = true; }
    ok(gone, "the server it returned is really its own: stopping it stops the answers");
    let err = null;
    const t0 = Date.now();
    try { await startServer({ root: ROOT, dir: www, pickPort: async () => dummyPort, attempts: 3 }); } catch (e) { err = e; }
    ok(err && err.message === "serve.py did not start" && Date.now() - t0 < 30000, "only ever handed the taken port: gives up with 'serve.py did not start'");
    for (const d of dummies) { try { d.close(); } catch { /* wasn't listening */ } }
}

console.log("\n4. run-all end to end");
for (const args of [["--jobs", "0"], ["--jobs", "x"], ["--jobs"], ["-j", "2.5"]]) {
    const r = runAll(["--only", "verify", ...args]);
    ok(r.code === 2 && r.out.includes("--jobs needs a whole number of 1 or more") && !r.out.includes("====="), `${args.join(" ")}: refused with a clear message, nothing run`);
}
{
    const r = runAll(["--only", "verify", "--only", "nosuch"]);
    ok(r.code === 2 && r.out.includes("Unknown suite(s): nosuch") && r.out.includes("Suites: verify, crypto") && !r.out.includes("ALL SUITES PASSED"),
        "an unknown --only name (a typo): refused with the list of suites - never a quiet 'ALL SUITES PASSED' with nothing run");
}
{
    const r = runAll(["--only", "verify", "--jobs", "3"]);
    ok(r.code === 0 && r.out.includes("up to 3 at a time (--jobs 3") && r.out.includes("\n===== verify: export CLI bundle is up to date =====\n") &&
        /----- verify: PASS in \d+s \(1 of 1 done\) -----/.test(r.out) && /PASS {2}verify {2}\d+s/.test(r.out) && r.out.includes("Took ") && r.out.includes("ALL SUITES PASSED"),
        "--jobs 3: header, the suite's output, its result and time, the summary with times");
    const r1 = runAll(["--only", "verify", "--jobs", "1"]);
    ok(r1.code === 0 && r1.out.includes("\n===== verify: export CLI bundle is up to date =====\n") && !r1.out.includes("at a time") && !r1.out.includes("-----") &&
        r1.out.includes("with --jobs 1") && r1.out.includes("ALL SUITES PASSED"), "--jobs 1: one at a time with live output, as before");
    const r2 = runAll(["--only", "verify", "-j", "2"]), r3 = runAll(["--only", "verify", "--jobs=2"]);
    ok(r2.code === 0 && r2.out.includes("up to 2 at a time") && r3.code === 0 && r3.out.includes("up to 2 at a time"), "-j 2 and --jobs=2 work too");
}
let playwright = true;
try { createRequire(path.join(TESTS, "browser", "x.cjs")).resolve("playwright"); } catch { playwright = false; }
if (!playwright) {
    console.log("  SKIP (Playwright not installed): a browser suite and a node suite at once");
} else {
    const r = runAll(["--only", "framing", "--only", "verify", "--only", "password-rules", "--jobs", "3"]);
    // Every suite's block: its header, then only its own lines, then its own result line.
    const lines = r.out.split("\n");
    let current = null, wellFormed = true;
    const blocks = [];
    for (const line of lines) {
        const h = line.match(/^===== ([\w-]+)[: ]/); // a suite's header, or "===== Summary ====="
        const f = line.match(/^----- ([\w-]+): (PASS|FAIL) in /);
        if (h) { if (current) wellFormed = false; if (h[1] !== "Summary") { current = h[1]; blocks.push(current); } }
        else if (f) { if (f[1] !== current) wellFormed = false; current = null; }
    }
    ok(r.code === 0 && blocks.sort().join() === "framing,password-rules,verify" && wellFormed && current === null,
        "two browser suites and a node suite at once (each browser suite with its own server): each suite's output in one unbroken block, all pass" +
        (r.code === 0 ? "" : ": " + r.out.slice(-600)));
    ok(/PASS {2}verify/.test(r.out) && /PASS {2}framing/.test(r.out) && /PASS {2}password-rules/.test(r.out) && r.out.indexOf("PASS  verify") < r.out.indexOf("PASS  framing"),
        "the summary lists them in the usual order");
}

console.log(`\n${checks} checks, ${fails ? fails + " FAILED" : "ALL PASSED"}`);
process.exitCode = fails ? 1 : 0;
