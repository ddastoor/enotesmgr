// Data safety: Drive glitches and duplicate / missing files must never lead to
// a second config.json with a new key, setup over existing data, or deleting
// the only key to the notes. Normal behaviour (one of everything) unchanged.
// Usage: node data-safety.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, drive, children, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, readDownload,
} = require("./lib/harness.cjs");
const path = require("path");
const { pathToFileURL } = require("url");

const FOLDER = "application/vnd.google-apps.folder";
let C; // crypto module (www/js/crypto/crypto.js), loaded in Node to craft Drive states
async function crypto() {
    if (!C) {
        globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(__dirname, "..", "..", "www", "js", "crypto", "crypto.wasm")).toString("base64");
        C = await import(pathToFileURL(path.join(__dirname, "..", "..", "www", "js", "crypto", "crypto.js")).href);
        await C.cryptoReady;
    }
    return C;
}

// --- helpers over the fake Drive ---
const items = () => [...drive.values()];
const named = (name, parent) => items().filter((f) => f.name === name && (!parent || f.parents.includes(parent)));
const managers = () => named("eNotes Manager").filter((f) => f.mimeType === FOLDER);
const sub = (managerId, name) => items().find((f) => f.name === name && f.mimeType === FOLDER && f.parents.includes(managerId));
const realManager = () => managers().find((m) => children(sub(m.id, "Entries")?.id || "-").length > 0) || managers()[0];
const cfgFolder = () => sub(realManager().id, "Config");
const configs = () => named("config.json", cfgFolder().id);
const snapshot = () => structuredClone([...drive]);
const restore = (snap) => { drive.clear(); for (const [k, v] of structuredClone(snap)) drive.set(k, v); };
// Put an item first in Drive's listing order (to make sure the app doesn't just pick "the first").
const putFirst = (id) => { const all = [...drive]; drive.clear(); drive.set(id, all.find(([k]) => k === id)[1]); for (const [k, v] of all) if (k !== id) drive.set(k, v); };
let nextId = 1;
const addFile = (name, parent, content, extra = {}) => {
    const id = "crafted" + nextId++;
    drive.set(id, { id, name, mimeType: "text/plain", parents: [parent], content, appProperties: { DateTimeCreated: "2030-01-01T00:00", DateTimeModified: "2030-01-01T00:00", CreationMethod: "app", FileType: "config" }, ...extra });
    return id;
};
const addFolder = (name, parent) => { const id = "craftedF" + nextId++; drive.set(id, { id, name, mimeType: FOLDER, parents: [parent], content: "" }); return id; };

const PW = "Master123";
async function unlockAndOpenBank(page, pw = PW) {
    await login(page);
    await page.waitForSelector("#mp-input", { timeout: 20000 });
    await unlockInput(page, pw);
    await onMain(page);
    await page.selectOption("#file-select", "bank");
    await page.waitForFunction(() => document.querySelector("#editor").textContent.includes("PIN 4242"), null, { timeout: 15000 });
}
const noSetupPage = async (page) => (await page.locator("#su-pwd").count()) === 0;

