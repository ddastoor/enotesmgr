// End to end: moving all notes to another account with the export CLI
// ('-m export' from account A, '-m import' into account B).
// Account A makes every kind of note in the app from REAL sample files (normal and
// sensitive: text, text with real pictures and audio clips, uploads - pictures,
// one without an extension, PDF, video, audio, an .html file); the CLI exports them; a brand-new account B is set up in the app
// (with a note whose name clashes); the CLI imports them into B. Then, logged in
// as B, every note must be exactly as in A - the same stored metadata (dates,
// type, sensitive) and content - and show, open (sensitive ones with their own
// note password) and download exactly as in A; B's own note is untouched;
// imported notes can be edited and saved; importing again adds nothing.
// Usage: node transfer.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, drive, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout } = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const M = require("../lib/media.cjs"); // real sample files (tests/fixtures/media)

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FAKEFETCH = path.join(ROOT, "tests", "cli", "fakefetch.cjs");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-transfer-e2e-"));
const PREFIX = "<<eNotesMgr-sensitive-note-v1>>";
const LOCK = " \u{1F512}";
const MASTER_A = "MasterA123", MASTER_B = "MasterB456";

// A's notes, from REAL sample files (tests/lib/media.cjs). body: a rich text note's typed text, pictures and
// clips in order; file: the sample uploaded. view: what the note area shows once opened.
const { T, I, A } = M;
const NOTES = [
    { name: "plain-text", kind: "new", body: [T("Plain text PIN 1111 café ✓")], view: "editor" },
    { name: "rich", kind: "new", body: [T("Rich note with pictures "), I("photo.jpg"), I("anim.gif"), T(" and clips "), A("voice.mp3"), A("clip.ogg"), T(" end")], view: "editor" },
    { name: "photo.png", kind: "upload", file: "picture.png", mime: "image/png", view: "image" },
    { name: "scan", kind: "upload", file: "photo.jpg", mime: "", view: "image" }, // no extension: labelled by the browser, typed by content
    { name: "page.html", kind: "upload", file: "page.html", mime: "text/html", view: "download-message" },
    { name: "doc.pdf", kind: "upload", file: "doc.pdf", mime: "application/pdf", view: "download-message" },
    { name: "movie.mp4", kind: "upload", file: "movie.mp4", mime: "video/mp4", view: "download-message" },
    { name: "voice.mp3", kind: "upload", file: "voice.mp3", mime: "audio/mpeg", view: "audio" },
    { name: "s-text", kind: "new", pw: "SecretText1", body: [T("Secret PIN 2222 ✓")], view: "editor" },
    { name: "s-rich", kind: "new", pw: "SecretRich2", body: [T("Secret with a picture "), I("pic.webp"), T(" and a clip "), A("tone.wav"), T(" end")], view: "editor" },
    { name: "s-photo.png", kind: "upload", pw: "SecretPhoto3", file: "picture.png", mime: "image/png", view: "image" },
    { name: "s-noext", kind: "upload", pw: "SecretNoExt4", file: "anim.gif", mime: "", view: "image" },
    { name: "s-doc.pdf", kind: "upload", pw: "SecretDoc55", file: "doc.pdf", mime: "application/pdf", view: "download-message" },
    { name: "s-movie.webm", kind: "upload", pw: "SecretMovie6", file: "movie.webm", mime: "video/webm", view: "download-message" },
    { name: "s-clip.m4a", kind: "upload", pw: "SecretClip77", file: "clip.m4a", mime: "audio/mp4", view: "audio" },
];

function cli(args, input, driveFile) {
    const cwd = fs.mkdtempSync(path.join(WORK, "run-"));
    const r = spawnSync(process.execPath, ["-r", FAKEFETCH, CLI, ...args], { cwd, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveFile } });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), cwd };
}

