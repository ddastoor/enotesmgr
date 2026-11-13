// Real sample files for the tests (tests/fixtures/media, made once by make-media.sh there): real pictures
// (JPEG, PNG with transparency, animated GIF, WebP), real audio clips (MP3, WAV, Ogg Opus, M4A / AAC), real
// video clips with sound (MP4 H.264 + AAC, WebM VP9 + Opus), a real two-page PDF with text and a picture, a
// UTF-8 text file, a web page and random binary data. Each file's SHA-256 is pinned here: a changed or broken
// sample stops the tests at once instead of quietly testing something else. checkRealInBrowser() and
// checkRealPdf() prove the samples are real: every picture decodes at its size, every clip plays for its
// length, the PDF has its two pages and their text.
//
// Also the kinds of notes the end-to-end suites make from them (RICH, UPLOADS) and markers to prove no
// plaintext of them leaks (leakMarkers).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "..", "fixtures", "media");
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");

// type: how the app shows the file ("image" / "audio" in its viewer, anything else as "Download this note to view").
const MEDIA = {
    "photo.jpg": { mime: "image/jpeg", type: "image", width: 320, height: 240, sha256: "5ba22699a8b06e34367dbc471c40fc3010601956a85bf96475e43eb9edbf54a1" },
    "picture.png": { mime: "image/png", type: "image", width: 200, height: 150, sha256: "9a0580abaaf35051b4160fb6681430e5e433c33d3f4b134aef24c8f44327c90b" },
    "anim.gif": { mime: "image/gif", type: "image", width: 64, height: 64, sha256: "ea0487abd3be106459b511b6484ea09698ba81bc5bb4b1c463a2feaff201066e" },
    "pic.webp": { mime: "image/webp", type: "image", width: 160, height: 120, sha256: "ca64d50a9ff59c230dd8bed25b1516bb8866d5505a4722810fb7ef70b84508a1" },
    "voice.mp3": { mime: "audio/mpeg", type: "audio", duration: 2, sha256: "abcc786756c27a2f9eceab64df4fdd5aa4fb472e50cc92ae4a6a56d6cd1e78a7" },
    "tone.wav": { mime: "audio/wav", type: "audio", duration: 1, sha256: "744e201fa513095059c2c211f4cad566e197b7c9480b2cb3a8e5d588212c4da7" },
    "clip.ogg": { mime: "audio/ogg", type: "audio", duration: 1.5, sha256: "ea5cbbaf7f678fff836bea15fe6724a5f6e8dacd97c47947cf64194ea9fb4908" },
    "clip.m4a": { mime: "audio/mp4", type: "audio", duration: 1, sha256: "685a4933b6134e4ec2ad1af7017f063129f96301ba1f3306e09dfc6c74bbcd3d" },
    "movie.mp4": { mime: "video/mp4", type: "video", width: 160, height: 120, duration: 2, sha256: "146d2fe189306a983138f178ffdb039691f759d4b7a60ed8d6acab243f05e9e1" },
    "movie.webm": { mime: "video/webm", type: "video", width: 160, height: 120, duration: 2, sha256: "32da800cdce871e0b8c8f08ecd55b8e3372600c0bc9333943bf93305273aca45" },
    "doc.pdf": { mime: "application/pdf", type: "pdf", pages: 2, sha256: "a01f2750933d20011b86f2774a10fe3cbd6fdf53ab768b9c4faa9c905816e04c" },
    "notes.txt": { mime: "text/plain", type: "text", sha256: "2e7ec78d4685384309d503ac2b3bbee9521c79261b4b769173c536a5503626bc" },
    "page.html": { mime: "text/html", type: "text", sha256: "dd3797f9cfcda497ce82074e269eba57d3832fad2142565dee38912cadd08f54" },
    "data.bin": { mime: "application/octet-stream", type: "binary", sha256: "bb9b8ef32898214a87de384ebda00b930dd0515dee53279f714439bec3e9dbb0" },
};
for (const [name, m] of Object.entries(MEDIA)) {
    const bytes = fs.readFileSync(path.join(DIR, name));
    if (sha(bytes) !== m.sha256) throw new Error(`tests/fixtures/media/${name} is not the pinned sample file (SHA-256 ${sha(bytes)}, pinned ${m.sha256})`);
    Object.assign(m, { name, bytes, b64: bytes.toString("base64"), dataUrl: `data:${m.mime};base64,${bytes.toString("base64")}` });
}
const byHash = Object.fromEntries(Object.values(MEDIA).map((m) => [m.sha256, m.name]));
// The sample a data: URL / bytes is, by SHA-256 ("?" if none).
const whichBytes = (bytes) => byHash[sha(bytes)] || "?";
const whichDataUrl = (url) => { const m = /^data:[^,]*;base64,(.*)$/s.exec(url || ""); return m ? whichBytes(Buffer.from(m[1], "base64")) : "?"; };
// What a picture / clip should look like when it works: "photo.jpg 320x240", "voice.mp3 2.0s".
const expectedLook = (name) => { const m = MEDIA[name]; return m.type === "image" ? `${name} ${m.width}x${m.height}` : `${name} ${m.duration.toFixed(1)}s`; };

