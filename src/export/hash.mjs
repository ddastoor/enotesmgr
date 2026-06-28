// Single source of truth for the export CLI's "input hash". build.mjs embeds it
// in www/enotesmgr-export-cli.js; verify.mjs recomputes it from the SAME sources and
// fails if they differ — so the shared crypto / CLI logic can't change without
// the built artifact being rebuilt (no silent drift).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const INPUTS = [
    "../../www/js/crypto/crypto.js",
    "../../www/js/crypto/crypto.wasm",
    "../../www/js/crypto/wasi-shim-vendor/dist/wasi-shim.js",
    "../../www/js/lib/noteExport.js",
    "export-cli.js",
].map((p) => resolve(here, p));

export function computeHash() {
    const h = createHash("sha256");
    for (const p of INPUTS) h.update(readFileSync(p));
    return h.digest("hex");
}

export const OUTPUT = resolve(here, "../../www/enotesmgr-export-cli.js");
