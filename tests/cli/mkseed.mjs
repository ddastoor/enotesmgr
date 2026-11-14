// Builds the CLI test data in the current directory: offline/config.json +
// offline/notes/* (encrypted note files) and a fake Drive tree (drive.json, plus
// drive-evil.json with hostile "." / ".." folder names).
// Usage: node mkseed.mjs <dir containing crypto.js + crypto.wasm>
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import M from "../lib/media.cjs"; // real sample files (tests/fixtures/media)
const CRYPTO_DIR = path.resolve(process.argv[2]);
globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(CRYPTO_DIR, "crypto.wasm")).toString("base64");
const m = await import(pathToFileURL(path.join(CRYPTO_DIR, "crypto.js")).href); await m.cryptoReady;
const fp = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
// Real pictures, clips and files, stored as the app stores them (a rich text note's embeds, an upload's data: URL).
const notes = {
  "bank": "<p><b>PIN</b> 4242 ✓ café</p><span class=\"media-embed\"><img src=\"" + M.MEDIA["photo.jpg"].dataUrl + "\"></span> " +
    "<span class=\"media-embed\"><audio controls=\"\" src=\"" + M.MEDIA["voice.mp3"].dataUrl + "\"></audio></span>",
  "bank.html": "<p>collides with bank</p>",
  "photo.png": M.MEDIA["picture.png"].dataUrl,
  "doc.pdf": M.MEDIA["doc.pdf"].dataUrl,
  "noext": M.MEDIA["picture.png"].dataUrl,
  "movie.mp4": M.MEDIA["movie.mp4"].dataUrl,
  "voice.mp3": M.MEDIA["voice.mp3"].dataUrl,
  "a:b*c?": "<p>weird name</p>",
  "café ☕ notes": "<p>unicode name</p>",
  "empty": "",
};
const config = m.encryptData(JSON.stringify({ file_password: fp }), "Master123");
fs.rmSync("offline", { recursive: true, force: true }); fs.mkdirSync("offline/notes", { recursive: true });
fs.writeFileSync("offline/config.json", config);
const drive = []; let n = 0; const id = () => "id" + (++n);
const add = (name, parent, content, folder) => { const f = { id: id(), name, parents: [parent], mimeType: folder ? "application/vnd.google-apps.folder" : "text/plain", content: content || "" }; drive.push(f); return f.id; };
const mgr = add("eNotes Manager", "appDataFolder", "", true);
const cfg = add("Config", mgr, "", true), ent = add("Entries", mgr, "", true), rec = add("Recovery", mgr, "", true);
add("config.json", cfg, config); add("settings.json", cfg, m.encryptData(JSON.stringify({ session_timeout_seconds: 300, app_theme: "Light" }), fp));
add("recovery-1111", rec, m.encryptData(JSON.stringify({ file_password: fp }), "1234567812345678"));
for (const [name, content] of Object.entries(notes)) {
  const ct = m.encryptData(content, fp);
  add(name, ent, ct);
  fs.writeFileSync("offline/notes/" + name, ct);
}
fs.writeFileSync("drive.json", JSON.stringify(drive));
// Same tree plus hostile folder names "." and ".." (for the mirror-mode path guard)
const evil = JSON.parse(JSON.stringify(drive));
evil.push({ id: "evil1", name: "..", parents: [mgr], mimeType: "application/vnd.google-apps.folder", content: "" });
evil.push({ id: "evil2", name: "ESCAPED.txt", parents: ["evil1"], mimeType: "text/plain", content: "should stay inside" });
evil.push({ id: "evil3", name: ".", parents: [mgr], mimeType: "application/vnd.google-apps.folder", content: "" });
evil.push({ id: "evil4", name: "DOT.txt", parents: ["evil3"], mimeType: "text/plain", content: "dot" });
fs.writeFileSync("drive-evil.json", JSON.stringify(evil));
// Duplicates, listed FIRST (as the app's data-safety rules handle them): an
// empty second "eNotes Manager" tree, and in the real Config folder a second
// config.json with a DIFFERENT key under the same master password that is also
// OLDER - so only "use the copy whose key opens the notes" picks correctly.
const dups = JSON.parse(JSON.stringify(drive));
const realConfigFolder = dups.find((f) => f.name === "Config").id;
dups.unshift({ id: "dupcfg", name: "config.json", parents: [realConfigFolder], mimeType: "text/plain",
  content: m.encryptData(JSON.stringify({ file_password: "a-different-key" }), "Master123"),
  appProperties: { DateTimeCreated: "2020-01-01T00:00", CreationMethod: "app", FileType: "config" } });
dups.unshift({ id: "dupE", name: "Entries", parents: ["dupM"], mimeType: "application/vnd.google-apps.folder", content: "" });
dups.unshift({ id: "dupC", name: "Config", parents: ["dupM"], mimeType: "application/vnd.google-apps.folder", content: "" });
dups.unshift({ id: "dupM", name: "eNotes Manager", parents: ["appDataFolder"], mimeType: "application/vnd.google-apps.folder", content: "" });
fs.writeFileSync("drive-dups.json", JSON.stringify(dups));
// config.json genuinely missing
fs.writeFileSync("drive-noconfig.json", JSON.stringify(drive.filter((f) => f.name !== "config.json")));
console.log("seeded", Object.keys(notes).length, "notes");