// Rich text notes: pieces in order - text (typed; "\n" is Enter), a picture (Insert Image) or a clip (Insert
// Audio). The app has no "insert video" button: a video only gets into a rich text note through Insert Audio
// (the file picker's "All files"), so one is put in that way too.
const T = (text) => ({ text }), I = (image) => ({ image }), A = (audio) => ({ audio });
const RICH = [
    { name: "text", body: [T("Text only: PIN 1111 café ✓ 日本語\nsecond line\nthird line")] },
    { name: "text+pictures", body: [T("A JPEG:"), I("photo.jpg"), T("\na PNG"), I("picture.png"), T("then a GIF"), I("anim.gif"), T("\nand a WebP"), I("pic.webp"), T("the end")] },
    { name: "text+audio", body: [T("An MP3 clip"), A("voice.mp3"), T("\na WAV"), A("tone.wav"), T("an Ogg"), A("clip.ogg"), T("\nan M4A"), A("clip.m4a"), T("the end")] },
    { name: "text+pictures+audio", body: [T("All mixed up: PIN 2222"), I("photo.jpg"), A("voice.mp3"), T("\nbetween them"), I("picture.png"), T("more text"), A("tone.wav"), I("anim.gif"),
        T("\na video put in as audio"), A("movie.mp4"), T("near the end"), A("clip.ogg"), I("pic.webp"), T("\nlast words")] },
    { name: "pictures only", body: [I("photo.jpg"), I("picture.png"), I("anim.gif"), I("pic.webp")] },
    { name: "audio only", body: [A("voice.mp3"), A("clip.ogg"), A("clip.m4a")] },
    { name: "pictures+audio", body: [I("picture.png"), A("tone.wav"), I("photo.jpg"), A("movie.webm")] },
    { name: "empty", body: [] },
];
const mediaOf = (body) => body.filter((p) => p.image || p.audio).map((p) => p.image || p.audio);

// Uploaded files: the note name, the sample, and the type the browser gives the upload ("" = none known).
const UPLOADS = [
    { name: "photo.jpg", file: "photo.jpg" },
    { name: "picture.png", file: "picture.png" },
    { name: "scan", file: "photo.jpg", mime: "" }, // a picture without an extension (and no type)
    { name: "anim.gif", file: "anim.gif" },
    { name: "pic.webp", file: "pic.webp" },
    { name: "voice.mp3", file: "voice.mp3" },
    { name: "tone.wav", file: "tone.wav" },
    { name: "clip.ogg", file: "clip.ogg" },
    { name: "clip.m4a", file: "clip.m4a" },
    { name: "movie.mp4", file: "movie.mp4" },
    { name: "movie.webm", file: "movie.webm" },
    { name: "doc.pdf", file: "doc.pdf" },
    { name: "notes.txt", file: "notes.txt" },
    { name: "page.html", file: "page.html" },
    { name: "data.bin", file: "data.bin" },
].map((u) => ({ ...u, mime: u.mime === undefined ? MEDIA[u.file].mime : u.mime }));

