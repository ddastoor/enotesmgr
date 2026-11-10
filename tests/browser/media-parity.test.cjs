// Pictures and audio work the same in a sensitive note as in a normal note: the
// SAME sequence of editing actions is done in a normal rich text note and in a
// sensitive one, and every step must give the same result - Insert Image, Insert
// Audio, Ctrl+V of an image from the real clipboard (small and screenshot-sized),
// Ctrl+V of text, pasting an audio file, removing an embed with its ✕ button and
// with Delete, Ctrl+Z bringing it back, saving and reopening (the sensitive note
// with its password); finally both notes hold byte-identical content (the
// sensitive one still double encrypted in Drive). Plus the mobile ✕ (with confirm).
// Usage: node media-parity.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, drive, GIS_STUB, driveRoute, ok, finish, newPage, modal, clickModal, login, onMain, unlockInput } = require("./lib/harness.cjs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const BASE = process.argv[2];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const MP3 = Buffer.from("ID3fakeaudio-for-tests");
const PREFIX = "<<eNotesMgr-sensitive-note-v1>>";
const NOTE_PW = "NotePass1";

(async () => {
    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;
    const fileByName = (name) => [...drive.values()].find((f) => f.name === name);

    const browser = await chromium.launch();
    // Real clipboard access, like a user's Ctrl+C / Ctrl+V.
    const ctx = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1280, height: 800 } });
    await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "application/javascript", body: GIS_STUB }));
    await ctx.route("https://www.googleapis.com/**", driveRoute);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE);
    const status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; }, null, { timeout: 120000 });
    const counts = () => page.evaluate(() => ({
        img: document.querySelectorAll("#editor .media-embed img").length,
        audio: document.querySelectorAll("#editor .media-embed audio").length,
    }));
    const savedHtml = () => page.evaluate(() => {
        const c = document.getElementById("editor").cloneNode(true);
        c.querySelectorAll(".embed-del").forEach((e) => e.remove());
        c.querySelectorAll(".media-embed.selected").forEach((e) => e.classList.remove("selected"));
        return c.innerHTML;
    });
    const clipboardImage = (w, h) => page.evaluate(async ([w, h]) => {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d"); const d = g.createImageData(w, h);
        // Deterministic noise (does not compress: a realistic screenshot size).
        let x = 12345;
        for (let i = 0; i < d.data.length; i++) { x = (x * 1103515245 + 12345) >>> 0; d.data[i] = (i & 3) === 3 ? 255 : x >>> 24; }
        g.putImageData(d, 0, 0);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return blob.size;
    }, [w, h]);
    const clipboardText = (t) => page.evaluate((t) => navigator.clipboard.writeText(t), t);
    // The same file pasted from the clipboard (as when a file is copied in the file manager).
    const pasteFile = (name, type, b64) => page.evaluate(([name, type, b64]) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type }));
        document.getElementById("editor").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [name, type, b64]);

    await login(page);
    await page.fill("#su-pwd", "Master123"); await page.fill("#su-pwd2", "Master123");
    await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    const FP = JSON.parse(C.decryptData(fileByName("config.json").content, "Master123")).file_password;

    // Every step's observable result, per note kind; compared at the end.
    const results = { normal: [], sensitive: [] };
    const step = async (kind, label, fn) => {
        await fn();
        await page.waitForTimeout(250);
        const r = { label, ...(await counts()), focus: await page.evaluate(() => document.activeElement && document.activeElement.id) };
        results[kind].push(r);
        return r;
    };

    for (const kind of ["normal", "sensitive"]) {
        const name = kind === "normal" ? "note-n" : "note-s";
        console.log(`${kind === "normal" ? "1" : "2"}. ${kind} note`);
        if (kind === "normal") {
            await page.click("#tb-new");
            await modal(page, "Enter a name for the new note").locator("input").fill(name);
            await clickModal(page, "Enter a name for the new note", "OK");
        } else {
            await page.click("#tb-new-sensitive");
            await modal(page, "new sensitive note").locator("input").fill(name);
            await clickModal(page, "new sensitive note", "OK");
            const m = modal(page, "Choose an extra password");
            await m.waitFor(); await m.locator("input").nth(0).fill(NOTE_PW); await m.locator("input").nth(1).fill(NOTE_PW);
            await clickModal(page, "Choose an extra password", "Create");
            await page.waitForTimeout(300);
            if (await modal(page, "save the current note").count()) await clickModal(page, "save the current note", "No");
        }
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name); await status();
        // Straight after creating: Ctrl+V of an image, without clicking first.
        await clipboardImage(4, 4);
        await step(kind, "Ctrl+V image right after creating", () => page.keyboard.press("Control+v"));
        await step(kind, "type text", () => page.keyboard.type(" Some text "));
        await clipboardText("pasted words ");
        await step(kind, "Ctrl+V text", () => page.keyboard.press("Control+v"));
        await step(kind, "Insert Image button", async () => {
            await page.setInputFiles("#hidden-ins-image", { name: "a.png", mimeType: "image/png", buffer: PNG });
        });
        await step(kind, "Insert Audio button", async () => {
            await page.setInputFiles("#hidden-ins-audio", { name: "a.mp3", mimeType: "audio/mpeg", buffer: MP3 });
        });
        const bytes = await clipboardImage(1280, 720);
        await page.click("#editor"); await page.keyboard.press("End");
        await step(kind, `Ctrl+V screenshot (${(bytes / 1048576).toFixed(1)} MB)`, () => page.keyboard.press("Control+v"));
        await step(kind, "paste an image file", () => pasteFile("p.png", "image/png", PNG.toString("base64")));
        await step(kind, "paste an audio file", () => pasteFile("a.mp3", "audio/mpeg", MP3.toString("base64")));
        await step(kind, "remove an image with its ✕", async () => {
            const e = page.locator("#editor .media-embed").first();
            await e.hover(); await e.locator(".embed-del").click();
        });
        await step(kind, "Ctrl+Z brings it back", async () => { await page.click("#editor"); await page.keyboard.press("Control+z"); });
        await step(kind, "select the audio + Delete", async () => {
            await page.locator("#editor .media-embed audio").first().evaluate((a) => a.closest(".media-embed").click());
            await page.keyboard.press("Delete");
        });
        await step(kind, "Ctrl+Z brings it back", async () => { await page.click("#editor"); await page.keyboard.press("Control+z"); });
        await page.click("#tb-save"); await status();
        const err = await modal(page, "Could not save").count();
        ok(!err, `${kind}: Save works`);
        if (err) await clickModal(page, "Could not save", "OK");
        const before = await savedHtml();
        // Reopen it (via the empty entry; the sensitive note asks for its password).
        await page.selectOption("#file-select", ""); await status();
        await page.selectOption("#file-select", name);
        if (kind === "sensitive") {
            await modal(page, "is a sensitive note").waitFor();
            await modal(page, "is a sensitive note").locator("input").fill(NOTE_PW);
            await clickModal(page, "is a sensitive note", "Unlock");
        }
        await status();
        await step(kind, "after save + reopen", async () => {});
        ok(await savedHtml() === before, `${kind}: reopened note is exactly what was saved`);
        // Reopened: paste once more without clicking, then save again.
        await clipboardImage(4, 4);
        await step(kind, "Ctrl+V image right after reopening", () => page.keyboard.press("Control+v"));
        await page.click("#tb-save"); await status();
        results[kind].html = await savedHtml();
    }

    console.log("3. Same results, step by step");
    for (let i = 0; i < results.normal.length; i++) {
        const n = results.normal[i], s = results.sensitive[i];
        ok(JSON.stringify({ ...n }) === JSON.stringify({ ...s }),
            `${n.label}: normal ${n.img} img / ${n.audio} audio (focus ${n.focus}) = sensitive ${s.img} img / ${s.audio} audio (focus ${s.focus})`);
    }
    ok(results.normal.find((r) => r.label === "Ctrl+V image right after creating").img === 1, "Ctrl+V of a picture works (sanity: it really inserted one)");
    ok(results.normal.at(-1).img === results.normal.find((r) => r.label === "after save + reopen").img + 1, "Ctrl+V after reopening works");
    ok(results.normal.html === results.sensitive.html, "the two notes end with byte-identical content");
    const sStored = C.decryptData(fileByName("note-s").content, FP);
    const nStored = C.decryptData(fileByName("note-n").content, FP);
    ok(sStored.startsWith(PREFIX) && C.decryptData(sStored.slice(PREFIX.length), NOTE_PW) === nStored,
        "Drive: the sensitive note is double encrypted and holds exactly the normal note's content");

    console.log("4. Mobile: the always-visible ✕ (with confirm) works the same");
    const mob = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await login(mob); await unlockInput(mob, "Master123"); await onMain(mob);
    const mobileResult = {};
    for (const [name, pw] of [["note-n", null], ["note-s", NOTE_PW]]) {
        await mob.selectOption("#file-select", name);
        if (pw) { await modal(mob, "is a sensitive note").waitFor(); await modal(mob, "is a sensitive note").locator("input").fill(pw); await clickModal(mob, "is a sensitive note", "Unlock"); }
        await mob.waitForFunction((n) => document.querySelector("#file-select").value === n, name);
        await mob.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
        const before = await mob.locator("#editor .media-embed").count();
        await mob.setInputFiles("#hidden-ins-image", { name: "m.png", mimeType: "image/png", buffer: PNG });
        await mob.waitForFunction((c) => document.querySelectorAll("#editor .media-embed").length > c, before);
        await mob.locator("#editor .media-embed").last().locator(".embed-del").click();
        await clickModal(mob, "Remove this image?", "OK");
        await mob.waitForTimeout(200);
        mobileResult[name] = [before, await mob.locator("#editor .media-embed").count()];
        await mob.selectOption("#file-select", "");
        if (await modal(mob, "save the current note").count()) await clickModal(mob, "save the current note", "No");
    }
    ok(JSON.stringify(mobileResult["note-n"]) === JSON.stringify(mobileResult["note-s"]) && mobileResult["note-s"][0] === mobileResult["note-s"][1],
        `mobile: insert image then ✕ + confirm removes it, the same in both (${JSON.stringify(mobileResult)})`);

    ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await browser.close();
    finish();
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
