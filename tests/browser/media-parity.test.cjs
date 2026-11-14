// A sensitive note can do everything a normal note can: the SAME sequence of
// editing actions is done in a normal rich text note and in a sensitive one, and
// every step must give the same result - Insert Image, Insert Audio, Ctrl+V of an
// image from the real clipboard (small and screenshot-sized), Ctrl+V of text,
// pasting image / audio files, removing an embed with its ✕ button and with
// Delete, Ctrl+Z / Ctrl+Y, the Undo / Redo / Bold / Italic / Underline buttons,
// Save (and "Nothing to save.."), saving and reopening (the sensitive note with
// its password), Search, Rename, Download and Delete; both notes hold
// byte-identical content (the sensitive one still double encrypted in Drive).
// Mobile: the always-visible ✕ (with confirm) and tap-to-open of a picture. The pictures and clips inserted
// and pasted are REAL sample files (tests/lib/media.cjs); clipboard pictures are real PNGs the browser draws.
// Only the designed differences are allowed: the sensitive note asks for its
// password when opened, warns before Download, and is listed with a padlock.
// Usage: node media-parity.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, drive, GIS_STUB, driveRoute, ok, finish, newPage, modal, clickModal, login, onMain, unlockInput, openSearch } = require("./lib/harness.cjs");
const path = require("path");
const { pathToFileURL } = require("url");
const M = require("../lib/media.cjs"); // real sample files (tests/fixtures/media)

