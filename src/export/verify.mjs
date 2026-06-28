// Drift guard: fail if www/enotesmgr-export-cli.js was not rebuilt after a source
// change. Run in CI / pre-commit:  node verify.mjs  (or: npm run verify)
import { readFileSync } from "node:fs";
import { computeHash, OUTPUT } from "./hash.mjs";

let js;
try {
    js = readFileSync(OUTPUT, "utf8");
} catch {
    console.error(`export: ${OUTPUT} is missing — run \`npm run build\` in src/export.`);
    process.exit(1);
}

const m = js.match(/build-hash:\s*([0-9a-f]{64})/);
const expected = computeHash();

if (!m) {
    console.error("export: no build-hash found in enotesmgr-export-cli.js — rebuild it.");
    process.exit(1);
}
if (m[1] !== expected) {
    console.error("export: enotesmgr-export-cli.js is STALE — shared code changed. Run `npm run build` in src/export.");
    process.exit(1);
}
console.log("export: enotesmgr-export-cli.js is up to date.");
