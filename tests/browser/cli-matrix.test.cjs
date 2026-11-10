// Export CLI x note kinds: every CLI mode run on data made by the current app,
// for plain text notes and notes with embedded images, each both as a normal
// note (file password only = single encrypted) and as a sensitive note (note
// password + file password = double encrypted), plus a normal and a sensitive
// upload. Normal notes must come out readable and byte-for-byte equal to the
// app's own Download; sensitive notes must come out as "<name>.sensitive", still
// locked with their note password (no plaintext, no image data), and decrypt -
// in Node and with the app's "Decrypt Sensitive File" - to exactly the app's
// Download. Modes: online (-t and token prompt), -x mirror, offline directory,
// offline single file, offline interactive wizard (directory and single file),
// Node 18, wrong master password, bad token.
// Usage: node cli-matrix.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, drive, driveLog, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout,
} = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FAKEFETCH = path.join(ROOT, "tests", "cli", "fakefetch.cjs");
const NODE18 = path.join(ROOT, "tests", "cli", "node18sim.cjs");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-cli-matrix-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const PREFIX = "<<eNotesMgr-sensitive-note-v1>>";
const MASTER = "Master123";

// The six notes the app makes. text: what is typed; images: embedded in the text.
const NOTES = [
    { name: "plain-text", sensitive: false, text: "Plain text note PIN 1111 café ✓", images: [] },
    { name: "plain-image", sensitive: false, text: "Plain note with images PIN 3333", images: [["a.png", "image/png", PNG], ["b.gif", "image/gif", GIF]] },
    { name: "secret-text", sensitive: true, pw: "SecretText1", text: "Secret text note PIN 2222 café ✓", images: [] },
    { name: "secret-image", sensitive: true, pw: "SecretImage1", text: "Secret note with images PIN 4444", images: [["a.png", "image/png", PNG], ["b.gif", "image/gif", GIF]] },
    { name: "photo.png", sensitive: false, upload: PNG },
    { name: "secret-photo.png", sensitive: true, pw: "SecretPhoto1", upload: PNG },
];
const outName = (n) => n.sensitive ? n.name + ".sensitive" : (n.upload ? n.name : n.name + ".html");
const ALL_OUT = NOTES.map(outName).sort().join();

function dumpDrive() {
    const file = path.join(WORK, "drive.json");
    fs.writeFileSync(file, JSON.stringify([...drive.values()]));
    return file;
}
// Run the CLI in a fresh folder; returns { code, out, dir, files: {relPath: Buffer}, modes }.
function cli(args, input, { driveFile = null, preload = [], env = {} } = {}) {
    const cwd = fs.mkdtempSync(path.join(WORK, "run-"));
    const pre = [...preload, ...(driveFile ? [FAKEFETCH] : [])].flatMap((p) => ["-r", p]);
    const r = spawnSync(process.execPath, [...pre, CLI, ...args], {
        cwd, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveFile || "", ...env },
    });
    const files = {}, modes = {};
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        const rel = path.relative(cwd, p).replace(/^[^/\\]+[/\\]/, "");
        modes[path.relative(cwd, p)] = fs.statSync(p).mode & 0o777;
        if (e.isDirectory()) walk(p); else files[rel] = fs.readFileSync(p);
    });
    walk(cwd);
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), dir: cwd, files, modes };
}
const isPrivate = (r) => process.platform === "win32" || Object.entries(r.modes).every(([, m]) => m === 0o700 || m === 0o600);

