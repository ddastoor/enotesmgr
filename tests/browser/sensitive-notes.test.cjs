// Sensitive notes (an extra per-note password, see instructions/sensitive-notes.md):
// making notes sensitive / normal again, the two encryption layers in Drive (note
// password inside, file password outside), unlocking on open, saving, refresh,
// download, the password being forgotten when the page is left, Drive's older
// versions being removed, failure handling, the export CLI writing "<name>.sensitive"
// files, and the PC-only "Upload Sensitive Note" tool decrypting them locally
// without any Drive call.
// Usage: node sensitive-notes.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, drive, driveLog, revisionsOf, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, readDownload,
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
const PREFIX = "<<eNotesMgr-sensitive-note-v1>>";
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

    const browser = await chromium.launch();
    const page = await newPage(browser);
    const status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    const sel = () => page.inputValue("#file-select");
    const pressed = () => page.getAttribute("#tb-sensitive", "aria-pressed");
    const editorText = () => page.textContent("#editor");
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
    const makeSensitive = async (pw) => {
        await page.click("#tb-sensitive");
        const m = modal(page, "Choose an extra password");
        await m.waitFor();
        await fillPw(m, pw, pw);
        await clickModal(page, "Choose an extra password", "Make sensitive");
        await status();
    };
    const newNote = async (name, text) => {
        await page.click("#tb-new");
        await modal(page, "Enter a name").locator("input").fill(name);
        await clickModal(page, "Enter a name", "OK");
        await page.click("#editor"); await page.keyboard.type(text);
        await page.click("#tb-save"); await status();
    };

    console.log("1. Setup, two ordinary notes");
    await login(page);
    await page.fill("#su-pwd", "Master123"); await page.fill("#su-pwd2", "Master123");
    await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    FP = JSON.parse(C.decryptData(fileByName("config.json").content, "Master123")).file_password;
    ok(await page.isDisabled("#tb-sensitive"), "Sensitive button is disabled while no note is selected");
    await newNote("plain", "nothing secret here");
    await newNote("bank", "PIN 4242 secret");
    ok(!(await page.isDisabled("#tb-sensitive")) && await pressed() === "false", "a normal note: Sensitive button enabled, not pressed");
    // The marker typed as ordinary text can never make a note look sensitive.
    await newNote("tricky", PREFIX + "QUJD");
    await open("plain"); await open("tricky");
    await page.waitForTimeout(300);
    ok(await unlockModal().count() === 0 && (await editorText()).includes(PREFIX + "QUJD") && await pressed() === "false",
        "a normal note whose text is the sensitive marker opens as a normal note");
    await page.click("#tb-delete"); await clickModal(page, "cannot be undone", "OK"); await status();
    await open("bank");
    const plainBefore = fileByName("plain").content;

    console.log("2. Make 'bank' sensitive (new password rules, unsaved edits included)");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" UNSAVED");
    await page.click("#tb-sensitive");
    const mk = modal(page, "Choose an extra password");
    await mk.waitFor();
    ok((await mk.textContent()).includes("can NOT be recovered"), "the dialog warns that a forgotten note password can't be recovered");
    await fillPw(mk, "short1", "short1");
    await clickModal(page, "Choose an extra password", "Make sensitive");
    ok((await mk.locator(".inline-error").textContent()).includes("at least 8"), "a password under 8 characters is refused");
    await fillPw(mk, NOTE_PW, "Different1");
    await clickModal(page, "Choose an extra password", "Make sensitive");
    ok((await mk.locator(".inline-error").textContent()).includes("don't match"), "the two entries must match");
    await clickModal(page, "Choose an extra password", "Cancel");
    ok(await pressed() === "false" && !outer("bank").startsWith(PREFIX), "Cancel changes nothing");
    await makeSensitive(NOTE_PW);
    let stored = outer("bank");
    ok(stored.startsWith(PREFIX) && !stored.includes("PIN 4242"), "Drive: under the file password there is only the note-password envelope (no plaintext)");
    ok((inner("bank", NOTE_PW) || "").includes("PIN 4242 secret UNSAVED"), "Drive: the note password opens it; unsaved edits were saved with it");
    ok(tryDec(stored.slice(PREFIX.length), FP) === null && tryDec(stored.slice(PREFIX.length), "Master123") === null,
        "neither the file password nor the master password opens the inner layer");
    ok(await pressed() === "true" && await page.getAttribute("#tb-sensitive", "class").then((c) => c.includes("is-on")), "Sensitive button shows 'on'");
    const revs = revisionsOf(fileByName("bank").id);
    ok(revs.length === 1 && revs[0].content === fileByName("bank").content, `Drive's older (unprotected) versions were deleted: ${revs.length} version left, the protected one`);
    ok(fileByName("plain").content === plainBefore, "the other note is untouched");
    ok(fileByName("bank").appProperties.FileType === "richtext" && fileByName("bank").appProperties.CreationMethod === "new", "metadata unchanged (still a richtext 'new' note)");

    console.log("3. Opening a sensitive note asks for its password");
    await open("plain");
    await page.selectOption("#file-select", "bank");
    await unlockModal().waitFor();
    await clickModal(page, "is a sensitive note", "Cancel");
    await status();
    ok(await sel() === "plain" && (await editorText()).includes("nothing secret"), "Cancel: stays on the previous note");
    await page.selectOption("#file-select", "bank");
    await unlockModal().waitFor();
    await fillPw(unlockModal(), "WrongPass9");
    await clickModal(page, "is a sensitive note", "Unlock");
    await status();
    await unlockModal().waitFor();
    ok((await unlockModal().locator(".inline-error").textContent()).includes("Wrong password"), "wrong password: asked again with an error");
    await fillPw(unlockModal(), NOTE_PW);
    await clickModal(page, "is a sensitive note", "Unlock");
    await status();
    ok(await sel() === "bank" && (await editorText()).includes("PIN 4242 secret UNSAVED") && await pressed() === "true", "right password: the note opens");
    await page.click("#tb-search");
    await page.fill(".search-input", "ban"); await page.press(".search-input", "Enter"); await page.keyboard.press("Enter");
    await status(); await page.waitForTimeout(300);
    ok(await unlockModal().count() === 0 && await sel() === "bank" && (await editorText()).includes("UNSAVED"),
        "picking the open note again via Search reloads it without asking again");

    console.log("4. Save / refresh / unsaved-changes prompt keep both layers");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" EDIT1");
    await page.keyboard.press("Control+s"); await status();
    ok((inner("bank", NOTE_PW) || "").includes("EDIT1") && !outer("bank").includes("EDIT1"), "Ctrl+S saves it locked with the note password");
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
    ok(dlBank.suggestedFilename() === "bank.html" && bankHtml.toString().includes("PIN 4242 secret UNSAVED EDIT1 EDIT2"), "OK downloads the readable bank.html");

    console.log("6. The note password is forgotten when the main page is left");
    await page.click("#btn-settings"); await page.click("#set-cancel");
    await page.waitForSelector("#file-select"); await status();
    ok(await page.isDisabled("#tb-sensitive"), "back from Settings (no note shown): Sensitive button disabled");
    // Whatever Save does in this state, a sensitive note is never rewritten
    // without its note password (its password was dropped on leaving the page).
    const bankStored = fileByName("bank").content;
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(600);
    const saveErr = modal(page, "Could not save this note");
    if (await saveErr.count()) await clickModal(page, "Could not save this note", "OK");
    await status();
    ok(fileByName("bank").content === bankStored, "back from Settings: Save can't overwrite the sensitive note");
    await page.selectOption("#file-select", "bank");
    await unlockModal().waitFor();
    ok(true, "back from Settings: opening it asks for the password again");
    await fillPw(unlockModal(), NOTE_PW); await clickModal(page, "is a sensitive note", "Unlock"); await status();
    await logout(page);
    await login(page); await unlockInput(page, "Master123"); await onMain(page);
    await page.selectOption("#file-select", "bank");
    await unlockModal().waitFor();
    ok(true, "after logout + login: asked again");
    await fillPw(unlockModal(), NOTE_PW); await clickModal(page, "is a sensitive note", "Unlock"); await status();
    ok((await editorText()).includes("EDIT2"), "and it opens");

    console.log("7. An uploaded file made sensitive");
    await page.setInputFiles("#hidden-upload", { name: "pic.png", mimeType: "image/png", buffer: PNG });
    await page.waitForFunction(() => document.querySelector("#file-select").value === "pic.png"); await status();
    await makeSensitive(PIC_PW);
    ok(outer("pic.png").startsWith(PREFIX) && (inner("pic.png", PIC_PW) || "").startsWith("data:image/png;base64,"), "Drive: the image is locked with its note password");
    ok(revisionsOf(fileByName("pic.png").id).length === 1, "Drive's older version of the upload was deleted");
    await open("plain");
    await open("pic.png", PIC_PW);
    ok(await page.locator("#media-viewer img").count() === 1 && await pressed() === "true", "reopened with its password: the image shows");
    const [dlPic] = await Promise.all([page.waitForEvent("download"), (async () => {
        await page.click("#tb-download"); await clickModal(page, "will NOT be encrypted", "OK");
    })()]);
    ok(dlPic.suggestedFilename() === "pic.png" && Buffer.compare(fs.readFileSync(await dlPic.path()), PNG) === 0, "its download is the original image");

    console.log("8. Failures never leave a sensitive note half-protected");
    await newNote("diary", "dear diary");
    global.failConfigWrite = true; // every content write fails
    await page.click("#tb-sensitive");
    await fillPw(modal(page, "Choose an extra password"), "DiaryPass1", "DiaryPass1");
    await clickModal(page, "Choose an extra password", "Make sensitive");
    await clickModal(page, "Could not make this note sensitive", "OK");
    global.failConfigWrite = false;
    ok(await pressed() === "false" && !outer("diary").startsWith(PREFIX), "Drive write fails: the note stays a normal note, unchanged");
    global.failRevisions = true;
    await page.click("#tb-sensitive");
    await fillPw(modal(page, "Choose an extra password"), "DiaryPass1", "DiaryPass1");
    await clickModal(page, "Choose an extra password", "Make sensitive");
    await clickModal(page, "could not be deleted", "OK");
    global.failRevisions = false;
    ok(await pressed() === "true" && outer("diary").startsWith(PREFIX), "older versions can't be deleted: the note IS protected, and the user is told");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" more");
    global.failConfigWrite = true;
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
    ok(r.code === 0 && Object.keys(r.files).sort().join() === "bank.sensitive,diary.sensitive,pic.png.sensitive,plain.html",
        "online export: plain.html + bank.sensitive, pic.png.sensitive, diary.sensitive: " + Object.keys(r.files).sort().join());
    ok(Buffer.compare(r.files["plain.html"], plainHtml) === 0, "the normal note is exported exactly as before (= the app's Download)");
    const bankSensitive = r.files["bank.sensitive"], picSensitive = r.files["pic.png.sensitive"];
    ok(bankSensitive.toString().startsWith(PREFIX) && !bankSensitive.toString().includes("PIN 4242"), "bank.sensitive holds only the note-password envelope");
    ok(r.out.includes("3 sensitive note(s)") && r.out.includes("Upload Sensitive Note"), "the CLI says how to open them");
    const mirror = cli(CLI, ["-m", "on", "-t", "GOODTOKEN", "-x"], "", driveFile);
    const mroot = fs.readdirSync(mirror.dir).find((d) => d.startsWith("eNotes Manager_"));
    const off = cli(CLI, ["-m", "off", "-c", path.join(mirror.dir, mroot, "Config", "config.json"), "-d", path.join(mirror.dir, mroot, "Entries")], "Master123\n");
    ok(off.code === 0 && Buffer.compare(off.files["bank.sensitive"], bankSensitive) === 0 && Buffer.compare(off.files["plain.html"], plainHtml) === 0,
        "offline export (from the -x mirror) gives the same files");
    const mirrorBank = fs.readFileSync(path.join(mirror.dir, mroot, "Entries", "bank"), "utf8");
    // An export CLI from before this feature (already downloaded by the user).
    const oldCliPath = path.join(WORK, "old-cli.js");
    const g = spawnSync("git", ["-C", ROOT, "show", `${PRE_FEATURE_COMMIT}:www/enotesmgr-export-cli.js`], { maxBuffer: 64 * 1024 * 1024 });
    ok(g.status === 0, "read the pre-feature export CLI from git (" + PRE_FEATURE_COMMIT + ")");
    fs.writeFileSync(oldCliPath, g.stdout);
    const old = cli(oldCliPath, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", driveFile);
    ok(old.code === 0 && old.files["bank.html"] && old.files["bank.html"].toString().includes(PREFIX) && !old.files["bank.html"].toString().includes("PIN 4242"),
        "an older CLI exports it as bank.html wrapping the (still locked) envelope");

    console.log("10. 'Upload Sensitive Note' (PC menu): local decrypt, no Drive");
    await login(page); await unlockInput(page, "Master123"); await onMain(page);
    await open("plain");
    const tool = async (name, buffer, pw, { wrongFirst = false, expectNotSensitive = false } = {}) => {
        await page.click("#btn-more");
        const item = page.locator('[data-action="upload-sensitive"]');
        await item.waitFor();
        const [fc] = await Promise.all([page.waitForEvent("filechooser"), item.click()]);
        await fc.setFiles({ name, mimeType: "application/octet-stream", buffer });
        if (expectNotSensitive) { await clickModal(page, "is not a sensitive note", "OK"); return null; }
        const m = modal(page, "Enter the password of the sensitive note");
        await m.waitFor();
        if (wrongFirst) {
            await fillPw(m, "WrongPass9"); await clickModal(page, "Enter the password of the sensitive note", "Decrypt"); await status();
            await m.waitFor();
            ok((await m.locator(".inline-error").textContent()).includes("Wrong password"), `  ${name}: wrong password asks again`);
        }
        await fillPw(m, pw);
        const [d] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Enter the password of the sensitive note", "Decrypt")]);
        return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
    };
    const callsBefore = driveLog.length;
    let got = await tool("bank.sensitive", bankSensitive, NOTE_PW, { wrongFirst: true });
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

    console.log("11. Removing the extra password");
    await open("bank", NOTE_PW);
    await page.click("#tb-sensitive");
    const rm = modal(page, "Remove the extra password");
    await rm.waitFor();
    await fillPw(rm, "WrongPass9"); await clickModal(page, "Remove the extra password", "Remove");
    await rm.waitFor();
    ok((await rm.locator(".inline-error").textContent()).includes("Wrong password") && outer("bank").startsWith(PREFIX), "the note's password is required (wrong one refused, nothing changed)");
    await fillPw(rm, NOTE_PW); await clickModal(page, "Remove the extra password", "Remove"); await status();
    ok(await pressed() === "false" && outer("bank").includes("PIN 4242 secret UNSAVED EDIT1 EDIT2") && !outer("bank").startsWith(PREFIX),
        "right password: stored with the file password only again");
    await open("plain"); await page.selectOption("#file-select", "bank"); await status();
    await page.waitForTimeout(300);
    ok(await unlockModal().count() === 0 && (await editorText()).includes("EDIT2"), "it opens without a note password now");
    await open("pic.png", PIC_PW);
    await page.click("#tb-sensitive");
    await fillPw(modal(page, "Remove the extra password"), PIC_PW); await clickModal(page, "Remove the extra password", "Remove"); await status();
    ok(outer("pic.png").startsWith("data:image/png;base64,") && await page.locator("#media-viewer img").count() === 1, "an upload goes back to a normal note too");
    await logout(page);
    r = cli(CLI, ["-m", "on", "-t", "GOODTOKEN"], "Master123\n", dumpDrive());
    ok(r.code === 0 && Buffer.compare(r.files["bank.html"], bankHtml) === 0 && Buffer.compare(r.files["pic.png"], PNG) === 0 && !!r.files["diary.sensitive"] && r.out.includes("1 sensitive note(s)"),
        "export CLI: bank.html and pic.png come out readable again (diary is still .sensitive)");

    console.log("12. Mobile: the toggle works, the PC-only tool is not offered");
    const mob = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await login(mob); await unlockInput(mob, "Master123"); await onMain(mob);
    await mob.selectOption("#file-select", "diary");
    await modal(mob, "is a sensitive note").waitFor();
    await modal(mob, "is a sensitive note").locator("input[type=password]").fill("DiaryPass1");
    await clickModal(mob, "is a sensitive note", "Unlock");
    await mob.waitForFunction(() => document.querySelector("#editor").textContent.includes("dear diary"));
    ok(await mob.isVisible("#tb-sensitive") && await mob.getAttribute("#tb-sensitive", "aria-pressed") === "true", "mobile: sensitive note unlocks, toggle visible and on");
    await mob.click("#btn-more");
    await mob.waitForSelector(".drawer");
    ok(await mob.locator('[data-action="upload-sensitive"]').count() === 0, "mobile: no 'Upload Sensitive Note' in the menu");

    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2);
});