// Pieces of the samples' plaintext that must never show up where a note is encrypted: a raw slice and a
// base64 slice (as inside a data: URL) of each sample, and typed text.
const leakMarkers = () => [
    ...Object.values(MEDIA).flatMap((m) => {
        const mid = Math.floor(m.bytes.length / 2), at = Math.floor(m.b64.length / 8) * 4;
        return [m.bytes.subarray(mid, mid + 24), Buffer.from(m.b64.slice(at, at + 32))];
    }),
    ...["PIN 1111", "PIN 2222", "All mixed up", "A JPEG:", "An MP3 clip", "eNotes test PDF", "An uploaded text file", "An uploaded web page"].map((s) => Buffer.from(s)),
];
// (A string is checked as UTF-8 and as Latin-1 text, so raw bytes kept in a string are found too.)
const leaks = (x) => {
    const forms = typeof x === "string" ? [Buffer.from(x, "utf8"), Buffer.from(x, "latin1")] : [Buffer.from(x)];
    return leakMarkers().some((m) => forms.some((b) => b.includes(m)));
};

// In a browser page: every picture decodes at its size, every audio / video clip plays for its length.
// Returns the samples that don't, with what the browser said (empty = all fine).
async function checkRealInBrowser(page) {
    const items = Object.values(MEDIA).filter((m) => ["image", "audio", "video"].includes(m.type)).map((m) => ({ name: m.name, type: m.type, url: m.dataUrl }));
    const got = await page.evaluate(async (list) => {
        const out = [];
        for (const it of list) {
            const el = document.createElement(it.type === "image" ? "img" : it.type);
            const r = await new Promise((done) => {
                el.addEventListener(it.type === "image" ? "load" : "loadedmetadata", () => done("ok"));
                el.addEventListener("error", () => done("error"));
                setTimeout(() => done("timeout"), 10000);
                el.src = it.url;
                document.body.appendChild(el);
            });
            out.push({ name: it.name, r, w: el.naturalWidth || el.videoWidth || 0, h: el.naturalHeight || el.videoHeight || 0, d: el.duration });
            el.remove();
        }
        return out;
    }, items);
    return got.filter((g) => {
        const m = MEDIA[g.name];
        if (g.r !== "ok") return true;
        if (m.width && (g.w !== m.width || g.h !== m.height)) return true;
        return m.duration !== undefined && !(Math.abs(g.d - m.duration) < 0.1);
    }).map((g) => `${g.name}: ${JSON.stringify(g)}`);
}
// The PDF: a real PDF (header, cross-reference table, end marker) with exactly its 2 pages and their text.
function checkRealPdf() {
    const t = MEDIA["doc.pdf"].bytes.toString("latin1");
    const pages = (t.match(/\/Type \/Page[^s]/g) || []).length;
    return t.startsWith("%PDF-1.") && /\nxref\n/.test(t) && t.trimEnd().endsWith("%%EOF") && pages === 2 &&
        t.includes("(eNotes test PDF - page 1) Tj") && t.includes("(eNotes test PDF - page 2) Tj") && t.includes("/Subtype /Image");
}