(async () => {
    const browser = await chromium.launch();
    const page = await newPage(browser);

    // An existing account: config + settings + 10 recovery codes + a note.
    await login(page);
    await page.fill("#su-pwd", PW); await page.fill("#su-pwd2", PW);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    const codes = await readDownload(dl);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    await page.click("#tb-new");
    await modal(page, "Enter a name").locator("input").fill("bank");
    await clickModal(page, "Enter a name", "OK");
    await page.click("#editor"); await page.keyboard.type("PIN 4242");
    await page.click("#tb-save"); await page.waitForTimeout(800);
    await logout(page);
    const base = snapshot();
    const filePassword = JSON.parse((await crypto()).decryptData(configs()[0].content, PW)).file_password;

    console.log("1. Normal login is unchanged");
    await unlockAndOpenBank(page);
    ok(configs().length === 1 && managers().length === 1, "one config.json, one folder tree, note opens");
    await logout(page);

    console.log("2. A momentary Drive glitch never creates duplicates or starts setup");
    for (const glitch of ["config.json", "eNotes Manager", "Entries", "Config"]) {
        restore(base);
        global.hideLookups = { [glitch]: 1 };
        await unlockAndOpenBank(page);
        ok(await noSetupPage(page) && configs().length === 1 && managers().length === 1 && named(glitch).length === 1,
            `'${glitch}' briefly not found: looked again, no duplicate created, unlocked normally`);
        await logout(page);
    }
    global.hideLookups = null;

    console.log("3. config.json really missing, recovery codes exist -> no setup; a recovery code restores it");
    restore(base);
    drive.delete(configs()[0].id);
    await page.click("#login-btn"); // (not login(): a message comes before any page)
    await modal(page, "Config file missing").waitFor({ timeout: 20000 });
    ok((await modal(page, "Config file missing").textContent()).includes("Nothing has been changed"), "'Config file missing' message, nothing changed");
    await clickModal(page, "Config file missing", "OK");
    await page.waitForSelector("#mp-input");
    ok(await noSetupPage(page), "unlock page shown, NOT the setup page");
    await unlockInput(page, PW);
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent.includes("config file is missing"));
    ok(true, "master password: 'Your config file is missing. Enter one of your recovery codes...'");
    await unlockInput(page, codes[0]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    await page.fill("#rmp-pwd", "Restored1x"); await page.fill("#rmp-pwd2", "Restored1x"); await page.click("#rmp-reset");
    await clickModal(page, "Master password reset", "OK");
    await page.waitForSelector("#login-btn");
    ok(configs().length === 1 && JSON.parse((await crypto()).decryptData(configs()[0].content, "Restored1x")).file_password === filePassword,
        "config.json recreated with the ORIGINAL key");
    await unlockAndOpenBank(page, "Restored1x");
    ok(true, "notes open again with the new master password");
    await logout(page);

    console.log("4. config.json missing, no recovery codes, notes exist -> asked first, nothing deleted");
    restore(base);
    drive.delete(configs()[0].id);
    for (const f of children(sub(realManager().id, "Recovery").id)) drive.delete(f.id);
    const before = items().length;
    await page.click("#login-btn");
    await modal(page, "Config file missing").waitFor({ timeout: 20000 });
    const btns = (await modal(page, "Config file missing").locator(".modal-actions button").allTextContents()).join(" / ");
    ok(btns === "Log out / Set up a new account", `asks: "${btns}"`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#login-btn");
    ok(items().length === before, "Escape / Log out: nothing created or deleted");
    await page.click("#login-btn");
    await clickModal(page, "Config file missing", "Set up a new account");
    await page.waitForSelector("#su-pwd");
    ok(items().length === before, "'Set up a new account' only opens the setup page (still nothing deleted)");
    await page.reload();

    console.log("5. Duplicate config.json, same master password, DIFFERENT key (e.g. an accidental re-setup)");
    restore(base);
    const c = await crypto();
    const dupId = addFile("config.json", cfgFolder().id, c.encryptData(JSON.stringify({ file_password: "a-different-key" }), PW));
    putFirst(dupId); // listed first, and newer: the app must still pick the one that opens the notes
    const settings = named("settings.json", cfgFolder().id)[0];
    settings.content = c.encryptData(JSON.stringify({ session_timeout_seconds: 300, app_theme: "Dark" }), "a-different-key");
    await unlockAndOpenBank(page);
    ok(true, "unlocks with the copy whose key opens the notes (not the first / newest one)");
    ok(configs().length === 2, "the other copy (different key) is NOT deleted");
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === "light", "unreadable settings: defaults used, unlock not blocked");
    await logout(page);

    console.log("6. Exact duplicate config.json (same key) -> the extra copy is removed");
    restore(base);
    addFile("config.json", cfgFolder().id, (await crypto()).encryptData(JSON.stringify({ file_password: filePassword }), PW));
    ok(configs().length === 2, "two copies before");
    await unlockAndOpenBank(page);
    ok(configs().length === 1, "one copy after, notes open");
    await logout(page);

    console.log("7. Duplicate config.json that does NOT open with this password -> never deleted");
    restore(base);
    const foreignId = addFile("config.json", cfgFolder().id, (await crypto()).encryptData(JSON.stringify({ file_password: "x" }), "SomeOtherPw9"));
    putFirst(foreignId);
    await unlockAndOpenBank(page);
    ok(configs().length === 2 && drive.has(foreignId), "unlocked; the copy for another password is kept (it used to be deleted)");
    await logout(page);

    console.log("8. Duplicate 'eNotes Manager' folders -> the one holding the data is used");
    for (const [label, makeEmptyHaveConfig] of [["an empty tree", false], ["a tree with a config but no notes", true]]) {
        restore(base);
        const m2 = addFolder("eNotes Manager", "appDataFolder");
        const cfg2 = addFolder("Config", m2); addFolder("Entries", m2); addFolder("Recovery", m2);
        if (makeEmptyHaveConfig) addFile("config.json", cfg2, (await crypto()).encryptData(JSON.stringify({ file_password: "k2" }), PW));
        putFirst(m2);
        await unlockAndOpenBank(page);
        ok(await noSetupPage(page) && managers().length === 2, `extra ${label} listed first: the tree with the notes is used, nothing deleted`);
        await logout(page);
    }

    console.log("9. A genuinely new account still goes straight to setup");
    drive.clear();
    await login(page);
    await page.waitForSelector("#su-pwd", { timeout: 20000 });
    ok(await modal(page, "Config file missing").count() === 0, "setup page, no 'Config file missing' message");

    ok(page.cspViolations.length === 0, "no CSP violations");
    await browser.close();
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
