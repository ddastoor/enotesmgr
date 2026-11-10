// Sensitive notes (an extra per-note password chosen when the note is created, see
// instructions/sensitive-notes.md): creating them with the padlock New / Upload
// buttons, what Drive stores (two layers from the very first write: note password
// inside, file password outside; "Sensitive" metadata), unlocking on open, saving,
// refresh, download, the password being forgotten when the page is left, failure
// handling, that ordinary / existing notes are never touched, the export CLI
// writing "<name>.sensitive" files, and the PC-only "Decrypt Sensitive File" tool
// decrypting them locally without any Drive call.
// Usage: node sensitive-notes.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, drive, driveLog, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout,
} = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FAKEFETCH = path.join(ROOT, "tests", "cli", "fakefetch.cjs");
const PRE_FEATURE_COMMIT = "0c53ab1"; // last commit before sensitive notes
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-sensitive-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PREFIX = "<<eNotesMgr-sensitive-note-v1>>";
const LOCK = " \u{1F512}";
const NOTE_PW = "NotePass1";
const PIC_PW = "Picture#22";

function dumpDrive() {
    const file = path.join(WORK, "drive.json");
    fs.writeFileSync(file, JSON.stringify([...drive.values()]));
    return file;
}
// Run a CLI in a fresh folder; returns { code, out, dir, files: {name: Buffer} }.
function cli(cliPath, args, input, driveFile) {
    const cwd = fs.mkdtempSync(path.join(WORK, "run-"));
    const preload = driveFile ? ["-r", FAKEFETCH] : [];
    const r = spawnSync(process.execPath, [...preload, cliPath, ...args], {
        cwd, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveFile || "" },
    });
    const files = {};
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else files[path.relative(cwd, p).replace(/^[^/\\]+[/\\]/, "")] = fs.readFileSync(p);
    });
    walk(cwd);
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), dir: cwd, files };
}

