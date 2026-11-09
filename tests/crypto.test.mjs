// Crypto module tests (www/js/crypto/crypto.js + crypto.wasm), run in Node.
// Usage: node tests/crypto.test.mjs   (or via tests/run-all.mjs)
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "www/js/crypto/crypto.wasm");
let failures = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) failures++; };

// Capture the WASM instance so we can inspect its memory afterwards.
let instance;
const realInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async (...a) => { const r = await realInstantiate(...a); instance = r.instance; return r; };
globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(wasmPath).toString("base64");
const m = await import(pathToFileURL(path.join(root, "www/js/crypto/crypto.js")).href);
await m.cryptoReady;

console.log("Encrypt / decrypt");
for (const text of ["hello", "", "héllo ✓ café", "x".repeat(100000)]) {
    ok(m.decryptData(m.encryptData(text, "pw"), "pw") === text, `round trip (${text.length} chars)`);
}
const a = m.encryptData("same", "pw"), b = m.encryptData("same", "pw");
ok(a !== b, "same text + password encrypts differently each time (random salt + nonce)");
ok(m.decryptData(m.encryptVerified("v", "pw"), "pw") === "v", "encryptVerified works");
let msg = ""; try { m.decryptData(a, "wrong"); } catch (e) { msg = e.message; }
ok(msg === "Bad password or corrupted ciphertext", "wrong password is rejected");
const raw = Buffer.from(a, "base64"); raw[raw.length - 1] ^= 1;
msg = ""; try { m.decryptData(raw.toString("base64"), "pw"); } catch (e) { msg = e.message; }
ok(msg === "Bad password or corrupted ciphertext", "tampered ciphertext is rejected");

console.log("Compatibility with data from the original app");
const fixture = fs.readFileSync(path.join(root, "tests/fixtures/ciphertext-from-original-app.txt"), "utf8");
ok(m.decryptData(fixture, "MyMasterPassw0rd!!") === "BANK-PIN-918273645-" + "x".repeat(200), "decrypts ciphertext made by the original (pre-hardening) code");

console.log("Missing passwords are refused");
for (const bad of [undefined, null, "", 123]) {
    let e1 = "", e2 = "";
    try { m.encryptData("x", bad); } catch (e) { e1 = e.message; }
    try { m.decryptData(fixture, bad); } catch (e) { e2 = e.message; }
    ok(e1 === "Missing password" && e2 === "Missing password", `password ${JSON.stringify(bad)} refused by encrypt and decrypt`);
}

console.log("Secrets don't linger in WASM memory");
const PW = "MyMasterPassw0rd!!", SECRET = "BANK-PIN-918273645-" + "y".repeat(200);
const c = m.encryptData(SECRET, PW);
m.decryptData(c, PW);
try { m.decryptData(c, "Wrong-" + PW); } catch {}
const mem = Buffer.from(instance.exports.memory.buffer);
ok(mem.indexOf(Buffer.from(PW)) < 0, "password wiped");
ok(mem.indexOf(Buffer.from(SECRET)) < 0, "plaintext wiped");
ok(mem.indexOf(Buffer.from("Wrong-" + PW)) < 0, "wrong password attempt wiped");

console.log("Random source");
const r = spawnSync(process.execPath, [path.join(root, "tests/lib/norng.mjs")], { encoding: "utf8" });
ok(r.status === 0, "refuses to start without a secure random source (" + (r.stdout || r.stderr).trim().split("\n").pop() + ")");

console.log("crypto.wasm is stripped of debug info");
const bytes = fs.readFileSync(wasmPath);
let i = 8, custom = 0;
const leb = () => { let v = 0, s = 0, b; do { b = bytes[i++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
while (i < bytes.length) { const id = bytes[i++]; const size = leb(); if (id === 0) custom++; i += size; }
ok(custom === 0, `no custom (debug / name) sections, ${(bytes.length / 1024).toFixed(0)} KB`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
process.exitCode = failures ? 1 : 0;
