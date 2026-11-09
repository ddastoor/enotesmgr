// Never locked out: mandatory new codes at 0/1 left, safe last-code reset, complete code sets, failure handling.
// Usage: node recovery-lockout.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, BASE, FOLDER, drive, children, folderByName, parseMultipart, driveLog, driveRoute, GIS_STUB,
    ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, recoveryFiles, readDownload,
} = require("./lib/harness.cjs");
const path = require("path");
const { pathToFileURL } = require("url");

// ---- recovery lockout-prevention tests ----
let cryptoMod;
async function codeToFile(codes) {
    // Which recovery file does each code open? (Trial decryption, like the app.)
    if (!cryptoMod) {
        globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(__dirname, "..", "..", "www", "js", "crypto", "crypto.wasm")).toString("base64");
        cryptoMod = await import(pathToFileURL(path.join(__dirname, "..", "..", "www", "js", "crypto", "crypto.js")).href); await cryptoMod.cryptoReady;
    }
    const map = new Map();
    for (const f of recoveryFiles()) for (const c of codes) {
        try { cryptoMod.decryptData(f.content, c); map.set(c, f.id); break; } catch {}
    }
    return map;
}
async function keepOnlyCodes(allCodes, keep) {
    const map = await codeToFile(allCodes);
    const keepIds = new Set(keep.map((c) => map.get(c)));
    for (const f of recoveryFiles()) if (!keepIds.has(f.id)) drive.delete(f.id);
}
const marker = () => children(folderByName("Recovery").id).find((f) => f.name.startsWith("one-or-no"));
const popup = (page, title) => page.locator(".modal-card").filter({ has: page.locator(".modal-title", { hasText: title }) });
const buttons = async (page, title) => (await popup(page, title).locator(".modal-actions button").allTextContents()).join(" / ");
async function passwordLogin(page, pw) { await login(page); await unlockInput(page, pw); await page.waitForSelector("#file-select", { timeout: 20000 }); }

