// Build www/mynotes-export.js: a single self-contained Node CLI.
//
//   node build.mjs   (or: npm run build)
//
// Bundles export-cli.js (+ the canonical www/ crypto + WASI shim) to one CJS
// file via esbuild, and prepends a banner that (a) makes it executable, (b)
// inlines the base64 wasm on a global the crypto reads at init, and (c) records
// the input hash for the drift guard. Runs with `node mynotes-export.js` on
// Node 18+ with no npm install.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { computeHash, OUTPUT } from "./hash.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const r = (p) => resolve(here, p);

const wasmB64 = readFileSync(r("../../www/js/crypto/crypto.wasm")).toString("base64");

const banner =
    "#!/usr/bin/env node\n" +
    `// eNotes export CLI — self-contained, built by src/export/build.mjs. Do NOT edit by hand.\n` +
    `// build-hash: ${computeHash()}\n` +
    `globalThis.__CRYPTO_WASM_BYTES__=${JSON.stringify(wasmB64)};\n`;

await build({
    entryPoints: [r("export-cli.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    outfile: OUTPUT,
    banner: { js: banner },
    legalComments: "none",
});

const kb = (Buffer.byteLength(readFileSync(OUTPUT)) / 1024).toFixed(0);
console.log(`Wrote ${OUTPUT} (${kb} KB)`);