const ROOT = path.join(__dirname, "..", "..");
const BASE = process.argv[2];
const JPG = M.MEDIA["photo.jpg"], MP3 = M.MEDIA["voice.mp3"], PNG = M.MEDIA["picture.png"], OGG = M.MEDIA["clip.ogg"], GIF = M.MEDIA["anim.gif"];
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
    const counts = () => page.evaluate(() => {
        const ed = document.getElementById("editor");
        return {
            img: ed.querySelectorAll(".media-embed img").length,
            audio: ed.querySelectorAll(".media-embed audio").length,
            bold: ed.querySelectorAll("b, strong").length,
            italic: ed.querySelectorAll("i, em").length,
            underline: ed.querySelectorAll("u").length,
            text: ed.textContent.replace(/✕/g, ""),
        };
    });
    const fmtButton = (cmd) => page.locator(`.editor-toolbar [data-cmd="${cmd}"]`).dispatchEvent("mousedown");
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
            await page.setInputFiles("#hidden-ins-image", { name: "photo.jpg", mimeType: JPG.mime, buffer: JPG.bytes });
        });
        await step(kind, "Insert Audio button", async () => {
            await page.setInputFiles("#hidden-ins-audio", { name: "voice.mp3", mimeType: MP3.mime, buffer: MP3.bytes });
        });
        const bytes = await clipboardImage(1280, 720);
        await page.click("#editor"); await page.keyboard.press("End");
        await step(kind, `Ctrl+V screenshot (${(bytes / 1048576).toFixed(1)} MB)`, () => page.keyboard.press("Control+v"));
        await step(kind, "paste an image file", () => pasteFile("picture.png", PNG.mime, PNG.b64));
        await step(kind, "paste an audio file", () => pasteFile("clip.ogg", OGG.mime, OGG.b64));
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
        await step(kind, "Ctrl+Y redoes the Delete", () => page.keyboard.press("Control+y"));
        await step(kind, "Undo button", () => fmtButton("undo"));
        await step(kind, "Redo button", () => fmtButton("redo"));
        await step(kind, "Undo button again", () => fmtButton("undo"));
        await page.click("#editor"); await page.keyboard.press("End");
        await step(kind, "Bold button + type", async () => { await fmtButton("bold"); await page.keyboard.type("BOLD"); await fmtButton("bold"); });
        await step(kind, "Italic button + type", async () => { await fmtButton("italic"); await page.keyboard.type("ITAL"); await fmtButton("italic"); });
        await step(kind, "Underline button + type", async () => { await fmtButton("underline"); await page.keyboard.type("UNDER"); await fmtButton("underline"); });
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
        // Reopened: every real sample in it decodes / plays as itself (size, length, SHA-256); the browser-drawn
        // clipboard pictures decode too.
        const l = await M.look(page);
        const shown = l.srcs.map((src, i) => [M.whichDataUrl(src), l.looks[i]]);
        const broken = shown.filter(([f, look]) => (f === "?" ? !/^[1-9]\d*x[1-9]\d*$/.test(look) : `${f} ${look}` !== M.expectedLook(f)));
        ok(broken.length === 0 && shown.some(([f]) => f === "photo.jpg") && shown.some(([f]) => f === "picture.png"),
            `${kind}: reopened, every picture decodes at its size and every clip plays for its length (${M.looksOf(l).replace(/\?/g, "clipboard picture")})` + (broken.length ? ` - broken: ${JSON.stringify(broken)}` : ""));
        // Reopened: paste once more without clicking, then save again.
        await clipboardImage(4, 4);
        await step(kind, "Ctrl+V image right after reopening", () => page.keyboard.press("Control+v"));
        await step(kind, "Ctrl+S saves (focus leaves the editor)", async () => { await page.keyboard.press("Control+s"); await status(); });
        ok(!(await modal(page, "Could not save").count()), `${kind}: Ctrl+S works`);
        await page.click("#tb-save");
        await page.waitForSelector(".status-overlay .status-text:text('Nothing to save..')");
        await status();
        ok(true, `${kind}: Save with no changes flashes 'Nothing to save..'`);
        results[kind].html = await savedHtml();
    }

    console.log("3. Same results, step by step");
    for (let i = 0; i < results.normal.length; i++) {
        const n = results.normal[i], s = results.sensitive[i];
        ok(JSON.stringify({ ...n }) === JSON.stringify({ ...s }),
            `${n.label}: normal ${n.img} img / ${n.audio} audio (focus ${n.focus}) = sensitive ${s.img} img / ${s.audio} audio (focus ${s.focus})`);
    }
    ok(results.normal.find((r) => r.label === "Ctrl+V image right after creating").img === 1, "Ctrl+V of a picture works (sanity: it really inserted one)");
    const fmt = results.sensitive.find((r) => r.label === "Underline button + type");
    ok(fmt.bold >= 1 && fmt.italic >= 1 && fmt.underline >= 1 && /BOLD.*ITAL.*UNDER/.test(fmt.text) && fmt.text.includes("pasted words"),
        `Bold / Italic / Underline really applied and pasted text is there (b ${fmt.bold}, i ${fmt.italic}, u ${fmt.underline})`);
    ok(results.normal.at(-1).img === results.normal.find((r) => r.label === "after save + reopen").img + 1, "Ctrl+V after reopening works");
    ok(results.normal.html === results.sensitive.html, "the two notes end with byte-identical content");
    const sStored = C.decryptData(fileByName("note-s").content, FP);
    const nStored = C.decryptData(fileByName("note-n").content, FP);
    ok(sStored.startsWith(PREFIX) && C.decryptData(sStored.slice(PREFIX.length), NOTE_PW) === nStored,
        "Drive: the sensitive note is double encrypted and holds exactly the normal note's content");

    console.log("4. Search, Rename, Download, Delete");
    const openNote = async (name, pw) => {
        await page.selectOption("#file-select", name);
        if (pw) { await modal(page, "is a sensitive note").waitFor(); await modal(page, "is a sensitive note").locator("input").fill(pw); await clickModal(page, "is a sensitive note", "Unlock"); }
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name); await status();
    };
    const other = {};
    for (const [kind, name, pw] of [["normal", "note-n", null], ["sensitive", "note-s", NOTE_PW]]) {
        // Search finds it (the sensitive one then asks for its password).
        await page.selectOption("#file-select", ""); await status();
        await openSearch(page);
        await page.fill(".search-input", name); await page.press(".search-input", "Enter"); await page.keyboard.press("Enter");
        if (pw) { await modal(page, "is a sensitive note").waitFor(); await modal(page, "is a sensitive note").locator("input").fill(pw); await clickModal(page, "is a sensitive note", "Unlock"); }
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name); await status();
        const found = (await savedHtml()) === results[kind].html;
        // Rename.
        await page.click("#tb-rename");
        await modal(page, "new name").locator("input").fill(name + "-renamed");
        await clickModal(page, "new name", "OK"); await status();
        const renamed = await page.inputValue("#file-select") === name + "-renamed" && !!fileByName(name + "-renamed") && !fileByName(name);
        const label = await page.$eval("#file-select", (s) => s.options[s.selectedIndex].textContent);
        // Download (the sensitive one warns first).
        const [d] = await Promise.all([page.waitForEvent("download"), (async () => {
            await page.click("#tb-download");
            if (pw) await clickModal(page, "will NOT be encrypted", "OK");
        })()]);
        const html = fs.readFileSync(await d.path(), "utf8").split(name + "-renamed").join("NAME");
        other[kind] = { found, renamed, label, file: d.suggestedFilename().replace(name, "NAME"), html };
    }
    ok(other.normal.found && other.sensitive.found, "Search opens both (the sensitive one with its password)");
    ok(other.normal.renamed && other.sensitive.renamed, "Rename works for both");
    ok(other.normal.label === "note-n-renamed" && other.sensitive.label === "note-s-renamed \u{1F512}", "after Rename the sensitive one keeps its padlock");
    ok(fileByName("note-s-renamed").appProperties.Sensitive === "yes" && C.decryptData(fileByName("note-s-renamed").content, FP).startsWith(PREFIX),
        "after Rename the sensitive one is still sensitive (metadata + double encryption)");
    ok(other.normal.file === other.sensitive.file && other.normal.html === other.sensitive.html,
        `Download gives the same ${other.normal.file} for both (only the note name differs)`);
    for (const [name, pw] of [["note-n-renamed", null], ["note-s-renamed", NOTE_PW]]) {
        await openNote(name, pw);
        await page.click("#tb-delete"); await clickModal(page, "cannot be undone", "OK"); await status();
    }
    ok(!fileByName("note-n-renamed") && !fileByName("note-s-renamed") && await page.inputValue("#file-select") === "", "Delete works for both");

    console.log("5. Mobile: the always-visible ✕ (with confirm) and tap-to-open work the same");
    // Two fresh notes with one (tappable, 200x150) real picture each, for the mobile checks.
    const bigPng = PNG.bytes;
    for (const [name, sensitive] of [["mob-n", false], ["mob-s", true]]) {
        await page.click(sensitive ? "#tb-new-sensitive" : "#tb-new");
        await modal(page, sensitive ? "new sensitive note" : "Enter a name for the new note").locator("input").fill(name);
        await clickModal(page, sensitive ? "new sensitive note" : "Enter a name for the new note", "OK");
        if (sensitive) {
            const m = modal(page, "Choose an extra password");
            await m.waitFor(); await m.locator("input").nth(0).fill(NOTE_PW); await m.locator("input").nth(1).fill(NOTE_PW);
            await clickModal(page, "Choose an extra password", "Create");
        }
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name); await status();
        await page.setInputFiles("#hidden-ins-image", { name: "big.png", mimeType: "image/png", buffer: bigPng });
        await page.waitForSelector("#editor .media-embed img");
        await page.click("#tb-save"); await status();
    }
    const mob = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await login(mob); await unlockInput(mob, "Master123"); await onMain(mob);
    const mobileResult = {};
    for (const [name, pw] of [["mob-n", null], ["mob-s", NOTE_PW]]) {
        await mob.selectOption("#file-select", name);
        if (pw) { await modal(mob, "is a sensitive note").waitFor(); await modal(mob, "is a sensitive note").locator("input").fill(pw); await clickModal(mob, "is a sensitive note", "Unlock"); }
        await mob.waitForFunction((n) => document.querySelector("#file-select").value === n, name);
        await mob.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
        // Tapping the (only, 200x150) picture opens it in a new window.
        const [popup] = await Promise.all([mob.waitForEvent("popup", { timeout: 10000 }).catch(() => null), mob.locator("#editor .media-embed img").first().click({ position: { x: 10, y: 40 } })]);
        const opened = !!popup && await popup.evaluate(() => !!document.querySelector("img") && document.querySelector("img").src.startsWith("data:image/png"));
        if (popup) await popup.close();
        // Insert a picture, then remove it with its always-visible ✕ (confirm).
        const before = await mob.locator("#editor .media-embed").count();
        await mob.setInputFiles("#hidden-ins-image", { name: "anim.gif", mimeType: GIF.mime, buffer: GIF.bytes });
        await mob.waitForFunction((c) => document.querySelectorAll("#editor .media-embed").length > c, before);
        const tiny = mob.locator("#editor .media-embed").filter({ has: mob.locator(`img[src="${GIF.dataUrl}"]`) });
        await tiny.locator(".embed-del").click();
        await clickModal(mob, "Remove this image?", "OK");
        await mob.waitForTimeout(200);
        const after = await mob.locator("#editor .media-embed").count();
        const bigLeft = await mob.locator("#editor .media-embed img").first().evaluate((i) => i.naturalWidth === 200);
        mobileResult[name] = [before, after, opened, bigLeft];
        await mob.selectOption("#file-select", "");
        if (await modal(mob, "save the current note").count()) await clickModal(mob, "save the current note", "No");
    }
    ok(JSON.stringify(mobileResult["mob-n"]) === JSON.stringify(mobileResult["mob-s"]) && mobileResult["mob-s"][0] === mobileResult["mob-s"][1] && mobileResult["mob-s"][2] === true && mobileResult["mob-s"][3] === true,
        `mobile: insert + ✕ with confirm removes a picture, tapping a picture opens it in a new window - the same in both (${JSON.stringify(mobileResult)})`);

    ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await browser.close();
    finish();
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