(async () => {
    // The app's own crypto module, in Node, to look inside what the app stores.
    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;
    const tryDec = (cipher, pw) => { try { return C.decryptData(cipher, pw); } catch { return null; } };
    const fileByName = (name) => [...drive.values()].find((f) => f.name === name);
    let FP = null; // the file password, from config.json
    const outer = (name) => C.decryptData(fileByName(name).content, FP);
    const inner = (name, pw) => tryDec(outer(name).slice(PREFIX.length), pw);
    // Exact Drive state (id, name, content, metadata) of some files.
    const snapshot = (names) => JSON.stringify(names.map((n) => { const f = fileByName(n); return [f.id, f.name, f.content, f.appProperties]; }));

    const browser = await chromium.launch();
    const page = await newPage(browser);
    const status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    const sel = () => page.inputValue("#file-select");
    const editorText = () => page.textContent("#editor");
    const optionText = (name) => page.$eval(`#file-select option[value="${name}"]`, (o) => o.textContent);
    const unlockModal = () => modal(page, "is a sensitive note");
    const fillPw = async (m, a, b) => {
        const inputs = m.locator("input[type=password]");
        await inputs.nth(0).fill(a);
        if (b !== undefined) await inputs.nth(1).fill(b);
    };
    // Open a note from the dropdown; if it is sensitive, unlock it with `pw`.
    const open = async (name, pw) => {
        await page.selectOption("#file-select", name);
        if (pw) {
            await unlockModal().waitFor();
            await fillPw(unlockModal(), pw);
            await clickModal(page, "is a sensitive note", "Unlock");
        }
        await status();
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name);
    };
    const newNote = async (name, text) => {
        await page.click("#tb-new");
        await modal(page, "Enter a name for the new note").locator("input").fill(name);
        await clickModal(page, "Enter a name for the new note", "OK");
        await page.click("#editor"); await page.keyboard.type(text);
        await page.click("#tb-save"); await status();
    };
    const pwModal = () => modal(page, "Choose an extra password");
    // expectCreated: wait until the new note (name without extension) is selected.
    const newSensitive = async (name, pw, expectCreated = true) => {
        await page.click("#tb-new-sensitive");
        await modal(page, "new sensitive note").locator("input").fill(name);
        await clickModal(page, "new sensitive note", "OK");
        await pwModal().waitFor();
        await fillPw(pwModal(), pw, pw);
        await clickModal(page, "Choose an extra password", "Create");
        if (expectCreated) await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name.replace(/\.[^.]+$/, ""));
        await status();
    };
    const uploadSensitive = async (name, mimeType, buffer, pw) => {
        const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#tb-upload-sensitive")]);
        await fc.setFiles({ name, mimeType, buffer });
        if (pw === null) return;
        await pwModal().waitFor();
        await fillPw(pwModal(), pw, pw);
        await clickModal(page, "Choose an extra password", "Create");
        // (The file is read before "Uploading..." shows: wait for the new note.)
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name);
        await status();
    };

    console.log("1. Setup; ordinary notes made with the ordinary New / Upload");
    await login(page);
    await page.fill("#su-pwd", "Master123"); await page.fill("#su-pwd2", "Master123");
    await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    FP = JSON.parse(C.decryptData(fileByName("config.json").content, "Master123")).file_password;
    await newNote("plain", "nothing secret here");
    await page.setInputFiles("#hidden-upload", { name: "doc.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.waitForFunction(() => document.querySelector("#file-select").value === "doc.pdf"); await status();
    ok(["plain", "doc.pdf"].every((n) => !("Sensitive" in fileByName(n).appProperties) && !outer(n).startsWith(PREFIX)),
        "ordinary New / Upload: normal notes, no 'Sensitive' metadata, no envelope");
    ok(await optionText("plain") === "plain" && await optionText("doc.pdf") === "doc.pdf", "ordinary notes are listed by name only");
    ok(await page.locator("#tb-sensitive").count() === 0, "there is no toggle: an existing note can't be made sensitive");
    const ordinary = ["plain", "doc.pdf"];
    const ordinaryBefore = snapshot(ordinary);
    // The marker typed as ordinary text can never make a note look sensitive.
    await newNote("tricky", PREFIX + "QUJD");
    await open("plain"); await open("tricky");
    await page.waitForTimeout(300);
    ok(await unlockModal().count() === 0 && (await editorText()).includes(PREFIX + "QUJD"),
        "a normal note whose text is the sensitive marker opens as a normal note");
    await page.click("#tb-delete"); await clickModal(page, "cannot be undone", "OK"); await status();

    console.log("2. Padlock New: a sensitive rich text note");
    await open("plain");
    await page.click("#tb-new-sensitive");
    await modal(page, "new sensitive note").locator("input").fill("plain");
    await clickModal(page, "new sensitive note", "OK");
    await clickModal(page, "Filename already exists", "OK");
    ok(true, "an existing name is refused ('Filename already exists')");
    await page.click("#tb-new-sensitive");
    await modal(page, "new sensitive note").locator("input").fill("bank.txt");
    await clickModal(page, "new sensitive note", "OK");
    await pwModal().waitFor();
    const warn = await pwModal().textContent();
    ok(warn.includes("can NOT be recovered") && warn.includes("can't be switched off later"), "the password dialog warns: unrecoverable if forgotten, can't be switched off");
    await fillPw(pwModal(), "short1", "short1");
    await clickModal(page, "Choose an extra password", "Create");
    ok((await pwModal().locator(".inline-error").textContent()).includes("at least 8"), "a password under 8 characters is refused");
    await fillPw(pwModal(), NOTE_PW, "Different1");
    await clickModal(page, "Choose an extra password", "Create");
    ok((await pwModal().locator(".inline-error").textContent()).includes("don't match"), "the two entries must match");
    await clickModal(page, "Choose an extra password", "Cancel");
    await status();
    ok(!fileByName("bank") && !fileByName("bank.txt") && await sel() === "plain", "Cancel creates nothing (still on 'plain')");
    await newSensitive("bank.txt", NOTE_PW);
    let f = fileByName("bank");
    ok(f && await sel() === "bank", "created as 'bank' (extension stripped, like New) and selected");
    ok(outer("bank").startsWith(PREFIX) && inner("bank", NOTE_PW) === "", "Drive: stored locked with the note password from the very first write");
    ok(f.appProperties.Sensitive === "yes" && f.appProperties.CreationMethod === "new" && f.appProperties.FileType === "richtext"
        && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(f.appProperties.DateTimeCreated), "metadata: the usual keys + Sensitive=yes");
    ok(await optionText("bank") === "bank" + LOCK, "listed as 'bank 🔒'");
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "editor"), "caret is in the editor, like New");
    await page.keyboard.type("PIN 4242 secret");
    await page.keyboard.press("Control+s"); await status();
    let stored = outer("bank");
    ok(stored.startsWith(PREFIX) && !stored.includes("PIN 4242") && (inner("bank", NOTE_PW) || "").includes("PIN 4242 secret"),
        "Ctrl+S: saved locked with the note password; no plaintext under the file password");
    ok(tryDec(stored.slice(PREFIX.length), FP) === null && tryDec(stored.slice(PREFIX.length), "Master123") === null,
        "neither the file password nor the master password opens the inner layer");
    ok(fileByName("bank").appProperties.Sensitive === "yes", "Sensitive=yes kept on save");

    console.log("3. Selecting a sensitive note (dropdown / search) asks for its password every time");
    const selectedLabel = () => page.$eval("#file-select", (s) => s.options[s.selectedIndex].textContent);
    const searchPick = async (q) => {
        await page.click("#tb-search");
        await page.fill(".search-input", q); await page.press(".search-input", "Enter"); await page.keyboard.press("Enter");
    };
    // `how`: "cancel" | a wrong password; the note must then NOT be shown.
    // checkHidden: the note being opened isn't already on screen.
    const abortOpen = async (how, checkHidden = true) => {
        await unlockModal().waitFor();
        if (checkHidden) ok(!(await editorText()).includes("PIN 4242"), "  nothing of the sensitive note is shown while its password is asked");
        if (how === "cancel") await clickModal(page, "is a sensitive note", "Cancel");
        else {
            await fillPw(unlockModal(), how); await clickModal(page, "is a sensitive note", "Unlock");
            await page.waitForSelector(".status-overlay .status-text:text('Wrong password')");
        }
        await status();
        await page.waitForTimeout(200);
        ok(await unlockModal().count() === 0, "  no second password prompt");
    };
    await open("plain");
    await page.selectOption("#file-select", "bank"); await abortOpen("cancel");
    ok(await sel() === "plain" && (await editorText()).includes("nothing secret"), "dropdown + Cancel: aborted, stays on the current note");
    await page.selectOption("#file-select", "bank"); await abortOpen("WrongPass9");
    ok(await sel() === "plain" && (await editorText()).includes("nothing secret"), "dropdown + wrong password: aborted ('Wrong password' flash), stays on the current note");
    await searchPick("ban"); await abortOpen("cancel");
    ok(await sel() === "plain" && (await editorText()).includes("nothing secret"), "search + Cancel: aborted, stays on the current note");
    await searchPick("ban"); await abortOpen("WrongPass9");
    ok(await sel() === "plain" && (await editorText()).includes("nothing secret"), "search + wrong password: aborted, stays on the current note");
    await open("bank", NOTE_PW);
    ok(await sel() === "bank" && (await editorText()).includes("PIN 4242 secret"), "right password: the note opens");
    ok(await selectedLabel() === "bank" + LOCK, "while it is open the selector shows 'bank 🔒'");
    await searchPick("ban"); await abortOpen("cancel", false);
    ok(await sel() === "bank" && (await editorText()).includes("PIN 4242 secret") && await selectedLabel() === "bank" + LOCK,
        "picking the open sensitive note again via Search asks again; Cancel keeps it as it was");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" DRAFT");
    await searchPick("ban");
    await clickModal(page, "save the current note", "No"); // the usual unsaved-changes prompt comes first
    await abortOpen("WrongPass9", false);
    ok(await sel() === "bank" && (await editorText()).includes("PIN 4242 secret DRAFT"), "... and a wrong password there keeps the unsaved edits on screen");
    await page.click("#tb-refresh"); await status(); // drop the draft (Refresh reloads the saved note)
    ok(await unlockModal().count() === 0 && !(await editorText()).includes("DRAFT"), "Refresh of the open note doesn't ask again");
    await open("plain");
    await searchPick("ban");
    await unlockModal().waitFor(); await fillPw(unlockModal(), NOTE_PW); await clickModal(page, "is a sensitive note", "Unlock"); await status();
    ok(await sel() === "bank" && (await editorText()).includes("PIN 4242 secret"), "search + right password: the note opens");

    console.log("4. Save / refresh / unsaved-changes prompt keep both layers");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" EDIT1");
    await page.click("#tb-save"); await status();
    ok((inner("bank", NOTE_PW) || "").includes("EDIT1") && !outer("bank").includes("EDIT1"), "Save keeps it locked with the note password");
    await page.click("#tb-save");
    await page.waitForSelector(".status-overlay .status-text:text('Nothing to save..')");
    await status();
    ok(true, "unchanged content: 'Nothing to save..' (no write)");
    await page.click("#tb-refresh"); await status();
    ok(await unlockModal().count() === 0 && (await editorText()).includes("EDIT1"), "Refresh reloads without asking again");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" EDIT2");
    await page.selectOption("#file-select", "plain");
    await clickModal(page, "save the current note", "Yes"); await status();
    ok(await sel() === "plain" && (inner("bank", NOTE_PW) || "").includes("EDIT2") && !outer("bank").includes("EDIT2"), "switching notes: Yes saves it, still locked");

    console.log("5. Download of an open sensitive note");
    await open("bank", NOTE_PW);
    await page.click("#tb-download");
    await clickModal(page, "will NOT be encrypted", "Cancel");
    ok(true, "a warning comes first; Cancel downloads nothing");
    const [dlBank] = await Promise.all([page.waitForEvent("download"), (async () => {
        await page.click("#tb-download"); await clickModal(page, "will NOT be encrypted", "OK");
    })()]);
    const bankHtml = fs.readFileSync(await dlBank.path());
    ok(dlBank.suggestedFilename() === "bank.html" && bankHtml.toString().includes("PIN 4242 secret EDIT1 EDIT2"), "OK downloads the readable bank.html");

    console.log("6. The note password is forgotten when the main page is left");
    await page.click("#btn-settings"); await page.click("#set-cancel");
    await page.waitForSelector("#file-select"); await status();
    await page.selectOption("#file-select", "bank"); await abortOpen("cancel");
    ok(await sel() === "" && (await editorText()) === "", "back from Settings (no note shown): an aborted open leaves no note selected");
    // Whatever Save does in this state, a sensitive note is never rewritten
    // without its note password (its password was dropped on leaving the page).
    const bankStored = fileByName("bank").content;
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(600);
    if (await modal(page, "Could not save this note").count()) await clickModal(page, "Could not save this note", "OK");
    await status();
    ok(fileByName("bank").content === bankStored, "back from Settings: Save can't overwrite the sensitive note");
    await page.selectOption("#file-select", "bank");
    await unlockModal().waitFor();
    ok(true, "back from Settings: opening it asks for the password again");
    await fillPw(unlockModal(), NOTE_PW); await clickModal(page, "is a sensitive note", "Unlock"); await status();
    await logout(page);
    await login(page); await unlockInput(page, "Master123"); await onMain(page);
    ok(await optionText("bank") === "bank" + LOCK, "after logout + login it is still listed as sensitive (remembered in Drive)");
    await page.selectOption("#file-select", "bank");
    await unlockModal().waitFor();
    ok(true, "after logout + login: asked again");
    await fillPw(unlockModal(), NOTE_PW); await clickModal(page, "is a sensitive note", "Unlock"); await status();
    ok((await editorText()).includes("EDIT2"), "and it opens");

    console.log("7. Padlock Upload: a file as a sensitive note");
    await uploadSensitive("plain", "image/png", PNG, null);
    await clickModal(page, "Filename already exists", "OK");
    ok(true, "an existing name is refused ('Filename already exists')");
    await uploadSensitive("pic.png", "image/png", PNG, PIC_PW);
    f = fileByName("pic.png");
    ok(f && f.appProperties.Sensitive === "yes" && f.appProperties.CreationMethod === "upload" && f.appProperties.FileType === "image",
        "metadata: CreationMethod=upload, FileType=image (by magic number), Sensitive=yes");
    ok(outer("pic.png").startsWith(PREFIX) && (inner("pic.png", PIC_PW) || "").startsWith("data:image/png;base64,"), "Drive: the image is locked with its note password from the first write");
    ok(await page.locator("#media-viewer img").count() === 1 && await optionText("pic.png") === "pic.png" + LOCK, "shown in the image viewer, listed as 'pic.png 🔒'");
    await open("plain");
    await open("pic.png", PIC_PW);
    ok(await page.locator("#media-viewer img").count() === 1, "reopened with its password: the image shows");
    const [dlPic] = await Promise.all([page.waitForEvent("download"), (async () => {
        await page.click("#tb-download"); await clickModal(page, "will NOT be encrypted", "OK");
    })()]);
    ok(dlPic.suggestedFilename() === "pic.png" && Buffer.compare(fs.readFileSync(await dlPic.path()), PNG) === 0, "its download is the original image");

    console.log("8. Failures never leave a sensitive note half-protected");
    global.failUploads = true; // creating any file fails
    await newSensitive("diary", "DiaryPass1", false);
    await clickModal(page, "Could not create the note", "OK");
    global.failUploads = false;
    ok(!fileByName("diary"), "Drive create fails: nothing is created");
    await newSensitive("diary", "DiaryPass1");
    await page.keyboard.type("dear diary"); await page.click("#tb-save"); await status();
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" more");
    global.failConfigWrite = true; // every content update fails
    await page.keyboard.press("Control+s");
    await clickModal(page, "Could not save this note", "OK");
    global.failConfigWrite = false;
    ok((inner("diary", "DiaryPass1") || "") === "dear diary", "a failed save of a sensitive note leaves the stored note as it was");

    console.log("9. Export CLI: sensitive notes come out still locked, as <name>.sensitive");
    await page.selectOption("#file-select", "plain");
    await clickModal(page, "save the current note", "No"); // drop the unsaved " more"
    await status();
    const [dlPlain] = await Promise.all([page.waitForEvent("download"), page.click("#tb-download")]);
    const plainHtml = fs.readFileSync(await dlPlain.path());
    await logout(page);
    const driveFile = dumpDrive();
    let r = cli(CLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", driveFile);
    ok(r.code === 0 && Object.keys(r.files).sort().join() === "bank.sensitive,diary.sensitive,doc.pdf,pic.png.sensitive,plain.html",
        "online export: plain.html, doc.pdf + bank.sensitive, pic.png.sensitive, diary.sensitive: " + Object.keys(r.files).sort().join());
    ok(Buffer.compare(r.files["plain.html"], plainHtml) === 0 && Buffer.compare(r.files["doc.pdf"], PDF) === 0,
        "the ordinary notes are exported exactly as before (= the app's Download / the original bytes)");
    const bankSensitive = r.files["bank.sensitive"], picSensitive = r.files["pic.png.sensitive"];
    ok(bankSensitive.toString().startsWith(PREFIX) && !bankSensitive.toString().includes("PIN 4242"), "bank.sensitive holds only the note-password envelope");
    ok(r.out.includes("3 sensitive note(s)") && r.out.includes("Decrypt Sensitive File"), "the CLI says how to open them");
    const mirror = cli(CLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", driveFile);
    const mroot = fs.readdirSync(mirror.dir).find((d) => d.startsWith("eNotes Manager_"));
    const off = cli(CLI, ["-m", "off", "-c", path.join(mirror.dir, mroot, "Config", "config.json"), "-d", path.join(mirror.dir, mroot, "Entries")], "Master123\n");
    ok(off.code === 0 && Buffer.compare(off.files["bank.sensitive"], bankSensitive) === 0 && Buffer.compare(off.files["plain.html"], plainHtml) === 0,
        "offline export (from the -x mirror, no Drive metadata) gives the same files");
    const mirrorBank = fs.readFileSync(path.join(mirror.dir, mroot, "Entries", "bank"), "utf8");
    // An export CLI from before this feature (already downloaded by the user).
    const oldCliPath = path.join(WORK, "old-cli.js");
    const g = spawnSync("git", ["-C", ROOT, "show", `${PRE_FEATURE_COMMIT}:www/enotesmgr-export-cli.js`], { maxBuffer: 64 * 1024 * 1024 });
    ok(g.status === 0, "read the pre-feature export CLI from git (" + PRE_FEATURE_COMMIT + ")");
    fs.writeFileSync(oldCliPath, g.stdout);
    const old = cli(oldCliPath, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", driveFile);
    ok(old.code === 0 && old.files["bank.html"] && old.files["bank.html"].toString().includes(PREFIX) && !old.files["bank.html"].toString().includes("PIN 4242"),
        "an older CLI exports it as bank.html wrapping the (still locked) envelope");

    console.log("10. 'Decrypt Sensitive File' (PC menu): local decrypt, no Drive");
    await login(page); await unlockInput(page, "Master123"); await onMain(page);
    await open("plain");
    const tool = async (name, buffer, pw, { wrongFirst = false, expectNotSensitive = false } = {}) => {
        await page.click("#btn-more");
        const item = page.locator('[data-action="decrypt-sensitive"]');
        await item.waitFor();
        const label = (await item.textContent()).trim();
        const [fc] = await Promise.all([page.waitForEvent("filechooser"), item.click()]);
        await fc.setFiles({ name, mimeType: "application/octet-stream", buffer });
        if (expectNotSensitive) { await clickModal(page, "is not a sensitive note", "OK"); return { label }; }
        const m = modal(page, "Enter the password of the sensitive note");
        await m.waitFor();
        if (wrongFirst) {
            await fillPw(m, "WrongPass9"); await clickModal(page, "Enter the password of the sensitive note", "Decrypt"); await status();
            await m.waitFor();
            ok((await m.locator(".inline-error").textContent()).includes("Wrong password"), `  ${name}: wrong password asks again`);
        }
        await fillPw(m, pw);
        const [d] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Enter the password of the sensitive note", "Decrypt")]);
        return { label, name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
    };
    const callsBefore = driveLog.length;
    let got = await tool("bank.sensitive", bankSensitive, NOTE_PW, { wrongFirst: true });
    ok(got.label === "Decrypt Sensitive File", "the menu item is labelled 'Decrypt Sensitive File'");
    ok(got.name === "bank.html" && Buffer.compare(got.bytes, bankHtml) === 0, "bank.sensitive -> bank.html, byte-for-byte the app's own Download of the note");
    got = await tool("pic.png.sensitive", picSensitive, PIC_PW);
    ok(got.name === "pic.png" && Buffer.compare(got.bytes, PNG) === 0, "pic.png.sensitive -> pic.png, the original image");
    got = await tool("bank.html", old.files["bank.html"], NOTE_PW);
    ok(got.name === "bank.html" && Buffer.compare(got.bytes, bankHtml) === 0, "an older CLI's bank.html export also decrypts to the same bank.html");
    await tool("plain.html", plainHtml, null, { expectNotSensitive: true });
    ok(true, "a file that isn't a sensitive note is refused with a message");
    await tool("bank", Buffer.from(mirrorBank), null, { expectNotSensitive: true });
    ok(true, "a still-encrypted -x mirror file is refused with a message (needs the master password too)");
    ok(driveLog.length === callsBefore, "the tool made no Google Drive calls at all");
    ok(await sel() === "plain" && (await editorText()).includes("nothing secret"), "the open note is unaffected by the tool");

    console.log("11. The padlock always shows while a sensitive note is open; tampering is refused");
    await open("plain");
    // A sensitive note whose 'Sensitive' metadata is missing (e.g. made by an
    // earlier test build): still asks for its password, shows the padlock while
    // open, and gets its metadata back on its next save.
    delete fileByName("diary").appProperties.Sensitive;
    await logout(page); await login(page); await unlockInput(page, "Master123"); await onMain(page);
    ok(await optionText("diary") === "diary", "metadata mark missing: listed without the padlock before it is opened");
    await open("diary", "DiaryPass1");
    ok(await selectedLabel() === "diary" + LOCK && (await editorText()).includes("dear diary"), "opened with its password: shown as 'diary 🔒'");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type("!"); await page.click("#tb-save"); await status();
    ok(fileByName("diary").appProperties.Sensitive === "yes" && (inner("diary", "DiaryPass1") || "").includes("dear diary!"), "its next save stores Sensitive=yes again (still locked)");
    // A note created sensitive whose content was replaced by an unlocked one
    // (outside the app) is never shown or saved as a normal note.
    await open("plain");
    const realBank = fileByName("bank").content;
    fileByName("bank").content = C.encryptData("<div>fake</div>", FP);
    await page.selectOption("#file-select", "bank");
    await clickModal(page, "no longer locked", "OK"); await status();
    ok(await sel() === "plain" && (await editorText()).includes("nothing secret"), "created sensitive but no longer locked: refused, stays on the current note");
    fileByName("bank").content = realBank;

    console.log("12. Mobile: padlock buttons work, the PC-only tool is not offered");
    const mob = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await login(mob); await unlockInput(mob, "Master123"); await onMain(mob);
    ok(await mob.isVisible("#tb-new-sensitive") && await mob.isVisible("#tb-upload-sensitive"), "mobile: padlock New / Upload buttons shown");
    await mob.selectOption("#file-select", "diary");
    await modal(mob, "is a sensitive note").waitFor();
    await modal(mob, "is a sensitive note").locator("input[type=password]").fill("DiaryPass1");
    await clickModal(mob, "is a sensitive note", "Unlock");
    await mob.waitForFunction(() => document.querySelector("#editor").textContent.includes("dear diary"));
    ok(true, "mobile: a sensitive note unlocks");
    await mob.click("#btn-more");
    await mob.waitForSelector(".drawer");
    ok(await mob.locator('[data-action="decrypt-sensitive"]').count() === 0, "mobile: no 'Decrypt Sensitive File' in the menu");

    console.log("13. Existing / ordinary notes were never touched");
    ok(snapshot(ordinary) === ordinaryBefore, "plain and doc.pdf: Drive id, name, content and metadata byte-for-byte unchanged after everything above");

    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2);
});
