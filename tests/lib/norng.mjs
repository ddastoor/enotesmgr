// Helper for crypto.test.mjs: with no secure random source (globalThis.crypto
// missing), the crypto module must refuse to start instead of silently using
// Math.random() for salts and nonces. Exits 0 if it refused, 1 otherwise.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(root, "www/js/crypto/crypto.wasm")).toString("base64");
const m = await import(pathToFileURL(path.join(root, "www/js/crypto/crypto.js")).href);
try {
    await m.cryptoReady;
    console.log("started WITHOUT a secure random source");
    process.exit(1);
} catch (e) {
    console.log("refused: " + e.message);
    process.exit(0);
}
