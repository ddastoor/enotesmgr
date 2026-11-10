// The REAL Google sign-in script (accounts.google.com/gsi/client) loads and opens
// its sign-in popup under the app's Content-Security-Policy, with no CSP
// violations. Needs internet access: skipped (passes with a SKIP note) when
// accounts.google.com can't be reached. Uses HTTPS_PROXY if set.
// The sign-in itself can't complete here (the test page's origin isn't one of the
// OAuth client's authorized origins) - only loading + CSP are checked.
// Usage: node google-signin.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium } = require("playwright");

const BASE = process.argv[2];
let failures = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) failures++; };

(async () => {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
    try {
        const ctx = await browser.newContext(proxy ? { ignoreHTTPSErrors: true } : {});
        // Is Google's sign-in script reachable at all from here?
        let reachable = false;
        try { reachable = (await ctx.request.get("https://accounts.google.com/gsi/client", { timeout: 15000 })).ok(); } catch { /* offline */ }
        if (!reachable) {
            console.log("  SKIP accounts.google.com is not reachable from here (no internet?) - nothing checked");
            return;
        }
        const page = await ctx.newPage();
        const csp = [];
        page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
        await page.goto(BASE);
        await page.waitForSelector("#login-btn");
        const [popup] = await Promise.all([
            ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null),
            page.click("#login-btn"),
        ]);
        await page.waitForTimeout(3000);
        ok(await page.evaluate(() => !!(window.google && google.accounts && google.accounts.oauth2)), "Google's real sign-in script (GIS) loaded under the CSP");
        ok(!!popup && popup.url().startsWith("https://accounts.google.com/"), "the Google sign-in popup opened");
        ok(csp.length === 0, "no CSP violations" + (csp[0] ? ": " + csp[0] : ""));
    } finally {
        await browser.close();
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
    process.exitCode = failures ? 1 : 0;
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