(async () => {
    const browser = await chromium.launch();
    const page = await newPage(browser);
    let pw = "Master123";

    // setup with 10 codes
    await login(page);
    await page.fill("#su-pwd", pw); await page.fill("#su-pwd2", pw);
    let [dl] = await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    let codes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForSelector("#file-select");
    await logout(page);

    console.log("PART 2: 1 code left at a normal login -> must generate or log out");
    await keepOnlyCodes(codes, [codes[0]]);
    ok(recoveryFiles().length === 1, "drive now has exactly 1 recovery code");
    await passwordLogin(page, pw);
    await popup(page, "Only 1 recovery code left").waitFor();
    const b = await buttons(page, "Only 1 recovery code left");
    ok(b === "Log out / Generate now", `mandatory popup, buttons: "${b}" (no Later / Don't ask again)`);
    ok((await popup(page, "Only 1 recovery code left").textContent()).includes("to keep using eNotesMgr, or log out"), 'popup text says "keep using eNotesMgr"');
    ok(await page.evaluate(() => { const e = new KeyboardEvent("keydown", { key: "n", bubbles: true }); document.dispatchEvent(e); return !document.querySelector(".modal-card .modal-title")?.textContent.includes("New note"); }), "app behind it can't be used (shortcut N ignored)");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#login-btn", { timeout: 5000 });
    ok(true, "Escape = log out");
    await passwordLogin(page, pw);
    await popup(page, "Only 1 recovery code left").locator("button", { hasText: "Log out" }).click();
    await page.waitForSelector("#login-btn", { timeout: 5000 });
    ok(true, "'Log out' logs out");
    // marker must be ignored at 1 code
    global.markerTest = true;
    drive.set("mk1", { id: "mk1", name: "one-or-no-recovery-files-left-dont-ask-marker-file", mimeType: "text/plain", parents: [folderByName("Recovery").id], content: "" });
    await passwordLogin(page, pw);
    await popup(page, "Only 1 recovery code left").waitFor();
    ok(true, "'Don't ask again' marker is ignored when 1 code is left");
    // generation failure -> error -> popup again -> success
    global.failUploads = true;
    await popup(page, "Only 1 recovery code left").locator("button", { hasText: "Generate now" }).click();
    await clickModal(page, "Could not generate recovery codes", "OK");
    await popup(page, "Only 1 recovery code left").waitFor();
    ok(recoveryFiles().length === 1, "failed generation: error shown, popup comes back, nothing half-created");
    global.failUploads = false;
    [dl] = await Promise.all([page.waitForEvent("download"), popup(page, "Only 1 recovery code left").locator("button", { hasText: "Generate now" }).click()]);
    let newCodes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    ok(recoveryFiles().length === 10 && newCodes.length === 10, "Generate now: a new set of 10 (the last old code is replaced), app usable");
    ok(!marker(), "generating removed the 'don't ask again' marker");
    await page.click("#tb-new"); await clickModal(page, "Enter a name", "Cancel");
    ok(true, "main page works after generating");
    codes = newCodes;
    await logout(page);

    console.log("PART 2b: auto-logout while the mandatory popup is open");
    await keepOnlyCodes(codes, [codes[1]]);
    await passwordLogin(page, pw);
    await popup(page, "Only 1 recovery code left").waitFor();
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 10 * 60 * 1000; });
    await page.mouse.move(20, 20);
    await page.waitForSelector("#login-btn", { timeout: 5000 });
    ok(await page.locator(".modal-backdrop").count() === 0, "after timeout logout the popup is gone (not left over the login page)");
    await page.reload(); // fresh page, normal clock
    await passwordLogin(page, pw);
    [dl] = await Promise.all([page.waitForEvent("download"), popup(page, "Only 1 recovery code left").locator("button", { hasText: "Generate now" }).click()]);
    codes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    ok(await page.locator("#file-select").count() === 1, "Escape later does not trigger a stray logout");
    await logout(page);

    console.log("PART 1: recovery-code reset never leaves 0 or 1 codes");
    for (const [have, expectPopup] of [[1, "That was your last recovery code"], [2, "That leaves you with only 1 recovery code"], [3, null]]) {
        await keepOnlyCodes(codes, codes.slice(0, have));
        await login(page);
        await unlockInput(page, codes[0]);
        await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
        pw = "NewPass" + have + "x1";
        await page.fill("#rmp-pwd", pw); await page.fill("#rmp-pwd2", pw); await page.click("#rmp-reset");
        if (expectPopup) {
            const p = popup(page, "Generate new recovery codes");
            await p.waitFor();
            ok((await p.textContent()).includes(expectPopup) && (await buttons(page, "Generate new recovery codes")) === "Generate now", `${have} code(s) before reset: mandatory "Generate now" popup ("${expectPopup}...")`);
            await page.keyboard.press("Escape"); await page.waitForTimeout(300);
            ok(await p.count() === 1, "  Escape doesn't dismiss it");
            [dl] = await Promise.all([page.waitForEvent("download"), p.locator("button", { hasText: "Generate now" }).click()]);
            newCodes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
            await clickModal(page, "Recovery codes downloaded", "I've saved them");
            await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
        }
        await clickModal(page, "Master password reset", "OK");
        await page.waitForSelector("#login-btn");
        const expected = expectPopup ? 10 : have - 1;
        ok(recoveryFiles().length === expected, `  after reset: ${recoveryFiles().length} codes (${expectPopup ? "a new set of 10 replaced the old codes, used one included" : "used code exhausted"})`);
        codes = expectPopup ? newCodes : codes.slice(1, have);
        await passwordLogin(page, pw);
        await page.waitForTimeout(500);
        ok(await page.locator(".modal-backdrop").count() === 0, "  new password works, no reminder popup");
        await logout(page);
    }

    console.log("PART 1b: generation fails during reset -> 'Finish without new codes' keeps the code");
    await keepOnlyCodes(codes, [codes[0]]);
    await login(page); await unlockInput(page, codes[0]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    pw = "NewPassFail1"; await page.fill("#rmp-pwd", pw); await page.fill("#rmp-pwd2", pw);
    global.failUploads = true;
    await page.click("#rmp-reset");
    await popup(page, "Generate new recovery codes").locator("button", { hasText: "Generate now" }).click();
    await popup(page, "Could not generate recovery codes").locator("button", { hasText: "Try again" }).click();
    await popup(page, "Generate new recovery codes").locator("button", { hasText: "Generate now" }).click();
    await popup(page, "Could not generate recovery codes").locator("button", { hasText: "Finish without new codes" }).click();
    const finalMsg = await popup(page, "Master password reset").textContent();
    ok(finalMsg.includes("was NOT used up and still works"), "final message says the code was NOT used up");
    await clickModal(page, "Master password reset", "OK");
    global.failUploads = false;
    ok(recoveryFiles().length === 1, "the used code's file is still there");
    await passwordLogin(page, pw);
    await popup(page, "Only 1 recovery code left").waitFor();
    ok(true, "next normal login: mandatory 'generate or log out' (1 code left)");
    await popup(page, "Only 1 recovery code left").locator("button", { hasText: "Log out" }).click();
    await page.waitForSelector("#login-btn");
    await login(page); await unlockInput(page, codes[0]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    ok(true, "and the kept code still works for a reset");
    await page.click("#rmp-cancel"); await page.waitForSelector("#login-btn");

    console.log("PART 1c: saving the new password fails -> clear error, code not used up");
    global.failConfigWrite = true;
    await login(page); await unlockInput(page, codes[0]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    await page.fill("#rmp-pwd", "Another1x"); await page.fill("#rmp-pwd2", "Another1x"); await page.click("#rmp-reset");
    const failMsg = await popup(page, "Reset failed").textContent();
    ok(failMsg.includes("not used up"), "error popup: 'Reset failed ... not used up'");
    await clickModal(page, "Reset failed", "OK");
    await page.waitForSelector("#login-btn");
    global.failConfigWrite = false;
    ok(recoveryFiles().length === 1, "code still there");
    await login(page); await unlockInput(page, pw); await page.waitForSelector("#file-select", { timeout: 20000 });
    ok(true, "old (unchanged) password still works");
    [dl] = await Promise.all([page.waitForEvent("download"), popup(page, "Only 1 recovery code left").locator("button", { hasText: "Generate now" }).click()]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");

    console.log("NEVER 0 CODES / COMPLETE SETS: Generate new codes on the Recovery Codes page");
    await page.click("#btn-more");
    ok(await page.locator('[data-action="restart-reminder"]').count() === 0, "menu: no 'Restart Recovery Reminders'");
    await page.click('[data-action="recovery"]');
    ok(await page.locator("#rc-wipe").count() === 0 && await page.locator("#rc-replace").count() === 0 && await page.locator("#rc-generate").count() === 1, "recovery page: just 'Generate new codes' (no Wipe / Replace)");
    let before = recoveryFiles().map((f) => f.id).sort().join();
    global.failRecoveryUploads = true;
    await page.click("#rc-generate"); await clickModal(page, "Generate 10 new recovery codes", "OK");
    ok((await modal(page, "left unchanged").textContent()).includes("Could not generate recovery codes"), "generation failing: error, ...");
    await clickModal(page, "left unchanged", "OK");
    global.failRecoveryUploads = false;
    ok(recoveryFiles().map((f) => f.id).sort().join() === before, "  ... and the current codes are untouched");
    const oldCount = recoveryFiles().length;
    global.failDeletes = true;
    await page.click("#rc-generate");
    await Promise.all([page.waitForEvent("download"), clickModal(page, "Generate 10 new recovery codes", "OK")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    ok((await modal(page, "could not be removed").textContent()).includes(`${oldCount} of your previous recovery codes could not be removed`), "deletes failing: new set made, says the old codes still work");
    await clickModal(page, "could not be removed", "OK");
    global.failDeletes = false;
    ok(recoveryFiles().length === oldCount + 10, "  never fewer codes than before");
    await page.click("#rc-generate");
    [dl] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Generate 10 new recovery codes", "OK")]);
    codes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    ok(recoveryFiles().length === 10, "generate again: exactly the 10 codes in the newest file");

    console.log("Not confirming 'I've saved them' (auto-logout) keeps BOTH sets working");
    const oldSet = codes;
    await page.click("#rc-generate");
    [dl] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Generate 10 new recovery codes", "OK")]);
    const unconfirmed = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
    await modal(page, "Recovery codes downloaded").waitFor();
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 10 * 60 * 1000; });
    await page.mouse.move(40, 40);
    await page.waitForSelector("#login-btn", { timeout: 5000 });
    ok(recoveryFiles().length === 20, "auto-logout before confirming: old and new sets both kept (20)");
    await page.reload();
    for (const [label, c] of [["an old code", oldSet[3]], ["a new code", unconfirmed[3]]]) {
        await login(page); await unlockInput(page, c);
        await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
        ok(true, `  ${label} still works`);
        await page.click("#rmp-cancel"); await page.waitForSelector("#login-btn");
    }
    await passwordLogin(page, pw);
    await page.click("#btn-more"); await page.click('[data-action="recovery"]');
    await page.click("#rc-generate");
    [dl] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Generate 10 new recovery codes", "OK")]);
    codes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
    ok((await modal(page, "Recovery codes downloaded").textContent()).includes("previous 20 recovery codes stop working"), "next generation: 'your previous 20 recovery codes stop working'");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    ok(recoveryFiles().length === 10, "  and afterwards exactly 10 again");
    await page.click("#rc-done"); await page.waitForSelector("#file-select");
    await logout(page);

    console.log("NEVER 0 CODES: 0 codes at login is mandatory too");
    const savedCodes = recoveryFiles().map((f) => ({ ...f }));
    savedCodes.forEach((f) => drive.delete(f.id));
    await passwordLogin(page, pw);
    await popup(page, "No recovery codes").waitFor();
    ok((await buttons(page, "No recovery codes")) === "Log out / Generate now", "0 codes: mandatory popup 'Log out / Generate now'");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#login-btn", { timeout: 5000 });
    ok(true, "Escape = log out");
    await passwordLogin(page, pw);
    await Promise.all([page.waitForEvent("download"), popup(page, "No recovery codes").locator("button", { hasText: "Generate now" }).click()]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    ok(recoveryFiles().length === 10, "Generate now: 10 codes");
    await logout(page);

    console.log("Leftover 'don't ask again' marker from the old app is removed");
    drive.set("mk2", { id: "mk2", name: "one-or-no-recovery-files-left-dont-ask-marker-file", mimeType: "text/plain", parents: [folderByName("Recovery").id], content: "" });
    await passwordLogin(page, pw); await page.waitForTimeout(800);
    ok(!marker() && await page.locator(".modal-backdrop").count() === 0, "marker deleted at login, no popup (10 codes)");
    await logout(page);

    console.log("Setup: no checkbox; codes always generated; if that fails, required at the main page");
    drive.clear();
    await login(page);
    ok(await page.locator("#su-gen").count() === 0, "setup page has no 'Generate Recovery codes' checkbox");
    global.failRecoveryUploads = true;
    await page.fill("#su-pwd", "Fresh1234"); await page.fill("#su-pwd2", "Fresh1234"); await page.click("#su-finish");
    await popup(page, "No recovery codes").waitFor({ timeout: 30000 });
    ok(!!folderByName("Config") && children(folderByName("Config").id).some((f) => f.name === "config.json"), "generation failed during setup: account still created, mandatory popup shown");
    await popup(page, "No recovery codes").locator("button", { hasText: "Generate now" }).click();
    await clickModal(page, "Could not generate recovery codes", "OK");
    await popup(page, "No recovery codes").waitFor();
    ok(true, "  still failing: error, popup comes back");
    global.failRecoveryUploads = false;
    await Promise.all([page.waitForEvent("download"), popup(page, "No recovery codes").locator("button", { hasText: "Generate now" }).click()]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    ok(recoveryFiles().length === 10, "  works once Drive is OK: 10 codes, app usable");
    pw = "Fresh1234";
    await logout(page);
    drive.clear();
    await login(page);
    await page.fill("#su-pwd", "Fresh5678"); await page.fill("#su-pwd2", "Fresh5678");
    await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForSelector("#file-select"); await page.waitForTimeout(500);
    ok(recoveryFiles().length === 10 && await page.locator(".modal-backdrop").count() === 0, "normal setup: 10 codes downloaded, no popup");
    pw = "Fresh5678";

    console.log("Search popup + auto-logout");
    await page.click("#tb-search"); await page.waitForSelector(".search-input");
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 10 * 60 * 1000; });
    await page.mouse.move(30, 30);
    await page.waitForSelector("#login-btn", { timeout: 5000 });
    ok(await page.locator(".search-modal").count() === 0, "search popup (note names) is closed by the auto-logout");

    ok(page.cspViolations.length === 0, "no CSP violations");
    await browser.close();
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