(async () => {
    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;
    const fileByName = (n) => [...drive.values()].find((f) => f.name === n);
    const fpOf = (master) => JSON.parse(C.decryptData(fileByName("config.json").content, master)).file_password;

    const browser = await chromium.launch();
    const page = await newPage(browser);
    const status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    const waitSel = (n) => page.waitForFunction((x) => document.querySelector("#file-select").value === x, n);
    const fillPw = async (m, a, b) => { const i = m.locator("input[type=password]"); await i.nth(0).fill(a); if (b !== undefined) await i.nth(1).fill(b); };
    const editorHtml = () => page.evaluate(() => {
        const c = document.getElementById("editor").cloneNode(true);
        c.querySelectorAll(".embed-del").forEach((e) => e.remove());
        c.querySelectorAll(".media-embed.selected").forEach((e) => e.classList.remove("selected"));
        return c.innerHTML;
    });
    const view = () => page.evaluate(() => {
        const v = document.getElementById("media-viewer");
        if (v.hidden) return "editor";
        if (v.querySelector("img")) return "image";
        if (v.querySelector("audio")) return "audio";
        return v.textContent.includes("Download this note to view") ? "download-message" : "?";
    });
    const open = async (name, pw) => {
        await page.selectOption("#file-select", name);
        if (await modal(page, "save the current note").count()) await clickModal(page, "save the current note", "No");
        if (pw) { const m = modal(page, "is a sensitive note"); await m.waitFor(); await fillPw(m, pw); await clickModal(page, "is a sensitive note", "Unlock"); }
        await waitSel(name); await status();
    };
    const download = async (name, pw) => {
        await open(name, pw);
        const [d] = await Promise.all([page.waitForEvent("download"), (async () => {
            await page.click("#tb-download");
            if (pw) await clickModal(page, "will NOT be encrypted", "OK");
        })()]);
        return { filename: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
    };
    const setup = async (master) => {
        await login(page);
        await page.waitForSelector("#su-pwd", { timeout: 30000 });
        await page.fill("#su-pwd", master); await page.fill("#su-pwd2", master);
        await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
        await clickModal(page, "Recovery codes downloaded", "I've saved them");
        await onMain(page);
    };
    const dumpDrive = (file) => { fs.writeFileSync(file, JSON.stringify([...drive.values()])); return file; };

    console.log("1. Account A makes every kind of note in the app");
    await setup(MASTER_A);
    for (const n of NOTES) {
        if (n.kind === "upload") {
            const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click(n.pw ? "#tb-upload-sensitive" : "#tb-upload")]);
            await fc.setFiles({ name: n.name, mimeType: n.mime, buffer: M.MEDIA[n.file].bytes });
        } else {
            await page.click(n.pw ? "#tb-new-sensitive" : "#tb-new");
            const m = modal(page, n.pw ? "new sensitive note" : "Enter a name for the new note");
            await m.locator("input").fill(n.name); await m.locator(".modal-actions button", { hasText: "OK" }).click();
        }
        if (n.pw) { const m = modal(page, "Choose an extra password"); await m.waitFor(); await fillPw(m, n.pw, n.pw); await clickModal(page, "Choose an extra password", "Create"); }
        await waitSel(n.name); await status();
        if (n.kind === "new") { await M.writeBody(page, n.body); await page.click("#tb-save"); await status(); }
    }
    const inA = {}, offA = [];
    for (const n of NOTES) {
        const d = await download(n.name, n.pw);
        const l = await M.look(page);
        inA[n.name] = { ...d, view: l.view, looks: M.looksOf(l), html: n.kind === "new" ? await editorHtml() : null };
        const why = M.vsSamples(n, l, d); if (why) offA.push(why);
    }
    ok(NOTES.every((n) => inA[n.name].view === n.view), "in A every note shows in its viewer: " + NOTES.map((n) => `${n.name}=${inA[n.name].view}`).join(", "));
    ok(offA.length === 0, "in A every note is exactly its real sample files: pictures decode at their sizes, clips play for their lengths, all byte for byte (SHA-256)" + (offA.length ? `\n      ${offA.join("\n      ")}` : ""));
    await logout(page);
    const fpA = fpOf(MASTER_A);
    const storedA = Object.fromEntries(NOTES.map((n) => { const f = fileByName(n.name); return [n.name, { appProperties: f.appProperties, mimeType: f.mimeType, content: C.decryptData(f.content, fpA) }]; }));

    console.log("2. '-m export' (account A)");
    const exp = cli(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, dumpDrive(path.join(WORK, "driveA.json")));
    const made = fs.readdirSync(exp.cwd); // the dated transfer folder, made where the command was run
    const tdir = path.join(exp.cwd, made[0] || "");
    ok(exp.code === 0 && made.length === 1 && /^eNotes Manager Transfer_\d{8}_\d{4}$/.test(made[0]) && fs.readdirSync(tdir).length === NOTES.length,
        `exported ${NOTES.length} notes into ${made[0]} (made in the folder it was run in)` + (exp.code === 0 ? "" : `: ${exp.out.slice(-400)}`));

    console.log("3. A brand-new account B, with its own 'plain-text' note");
    drive.clear();
    await setup(MASTER_B);
    await page.click("#tb-new");
    await modal(page, "Enter a name for the new note").locator("input").fill("plain-text");
    await clickModal(page, "Enter a name for the new note", "OK"); await status();
    await page.keyboard.type("B's own note"); await page.click("#tb-save"); await status();
    await logout(page);
    const bOwn = JSON.stringify(fileByName("plain-text"));
    const fpB = fpOf(MASTER_B);

    console.log("4. '-m import' into B");
    const driveB = dumpDrive(path.join(WORK, "driveB.json"));
    const before = new Set([...drive.keys()]);
    const imp = cli(["-m", "import"], `${tdir}\n${MASTER_A}\nGOODTOKEN\n${MASTER_B}\ny\n`, driveB);
    ok(imp.code === 0 && imp.out.includes(`Imported ${NOTES.length} of ${NOTES.length} note(s)`), `imported ${NOTES.length} notes` + (imp.code === 0 ? "" : `: ${imp.out.slice(-400)}`));
    const after = JSON.parse(fs.readFileSync(driveB, "utf8"));
    drive.clear(); after.forEach((f) => drive.set(f.id, f));
    const nameInB = (n) => (n.name === "plain-text" ? "plain-text (1)" : n.name);
    ok(NOTES.every((n) => { const f = fileByName(nameInB(n)); return f && !before.has(f.id) && JSON.stringify(f.appProperties) === JSON.stringify(storedA[n.name].appProperties) && C.decryptData(f.content, fpB) === storedA[n.name].content; }),
        "in B's Drive every note is EXACTLY as in A: same metadata (dates, type, sensitive) and same content - re-encrypted with B's file password");
    const bEntriesId = [...drive.values()].find((f) => f.name === "Entries").id;
    ok(NOTES.every((n) => { const f = fileByName(nameInB(n)); return f.mimeType === storedA[n.name].mimeType && f.parents.length === 1 && f.parents[0] === bEntriesId
        && Object.keys(f.appProperties).sort().join() === Object.keys(storedA[n.name].appProperties).sort().join(); }),
        "and the rest of each Drive record is what the app writes for a note it creates: a text/plain file in B's Entries folder, every metadata key present");
    ok(JSON.stringify(fileByName("plain-text")) === bOwn, "B's own 'plain-text' is untouched; A's arrives as 'plain-text (1)'");

    console.log("5. In the app, B's notes work exactly as A's did");
    await login(page); await unlockInput(page, MASTER_B); await onMain(page);
    const labels = await page.$$eval("#file-select option", (os) => os.map((o) => o.textContent).filter(Boolean));
    const want = ["plain-text", ...NOTES.map((n) => nameInB(n) + (n.pw ? LOCK : ""))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    ok(JSON.stringify(labels) === JSON.stringify(want), "file list: B's note + all of A's, sensitive ones with a padlock: " + labels.join(" | "));
    for (const n of NOTES) {
        const d = await download(nameInB(n), n.pw);
        const l = await M.look(page), v = l.view;
        const html = n.kind === "new" ? await editorHtml() : null;
        const a = inA[n.name];
        const bytes = nameInB(n) === n.name ? d.bytes : Buffer.from(d.bytes.toString().replace(`<title>${nameInB(n)}</title>`, `<title>${n.name}</title>`));
        const why = M.vsSamples({ ...n, name: nameInB(n) }, l, { ...d, bytes });
        ok(v === n.view && M.looksOf(l) === a.looks && html === a.html && Buffer.compare(bytes, a.bytes) === 0 && d.filename === a.filename.replace(n.name, nameInB(n)) && !why,
            `'${nameInB(n)}'` + (n.pw ? " (with its note password)" : "") + `: shows as ${v}` + (l.srcs.length ? ` [${M.looksOf(l)}]` : "") + (html !== null ? ", same content" : "") + ", Download identical to A's - exactly its real sample files" + (why ? `\n      ${why}` : ""));
        if (n.view !== "editor") ok(await page.isDisabled("#tb-save"), `'${nameInB(n)}': Save disabled, as for any upload`);
    }
    await open("s-text", "SecretText1");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" edited in B");
    await page.click("#tb-save"); await status();
    const st = fileByName("s-text"), outer = C.decryptData(st.content, fpB);
    ok(outer.startsWith(PREFIX) && C.decryptData(outer.slice(PREFIX.length), "SecretText1").includes("edited in B") && st.appProperties.Sensitive === "yes",
        "an imported sensitive note edited and saved in B: still locked with its note password");
    await open("rich");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" more");
    await page.click("#tb-save"); await status();
    ok(C.decryptData(fileByName("rich").content, fpB).includes("more"), "an imported normal note edited and saved in B");
    await logout(page);

    console.log("6. Importing the same folder again adds nothing");
    const driveB2 = dumpDrive(path.join(WORK, "driveB2.json"));
    const again = cli(["-m", "import"], `${tdir}\n${MASTER_A}\nGOODTOKEN\n${MASTER_B}\ny\n`, driveB2);
    const after2 = JSON.parse(fs.readFileSync(driveB2, "utf8"));
    // (the two notes edited in B are no longer identical, so those two come back as ' (1)' copies)
    ok(again.code === 0 && after2.length === drive.size + 2 && again.out.includes(`2 note(s) to add, ${NOTES.length - 2} already there`),
        "again: the unchanged notes are 'already there' - only the 2 notes edited in B since are added again (as copies)");

    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2);
});
