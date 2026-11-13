// Features: uploads/downloads, rename, search, save prompts, settings, menu; Argon2 used for every recovery file; secrets wiped from WASM memory.
// Usage: node features.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, BASE, FOLDER, drive, children, folderByName, parseMultipart, driveLog, driveRoute, GIS_STUB,
    ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, recoveryFiles, readDownload, openSearch,
} = require("./lib/harness.cjs");
const path = require("path");
const { pathToFileURL } = require("url");

// Count and time every WASM decrypt/encrypt call, and track WASM memory size.
const WASM_PROBE = `
(() => {
  const orig = WebAssembly.instantiate;
  window.__probe = { dec: [], enc: 0 };
  WebAssembly.instantiate = async (...a) => {
    const r = await orig(...a);
    const ex = r.instance.exports;
    const wrapped = Object.assign({}, ex, {
      decrypt_sym: (...x) => { const t = performance.now(); const v = ex.decrypt_sym(...x);
        window.__probe.dec.push({ ms: performance.now() - t, ok: v >= 0 }); return v; },
      encrypt_sym: (...x) => { window.__probe.enc++; return ex.encrypt_sym(...x); },
    });
    window.__probe.mem = () => ex.memory.buffer.byteLength;
    window.__probe.find = (str) => {
      const m = new Uint8Array(ex.memory.buffer), b = new TextEncoder().encode(str);
      for (let i = m.indexOf(b[0]); i !== -1 && i <= m.length - b.length; i = m.indexOf(b[0], i + 1)) {
        let k = 1; while (k < b.length && m[i + k] === b[k]) k++;
        if (k === b.length) return true;
      }
      return false;
    };
    return { module: r.module, instance: { exports: wrapped } };
  };
})();`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const TXT = Buffer.from("just some text, no magic number");

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
    await ctx.addInitScript(WASM_PROBE);
    await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "application/javascript", body: GIS_STUB }));
    await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
    await ctx.route("https://www.googleapis.com/**", driveRoute);
    const page = await ctx.newPage();
    const csp = [], errs = [];
    page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(BASE);
    const status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });

    console.log("A. Setup (no codes) + rich text note");
    await login(page);
    await page.fill("#su-pwd", "Master123"); await page.fill("#su-pwd2", "Master123");
    await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    await page.click("#tb-new");
    await modal(page, "Enter a name").locator("input").fill("bank");
    await clickModal(page, "Enter a name", "OK");
    await page.click("#editor"); await page.keyboard.type("PIN 4242 ");
    await page.setInputFiles("#hidden-ins-image", { name: "a.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector("#editor .media-embed img");
    await page.setInputFiles("#hidden-ins-audio", { name: "a.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("ID3fakeaudio") });
    await page.waitForSelector("#editor .media-embed audio");
    await page.keyboard.press("Control+s"); await status();
    await page.click("#tb-refresh"); await status();
    await page.waitForSelector("#editor .media-embed img");
    ok(await page.locator("#editor .media-embed audio").count() === 1 && (await page.textContent("#editor")).includes("PIN 4242"), "rich text with inserted image + audio saves and reloads");

    console.log("B. Uploads (image / pdf / unknown)");
    for (const [name, mime, buf] of [["pic.png", "image/png", PNG], ["doc.pdf", "application/pdf", PDF], ["notes.txt", "text/plain", TXT]]) {
        await page.setInputFiles("#hidden-upload", { name, mimeType: mime, buffer: buf });
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name); await status();
        const ft = [...drive.values()].find((f) => f.name === name).appProperties.FileType;
        const shown = await page.evaluate(() => {
            const v = document.querySelector("#media-viewer");
            return v.hidden ? "editor" : v.querySelector("img") ? "image" : v.textContent.trim();
        });
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#tb-download")]);
        const same = Buffer.compare(fs.readFileSync(await dl.path()), buf) === 0;
        ok(same, `upload ${name}: FileType=${ft}, shown as "${shown}", download returns identical bytes`);
    }
    const [dlr] = await Promise.all([page.waitForEvent("download"), (async () => { await page.selectOption("#file-select", "bank"); await status(); await page.click("#tb-download"); })()]);
    ok(dlr.suggestedFilename() === "bank.html" && fs.readFileSync(await dlr.path(), "utf8").includes("PIN 4242"), "rich text note downloads as bank.html");

    console.log("C. Rename / search / unsaved-changes prompt / delete");
    await page.selectOption("#file-select", "pic.png"); await status();
    await page.click("#tb-rename");
    await modal(page, "new name").locator("input").fill("photo.png");
    await clickModal(page, "new name", "OK"); await status();
    ok([...drive.values()].some((f) => f.name === "photo.png") && await page.inputValue("#file-select") === "photo.png", "rename");
    await openSearch(page);
    await page.fill(".search-input", "ban"); await page.press(".search-input", "Enter"); await page.keyboard.press("Enter"); await status();
    ok(await page.inputValue("#file-select") === "bank", "search selects the note");
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" extra");
    await page.click("#tb-new");
    await modal(page, "Enter a name").locator("input").fill("second");
    await clickModal(page, "Enter a name", "OK");
    await clickModal(page, "save the current note", "Yes"); await status();
    await page.waitForFunction(() => document.querySelector("#file-select").value === "second");
    await page.selectOption("#file-select", "bank"); await status();
    ok((await page.textContent("#editor")).includes("extra"), "New with unsaved edits offers to save, and Yes saves");
    await page.selectOption("#file-select", "notes.txt"); await status();
    await page.click("#tb-delete");
    await clickModal(page, "cannot be undone", "OK"); await status();
    ok(![...drive.values()].some((f) => f.name === "notes.txt"), "delete");

    console.log("C2. Save prompt when switching notes from the dropdown");
    const editorText = () => page.textContent("#editor");
    const typeInBank = async (t) => { await page.selectOption("#file-select", "bank"); await status(); await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(t); };
    // Yes -> saved
    await typeInBank(" YES1");
    await page.selectOption("#file-select", "second");
    await clickModal(page, "save the current note", "Yes"); await status();
    ok(await page.inputValue("#file-select") === "second", "Yes: switches to the picked note");
    await page.selectOption("#file-select", "bank"); await status();
    ok((await editorText()).includes("YES1"), "Yes: edits were saved");
    // No -> discarded
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" NO2");
    await page.selectOption("#file-select", "second");
    await clickModal(page, "save the current note", "No"); await status();
    await page.selectOption("#file-select", "bank"); await status();
    ok(!(await editorText()).includes("NO2"), "No: edits were discarded");
    // Cancel -> stay, dropdown reverted, edits kept
    await page.click("#editor"); await page.keyboard.press("End"); await page.keyboard.type(" CANCEL3");
    await page.selectOption("#file-select", "second");
    await clickModal(page, "save the current note", "Cancel");
    ok(await page.inputValue("#file-select") === "bank" && (await editorText()).includes("CANCEL3"), "Cancel: stays on the note, dropdown put back, edits kept");
    // via search -> same prompt
    await openSearch(page);
    await page.fill(".search-input", "second"); await page.press(".search-input", "Enter"); await page.keyboard.press("Enter");
    await clickModal(page, "save the current note", "Yes"); await status();
    await page.selectOption("#file-select", "bank"); await status();
    ok((await editorText()).includes("CANCEL3"), "search selection gets the same prompt (Yes saved)");
    // no unsaved edits -> no prompt
    await page.selectOption("#file-select", "second"); await status();
    await page.waitForTimeout(300);
    ok(await modal(page, "save the current note").count() === 0 && await page.inputValue("#file-select") === "second", "no edits: switches without a prompt");
    // uploaded file (not "new") -> no prompt
    await page.selectOption("#file-select", "photo.png"); await status();
    await page.selectOption("#file-select", "bank"); await status();
    await page.waitForTimeout(300);
    ok(await modal(page, "save the current note").count() === 0, "switching away from an uploaded file: no prompt");

    console.log("D. Settings / shortcuts / menu");
    await page.click("#btn-settings");
    await page.fill("#set-timeout", "120"); await page.selectOption("#set-theme", "Dark");
    await page.click("#set-save"); await onMain(page);
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "settings save: dark theme applied");
    await page.click("body", { position: { x: 5, y: 5 } }); await page.keyboard.press("Escape");
    await page.keyboard.press("?");
    ok(await modal(page, "Keyboard shortcuts").count() === 1, "? opens keyboard shortcuts help");
    await page.keyboard.press("Escape");
    await page.click("#btn-more");
    const [dlx] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="dl-export"]')]);
    ok(fs.readFileSync(await dlx.path(), "utf8").startsWith("#!/usr/bin/env node"), "menu: Download Export Utility");
    await page.click("#btn-more");
    await page.click('[data-action="copy-token"]');
    await clickModal(page, "Export token", "OK");
    ok(await page.evaluate(() => navigator.clipboard.readText()) === "fake-token-1", "menu: Copy Export Token");

    console.log("E. Is Argon2 (slow) used for EVERY recovery file?");
    await page.click("#btn-more"); await page.click('[data-action="recovery"]');
    await page.click("#rc-generate");   // a new set: exactly 10 codes for the count checks below
    const [dlc] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Generate 10 new recovery codes", "OK")]);
    const codes = fs.readFileSync(await dlc.path(), "utf8").trim().split("\n");
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    await page.click("#rc-done"); await onMain(page);
    await logout(page); await login(page);
    await page.evaluate(() => { window.__probe.dec = []; });
    driveLog.length = 0;
    await unlockInput(page, "1234567812345678");
    await page.waitForFunction(() => document.querySelector("#mp-error").textContent === "Invalid recovery code", null, { timeout: 30000 });
    let p = await page.evaluate(() => ({ dec: window.__probe.dec, mem: window.__probe.mem() }));
    const recFolder = folderByName("Recovery").id;
    const nameQueries = driveLog.filter((l) => l.includes("name='") && l.includes(recFolder));
    const downloads = driveLog.filter((l) => l.includes("alt=media"));
    console.log("     wrong code -> decrypt calls:", p.dec.length, " ms each:", p.dec.map((d) => Math.round(d.ms)).join(", "));
    console.log("     WASM memory:", Math.round(p.mem / 1048576), "MiB;  recovery files downloaded:", downloads.length, "; lookups by file name:", nameQueries.length);
    ok(p.dec.length === 10 && p.dec.every((d) => !d.ok), "wrong code: tried to decrypt all 10 recovery files, all failed");
    ok(p.dec.every((d) => d.ms > 50), "every attempt took a full slow key derivation (each >50 ms, not microseconds)");
    ok(p.mem >= 64 * 1048576, "WASM memory >= 64 MiB (Argon2id memory cost)");
    ok(nameQueries.length === 0, "no lookup by file name (no code -> file mapping)");
    await page.evaluate(() => { window.__probe.dec = []; });
    await unlockInput(page, codes[6]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    p = await page.evaluate(() => window.__probe.dec);
    console.log("     valid code -> decrypt calls:", p.length, "(stops at the matching file)");
    ok(p.length >= 1 && p.length <= 10 && p[p.length - 1].ok && p.slice(0, -1).every((d) => !d.ok), "valid code: tries files until one decrypts, then stops");
    await page.click("#rmp-cancel");

    console.log("G. Spellcheck off + secrets not left in WASM memory");
    await login(page);
    await unlockInput(page, "Master123");
    await onMain(page);
    await page.selectOption("#file-select", "bank"); await status();
    await page.waitForFunction(() => document.querySelector("#editor").textContent.includes("PIN 4242"));
    ok(await page.getAttribute("#editor", "spellcheck") === "false", "editor has spellcheck=\"false\"");
    const leftovers = await page.evaluate(() => ({ pw: window.__probe.find("Master123"), note: window.__probe.find("PIN 4242"), mb: Math.round(window.__probe.mem() / 1048576) }));
    ok(!leftovers.pw, `master password not left in WASM memory (${leftovers.mb} MiB searched)`);
    ok(!leftovers.note, "decrypted note text not left in WASM memory");

    console.log("F. Errors");
    ok(csp.length === 0, "no CSP violations" + (csp[0] ? ": " + csp[0] : ""));
    ok(errs.length === 0, "no JavaScript errors" + (errs[0] ? ": " + errs[0] : ""));
    await browser.close();
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    process.exit(2); // exit even if a browser is still open
});
