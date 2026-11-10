// Sensitive notes, without a browser: the envelope format (www/js/lib/sensitiveNote.js),
// the two encryption layers with the real crypto module, the shared export rules
// (noteExport.js) and the export CLI's offline mode on a sensitive note.
// Usage: node tests/sensitive.test.mjs   (or via tests/run-all.mjs)
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
let failures = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) failures++; };

globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(root, "www/js/crypto/crypto.wasm")).toString("base64");
const C = await imp("www/js/crypto/crypto.js");
await C.cryptoReady;
const S = await imp("www/js/lib/sensitiveNote.js");
const E = await imp("www/js/lib/noteExport.js");
const tryDec = (c, p) => { try { return C.decryptData(c, p); } catch { return null; } };

console.log("Envelope format");
const P = S.SENSITIVE_PREFIX;
ok(P === "<<eNotesMgr-sensitive-note-v1>>" && S.SENSITIVE_EXT === ".sensitive", "marker and extension are fixed (stored data depends on them)");
ok(S.isSensitiveContent(P + "QUJD"), "an envelope is recognised");
ok(["", "<div>hi</div>", "data:image/png;base64,AAA", "[metadata begin]\nx=y\n[metadata end]\nhi",
    "&lt;&lt;eNotesMgr-sensitive-note-v1&gt;&gt;QUJD", " " + P + "QUJD", null, undefined, 42].every((t) => !S.isSensitiveContent(t)),
    "ordinary notes (rich text, uploads, legacy, the marker typed as text, leading space) are not");
ok(S.unwrapSensitive(S.wrapSensitive("QUJD+/9=")) === "QUJD+/9=", "wrap / unwrap round trip");
ok(S.unwrapSensitive(P + "not base64!") === null && S.unwrapSensitive("QUJD") === null, "unwrap refuses malformed text");
const html = `<!DOCTYPE html><html><body><div class="editor">${P}QUJDRA==</div></body></html>`;
ok(S.findSensitivePayload(P + "QUJDRA==") === "QUJDRA==" && S.findSensitivePayload(html) === "QUJDRA==", "payload found in a .sensitive file and in an older CLI's .html");
ok(S.findSensitivePayload("<div>hello</div>") === null && S.findSensitivePayload(null) === null, "no payload in other files");
const names = [["bank.sensitive", "bank"], ["photo.png.sensitive", "photo.png"], ["BANK.SENSITIVE", "BANK"], ["bank.html", "bank"],
    ["photo.png.html", "photo.png"], ["bank", "bank"], [".sensitive", "note"], ["", "note"]];
ok(names.every(([f, b]) => S.sensitiveBaseName(f) === b), "file name -> note name: " + names.map(([f, b]) => `${f || '""'}->${b}`).join(", "));

console.log("Two layers: note password inside, file password outside");
const content = "<div>PIN 4242 ✓ café</div>";
const stored = C.encryptData(S.wrapSensitive(C.encryptVerified(content, "NotePass1")), "file-pw");
const afterFile = C.decryptData(stored, "file-pw");
ok(S.isSensitiveContent(afterFile) && !afterFile.includes("PIN"), "the file password only reveals the envelope");
ok(C.decryptData(S.unwrapSensitive(afterFile), "NotePass1") === content, "the note password then reveals the content");
ok(tryDec(S.unwrapSensitive(afterFile), "file-pw") === null && tryDec(stored, "NotePass1") === null, "each layer needs its own password");

console.log("Export rules (shared by the CLI and the app's Download)");
let out = E.buildNoteExport("bank", afterFile);
ok(out.filename === "bank.sensitive" && Buffer.from(out.bytes).toString() === afterFile, "a sensitive note -> bank.sensitive holding the envelope as-is");
ok(E.buildNoteExport("photo.png", afterFile).filename === "photo.png.sensitive", "an upload -> photo.png.sensitive");
ok(E.buildNoteExport("a/b:c", afterFile).filename === "a_b_c.sensitive", "the name is made filesystem-safe as usual");
ok(E.buildNoteExport("bank", content).filename === "bank.html" && E.buildNoteExport("p.png", "data:image/png;base64,AAAA").filename === "p.png",
    "ordinary notes are unchanged (bank.html, p.png)");

console.log("Export CLI, offline mode, on a sensitive note");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-sensitive-node-"));
try {
    fs.mkdirSync(path.join(work, "notes"));
    fs.writeFileSync(path.join(work, "config.json"), C.encryptVerified(JSON.stringify({ file_password: "file-pw" }), "Master123"));
    fs.writeFileSync(path.join(work, "notes", "bank"), stored);
    fs.writeFileSync(path.join(work, "notes", "plain"), C.encryptData("<div>hello</div>", "file-pw"));
    const run = fs.mkdtempSync(path.join(work, "run-"));
    const r = spawnSync(process.execPath, [path.join(root, "www/enotesmgr-export-cli.js"), "-m", "off", "-c", path.join(work, "config.json"), "-d", path.join(work, "notes")],
        { cwd: run, input: "Master123\n", encoding: "utf8" });
    const dir = fs.readdirSync(run).find((d) => d.startsWith("eNotes Manager Export_"));
    const files = dir ? fs.readdirSync(path.join(run, dir)).sort() : [];
    ok(r.status === 0 && files.join() === "bank.sensitive,plain.html", "exports bank.sensitive + plain.html: " + files.join(", "));
    ok(dir && fs.readFileSync(path.join(run, dir, "bank.sensitive"), "utf8") === afterFile, "bank.sensitive = the envelope (still locked with the note password)");
    ok(/1 sensitive note\(s\)/.test(r.stdout) && r.stdout.includes("Decrypt Sensitive File"), "and says how to open it");
    if (process.platform !== "win32" && dir) {
        ok((fs.statSync(path.join(run, dir, "bank.sensitive")).mode & 0o777) === 0o600, "written private (0600) like every exported file");
    }
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
process.exitCode = failures ? 1 : 0;
