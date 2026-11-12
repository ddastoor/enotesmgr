// Helpers for tests/run-all.mjs: run several suites at once. Tested by tests/runner.test.mjs.

// Run worker(item, index) for every item, at most `jobs` at a time, starting them in the
// items' order. Resolves to the workers' results in the items' order. If a worker throws, no
// further items are started, the ones already running finish, then it rejects with that error.
export async function runPool(items, jobs, worker) {
    if (!Number.isInteger(jobs) || jobs < 1) throw new Error("jobs must be a whole number of 1 or more");
    const results = new Array(items.length);
    let next = 0, failure = null;
    const lane = async () => {
        while (!failure && next < items.length) {
            const i = next++;
            try { results[i] = await worker(items[i], i); } catch (err) { failure ??= { err }; }
        }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, lane));
    if (failure) throw failure.err;
    return results;
}

// --jobs N, --jobs=N or -j N. Returns null when not given, NaN when the value isn't a whole
// number of 1 or more, else the number.
export function parseJobs(args) {
    let value;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--jobs" || args[i] === "-j") value = args[i + 1] ?? "";
        else if (args[i].startsWith("--jobs=")) value = args[i].slice("--jobs=".length);
    }
    if (value === undefined) return null;
    const n = /^\d+$/.test(value) ? Number(value) : NaN;
    return n >= 1 ? n : NaN;
}

// How many suites to run at once by default: half the CPU threads (a browser suite keeps more
// than one busy: Chromium, the test, the server), at most one per ~1.5 GB of memory (Chromium
// plus Argon2's 64 MiB per key derivation), at most 8, at least 1.
export function defaultJobs({ cpus, totalmem }) {
    const byMemory = Math.floor(totalmem / (1.5 * 1024 ** 3));
    return Math.max(1, Math.min(Math.floor(cpus / 2), byMemory, 8));
}

// The jobs for a list of suites: one per suite, or one per part for a suite listed in `parts`
// (name -> part names). -> [{ suite, part, label }], label "name" or "name [part]".
export function expandParts(suites, parts) {
    return suites.flatMap((suite) => (parts[suite.name] || [null]).map((part) => ({
        suite, part, label: part ? `${suite.name} [${part}]` : suite.name,
    })));
}

// "42s" / "3m 05s"
export function duration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
