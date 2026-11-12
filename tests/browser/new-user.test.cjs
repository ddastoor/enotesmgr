// A brand-new user: nothing changes with the sensitive-notes feature.
// The app from BEFORE the feature (main, commit PRE_FEATURE_COMMIT) and the
// current app each set up a new account and are then used the same way (normal
// notes only), side by side, and must behave identically:
//   - the code a new user's setup runs is byte-for-byte unchanged (except the
//     settings page, deliberately fixed since: see settings.test.cjs);
//   - login, setup, unlock, settings and recovery-codes screens are identical;
//   - setup writes the same Drive tree: same folders, files, names, metadata,
//     sizes, the same decrypted config.json / settings.json / recovery files, the
//     same downloaded recovery-codes file - with the same Drive calls;
//   - the main page only gains the two padlock buttons, the menu only gains
//     'Decrypt Sensitive File' (PC), the '?' help only gains Alt+N / Alt+U;
//   - the same normal-note usage (New, typing, embedded picture, Save, Upload,
//     Rename, Delete, Settings) stores byte-identical notes with identical
//     metadata (no "Sensitive" key anywhere) and identical Downloads;
//   - data made by either version opens unchanged in the other.
// Usage: node new-user.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, drive, driveLog, driveRoute, GIS_STUB, ok, finish, modal, clickModal, onMain } = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const NEW_URL = process.argv[2];
const PRE_FEATURE_COMMIT = "0c53ab1"; // main before sensitive notes
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-new-user-"));
const MASTER = "Master123";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
// What a new user's setup (and normal use) runs: none of it may differ from main.
// (Not www/js/pages/settings.js: changed on purpose since - while it re-reads the settings from
// Drive they can't be changed, see settings.test.cjs. Its screen and what it saves are still
// compared below, and must be identical.)
const SETUP_CODE = ["www/index.html", "www/js/app.js", "www/js/state.js", "www/js/drive.js", "www/js/flow.js", "www/js/newUserLogin.js",
    "www/js/recovery.js", "www/js/recoveryReminder.js", "www/js/pages/login.js", "www/js/pages/setup.js", "www/js/pages/masterPassword.js",
    "www/js/pages/resetMasterPassword.js", "www/js/pages/recoveryCodes.js", "www/js/lib/meta.js",
    "www/js/lib/driveConfig.js", "www/js/lib/google.js", "www/js/lib/fileType.js", "www/js/crypto/crypto.js", "www/js/crypto/crypto.wasm"];

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

