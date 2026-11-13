// End to end: a new file password with the export CLI's '-m rotate', the app doing the set-up in between.
// Account A makes every kind of note in the app (normal and sensitive; text, pictures, audio, uploads) and
// changes its settings (dark theme, a longer session timeout). '-m rotate' backs everything up, saves and
// checks it and - after the typed confirmation - deletes A's data; it stops there (no new token yet). The
// app then sets the account up again (a NEW file password, NEW recovery codes); '-m rotate' run again in the
// same folder puts everything back. Then: in Drive every note is exactly as before (metadata incl. dates,
// content) under the new file password, which the old one doesn't open; in the app every note shows, opens
// (sensitive ones with their note password) and downloads exactly as before, the dark theme and the
// session timeout are back, the old recovery codes no longer work and the new ones do.
// Usage: node rotate.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, drive, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout } = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FAKEFETCH = path.join(ROOT, "tests", "cli", "fakefetch.cjs");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-rotate-e2e-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const MP3 = Buffer.from("ID3fakeaudio-for-tests");
const LOCK = " \u{1F512}";
const MASTER = "MasterA123";
const EMAIL = "tester@gmail.com"; // the CLI's fake Drive account

const NOTES = [
    { name: "plain-text", kind: "new", text: "Plain text PIN 1111 café ✓", view: "editor" },
    { name: "rich", kind: "new", text: "Rich note with pictures", images: [PNG, GIF], audio: true, view: "editor" },
    { name: "photo.png", kind: "upload", file: PNG, mime: "image/png", view: "image" },
    { name: "doc.pdf", kind: "upload", file: PDF, mime: "application/pdf", view: "download-message" },
    { name: "s-text", kind: "new", pw: "SecretText1", text: "Secret PIN 2222 ✓", view: "editor" },
    { name: "s-rich", kind: "new", pw: "SecretRich2", text: "Secret with a picture", images: [GIF], view: "editor" },
    { name: "s-photo.png", kind: "upload", pw: "SecretPhoto3", file: PNG, mime: "image/png", view: "image" },
];

// The CLI, always in the same folder (a stopped rotation is continued there), on a dump of the app's Drive.
const ROT_CWD = fs.mkdtempSync(path.join(WORK, "rotation-"));
function cli(args, input, driveFile) {
    const r = spawnSync(process.execPath, ["-r", FAKEFETCH, CLI, ...args], { cwd: ROT_CWD, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveFile, FAKE_EMAIL: EMAIL } });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

