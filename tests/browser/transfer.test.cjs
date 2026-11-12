// End to end: moving all notes to another account with the export CLI
// ('-m export' from account A, '-m import' into account B).
// Account A makes every kind of note in the app (normal and sensitive: text,
// text with pictures / audio, uploads - also one without an extension and an
// .html file); the CLI exports them; a brand-new account B is set up in the app
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

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FAKEFETCH = path.join(ROOT, "tests", "cli", "fakefetch.cjs");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-transfer-e2e-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const MP3 = Buffer.from("ID3fakeaudio-for-tests");
const HTMLFILE = Buffer.from("<html><body><p>an uploaded web page</p></body></html>");
const PREFIX = "<<eNotesMgr-sensitive-note-v1>>";
const LOCK = " \u{1F512}";
const MASTER_A = "MasterA123", MASTER_B = "MasterB456";

// A's notes. view: what the note area shows once opened.
const NOTES = [
    { name: "plain-text", kind: "new", text: "Plain text PIN 1111 café ✓", view: "editor" },
    { name: "rich", kind: "new", text: "Rich note with pictures", images: [PNG, GIF], audio: true, view: "editor" },
    { name: "photo.png", kind: "upload", file: PNG, mime: "image/png", view: "image" },
    { name: "scan", kind: "upload", file: PNG, mime: "", view: "image" }, // no extension: labelled by the browser, typed by content
    { name: "page.html", kind: "upload", file: HTMLFILE, mime: "text/html", view: "download-message" },
    { name: "doc.pdf", kind: "upload", file: PDF, mime: "application/pdf", view: "download-message" },
    { name: "s-text", kind: "new", pw: "SecretText1", text: "Secret PIN 2222 ✓", view: "editor" },
    { name: "s-rich", kind: "new", pw: "SecretRich2", text: "Secret with a picture", images: [GIF], view: "editor" },
    { name: "s-photo.png", kind: "upload", pw: "SecretPhoto3", file: PNG, mime: "image/png", view: "image" },
    { name: "s-noext", kind: "upload", pw: "SecretNoExt4", file: GIF, mime: "", view: "image" },
    { name: "s-doc.pdf", kind: "upload", pw: "SecretDoc55", file: PDF, mime: "application/pdf", view: "download-message" },
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
            await fc.setFiles({ name: n.name, mimeType: n.mime, buffer: n.file });
        } else {
            await page.click(n.pw ? "#tb-new-sensitive" : "#tb-new");
            const m = modal(page, n.pw ? "new sensitive note" : "Enter a name for the new note");
            await m.locator("input").fill(n.name); await m.locator(".modal-actions button", { hasText: "OK" }).click();
        }
        if (n.pw) { const m = modal(page, "Choose an extra password"); await m.waitFor(); await fillPw(m, n.pw, n.pw); await clickModal(page, "Choose an extra password", "Create"); }
        await waitSel(n.name); await status();
        if (n.kind === "new") {
            await page.click("#editor"); await page.keyboard.type(n.text + " ");
            for (const img of n.images || []) {
                const c = await page.locator("#editor .media-embed").count();
                await page.setInputFiles("#hidden-ins-image", { name: "i.png", mimeType: "image/png", buffer: img });
                await page.waitForFunction((x) => document.querySelectorAll("#editor .media-embed").length > x, c);
            }
            if (n.audio) {
                const c = await page.locator("#editor .media-embed").count();
                await page.setInputFiles("#hidden-ins-audio", { name: "a.mp3", mimeType: "audio/mpeg", buffer: MP3 });
                await page.waitForFunction((x) => document.querySelectorAll("#editor .media-embed").length > x, c);
            }
            await page.keyboard.type(" end"); await page.click("#tb-save"); await status();
        }
    }
    const inA = {};
    for (const n of NOTES) {
        const d = await download(n.name, n.pw);
        inA[n.name] = { ...d, view: await view(), html: n.kind === "new" ? await editorHtml() : null };
    }
    ok(NOTES.every((n) => inA[n.name].view === n.view), "in A every note shows in its viewer: " + NOTES.map((n) => `${n.name}=${inA[n.name].view}`).join(", "));
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
        const v = await view();
        const html = n.kind === "new" ? await editorHtml() : null;
        const a = inA[n.name];
        const bytes = nameInB(n) === n.name ? d.bytes : Buffer.from(d.bytes.toString().replace(`<title>${nameInB(n)}</title>`, `<title>${n.name}</title>`));
        ok(v === n.view && html === a.html && Buffer.compare(bytes, a.bytes) === 0 && d.filename === a.filename.replace(n.name, nameInB(n)),
            `'${nameInB(n)}'` + (n.pw ? " (with its note password)" : "") + `: shows as ${v}` + (html !== null ? ", same content" : "") + ", Download identical to A's");
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
