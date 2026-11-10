// Self-hosted font: the app never contacts Google Fonts, loads Nunito from its
// own site (files untampered: SHA-256 as recorded in www/fonts/SOURCE.md), the
// CSP no longer allows Google Fonts - and (needs internet, else skipped) text
// renders pixel-identical to Google Fonts' live Nunito.
// Usage: node fonts.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, BASE, ok, finish, newPage, login, onMain } = require("./lib/harness.cjs");
const path = require("path");
const crypto = require("crypto");

const WWW = path.join(__dirname, "..", "..", "www");
const GOOGLE_CSS = "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap";
const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const isGoogleFonts = (url) => /fonts\.(googleapis|gstatic)\.com/.test(url);

// Sample text in every weight and script the font covers (Latin, Latin-ext,
// Cyrillic, Vietnamese), added to the page for the rendering checks.
const SAMPLE = `(() => {
  const d = document.createElement("div"); d.id = "font-sample";
  d.style.cssText = "position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#000;padding:12px;font-family:Nunito;font-size:22px;line-height:1.3;width:900px";
  for (const w of [400, 600, 700, 800]) {
    const p = document.createElement("div"); p.style.fontWeight = w;
    p.textContent = w + " eNotesMgr - The quick brown fox 0123456789 café ĞŁŒ Привет Tiếng Việt";
    d.appendChild(p);
  }
  document.body.appendChild(d);
})()`;

(async () => {
    console.log("1. The app uses its own copy of the font");
    {
        const browser = await chromium.launch();
        const page = await newPage(browser);
        const google = [], fontResponses = [];
        page.on("request", (r) => { if (isGoogleFonts(r.url())) google.push(r.url()); });
        page.on("response", (r) => { if (/\/fonts\/nunito-[a-z-]+\.woff2$/.test(r.url())) fontResponses.push([r.url(), r.status()]); });
        await page.reload();
        await page.evaluate(SAMPLE);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const loaded = await page.evaluate(() => [400, 600, 700, 800].every((w) => document.fonts.check(`${w} 16px Nunito`)));
        ok(loaded, "Nunito is loaded in all four weights (400/600/700/800)");
        ok(fontResponses.length > 0 && fontResponses.every(([u, s]) => u.startsWith(BASE) && s === 200),
            "font files come from the app's own site: " + fontResponses.map(([u]) => path.basename(u)).join(", "));
        await login(page);
        await page.fill("#su-pwd", "Master123"); await page.fill("#su-pwd2", "Master123");
        await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
        await page.locator(".modal-card").filter({ hasText: "Recovery codes downloaded" }).locator("button", { hasText: "I've saved them" }).click();
        await onMain(page);
        ok(google.length === 0, "no request to Google Fonts (login page, setup, main page)" + (google[0] ? ": " + google[0] : ""));
        ok(page.cspViolations.length === 0, "no CSP violations");
        await browser.close();
    }

    console.log("2. Security policy and files");
    const html = fs.readFileSync(path.join(WWW, "index.html"), "utf8");
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    ok(!isGoogleFonts(csp) && /font-src 'self'/.test(csp), "CSP allows fonts only from the app itself (no Google Fonts hosts)");
    ok(!isGoogleFonts(html.replace(/<!--[\s\S]*?-->/g, "")), "index.html doesn't link Google Fonts");
    const css = fs.readFileSync(path.join(WWW, "css", "fonts.css"), "utf8");
    const referenced = [...new Set([...css.matchAll(/url\(\.\.\/fonts\/([^)]+)\)/g)].map((m) => m[1]))];
    const source = fs.readFileSync(path.join(WWW, "fonts", "SOURCE.md"), "utf8");
    const recorded = Object.fromEntries([...source.matchAll(/\| `([^`]+\.woff2)` \| \d+ \| `([0-9a-f]{64})` \|/g)].map((m) => [m[1], m[2]]));
    ok(referenced.length === 5 && !/https?:/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "fonts.css uses only the 5 local files");
    const mismatched = referenced.filter((f) => recorded[f] !== crypto.createHash("sha256").update(fs.readFileSync(path.join(WWW, "fonts", f))).digest("hex"));
    ok(mismatched.length === 0, "every font file matches its SHA-256 in www/fonts/SOURCE.md" + (mismatched.length ? ": " + mismatched.join(", ") : ""));
    ok(fs.existsSync(path.join(WWW, "fonts", "OFL.txt")) && fs.readFileSync(path.join(WWW, "fonts", "OFL.txt"), "utf8").includes("SIL Open Font License"), "font licence (OFL) included");

    console.log("3. Looks identical to Google Fonts' Nunito (needs internet)");
    {
        const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
        try {
            const probe = await browser.newContext(proxy ? { ignoreHTTPSErrors: true } : {});
            let googleCss = null;
            try {
                const r = await probe.request.get(GOOGLE_CSS, { headers: { "User-Agent": CHROME_UA }, timeout: 15000 });
                if (r.ok()) googleCss = await r.text();
            } catch { /* offline */ }
            if (!googleCss) {
                console.log("  SKIP Google Fonts not reachable from here (no internet?) - rendering not compared");
            } else {
                const shot = async (useGoogle) => {
                    const ctx = await browser.newContext({ viewport: { width: 1000, height: 400 }, ...(proxy ? { ignoreHTTPSErrors: true } : {}), ...(useGoogle ? { bypassCSP: true } : {}) });
                    await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
                    if (useGoogle) await ctx.route("**/css/fonts.css", (r) => r.fulfill({ contentType: "text/css", body: googleCss }));
                    const p = await ctx.newPage();
                    await p.goto(BASE);
                    await p.waitForSelector("#login-btn");
                    await p.evaluate(SAMPLE);
                    await p.evaluate(() => document.fonts.ready);
                    await p.waitForTimeout(500);
                    const img = await p.locator("#font-sample").screenshot();
                    await ctx.close();
                    return img;
                };
                const mine = await shot(false), theirs = await shot(true);
                const sameFiles = Object.keys(recorded).length === 5 &&
                    [...googleCss.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].every((m) => source.includes(m[1]));
                if (Buffer.compare(mine, theirs) === 0) ok(true, "self-hosted rendering is pixel-identical to Google Fonts' (all weights, all scripts)");
                else if (!sameFiles) console.log("  NOTE Google Fonts now serves a newer Nunito than the self-hosted copy; run src/fonts-vendor/fetch-fonts.mjs to update (not a failure)");
                else ok(false, "self-hosted rendering differs from Google Fonts' although the files are the same");
            }
        } finally {
            await browser.close();
        }
    }
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
