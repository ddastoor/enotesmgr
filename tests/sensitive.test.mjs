// Sensitive notes, without a browser: the envelope format (www/js/lib/sensitiveNote.js),
// the two encryption layers with the real crypto module, the shared export rules
// (noteExport.js) and the export CLI's offline mode on a sensitive note.
// Usage: node tests/sensitive.test.mjs   (or via tests/run-all.mjs)
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import M from "./lib/media.cjs"; // real sample files (tests/fixtures/media)

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

console.log("Every real sample file (pictures, audio / video clips, PDFs, text, web page, binary)");
{
    const all = Object.values(M.MEDIA);
    // As an uploaded note: its export is the file itself, byte for byte - with its own name, or (no extension)
    // the name plus the extension of its type.
    ok(all.every((m) => { const o = E.buildNoteExport(m.name, m.dataUrl); return o.filename === m.name && M.sha(Buffer.from(o.bytes)) === m.sha256; }),
        `${all.length} uploaded samples: each exports as exactly the file (name and SHA-256)`);
    ok(all.every((m) => { const o = E.buildNoteExport("noext", m.dataUrl); return o.filename.startsWith("noext.") && M.sha(Buffer.from(o.bytes)) === m.sha256; }),
        "uploaded without an extension: named by their type, still byte for byte the file");
    // As a sensitive note: two layers; the file password alone shows nothing of it; the note password gives it back exactly.
    const bad = [];
    for (const m of all) {
        const st = C.encryptData(S.wrapSensitive(C.encryptVerified(m.dataUrl, "NotePass9")), "file-pw");
        const env = C.decryptData(st, "file-pw");
        const back = tryDec(S.unwrapSensitive(env), "NotePass9");
        const o = back === null ? null : E.buildNoteExport(m.name, back);
        if (!S.isSensitiveContent(env) || M.leaks(env) || M.leaks(st) || E.buildNoteExport(m.name, env).filename !== m.name + ".sensitive" || !o || M.sha(Buffer.from(o.bytes)) !== m.sha256) bad.push(m.name);
    }
    ok(bad.length === 0, `as sensitive notes: locked in two layers, nothing of the file readable without the note password, ${all.length} samples back byte for byte with it` + (bad.length ? ` - wrong: ${bad.join(", ")}` : ""));
    // A rich text note holding every picture and clip: its export (.html) holds each, byte for byte, in order.
    const media = all.filter((m) => m.type === "image" || m.type === "audio");
    const rich = "<div>All the pictures and clips ✓</div>" + media.map((m) => m.type === "image"
        ? `<span class="media-embed" contenteditable="false"><img src="${m.dataUrl}"></span> `
        : `<span class="media-embed" contenteditable="false"><audio controls="" src="${m.dataUrl}"></audio></span> `).join("");
    const ro = E.buildNoteExport("album", rich), rhtml = Buffer.from(ro.bytes).toString("utf8");
    let at = 0;
    const inOrder = media.every((m) => { const i = rhtml.indexOf(m.b64, at); if (i < 0) return false; at = i + m.b64.length; return true; });
    ok(ro.filename === "album.html" && inOrder, `a rich text note with ${media.length} pictures and clips exports as album.html holding each, byte for byte, in order`);
}

console.log("Export CLI, offline mode, on a sensitive note");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-sensitive-node-"));
try {
    fs.mkdirSync(path.join(work, "notes"));
    fs.writeFileSync(path.join(work, "config.json"), C.encryptVerified(JSON.stringify({ file_password: "file-pw" }), "Master123"));
    fs.writeFileSync(path.join(work, "notes", "bank"), stored);
    fs.writeFileSync(path.join(work, "notes", "plain"), C.encryptData("<div>hello</div>", "file-pw"));
    // Real samples: a sensitive picture and a normal video clip.
    const sPhoto = C.encryptData(S.wrapSensitive(C.encryptVerified(M.MEDIA["photo.jpg"].dataUrl, "PhotoPass1")), "file-pw");
    fs.writeFileSync(path.join(work, "notes", "photo.jpg"), sPhoto);
    fs.writeFileSync(path.join(work, "notes", "movie.mp4"), C.encryptData(M.MEDIA["movie.mp4"].dataUrl, "file-pw"));
    const run = fs.mkdtempSync(path.join(work, "run-"));
    const r = spawnSync(process.execPath, [path.join(root, "www/enotesmgr-export-cli.js"), "-m", "off", "-c", path.join(work, "config.json"), "-d", path.join(work, "notes")],
        { cwd: run, input: "Master123\n", encoding: "utf8" });
    const dir = fs.readdirSync(run).find((d) => d.startsWith("eNotes Manager Export_"));
    const files = dir ? fs.readdirSync(path.join(run, dir)).sort() : [];
    ok(r.status === 0 && files.join() === "bank.sensitive,movie.mp4,photo.jpg.sensitive,plain.html", "exports bank.sensitive + movie.mp4 + photo.jpg.sensitive + plain.html: " + files.join(", "));
    ok(dir && fs.readFileSync(path.join(run, dir, "bank.sensitive"), "utf8") === afterFile, "bank.sensitive = the envelope (still locked with the note password)");
    if (dir) {
        const env = fs.readFileSync(path.join(run, dir, "photo.jpg.sensitive"), "utf8");
        const back = tryDec(S.findSensitivePayload(env), "PhotoPass1");
        ok(env === C.decryptData(sPhoto, "file-pw") && !M.leaks(env) && back !== null && M.sha(Buffer.from(E.buildNoteExport("photo.jpg", back).bytes)) === M.MEDIA["photo.jpg"].sha256,
            "photo.jpg.sensitive = the envelope, nothing of the picture readable; with its note password: the original picture byte for byte");
        ok(M.sha(fs.readFileSync(path.join(run, dir, "movie.mp4"))) === M.MEDIA["movie.mp4"].sha256, "movie.mp4 = the original video clip byte for byte (SHA-256)");
    }
    ok(/2 sensitive note\(s\)/.test(r.stdout) && r.stdout.includes("Decrypt Sensitive File"), "and says how to open them");
    if (process.platform !== "win32" && dir) {
        ok((fs.statSync(path.join(run, dir, "bank.sensitive")).mode & 0o777) === 0o600, "written private (0600) like every exported file");
    }
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
process.exitCode = failures ? 1 : 0;