(async () => {
    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;
    const E = await import(pathToFileURL(path.join(ROOT, "www/js/lib/noteExport.js")).href);
    const fileByName = (name) => [...drive.values()].find((f) => f.name === name);

    const browser = await chromium.launch();
    const page = await newPage(browser);
    const status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
    const fillPw = async (m, a, b) => {
        const inputs = m.locator("input[type=password]");
        await inputs.nth(0).fill(a);
        if (b !== undefined) await inputs.nth(1).fill(b);
    };
    const waitSelected = (name) => page.waitForFunction((n) => document.querySelector("#file-select").value === n, name);

    console.log("1. The app makes normal and sensitive notes: text, text + embedded images, uploads");
    await login(page);
    await page.fill("#su-pwd", MASTER); await page.fill("#su-pwd2", MASTER);
    await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    for (const n of NOTES) {
        if (n.upload) {
            const btn = n.sensitive ? "#tb-upload-sensitive" : "#tb-upload";
            const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click(btn)]);
            await fc.setFiles({ name: n.name, mimeType: "image/png", buffer: n.upload });
        } else {
            await page.click(n.sensitive ? "#tb-new-sensitive" : "#tb-new");
            const m = modal(page, n.sensitive ? "new sensitive note" : "Enter a name for the new note");
            await m.locator("input").fill(n.name);
            await m.locator(".modal-actions button", { hasText: "OK" }).click();
        }
        if (n.sensitive) {
            const m = modal(page, "Choose an extra password");
            await m.waitFor(); await fillPw(m, n.pw, n.pw);
            await clickModal(page, "Choose an extra password", "Create");
        }
        await waitSelected(n.name); await status();
        if (!n.upload) {
            await page.click("#editor"); await page.keyboard.type(n.text + " ");
            for (const [fname, mime, buf] of n.images) {
                const before = await page.locator("#editor .media-embed img").count();
                await page.setInputFiles("#hidden-ins-image", { name: fname, mimeType: mime, buffer: buf });
                await page.waitForFunction((c) => document.querySelectorAll("#editor .media-embed img").length > c, before);
            }
            await page.keyboard.type(" end.");
            await page.click("#tb-save"); await status();
        }
    }
    // The app's own Download of every note (sensitive ones: unlocked, after the warning).
    const appDownload = {};
    for (const n of NOTES) {
        await page.selectOption("#file-select", n.name);
        if (n.sensitive) {
            const m = modal(page, "is a sensitive note");
            await m.waitFor(); await fillPw(m, n.pw);
            await clickModal(page, "is a sensitive note", "Unlock");
        }
        await waitSelected(n.name); await status();
        const [d] = await Promise.all([page.waitForEvent("download"), (async () => {
            await page.click("#tb-download");
            if (n.sensitive) await clickModal(page, "will NOT be encrypted", "OK");
        })()]);
        appDownload[n.name] = { filename: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
    }
    await logout(page);
    const FP = JSON.parse(C.decryptData(fileByName("config.json").content, MASTER)).file_password;
    const outer = (n) => C.decryptData(fileByName(n.name).content, FP);
    for (const n of NOTES.filter((x) => !x.upload)) {
        const html = appDownload[n.name].bytes.toString();
        ok(appDownload[n.name].filename === n.name + ".html" && html.includes(n.text)
            && (!n.images.length || (html.includes("data:image/png;base64,") && html.includes("data:image/gif;base64,"))),
            `${n.name}: the app's Download is a readable ${n.name}.html` + (n.images.length ? " with both embedded images" : ""));
    }
    ok(NOTES.every((n) => outer(n).startsWith(PREFIX) === n.sensitive), "Drive: the 3 sensitive notes are double encrypted, the 3 normal ones single encrypted");

    // What every decrypting CLI mode must write for each note.
    const expected = {};
    for (const n of NOTES) expected[outName(n)] = n.sensitive ? Buffer.from(outer(n)) : appDownload[n.name].bytes;
    const plainMarkers = ["PIN 2222", "PIN 4444", "iVBORw0KGgo", "R0lGODlh", "data:image"];
    // Check one CLI run's notes against `expected` (only the notes in `names`).
    const check = (label, r, names = NOTES.map((n) => n.name)) => {
        const want = NOTES.filter((n) => names.includes(n.name)).map(outName).sort();
        const got = Object.keys(r.files).sort();
        ok(r.code === 0 && got.join() === want.join(), `${label}: exit 0, writes exactly ${want.join(", ")}` + (r.code === 0 ? "" : ` (exit ${r.code}: ${r.out.slice(-300)})`));
        ok(want.every((f) => r.files[f] && Buffer.compare(r.files[f], expected[f]) === 0),
            `${label}: normal notes byte-for-byte the app's Download; sensitive notes = their locked envelope`);
        ok(want.filter((f) => f.endsWith(".sensitive")).every((f) => r.files[f].toString().startsWith(PREFIX)
            && plainMarkers.every((m) => !r.files[f].toString().includes(m))), `${label}: .sensitive files hold no plaintext and no image data`);
        const nSens = NOTES.filter((n) => names.includes(n.name) && n.sensitive).length;
        ok(nSens ? r.out.includes(`${nSens} sensitive note(s)`) && r.out.includes("Decrypt Sensitive File") : !r.out.includes("sensitive note(s)"),
            `${label}: ` + (nSens ? `says ${nSens} sensitive note(s) need 'Decrypt Sensitive File'` : "no sensitive-note hint"));
        ok(isPrivate(r), `${label}: output private (folders 700, files 600)`);
    };

    console.log("2. Online mode (-m on)");
    const driveFile = dumpDrive();
    let r = cli(["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { driveFile });
    check("online -t", r);
    const online = r;
    check("online, token pasted at the prompt", cli(["-m", "on"], `  GOODTOKEN  \n${MASTER}\n`, { driveFile }));
    check("online on Node 18 (no global crypto)", cli(["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { driveFile, preload: [NODE18] }));
    r = cli(["-m", "on", "-t", "GOODTOKEN"], "WrongPass9\n", { driveFile });
    ok(r.code === 1 && r.out.includes("Could not decrypt config.json") && !Object.keys(r.files).length, "online, wrong master password: clear error, nothing written");
    r = cli(["-m", "on", "-t", "BADTOKEN"], `${MASTER}\n`, { driveFile });
    ok(r.code === 1 && r.out.includes("rejected the export token"), "online, bad token: clear error");

    console.log("3. Mirror (-m on -x): the Drive tree copied as stored (still encrypted)");
    const mirror = cli(["-m", "on", "-t", "GOODTOKEN", "-x"], "", { driveFile });
    const mroot = fs.readdirSync(mirror.dir).find((d) => d.startsWith("eNotes Manager_"));
    const entriesDir = path.join(mirror.dir, mroot, "Entries");
    const configPath = path.join(mirror.dir, mroot, "Config", "config.json");
    ok(mirror.code === 0 && Object.keys(mirror.files).length === 6 + 2 + 10, `mirror: ${Object.keys(mirror.files).length} files = 6 notes + config + settings + 10 recovery codes`);
    ok(NOTES.every((n) => fs.readFileSync(path.join(entriesDir, n.name), "utf8") === fileByName(n.name).content),
        "mirror: every note file byte-for-byte as stored in Drive (normal: single, sensitive: double encrypted)");
    ok(!mirror.out.includes("sensitive note(s)") && isPrivate(mirror), "mirror: no decryption, no hint; output private");

    console.log("4. Offline mode (-m off) from the mirror");
    check("offline -c -d (whole folder)", cli(["-m", "off", "-c", configPath, "-d", entriesDir], `${MASTER}\n`));
    for (const n of NOTES) {
        check(`offline -c -n ${n.name} (single file)`, cli(["-m", "off", "-c", configPath, "-n", path.join(entriesDir, n.name)], `${MASTER}\n`), [n.name]);
    }
    check("offline wizard, whole folder (default answer)", cli(["-m", "off"], `${configPath}\n\n${entriesDir}\n${MASTER}\n`));
    check("offline wizard, single sensitive file with images", cli(["-m", "off"], `${configPath}\nf\n${path.join(entriesDir, "secret-image")}\n${MASTER}\n`), ["secret-image"]);
    check("offline wizard, single normal file with images", cli(["-m", "off"], `${configPath}\nf\n${path.join(entriesDir, "plain-image")}\n${MASTER}\n`), ["plain-image"]);
    r = cli(["-m", "off", "-c", configPath, "-d", entriesDir], "WrongPass9\n");
    ok(r.code === 1 && r.out.includes("Could not decrypt config.json") && !Object.keys(r.files).length, "offline, wrong master password: clear error, nothing written");

    console.log("4b. Every other option combination, on the app's data");
    const all = NOTES.map((n) => n.name);
    const one = "secret-image"; // a sensitive note with embedded pictures
    const oneFile = path.join(entriesDir, one);
    const bad = path.join(WORK, "does-not-exist");
    check("offline -c -n -d (-d wins)", cli(["-m", "off", "-c", configPath, "-n", oneFile, "-d", entriesDir], `${MASTER}\n`));
    check("offline -c only, wizard 'd'", cli(["-m", "off", "-c", configPath], `d\n${entriesDir}\n${MASTER}\n`));
    check("offline -c only, wizard default", cli(["-m", "off", "-c", configPath], `\n${entriesDir}\n${MASTER}\n`));
    check("offline -c only, wizard 'f'", cli(["-m", "off", "-c", configPath], `f\n${oneFile}\n${MASTER}\n`), [one]);
    check("offline -d only (asks for config.json)", cli(["-m", "off", "-d", entriesDir], `${configPath}\n${MASTER}\n`));
    check("offline -n only (asks for config.json)", cli(["-m", "off", "-n", oneFile], `${configPath}\n${MASTER}\n`), [one]);
    r = cli(["-m", "off", "-c", bad, "-d", entriesDir], `${configPath}\n${MASTER}\n`);
    check("offline, bad -c path (asked again)", r);
    ok(r.out.includes("File not found"), "offline, bad -c path: says 'File not found'");
    check("offline, bad -d path (asked again)", cli(["-m", "off", "-c", configPath, "-d", bad], `${entriesDir}\n${MASTER}\n`));
    check("offline, bad -n path (asked again)", cli(["-m", "off", "-c", configPath, "-n", bad], `${oneFile}\n${MASTER}\n`), [one]);
    check("offline, wizard with wrong paths typed first", cli(["-m", "off"], `${bad}\n${configPath}\nd\n${bad}\n${entriesDir}\n${MASTER}\n`));
    r = cli(["-m", "off"], "\n");
    ok(r.code === 1 && r.out.includes("No path entered") && !Object.keys(r.files).length, "offline, empty path: aborts, nothing written");
    check("offline with -t / -x too (ignored)", cli(["-m", "off", "-c", configPath, "-d", entriesDir, "-t", "GOODTOKEN", "-x"], `${MASTER}\n`));
    check("offline on Node 18", cli(["-m", "off", "-c", configPath, "-d", entriesDir], `${MASTER}\n`, { preload: [NODE18] }));
    const messy = path.join(WORK, "messy");
    fs.cpSync(entriesDir, messy, { recursive: true });
    fs.copyFileSync(configPath, path.join(messy, "config.json"));
    fs.writeFileSync(path.join(messy, "README.txt"), "not a note");
    r = cli(["-m", "off", "-c", configPath, "-d", messy], `${MASTER}\n`);
    check("offline -d, folder also holding non-note files", r);
    ok(r.out.includes("SKIPPED config.json") && r.out.includes("SKIPPED README.txt"), "offline -d: non-note files listed as SKIPPED");
    check("online, '-t' without a value (asks)", cli(["-m", "on", "-t"], `GOODTOKEN\n${MASTER}\n`, { driveFile }));
    check("online with -c / -n / -d too (ignored)", cli(["-m", "on", "-t", "GOODTOKEN", "-c", configPath, "-n", oneFile, "-d", entriesDir], `${MASTER}\n`, { driveFile }));
    check("online, momentary Drive miss", cli(["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { driveFile, env: { FAKE_HIDE_ONCE: "eNotes Manager,Config,Entries,config.json" } }));
    // The app's Drive data plus an empty 2nd tree and an OLDER config.json with
    // another key (listed first): the CLI must still pick the key that opens the
    // notes - it tries their outer (file password) layer, sensitive ones too.
    const tree = JSON.parse(fs.readFileSync(driveFile, "utf8"));
    const cfgFolder = tree.find((f) => f.name === "Config").id;
    tree.unshift({ id: "dupcfg", name: "config.json", parents: [cfgFolder], mimeType: "text/plain",
        content: C.encryptData(JSON.stringify({ file_password: "another-key" }), MASTER), appProperties: { DateTimeCreated: "2020-01-01T00:00" } });
    tree.unshift({ id: "dupE", name: "Entries", parents: ["dupM"], mimeType: "application/vnd.google-apps.folder", content: "" });
    tree.unshift({ id: "dupM", name: "eNotes Manager", parents: ["appDataFolder"], mimeType: "application/vnd.google-apps.folder", content: "" });
    const dupFile = path.join(WORK, "drive-dups.json");
    fs.writeFileSync(dupFile, JSON.stringify(tree));
    check("online, duplicate tree + older config.json with another key", cli(["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { driveFile: dupFile }));
    const noCfg = path.join(WORK, "drive-noconfig.json");
    fs.writeFileSync(noCfg, JSON.stringify(JSON.parse(fs.readFileSync(driveFile, "utf8")).filter((f) => f.name !== "config.json")));
    r = cli(["-m", "on", "-t", "GOODTOKEN"], `${MASTER}\n`, { driveFile: noCfg });
    ok(r.code === 1 && r.out.includes("recovery codes"), "online, config.json missing: points to the recovery-code fix");
    r = cli(["-m", "on"], "\n", { driveFile });
    ok(r.code === 1 && r.out.includes("needs an export token"), "online, empty token: usage error");
    const mirror2 = cli(["-m", "on", "-x"], "GOODTOKEN\n", { driveFile });
    const m2 = fs.readdirSync(mirror2.dir).find((d) => d.startsWith("eNotes Manager_"));
    ok(mirror2.code === 0 && NOTES.every((n) => fs.readFileSync(path.join(mirror2.dir, m2, "Entries", n.name), "utf8") === fileByName(n.name).content),
        "mirror with the token typed at the prompt: every note as stored");
    r = cli(["-m", "on", "-t", "BADTOKEN", "-x"], "", { driveFile });
    ok(r.code === 1 && r.out.includes("rejected the export token"), "mirror, bad token: clear error");
    for (const [label, args] of [["no arguments", []], ["-m bogus", ["-m", "maybe"]]]) {
        r = cli(args, "");
        ok(r.code === 1 && r.out.includes("Usage:") && !Object.keys(r.files).length, `${label}: usage message, exit 1, nothing written`);
    }
    ok(all.length === 6, "(all of the above on the app's 6 notes)");

    console.log("5. The .sensitive files open with their note password (and only with it)");
    for (const n of NOTES.filter((x) => x.sensitive)) {
        const envelope = online.files[outName(n)].toString();
        const payload = envelope.slice(PREFIX.length);
        const content = C.decryptData(payload, n.pw);
        const built = E.buildNoteExport(n.name, content);
        ok(built.filename === appDownload[n.name].filename && Buffer.compare(Buffer.from(built.bytes), appDownload[n.name].bytes) === 0,
            `${n.name}.sensitive + note password -> ${built.filename}, byte-for-byte the app's Download`);
        let refused = 0;
        for (const pw of [MASTER, FP, "WrongPass9"]) { try { C.decryptData(payload, pw); } catch { refused++; } }
        ok(refused === 3, `${n.name}.sensitive: the master password, the file password and a wrong password don't open it`);
    }
    // ... and with the app's PC-only "Decrypt Sensitive File" (no Drive calls).
    await login(page); await unlockInput(page, MASTER); await onMain(page);
    const callsBefore = driveLog.length;
    for (const n of NOTES.filter((x) => x.sensitive)) {
        await page.click("#btn-more");
        const item = page.locator('[data-action="decrypt-sensitive"]');
        await item.waitFor();
        const [fc] = await Promise.all([page.waitForEvent("filechooser"), item.click()]);
        await fc.setFiles({ name: outName(n), mimeType: "application/octet-stream", buffer: online.files[outName(n)] });
        const m = modal(page, "Enter the password of the sensitive note");
        await m.waitFor(); await fillPw(m, n.pw);
        const [d] = await Promise.all([page.waitForEvent("download"), clickModal(page, "Enter the password of the sensitive note", "Decrypt")]);
        const bytes = fs.readFileSync(await d.path());
        ok(d.suggestedFilename() === appDownload[n.name].filename && Buffer.compare(bytes, appDownload[n.name].bytes) === 0,
            `Decrypt Sensitive File: ${outName(n)} -> ${d.suggestedFilename()}, byte-for-byte the app's Download` + (n.images && n.images.length ? " (embedded images included)" : ""));
    }
    ok(driveLog.length === callsBefore, "Decrypt Sensitive File made no Google Drive calls");

    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2);
});
