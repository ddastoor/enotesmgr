// Core flows: setup, unlock, notes, recovery codes, wall-clock session timeout, CSP, mobile image popup.
// Usage: node app-core.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, BASE, FOLDER, drive, children, folderByName, parseMultipart, driveLog, driveRoute, GIS_STUB,
    ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, recoveryFiles, readDownload,
} = require("./lib/harness.cjs");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
    const browser = await chromium.launch();

    console.log("1. New user setup with recovery codes");
    let page = await newPage(browser);
    await login(page);
    await page.fill("#su-pwd", "Master123");
    await page.fill("#su-pwd2", "Master123");
    let [dl] = await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    let codes = await readDownload(dl);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    ok(codes.length === 10 && codes.every((c) => /^\d{16}$/.test(c)), "10 x 16-digit codes downloaded (" + dl.suggestedFilename() + ")");
    ok(new Set(codes).size === 10, "codes are unique");
    let rf = recoveryFiles();
    ok(rf.length === 10, "10 recovery files in Drive");
    ok(rf.every((f) => /^recovery-[0-9a-f-]{36}$/.test(f.name)), "recovery file names are random (e.g. " + rf[0].name + ")");
    ok(rf.every((f) => !/^[0-9a-f]{64}$/.test(f.name)), "no sha256-style names");
    ok(rf.every((f) => f.appProperties && f.appProperties.FileType === "recovery" && f.appProperties.CreationMethod === "app"), "recovery metadata intact");

    console.log("2. Create + save a note");
    await page.click("#tb-new");
    await modal(page, "Enter a name").locator("input").fill("bank");
    await clickModal(page, "Enter a name", "OK");
    await page.click("#editor");
    await page.keyboard.type("PIN 4242");
    await page.click("#tb-save");
    await page.waitForTimeout(800);
    const note = [...drive.values()].find((f) => f.name === "bank");
    ok(note && note.content.length > 0 && !note.content.includes("4242"), "note stored encrypted");
    await logout(page);

    console.log("3. Unlock with master password");
    await login(page);
    await unlockInput(page, "Wrong123");
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent.includes("Decryption failed"));
    ok(true, "wrong master password rejected");
    await unlockInput(page, "Master123");
    await onMain(page);
    await page.selectOption("#file-select", "bank");
    await page.waitForFunction(() => document.querySelector("#editor").textContent.includes("PIN 4242"));
    ok(true, "note decrypts after re-login");
    await logout(page);

    console.log("4. Recovery codes");
    await login(page);
    let t0 = Date.now();
    await unlockInput(page, "1234567812345678");
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent === "Invalid recovery code", null, { timeout: 30000 });
    const trialMs = Date.now() - t0;
    ok(true, `unknown code rejected as "Invalid recovery code" (tried all 10 files in ${trialMs} ms)`);
    await unlockInput(page, codes[7]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    await page.fill("#rmp-pwd", "NewPass456");
    await page.fill("#rmp-pwd2", "NewPass456");
    await page.click("#rmp-reset");
    await modal(page, "exhausted").waitFor();
    ok(true, 'reset message: "' + (await modal(page, "exhausted").locator(".modal-text").textContent()).slice(0, 60) + '..."');
    await clickModal(page, "exhausted", "OK");
    await page.waitForSelector("#login-btn");
    ok(recoveryFiles().length === 9, "used code's file deleted (9 left)");
    await login(page);
    await unlockInput(page, "Master123");
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent.includes("Decryption failed"));
    ok(true, "old master password no longer works");
    await unlockInput(page, codes[7]);
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent === "Invalid recovery code", null, { timeout: 30000 });
    ok(true, "used code is exhausted (rejected)");
    await unlockInput(page, "NewPass456");
    await onMain(page);
    await page.selectOption("#file-select", "bank");
    await page.waitForFunction(() => document.querySelector("#editor").textContent.includes("PIN 4242"));
    ok(true, "new master password unlocks, notes intact");
    ok(page.sawReminder === false, "no low-codes reminder with 9 left");

    console.log("5. Generate new codes = a complete new set (Recovery Codes page)");
    await page.click("#btn-more");
    ok(await page.locator('[data-action="restart-reminder"]').count() === 0, "menu no longer has 'Restart Recovery Reminders'");
    await page.click('[data-action="recovery"]');
    ok(await page.locator("#rc-wipe").count() === 0 && await page.locator("#rc-replace").count() === 0, "only one button: no Wipe, no separate Replace");
    await page.click("#rc-generate");
    [dl] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Generate 10 new recovery codes", "OK")]);
    const codes2 = await readDownload(dl);
    const savePopup = modal(page, "Recovery codes downloaded");
    ok((await savePopup.textContent()).includes("previous 9 recovery codes stop working"), "save popup: says the previous 9 codes stop working");
    ok(recoveryFiles().length === 19, "until you confirm, old and new codes both exist (19)");
    const [dl2] = await Promise.all([page.waitForEvent("download"), savePopup.locator("button", { hasText: "Download again" }).click()]);
    ok((await readDownload(dl2)).join() === codes2.join(), "'Download again' downloads the same codes");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    ok(recoveryFiles().length === 10, "after 'I've saved them': exactly the 10 new codes (all in the downloaded file)");
    await page.click("#rc-done");
    await onMain(page);
    await logout(page);
    await login(page);
    await unlockInput(page, codes[2]);
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent === "Invalid recovery code", null, { timeout: 30000 });
    ok(true, "an old code no longer works");
    await unlockInput(page, codes2[4]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    ok(true, "a new code works");
    await page.click("#rmp-cancel");
    await page.waitForSelector("#login-btn");
    ok(recoveryFiles().length === 10, "cancelling the reset does not use up the code");
    const codes3 = codes2;
    // 0 codes can no longer be reached from the app; simulate it to check the message still works.
    const saved = recoveryFiles().map((f) => ({ ...f }));
    saved.forEach((f) => drive.delete(f.id));
    await login(page);
    await unlockInput(page, codes3[0]);
    await modal(page, "out of luck").waitFor();
    ok(true, '"out of luck" message when no codes are left');
    await clickModal(page, "out of luck", "OK");
    await page.waitForSelector("#login-btn");
    saved.forEach((f) => drive.set(f.id, f));

    console.log("6. CSP");
    ok(page.cspViolations.length === 0, "no CSP violations during all of the above" + (page.cspViolations.length ? ": " + page.cspViolations[0] : ""));
    await login(page);
    await unlockInput(page, "NewPass456");
    await onMain(page);
    // A note whose HTML carries an inline event handler (e.g. pasted from a web page).
    await page.click("#tb-new");
    await modal(page, "Enter a name").locator("input").fill("evil");
    await clickModal(page, "Enter a name", "OK");
    await page.evaluate(() => { document.querySelector("#editor").innerHTML = '<img src="x" onerror="window.__pwned=1">hi'; });
    await page.click("#tb-save");
    await page.waitForTimeout(500);
    await page.click("#tb-refresh");
    await page.waitForTimeout(800);
    ok(!(await page.evaluate(() => window.__pwned)), "script inside a note's HTML is blocked");

    console.log("7. Session timeout (wall clock)");
    await page.evaluate(() => { const real = Date.now; window.__shift = 0; Date.now = () => real() + window.__shift; });
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    ok(await page.locator("#file-select").count() === 1, "normal activity keeps you logged in");
    await page.evaluate(() => { window.__shift = 6 * 60 * 1000; }); // "slept" 6 min, timers didn't run
    await page.mouse.move(50, 50);
    await page.waitForSelector("#login-btn", { timeout: 3000 }).then(() => ok(true, "after 6 min asleep, first mouse move logs out"), () => ok(false, "after 6 min asleep, first mouse move logs out"));
    await login(page);
    await unlockInput(page, "NewPass456");
    await onMain(page);
    await page.evaluate(() => { const real = Date.now; window.__shift = 0; Date.now = () => real() + window.__shift; });
    await page.evaluate(() => { window.__shift = 6 * 60 * 1000; window.dispatchEvent(new Event("focus")); });
    await page.waitForSelector("#login-btn", { timeout: 3000 }).then(() => ok(true, "returning to the tab after the timeout logs out"), () => ok(false, "returning to the tab after the timeout logs out"));
    await page.context().close();

    console.log("8. Normal timer still fires (fake clock)");
    {
        const ctxPage = await newPage(browser);
        await ctxPage.clock.install();
        await ctxPage.reload();
        await login(ctxPage);
        await unlockInput(ctxPage, "NewPass456");
        await onMain(ctxPage);
        await ctxPage.clock.fastForward("04:50");
        ok(await ctxPage.locator("#file-select").count() === 1, "still logged in at 4:50 idle");
        await ctxPage.clock.fastForward("00:20");
        await ctxPage.waitForSelector("#login-btn", { timeout: 3000 }).then(() => ok(true, "logged out at 5:10 idle (timeout 300 s)"), () => ok(false, "logged out at 5:10 idle"));
        await ctxPage.context().close();
    }

    console.log("9. Mobile image popup (with CSP disabled, to test the code fix on its own)");
    {
        const mp = await newPage(browser, { viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true, bypassCSP: true });
        await login(mp);
        await unlockInput(mp, "NewPass456");
        await onMain(mp);
        await mp.selectOption("#file-select", "bank");
        await mp.waitForFunction(() => document.querySelector("#editor").textContent.includes("PIN"));
        await mp.evaluate(() => {
            document.querySelector("#editor").innerHTML = `<span class="media-embed"><img style="width:60px;height:60px;display:block" src='data:image/png,x" onerror="window.opener.__pwned=1'></span>`;
        });
        await mp.click("#tb-save");
        await mp.waitForTimeout(500);
        await mp.click("#tb-refresh");
        await mp.waitForTimeout(800);
        const [popup] = await Promise.all([mp.waitForEvent("popup"), mp.locator(".media-embed img").first().click()]);
        await popup.waitForTimeout(500);
        const info = await popup.evaluate(() => ({ title: document.title, imgs: document.images.length, onerror: document.images[0] && document.images[0].hasAttribute("onerror") }));
        ok(info.imgs === 1 && info.title === "Image", "popup shows the image");
        ok(!info.onerror && !(await mp.evaluate(() => window.__pwned)), "crafted image URL can't inject code into the popup");
        await mp.context().close();
    }

    await browser.close();
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
