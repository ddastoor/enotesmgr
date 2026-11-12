// Start ./serve.py for a browser suite, on a free local port. Tested by tests/runner.test.mjs.
//
// A free port is found by opening and closing a socket, so in theory another server can take
// it before serve.py does (more likely with several suites starting at once). Then serve.py
// can't bind and exits - but the port still answers, from the OTHER server. So a server only
// counts as ours once OUR serve.py has logged a request carrying a random token; otherwise it
// is stopped and another port is tried.
import { spawn, spawnSync } from "child_process";
import net from "net";
import path from "path";
import { randomBytes } from "crypto";

export function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.on("error", reject);
        s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    });
}

export function findPython() {
    for (const cmd of ["python3", "python"]) {
        const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
        if (r.status === 0) return cmd;
    }
    return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -> { proc, url }. `pickPort` is for the tests (to hand out a taken port).
export async function startServer({ root, dir, pickPort = freePort, attempts = 5 }) {
    const python = findPython();
    if (!python) throw new Error("Python 3 is needed to serve the app (serve.py).");
    for (let attempt = 0; attempt < attempts; attempt++) {
        const port = await pickPort();
        const token = randomBytes(8).toString("hex");
        // -u: unbuffered, so serve.py's request log arrives at once.
        const proc = spawn(python, ["-u", path.join(root, "serve.py"), "--port", String(port), "--dir", dir], { stdio: ["ignore", "pipe", "pipe"] });
        let log = "", exited = false;
        const seen = () => log.includes(token);
        // Keep reading everything it prints (a full pipe would block it); remember only the start.
        const take = (chunk) => { if (log.length < 65536) log += chunk.toString("utf8"); };
        proc.stdout.on("data", take);
        proc.stderr.on("data", take);
        proc.on("exit", () => { exited = true; });
        const url = `http://localhost:${port}/`;
        for (let i = 0; i < 100 && !exited; i++) {
            try {
                const r = await fetch(`${url}?runner-probe=${token}`);
                await r.arrayBuffer();
                if (r.ok) {
                    // It answered; was it ours? Our log line arrives right after the response.
                    for (let j = 0; j < 20 && !seen() && !exited; j++) await sleep(50);
                    if (seen()) return { proc, url };
                    break; // another server has this port
                }
            } catch { /* not up yet */ }
            await sleep(100);
        }
        proc.kill();
    }
    throw new Error("serve.py did not start");
}
