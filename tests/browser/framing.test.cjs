// Clickjacking protection: the app must refuse to run inside another site's frame.
// Usage: node framing.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium } = require("playwright");
const http = require("http");

const BASE = process.argv[2];
let failures = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) failures++; };

(async () => {
    // A "hostile" page on a different local origin that frames the app. (A real
    // server, not a Playwright route: Chromium blocks a fake public page from
    // framing localhost.)
    const evil = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<h1>Win a prize!</h1><iframe src="${BASE}" width="800" height="600"></iframe>`);
    });
    await new Promise((resolve) => evil.listen(0, "127.0.0.1", resolve));
    const evilUrl = `http://127.0.0.1:${evil.address().port}/`;

    const browser = await chromium.launch();
    try {
        const ctx = await browser.newContext();
        await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
        await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
        const page = await ctx.newPage();

        await page.goto(BASE);
        await page.waitForSelector("#login-btn");
        ok(true, "opened directly: login page shows normally");

        await page.goto(evilUrl);
        await page.waitForTimeout(1500);
        const frame = page.frames().find((f) => f.url().startsWith(BASE));
        ok(!!frame, "the hostile page loaded the app in an iframe");
        if (frame) {
            const txt = await frame.evaluate(() => document.body.textContent);
            ok(txt.includes("can't be shown inside another website"), "inside another site's iframe: shows the warning");
            ok(await frame.locator("#login-btn").count() === 0, "inside another site's iframe: no login button, app does not start");
        }
    } finally {
        await browser.close();
        evil.close();
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
    process.exitCode = failures ? 1 : 0;
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
