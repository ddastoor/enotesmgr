// Settings page: while it re-reads the settings from Drive (right after it opens), they can't be
// changed or saved - so a change is never silently undone by that re-read, and a re-read that ends
// late (after the page was left and a Save was made) is ignored. The fake Drive is slowed down on
// purpose, so every step happens in exactly the order described.
// The same steps are also run on the app from before this fix (commit PRE_FIX_COMMIT), where they
// must show the old bug - proof that these checks really catch it.
// Usage: node settings.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, drive, driveLog, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain } = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const NEW_URL = process.argv[2];
const PRE_FIX_COMMIT = "518db4b"; // main before this fix
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-settings-"));
const MASTER = "Master123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileByName = (n) => [...drive.values()].find((f) => f.name === n);
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

(async () => {
    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;

    // The app from before the fix, served next to the current one.
    const oldDir = path.join(WORK, "old");
    fs.mkdirSync(oldDir);
    const arch = spawnSync("sh", ["-c", `git -C "${ROOT}" archive ${PRE_FIX_COMMIT} www | tar -x -C "${oldDir}"`], { encoding: "utf8" });
    if (arch.status !== 0) throw new Error("could not extract the app of " + PRE_FIX_COMMIT + " from git: " + arch.stderr);
    const port = await freePort();
    const server = spawn("python3", [path.join(ROOT, "serve.py"), "--port", String(port), "--dir", path.join(oldDir, "www")], { stdio: "ignore" });
    const OLD_URL = `http://localhost:${port}/`;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(OLD_URL)).ok) break; } catch { /* starting */ } await sleep(200); }

    const browser = await chromium.launch();
    const errors = [];

    // A new account, set up with the current app.
    let page = await newPage(browser);
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page);
    await page.fill("#su-pwd", MASTER); await page.fill("#su-pwd2", MASTER);
    await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    await page.context().close();
    const FP = JSON.parse(C.decryptData(fileByName("config.json").content, MASTER)).file_password;

    // Settings as stored in Drive.
    const stored = () => { const j = JSON.parse(C.decryptData(fileByName("settings.json").content, FP)); return `${j.app_theme}/${j.session_timeout_seconds}`; };
    const store = (theme, timeout) => {
        const f = fileByName("settings.json");
        f.content = C.encryptData(JSON.stringify({ ...JSON.parse(C.decryptData(f.content, FP)), app_theme: theme, session_timeout_seconds: timeout }), FP);
    };
    const settingsDownloads = () => driveLog.filter((l) => l.includes(`/files/${fileByName("settings.json").id}?alt=media`)).length;
    // A fresh page of one of the two apps, logged in (it reads the settings from Drive then).
    const openApp = async (url) => {
        global.slowDownloads = {}; global.slowLookups = {};
        const p = await newPage(browser);
        p.on("pageerror", (e) => errors.push(e.message));
        if (url !== NEW_URL) await p.goto(url);
        await login(p); await unlockInput(p, MASTER); await onMain(p);
        return p;
    };
    const theme = (p) => p.evaluate(() => document.documentElement.dataset.theme);
    const fields = (p) => p.evaluate(() => `${document.querySelector("#set-theme").value}/${document.querySelector("#set-timeout").value}`);
    // The settings the app holds in memory: the page shows them the moment it opens, before its
    // re-read from Drive (slowed down here) comes in. Leaves with Escape.
    const inMemory = async (p) => {
        global.slowLookups = {};
        global.slowDownloads = { "settings.json": [2000] };
        await p.click("#btn-settings"); await p.waitForSelector("#set-save");
        const v = await fields(p);
        await p.keyboard.press("Escape"); await p.waitForSelector("#file-select");
        return v;
    };
    const waitDownloads = async (n) => { for (let i = 0; i < 400 && settingsDownloads() < n; i++) await sleep(25); return settingsDownloads() >= n; };

    console.log("1. While the settings load from Drive they can't be changed or saved");
    // Opening Settings: a name lookup in Drive (nothing on screen meanwhile), then the download
    // (with 'Loading...' on screen, which takes the mouse but not the keyboard).
    for (const [where, slow] of [["the lookup", { slowLookups: { "settings.json": [3000] } }], ["the download", { slowDownloads: { "settings.json": [3000] } }]]) {
        store("Light", 300);
        page = await openApp(NEW_URL);
        store("Dark", 900); // changed elsewhere since this page logged in
        Object.assign(global, slow);
        const n = settingsDownloads();
        await page.click("#btn-settings"); await page.waitForSelector("#set-save");
        const atOnce = await fields(page);
        if (where === "the download") await waitDownloads(n + 1);
        const during = await page.evaluate(() => ["#set-timeout", "#set-theme", "#set-save", "#set-cancel"].map((s) => document.querySelector(s).disabled));
        ok(atOnce === "Light/300", `during ${where}: it shows the settings in memory at once (${atOnce})`);
        ok(during.join() === "true,true,true,false", `during ${where}: the timeout field, the theme and Save are disabled; Cancel is not`);
        await page.keyboard.press("Tab"); await page.keyboard.type("777"); await page.keyboard.press("ArrowDown");
        ok(await fields(page) === "Light/300", `during ${where}: typing and arrow keys change nothing`);
        const t0 = Date.now();
        await page.waitForFunction(() => !document.querySelector("#set-save").disabled, null, { timeout: 20000 });
        ok(Date.now() - t0 > 1000 && await fields(page) === "Dark/900", `once Drive's copy is in, it is shown (${await fields(page)})`);
        const after = await page.evaluate(() => ["#set-timeout", "#set-theme", "#set-save", "#set-cancel"].map((s) => document.querySelector(s).disabled));
        ok(after.join() === "false,false,false,false", "and every field and both buttons work");
        await page.keyboard.press("Escape"); await page.waitForSelector("#file-select");
        await page.context().close();
        global.slowLookups = {};
    }

    // The same steps on both apps.
    // A: change the settings at once - during the lookup or the download - and Save when the
    //    loading is over. (The test's actions wait for a field to be usable, as a person must.)
    const changeWhileLoading = async (url, where) => {
        store("Light", 300);
        const p = await openApp(url);
        if (where === "lookup") global.slowLookups = { "settings.json": [3000] };
        else global.slowDownloads = { "settings.json": [3000] };
        const n = settingsDownloads();
        await p.click("#btn-settings"); await p.waitForSelector("#set-save");
        await p.selectOption("#set-theme", "Dark"); await p.fill("#set-timeout", "600");
        await waitDownloads(n + 1);
        await p.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
        await sleep(300);
        await p.click("#set-save"); await onMain(p);
        await sleep(300);
        global.slowLookups = {};
        const r = { theme: await theme(p), drive: stored(), memory: await inMemory(p) };
        await p.context().close();
        return r;
    };
    // B: open Settings, leave (Escape) while it is still reading Drive (slowly), open it again,
    //    change and save; the first, slow read ends only after that.
    const leaveAndComeBack = async (url) => {
        store("Light", 300);
        const p = await openApp(url);
        global.slowDownloads = { "settings.json": [8000, 0] };
        const n = settingsDownloads();
        await p.click("#btn-settings"); await p.waitForSelector("#set-save");
        await waitDownloads(n + 1);
        const slowStarted = Date.now();
        await p.keyboard.press("Escape"); await p.waitForSelector("#file-select");
        await p.click("#btn-settings"); await p.waitForSelector("#set-save");
        await waitDownloads(n + 2);
        await p.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
        await sleep(300);
        await p.selectOption("#set-theme", "Dark"); await p.fill("#set-timeout", "600");
        await p.click("#set-save"); await onMain(p);
        const savedBeforeSlowRead = Date.now() - slowStarted < 7000;
        await sleep(Math.max(0, 8000 - (Date.now() - slowStarted)) + 1000); // the slow read is in now
        const memory = await inMemory(p); // (this also navigates: the theme is re-applied from memory)
        const r = { savedBeforeSlowRead, theme: await theme(p), drive: stored(), memory };
        await p.context().close();
        return r;
    };

    console.log("2. A change made while it loads, saved when loading is over");
    for (const where of ["lookup", "download"]) {
        const a = await changeWhileLoading(NEW_URL, where);
        ok(a.drive === "Dark/600" && a.memory === "Dark/600" && a.theme === "dark",
            `during the ${where}: the change is kept - Drive Dark/600, in the app Dark/600, dark theme (Drive ${a.drive}, app ${a.memory}, ${a.theme})`);
        const old = await changeWhileLoading(OLD_URL, where);
        ok(!(old.drive === "Dark/600" && old.memory === "Dark/600" && old.theme === "dark"),
            `(before the fix the same steps lost the change: Drive ${old.drive}, app ${old.memory}, ${old.theme} theme)`);
    }

    console.log("3. Leave while it is loading, come back, change and save; the first load ends after that");
    const b = await leaveAndComeBack(NEW_URL);
    ok(b.savedBeforeSlowRead, "(the save was done before the first, slow read ended)");
    ok(b.drive === "Dark/600" && b.memory === "Dark/600" && b.theme === "dark",
        `the late first read is ignored: Drive Dark/600 and the app keeps Dark/600, dark theme (Drive ${b.drive}, app ${b.memory}, ${b.theme})`);
    const bOld = await leaveAndComeBack(OLD_URL);
    ok(bOld.savedBeforeSlowRead && bOld.drive === "Dark/600" && bOld.memory !== "Dark/600",
        `(before the fix the late read undid the save in the app: Drive ${bOld.drive}, app ${bOld.memory}, ${bOld.theme} theme)`);

    console.log("4. If reading Drive fails, the settings can still be changed and saved");
    store("Light", 300);
    page = await openApp(NEW_URL);
    global.slowDownloads = { "settings.json": ["fail"] };
    await page.click("#btn-settings"); await page.waitForSelector("#set-save");
    await page.waitForFunction(() => !document.querySelector("#set-save").disabled, null, { timeout: 20000 });
    ok(await fields(page) === "Light/300", "the fields show the settings in memory and are enabled");
    await page.selectOption("#set-theme", "Dark"); await page.fill("#set-timeout", "600");
    await page.click("#set-save"); await onMain(page);
    ok(stored() === "Dark/600" && await theme(page) === "dark", `Save works: Drive ${stored()}, ${await theme(page)} theme`);
    await page.context().close();

    console.log("5. Cancel, Escape and the checks still work");
    store("Light", 300);
    page = await openApp(NEW_URL);
    global.slowLookups = { "settings.json": [3000] };
    let n = settingsDownloads();
    await page.click("#btn-settings"); await page.waitForSelector("#set-save");
    await page.click("#set-cancel"); await page.waitForSelector("#file-select");
    ok(stored() === "Light/300", "Cancel while it is looking the settings up: back to the main page at once, nothing changed");
    await sleep(3500);
    ok(settingsDownloads() === n && await page.locator(".status-overlay:visible").count() === 0 && await page.locator("#file-select").count() === 1,
        "the late lookup is dropped: nothing more is read, no 'Loading...' over the main page");
    global.slowDownloads = { "settings.json": [3000] };
    n = settingsDownloads();
    await page.click("#btn-settings"); await page.waitForSelector("#set-save");
    await waitDownloads(n + 1);
    await page.keyboard.press("Escape"); await page.waitForSelector("#file-select");
    ok(stored() === "Light/300", "Escape while it is downloading: back to the main page, nothing changed");
    await sleep(3500);
    ok(await page.locator(".status-overlay:visible").count() === 0 && await page.locator("#file-select").count() === 1, "the late download leaves the main page alone");
    await page.click("#btn-settings"); await page.waitForFunction(() => !document.querySelector("#set-save").disabled);
    await page.fill("#set-timeout", "5"); await page.click("#set-save");
    ok((await page.textContent("#set-error")).includes("between 60 and 3600") && stored() === "Light/300", "an out-of-range timeout is still refused, nothing saved");
    await page.click("#set-cancel"); await page.waitForSelector("#file-select");
    ok(stored() === "Light/300", "Cancel: back to the main page, nothing changed");
    await page.context().close();

    ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await browser.close();
    server.kill();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