// ---- In the app (a Playwright page, a note open on the main page) ----
// Write a rich text note's body into the open note: text typed, pictures with Insert Image, clips with Insert Audio.
async function writeBody(page, body) {
    await page.click("#editor");
    for (const p of body) {
        if (p.text !== undefined) { await page.keyboard.type(p.text); continue; }
        const f = p.image || p.audio, c = await page.locator("#editor .media-embed").count();
        await page.setInputFiles(p.image ? "#hidden-ins-image" : "#hidden-ins-audio", { name: f, mimeType: MEDIA[f].mime, buffer: MEDIA[f].bytes });
        await page.waitForFunction((x) => document.querySelectorAll("#editor .media-embed").length > x, c);
    }
}
// What the open note shows: the view ("editor", "image", "audio", "download-message"), and every picture
// (its decoded size) and clip (its length) with its source, and the editor's text.
const look = (page) => page.evaluate(async () => {
    const settle = (el) => new Promise((done) => {
        const img = el.tagName === "IMG";
        if (img ? el.complete && el.naturalWidth > 0 : el.readyState >= 1) return done();
        el.addEventListener(img ? "load" : "loadedmetadata", () => done(), { once: true });
        el.addEventListener("error", () => done(), { once: true });
        setTimeout(done, 10000);
    });
    const desc = (el) => (el.tagName === "IMG" ? `${el.naturalWidth}x${el.naturalHeight}` : `${Number.isFinite(el.duration) ? el.duration.toFixed(1) : el.duration}s`);
    const v = document.getElementById("media-viewer");
    const els = v.hidden ? [...document.querySelectorAll("#editor .media-embed img, #editor .media-embed audio")] : [...v.querySelectorAll("img, audio")];
    await Promise.all(els.map(settle));
    const view = v.hidden ? "editor" : els.length ? (els[0].tagName === "IMG" ? "image" : "audio") : v.textContent.includes("Download this note to view") ? "download-message" : "?";
    return { view, looks: els.map(desc), srcs: els.map((e) => e.src), text: v.hidden ? document.getElementById("editor").innerText : "" };
});
// "photo.jpg 320x240 | voice.mp3 2.0s": every picture / clip shown, as which sample (by SHA-256) and how it decodes.
const looksOf = (l) => l.srcs.map((src, i) => `${whichDataUrl(src)} ${l.looks[i]}`).join(" | ");
// What differs between an open note (n: a RICH note with its body, or an upload with its file; l: look(); d: its
// Download {filename, bytes}) and its sample files - "" when nothing does.
function vsSamples(n, l, d) {
    const bad = [];
    if (!n.body) {
        const m = MEDIA[n.file];
        const want = m.type === "image" || m.type === "audio" ? m.type : "download-message";
        if (l.view !== want) bad.push(`shows ${l.view}, not ${want}`);
        if (want !== "download-message" && looksOf(l) !== expectedLook(n.file)) bad.push(`shows "${looksOf(l)}", not "${expectedLook(n.file)}"`);
        if (sha(d.bytes) !== m.sha256) bad.push(`downloads as ${whichBytes(d.bytes)} (${d.bytes.length} bytes), not ${n.file}`);
    } else {
        const want = mediaOf(n.body).map(expectedLook).join(" | ");
        if (l.view !== "editor") bad.push(`shows ${l.view}, not the editor`);
        if (looksOf(l) !== want) bad.push(`holds "${looksOf(l)}", not "${want}"`);
        const lines = n.body.filter((p) => p.text !== undefined).flatMap((p) => p.text.split("\n")).map((x) => x.trim()).filter(Boolean);
        let at = 0;
        for (const x of lines) { const i = l.text.indexOf(x, at); if (i < 0) { bad.push(`text "${x}" missing or out of order`); break; } at = i + x.length; }
        const html = d.bytes.toString("utf8");
        at = 0;
        for (const f of mediaOf(n.body)) { const i = html.indexOf(MEDIA[f].b64, at); if (i < 0) { bad.push(`its Download doesn't hold ${f} (in order)`); break; } at = i + MEDIA[f].b64.length; }
    }
    return bad.length ? `${n.name}: ${bad.join("; ")}` : "";
}
// How many pictures and clips the app shows for a list of notes (an uploaded video or document isn't shown).
const countMedia = (notes) => {
    let pictures = 0, clips = 0;
    for (const n of notes) {
        const shown = n.body ? mediaOf(n.body) : ["image", "audio"].includes(MEDIA[n.file].type) ? [n.file] : [];
        for (const f of shown) if (MEDIA[f].type === "image") pictures++; else clips++;
    }
    return { pictures, clips };
};

module.exports = { MEDIA, RICH, UPLOADS, T, I, A, mediaOf, whichBytes, whichDataUrl, expectedLook, leakMarkers, leaks, checkRealInBrowser, checkRealPdf, sha, writeBody, look, looksOf, vsSamples, countMedia };
