// Master password rules on setup and reset (e.g. not exactly 16 digits).
// Usage: node password-rules.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, BASE, FOLDER, drive, children, folderByName, parseMultipart, driveLog, driveRoute, GIS_STUB,
    ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, recoveryFiles, readDownload,
} = require("./lib/harness.cjs");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
    const browser = await chromium.launch();
    const page = await newPage(browser);
    const errText = (sel) => page.textContent(sel);
    console.log("Setup page");
    await login(page);
    for (const bad of ["1234567890123456", "0000000000000000"]) {
        await page.fill("#su-pwd", bad); await page.fill("#su-pwd2", bad); await page.click("#su-finish");
        ok((await errText("#su-error")).includes("can't be exactly 16 digits"), `rejects "${bad}"`);
    }
    ok(recoveryFilesSafe() === 0, "nothing was created in Drive");
    for (const fine of ["12345678901234567", "123456789012345", "1234567890123456x"]) {
        // same validator, check without submitting: only the error text matters
        await page.fill("#su-pwd", fine); await page.fill("#su-pwd2", fine + "-mismatch"); await page.click("#su-finish");
        ok((await errText("#su-error")).includes("do not match"), `"${fine}" passes the format rules (17 digits / 15 digits / digits+letter)`);
    }
    await page.fill("#su-pwd", "Master123"); await page.fill("#su-pwd2", "Master123");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    const codes = fs.readFileSync(await dl.path(), "utf8").trim().split("\n");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    ok(true, "normal password still sets up fine");
    await logout(page);
    console.log("Reset page (after a recovery code)");
    await login(page);
    await unlockInput(page, codes[0]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    await page.fill("#rmp-pwd", "9999999999999999"); await page.fill("#rmp-pwd2", "9999999999999999"); await page.click("#rmp-reset");
    ok((await errText("#rmp-error")).includes("can't be exactly 16 digits"), "reset rejects 16 digits");
    ok(recoveryFiles().length === 10, "code not used up by the rejected attempt");
    await page.fill("#rmp-pwd", "NewPass456"); await page.fill("#rmp-pwd2", "NewPass456"); await page.click("#rmp-reset");
    await clickModal(page, "exhausted", "OK");
    await page.waitForSelector("#login-btn");
    await login(page); await unlockInput(page, "NewPass456"); await onMain(page);
    ok(true, "reset to a normal password and log in with it");
    await browser.close();
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
function recoveryFilesSafe() { const r = folderByName("Recovery"); return r ? recoveryFiles().length : 0; }