(async () => {
    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;
    const fileByName = (n) => [...drive.values()].find((f) => f.name === n);
    const fpOf = (master) => JSON.parse(C.decryptData(fileByName("config.json").content, master)).file_password;
    const tryDec = (c, p) => { try { return C.decryptData(c, p); } catch { return null; } };

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
    // Set up the account in the app; -> its recovery codes.
    const setup = async (master) => {
        await login(page);
        await page.waitForSelector("#su-pwd", { timeout: 30000 });
        await page.fill("#su-pwd", master); await page.fill("#su-pwd2", master);
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
        const codes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
        await clickModal(page, "Recovery codes downloaded", "I've saved them");
        await onMain(page);
        return codes;
    };
    const dumpDrive = (file) => { fs.writeFileSync(file, JSON.stringify([...drive.values()])); return file; };
    const loadDrive = (file) => { const t = JSON.parse(fs.readFileSync(file, "utf8")); drive.clear(); t.forEach((f) => drive.set(f.id, f)); };
    const settingsShown = async () => {
        await page.click("#btn-settings");
        await page.waitForFunction(() => !document.querySelector("#set-save").disabled);
        const v = await page.evaluate(() => `${document.querySelector("#set-theme").value}/${document.querySelector("#set-timeout").value}`);
        await page.click("#set-cancel"); await page.waitForSelector("#file-select");
        return v;
    };

    console.log("1. Account A: every kind of note, and its own settings");
    const oldCodes = await setup(MASTER);
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
    await page.click("#btn-settings");
    await page.selectOption("#set-theme", "Dark"); await page.fill("#set-timeout", "900");
    await page.click("#set-save"); await onMain(page);
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark" && await settingsShown() === "Dark/900", "A's settings: dark theme, session timeout 900");
    const inA = {};
    for (const n of NOTES) {
        const d = await download(n.name, n.pw);
        inA[n.name] = { ...d, view: await view(), html: n.kind === "new" ? await editorHtml() : null };
    }
    ok(NOTES.every((n) => inA[n.name].view === n.view), "in A every note shows in its viewer");
    const labelsA = await page.$$eval("#file-select option", (os) => os.map((o) => o.textContent).filter(Boolean));
    await logout(page);
    const oldFp = fpOf(MASTER);
    const storedA = Object.fromEntries(NOTES.map((n) => { const f = fileByName(n.name); return [n.name, { appProperties: f.appProperties, content: C.decryptData(f.content, oldFp) }]; }));

    console.log("2. '-m rotate': back up, save, check, delete - then it waits for the set-up");
    const d1 = dumpDrive(path.join(WORK, "drive1.json"));
    const r1 = cli(["-m", "rotate"], `GOODTOKEN\n${MASTER}\nWIPE ${EMAIL}\n`, d1);
    loadDrive(d1);
    ok(r1.code === 1 && r1.out.includes("Deleted.") && r1.out.includes("The rotation is NOT finished") && !fileByName("eNotes Manager"),
        "A's data is deleted after the checks and the confirmation; with no new token yet it stops, saying how to finish" + (r1.code === 1 ? "" : `: ${r1.out.slice(-500)}`));

    console.log("3. The app sets the account up again");
    const newCodes = await setup(MASTER);
    await logout(page);
    const newFp = fpOf(MASTER);
    ok(newFp && newFp !== oldFp, "the set-up made a NEW file password (the same master password was chosen)");

    console.log("4. '-m rotate' again in the same folder: everything is put back");
    const d2 = dumpDrive(path.join(WORK, "drive2.json"));
    const r2 = cli(["-m", "rotate"], `\n${MASTER}\nGOODTOKEN\n${MASTER}\n`, d2);
    loadDrive(d2);
    ok(r2.code === 0 && r2.out.includes("Continuing the rotation") && r2.out.includes(`Rotation finished for ${EMAIL}`), "it continues the stopped rotation and finishes" + (r2.code === 0 ? "" : `: ${r2.out.slice(-600)}`));
    const entries = [...drive.values()].filter((f) => f.parents.includes(fileByName("Entries").id));
    ok(entries.length === NOTES.length && NOTES.every((n) => { const f = fileByName(n.name); return f && JSON.stringify(f.appProperties) === JSON.stringify(storedA[n.name].appProperties) && tryDec(f.content, newFp) === storedA[n.name].content; }),
        "in Drive every note is EXACTLY as before - metadata (dates, type, sensitive) and content - under the new file password");
    ok(entries.every((f) => tryDec(f.content, oldFp) === null), "the old file password opens none of them");
    ok(JSON.stringify(JSON.parse(tryDec(fileByName("settings.json").content, newFp))) === JSON.stringify({ session_timeout_seconds: 900, app_theme: "Dark" }), "settings.json: A's settings, under the new file password");

    console.log("5. In the app, everything is as it was");
    await login(page); await unlockInput(page, MASTER); await onMain(page);
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "the dark theme is back right after unlocking");
    ok(await settingsShown() === "Dark/900", "the Settings page shows Dark / 900");
    // (back on the main page, the note list loads again: wait for it)
    await page.waitForFunction((n) => [...document.querySelectorAll("#file-select option")].filter((o) => o.textContent).length >= n, labelsA.length, { timeout: 30000 }).catch(() => {});
    await status();
    const labels = await page.$$eval("#file-select option", (os) => os.map((o) => o.textContent).filter(Boolean));
    ok(JSON.stringify(labels) === JSON.stringify(labelsA), "the file list is the same as before, padlocks included: " + labels.join(" | "));
    for (const n of NOTES) {
        const d = await download(n.name, n.pw);
        const v = await view();
        const html = n.kind === "new" ? await editorHtml() : null;
        const a = inA[n.name];
        ok(v === n.view && html === a.html && Buffer.compare(d.bytes, a.bytes) === 0 && d.filename === a.filename,
            `'${n.name}'` + (n.pw ? " (with its note password)" : "") + `: shows as ${v}` + (html !== null ? ", same content" : "") + ", Download identical to before");
    }
    await open("s-text", "SecretText1");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" edited after");
    await page.click("#tb-save"); await status();
    ok(C.decryptData(C.decryptData(fileByName("s-text").content, newFp).slice("<<eNotesMgr-sensitive-note-v1>>".length), "SecretText1").includes("edited after"),
        "a sensitive note edited and saved after the rotation: locked with its note password and the new file password");
    await logout(page);

    console.log("6. Recovery codes: the old ones no longer work, the new ones do");
    await login(page); await unlockInput(page, oldCodes[0]);
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent === "Invalid recovery code", null, { timeout: 30000 });
    ok(true, "an old recovery code: 'Invalid recovery code'");
    await unlockInput(page, newCodes[0]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    ok(true, "a new recovery code opens the reset page");
    await page.click("#rmp-cancel"); await page.waitForSelector("#login-btn");

    ok(page.cspViolations.length === 0, "no CSP violations");
    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2);
});