(async () => {
    console.log("1. The code a new user's setup runs is unchanged");
    const diff = spawnSync("git", ["-C", ROOT, "diff", "--name-only", PRE_FEATURE_COMMIT, "--", ...SETUP_CODE], { encoding: "utf8" });
    ok(diff.status === 0 && diff.stdout.trim() === "", `${SETUP_CODE.length} setup / login / unlock / recovery / crypto files byte-for-byte as on main` + (diff.stdout.trim() ? ": changed " + diff.stdout.trim().split("\n").join(", ") : ""));

    // Serve the pre-feature app (main) next to the current one.
    const oldDir = path.join(WORK, "old");
    fs.mkdirSync(oldDir);
    const arch = spawnSync("sh", ["-c", `git -C "${ROOT}" archive ${PRE_FEATURE_COMMIT} www | tar -x -C "${oldDir}"`], { encoding: "utf8" });
    ok(arch.status === 0 && fs.existsSync(path.join(oldDir, "www", "index.html")), "pre-feature app (main " + PRE_FEATURE_COMMIT + ") extracted from git");
    const port = await freePort();
    const server = spawn("python3", [path.join(ROOT, "serve.py"), "--port", String(port), "--dir", path.join(oldDir, "www")], { stdio: "ignore" });
    const OLD_URL = `http://localhost:${port}/`;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(OLD_URL)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }

    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;

    const browser = await chromium.launch();
    const errors = [];
    const openApp = async (url, opts = {}) => {
        const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 }, ...opts });
        await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "application/javascript", body: GIS_STUB }));
        await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
        await ctx.route("https://www.googleapis.com/**", driveRoute);
        const page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(url + ": " + e.message));
        await page.goto(url);
        page.status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
        return page;
    };
    // The app's screen, with things that differ per run (user-independent) kept.
    const screen = (page) => page.evaluate(() => document.getElementById("app").innerHTML);
    const normIds = (s) => s.replace(/\bf[0-9a-z]{7,}\b/g, "ID").replace(/recovery-[0-9a-f-]{36}/g, "recovery-UUID");
    // The Drive tree as stored: paths, types, metadata, content sizes.
    const treeShape = () => {
        const byId = new Map([...drive.values()].map((f) => [f.id, f]));
        const pathOf = (f) => { const p = byId.get((f.parents || [])[0]); return (p ? pathOf(p) + "/" : "") + f.name.replace(/^recovery-[0-9a-f-]{36}$/, "recovery-UUID"); };
        return [...drive.values()].map((f) => ({
            path: pathOf(f), mime: f.mimeType,
            meta: Object.fromEntries(Object.entries(f.appProperties || {}).map(([k, v]) => [k, /^DateTime/.test(k) ? (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) ? "STAMP" : "BAD:" + v) : v])),
            size: (f.content || "").length,
        })).sort((a, b) => (a.path + a.size).localeCompare(b.path + b.size));
    };
    const snapshotDrive = () => [...drive.values()].map((f) => JSON.parse(JSON.stringify(f)));
    const restoreDrive = (snap) => { drive.clear(); snap.forEach((f) => drive.set(f.id, JSON.parse(JSON.stringify(f)))); };
    const fileByName = (n) => [...drive.values()].find((f) => f.name === n);
    const filePassword = () => JSON.parse(C.decryptData(fileByName("config.json").content, MASTER)).file_password;

    // ---- the same new-user journey, run on each version ----
    const journey = async (url, label) => {
        drive.clear();
        const out = { label };
        const page = await openApp(url);
        await page.waitForSelector("#login-btn");
        out.loginScreen = await screen(page);
        const callsBefore = driveLog.length;
        await page.click("#login-btn");
        await page.waitForSelector("#su-pwd");
        out.setupScreen = await screen(page);
        await page.fill("#su-pwd", MASTER); await page.fill("#su-pwd2", MASTER);
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
        out.codesFileName = dl.suggestedFilename().replace(/\d{4}-\d\d-\d\d/, "DATE");
        out.codes = fs.readFileSync(await dl.path(), "utf8");
        out.codesShape = out.codes.replace(/\d{16}/g, "CODE").replace(/\d{4}-\d\d-\d\d[T ]?[\d:]*/g, "DATE");
        await clickModal(page, "Recovery codes downloaded", "I've saved them");
        await onMain(page);
        out.setupCalls = driveLog.slice(callsBefore).map(normIds).sort();
        out.setupTree = treeShape();
        const fp = filePassword();
        out.config = Object.keys(JSON.parse(C.decryptData(fileByName("config.json").content, MASTER)));
        out.fpShape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fp);
        out.settings = C.decryptData(fileByName("settings.json").content, fp);
        const codes = out.codes.match(/\d{16}/g) || [];
        const recFiles = [...drive.values()].filter((f) => f.name.startsWith("recovery-"));
        out.recovery = { files: recFiles.length, codes: codes.length,
            allOpen: codes.every((c) => recFiles.some((f) => { try { return JSON.parse(C.decryptData(f.content, c)).file_password === fp; } catch { return false; } })) };
        // Main page, menu, shortcut help.
        out.toolbar = await page.$$eval(".toolbar button, .header-actions button, .editor-toolbar button", (bs) => bs.map((b) => [b.id || b.dataset.cmd, b.textContent.trim(), b.title]));
        out.mainScreen = await screen(page);
        await page.click("#btn-more"); await page.waitForSelector(".drawer");
        out.menu = await page.$$eval(".drawer-list > li", (lis) => lis.map((li) => li.textContent.trim().replace(/\s+/g, " ")));
        await page.keyboard.press("Escape");
        await page.keyboard.press("?");
        await modal(page, "Keyboard shortcuts").waitFor();
        out.help = await page.$$eval(".shortcuts-list > div", (ds) => ds.map((d) => d.textContent.trim()));
        await clickModal(page, "Keyboard shortcuts", "Close");
        // Settings and recovery-codes screens.
        // (The settings page re-reads settings.json from Drive after it shows; wait
        // for that: the old app lets a change made before it be overwritten by it -
        // fixed since, see settings.test.cjs - and this check is about the screens.)
        const before = driveLog.length;
        await page.click("#btn-settings"); await page.waitForSelector("#set-save");
        for (let i = 0; i < 100 && !driveLog.slice(before).some((l) => l.includes("alt=media")); i++) await page.waitForTimeout(50);
        await page.status();
        out.settingsScreen = await screen(page);
        await page.selectOption("#set-theme", "Dark"); await page.fill("#set-timeout", "600");
        await page.click("#set-save"); await onMain(page);
        await page.click("#btn-more"); await page.click('[data-action="recovery"]');
        await page.waitForSelector("#rc-done"); await page.status();
        out.recoveryScreen = await screen(page);
        await page.click("#rc-done"); await onMain(page);
        // Normal notes, exactly as before the feature.
        await page.click("#tb-new");
        await modal(page, "Enter a name").locator("input").fill("first note");
        await clickModal(page, "Enter a name", "OK"); await page.status();
        await page.keyboard.type("My first note PIN 1234 café ✓ ");
        await page.setInputFiles("#hidden-ins-image", { name: "a.png", mimeType: "image/png", buffer: PNG });
        await page.waitForSelector("#editor .media-embed img");
        await page.keyboard.type(" end");
        await page.keyboard.press("Control+s"); await page.status();
        await page.setInputFiles("#hidden-upload", { name: "doc.pdf", mimeType: "application/pdf", buffer: PDF });
        await page.waitForFunction(() => document.querySelector("#file-select").value === "doc.pdf"); await page.status();
        await page.click("#tb-rename");
        await modal(page, "new name").locator("input").fill("renamed.pdf");
        await clickModal(page, "new name", "OK"); await page.status();
        await page.click("#tb-new");
        await modal(page, "Enter a name").locator("input").fill("temp");
        await clickModal(page, "Enter a name", "OK"); await page.status();
        await page.click("#tb-delete"); await clickModal(page, "cannot be undone", "OK"); await page.status();
        out.options = await page.$$eval("#file-select option", (os) => os.map((o) => o.textContent));
        out.downloads = {};
        for (const n of ["first note", "renamed.pdf"]) {
            await page.selectOption("#file-select", n); await page.status();
            const [d] = await Promise.all([page.waitForEvent("download"), page.click("#tb-download")]);
            out.downloads[n] = [d.suggestedFilename(), fs.readFileSync(await d.path()).toString("base64")];
        }
        out.usedTree = treeShape();
        out.notes = Object.fromEntries(["first note", "renamed.pdf"].map((n) => [n, C.decryptData(fileByName(n).content, fp)]));
        out.settingsAfter = C.decryptData(fileByName("settings.json").content, fp);
        // Log out and unlock again.
        await page.click("#btn-logout"); await page.waitForSelector("#login-btn");
        await page.click("#login-btn"); await page.waitForSelector("#mp-input");
        out.unlockScreen = await screen(page);
        await page.fill("#mp-input", MASTER); await page.press("#mp-input", "Enter");
        await onMain(page);
        out.theme = await page.evaluate(() => document.documentElement.dataset.theme);
        await page.selectOption("#file-select", "first note"); await page.status();
        out.reopened = await page.evaluate(() => document.getElementById("editor").innerHTML);
        out.drive = snapshotDrive();
        await page.context().close();
        return out;
    };

    console.log("2. The same new-user journey on main and on this branch");
    const A = await journey(OLD_URL, "main");
    const B = await journey(NEW_URL, "branch");
    const same = (k, label) => ok(JSON.stringify(A[k]) === JSON.stringify(B[k]), label + (JSON.stringify(A[k]) === JSON.stringify(B[k]) ? "" : `\n      main:   ${JSON.stringify(A[k]).slice(0, 400)}\n      branch: ${JSON.stringify(B[k]).slice(0, 400)}`));
    same("loginScreen", "login screen identical");
    same("setupScreen", "setup screen identical");
    same("codesFileName", `recovery-codes file has the same name (${B.codesFileName})`);
    same("codesShape", "recovery-codes file has the same layout");
    same("setupCalls", `setup makes the same Drive calls (${B.setupCalls.length})`);
    same("setupTree", `setup writes the same Drive tree: folders, files, metadata, sizes (${B.setupTree.length} items)`);
    same("config", "config.json holds the same keys");
    ok(A.fpShape && B.fpShape, "file password is a random UUID in both");
    same("settings", "settings.json identical");
    same("recovery", `recovery: ${B.recovery.files} files, ${B.recovery.codes} codes, every code opens a file with the file password`);
    ok(B.recovery.files === 10 && B.recovery.allOpen, "10 recovery codes, all working");
    same("settingsScreen", "settings screen identical");
    same("recoveryScreen", "recovery-codes screen identical");
    same("unlockScreen", "unlock screen identical");
    same("settingsAfter", "saved settings identical");
    same("theme", "theme applied the same after login");
    same("options", "file list identical (no padlocks)");
    same("downloads", "Downloads identical (rich text with picture, renamed upload)");
    same("notes", "stored notes decrypt to byte-identical content");
    same("usedTree", "after normal use the Drive tree is identical: names, metadata, sizes");
    same("reopened", "reopened note identical");
    ok(B.drive.every((f) => !("Sensitive" in (f.appProperties || {}))), "no 'Sensitive' metadata anywhere for a user who doesn't create sensitive notes");
    const sameFormatAsBefore = B.drive.filter((f) => f.parents && fileByNameIn(B.drive, "Entries", f)).every((f) => !C.decryptData(f.content, JSON.parse(C.decryptData(B.drive.find((x) => x.name === "config.json").content, MASTER)).file_password).startsWith("<<eNotesMgr"));
    function fileByNameIn(list, folder, f) { const p = list.find((x) => x.id === f.parents[0]); return p && p.name === folder; }
    ok(sameFormatAsBefore, "every note is stored in the old format (no sensitive envelope)");

    console.log("3. Only additions on the main page / menu / help");
    const added = (a, b) => b.filter((x) => !a.some((y) => JSON.stringify(y) === JSON.stringify(x)));
    const removed = (a, b) => a.filter((x) => !b.some((y) => JSON.stringify(y) === JSON.stringify(x)));
    ok(removed(A.toolbar, B.toolbar).length === 0 && JSON.stringify(added(A.toolbar, B.toolbar).map((x) => x[0])) === JSON.stringify(["tb-new-sensitive", "tb-upload-sensitive"]),
        "main page buttons: all of main's, unchanged, + the padlock New / Upload");
    ok(removed(A.menu, B.menu).length === 0 && added(A.menu, B.menu).length === 1 && added(A.menu, B.menu)[0] === "Decrypt Sensitive File",
        "menu: all of main's items, unchanged, + 'Decrypt Sensitive File'");
    ok(removed(A.help, B.help).length === 0 && added(A.help, B.help).length === 2 && added(A.help, B.help).every((r) => r.startsWith("Alt + ")),
        "keyboard help: all of main's rows, unchanged, + Alt + N / Alt + U");

    console.log("4. Data made by either version opens unchanged in the other");
    const crossCheck = async (snap, url, label, expect) => {
        restoreDrive(snap);
        const page = await openApp(url);
        await page.click("#login-btn"); await page.waitForSelector("#mp-input");
        await page.fill("#mp-input", MASTER); await page.press("#mp-input", "Enter");
        await onMain(page);
        const opts = await page.$$eval("#file-select option", (os) => os.map((o) => o.textContent));
        await page.selectOption("#file-select", "first note"); await page.status();
        const html = await page.evaluate(() => document.getElementById("editor").innerHTML);
        const downloads = {};
        for (const n of ["first note", "renamed.pdf"]) {
            await page.selectOption("#file-select", n); await page.status();
            const [d] = await Promise.all([page.waitForEvent("download"), page.click("#tb-download")]);
            downloads[n] = [d.suggestedFilename(), fs.readFileSync(await d.path()).toString("base64")];
        }
        ok(JSON.stringify(opts) === JSON.stringify(expect.options) && html === expect.reopened && JSON.stringify(downloads) === JSON.stringify(expect.downloads),
            `${label}: same notes, same content, same Downloads`);
        await page.context().close();
    };
    await crossCheck(B.drive, OLD_URL, "data made by this branch, opened in main", A);
    await crossCheck(A.drive, NEW_URL, "data made by main, opened in this branch", B);

    ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await browser.close();
    server.kill();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2);
});
