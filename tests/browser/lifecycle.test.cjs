// Everything together, with every kind of note: the app and every mode of the export CLI, one after another
// on the same notes, made from REAL sample files (tests/lib/media.cjs: JPEG, PNG, animated GIF, WebP; MP3, WAV,
// Ogg, M4A clips; MP4 and WebM videos; a two-page PDF; a text file, a web page, binary data). The notes are
// made in the app - rich text (text only; text with pictures; text with audio clips; text, pictures and clips
// all mixed up, a video among them; pictures only; clips only; pictures and clips; empty) and uploads (every
// sample, a picture also without an extension), as normal or as sensitive notes. At the start every note is
// checked against its sample files (every picture decodes at its size, every clip plays for its length, each
// is byte for byte its sample by SHA-256, an upload downloads as exactly its file), and the app's own Download
// of each is the truth every step is compared with, by SHA-256 - and in the app the same checks again:
//   1. '-m on' (online, decrypted): every note = the app's Download; a sensitive note comes out still locked
//      (<name>.sensitive, no plaintext) and '-m sensitive' opens it to exactly the app's Download;
//   2. '-m on -x' (the encrypted copy) is Drive byte for byte; '-m off' on that copy (the whole folder, and
//      every note on its own) = the same; '-m sensitive' on its output = the app's Downloads;
//   3. '-m export', a second account set up in the app, '-m import': in the app the second account's notes
//      show, open and download exactly as the first account's;
//   4. '-m rotate' on the second account (the app sets it up again in between, with a NEW master password):
//      in the app every note is still exactly the same;
//   5. after the rotation: '-m on', and '-m on -x' + '-m off' with the new master password = the same again.
// Parts (ENOTES_TEST_PART, see lifecycle.test.parts.mjs): rich text / uploaded pictures and clips / uploaded
// videos and documents, each normal and sensitive, and one account with all of them mixed - each the whole
// chain. Usage: node lifecycle.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const { chromium, fs, drive, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout } = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const M = require("../lib/media.cjs");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FAKEFETCH = path.join(ROOT, "tests", "cli", "fakefetch.cjs");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-lifecycle-"));
const PREFIX = "<<eNotesMgr-sensitive-note-v1>>";
const MASTER_A = "MasterA123", MASTER_B = "MasterB456", MASTER_C = "MasterC789";
const EMAIL = "tester@gmail.com"; // the CLI's fake Drive account
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");

// The notes of each group: rich text notes (made by typing and inserting pictures / clips) and uploads.
const rich = (r) => ({ ...r, kind: "new" });
const upload = (u) => ({ ...u, kind: "upload" });
const isAV = (u) => ["image", "audio"].includes(M.MEDIA[u.file].type);
const GROUPS = {
    rich: M.RICH.map(rich),
    "uploads-media": M.UPLOADS.filter(isAV).map(upload), // pictures and audio clips (the app shows them)
    "uploads-files": M.UPLOADS.filter((u) => !isAV(u)).map(upload), // videos, PDF, text, web page, binary
};
const sensitive = (n, i) => ({ ...n, name: "s-" + n.name, pw: `NotePass${i}x` });
// One account with normal and sensitive notes of every sort side by side.
const MIXED = [
    rich(M.RICH.find((r) => r.name === "text+pictures+audio")),
    sensitive(rich(M.RICH.find((r) => r.name === "text+pictures+audio")), 1),
    upload(M.UPLOADS.find((u) => u.name === "photo.jpg")),
    sensitive(rich(M.RICH.find((r) => r.name === "text")), 3),
    sensitive(upload(M.UPLOADS.find((u) => u.name === "movie.mp4")), 4),
    upload(M.UPLOADS.find((u) => u.name === "doc.pdf")),
    sensitive(upload(M.UPLOADS.find((u) => u.name === "voice.mp3")), 6),
    rich(M.RICH.find((r) => r.name === "empty")),
    sensitive(upload(M.UPLOADS.find((u) => u.name === "data.bin")), 8),
    upload(M.UPLOADS.find((u) => u.name === "notes.txt")),
];
const notesOf = (part) => {
    if (part === "mixed") return MIXED;
    const group = part.replace(/-sensitive$/, "");
    return part.endsWith("-sensitive") ? GROUPS[group].map(sensitive) : GROUPS[group];
};

// Run the CLI in `cwd` (a new folder if none), optionally on a dump of the fake Drive.
function cli(args, input, { driveFile = "", cwd = null } = {}) {
    const dir = cwd || fs.mkdtempSync(path.join(WORK, "run-"));
    const pre = driveFile ? ["-r", FAKEFETCH] : [];
    const r = spawnSync(process.execPath, [...pre, CLI, ...args], { cwd: dir, input, encoding: "utf8", timeout: 5 * 60 * 1000, env: { ...process.env, FAKE_DRIVE: driveFile, FAKE_EMAIL: EMAIL } });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), cwd: dir };
}
const folderIn = (dir, prefix) => { const d = fs.readdirSync(dir).find((x) => x.startsWith(prefix)); return d ? path.join(dir, d) : null; };
// The files directly in a folder -> SHA-256 of each.
const shasIn = (dir) => (dir ? Object.fromEntries(fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, sha(fs.readFileSync(path.join(dir, f)))])) : {});
const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

(async () => {
    globalThis.__CRYPTO_WASM_BYTES__ = fs.readFileSync(path.join(ROOT, "www/js/crypto/crypto.wasm")).toString("base64");
    const C = await import(pathToFileURL(path.join(ROOT, "www/js/crypto/crypto.js")).href);
    await C.cryptoReady;
    const E = await import(pathToFileURL(path.join(ROOT, "www/js/lib/noteExport.js")).href);
    const fileByName = (n) => [...drive.values()].find((f) => f.name === n);
    const fpOf = (master) => JSON.parse(C.decryptData(fileByName("config.json").content, master)).file_password;
    const tryDec = (c, p) => { try { return C.decryptData(c, p); } catch { return null; } };
    const { PARTS } = await import(pathToFileURL(path.join(__dirname, "lifecycle.test.parts.mjs")).href);
    const PART = process.env.ENOTES_TEST_PART || "";
    if (PART && !PARTS.includes(PART)) { console.error(`ENOTES_TEST_PART must be one of ${PARTS.join(", ")} (or unset), not '${PART}'`); process.exit(2); }
    const browser = await chromium.launch();

    for (const part of PARTS) {
        if (PART && PART !== part) continue;
        const NOTES = notesOf(part);
        const ANY_SENS = NOTES.some((n) => n.pw);
        drive.clear();
        console.log(`\n=== ${part}: ${NOTES.map((n) => n.name).join(", ")} ===`);
        const page = await newPage(browser);
        const status = () => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });
        const waitSel = (n) => page.waitForFunction((x) => document.querySelector("#file-select").value === x, n);
        const fillPw = async (m, a, b) => { const i = m.locator("input[type=password]"); await i.nth(0).fill(a); if (b !== undefined) await i.nth(1).fill(b); };
        const editorHtml = () => page.evaluate(() => {
            const c = document.getElementById("editor").cloneNode(true);
            c.querySelectorAll(".embed-del").forEach((e) => e.remove());
            c.querySelectorAll(".media-embed.selected").forEach((e) => e.classList.remove("selected"));
            return c.innerHTML;
        });
        const open = async (name, pw) => {
            await page.selectOption("#file-select", name);
            if (await modal(page, "save the current note").count()) await clickModal(page, "save the current note", "No");
            if (pw) { const m = modal(page, "is a sensitive note"); await m.waitFor(); await fillPw(m, pw); await clickModal(page, "is a sensitive note", "Unlock"); }
            await waitSel(name); await status();
        };
        const download = async (name, pw) => {
            await open(name, pw);
            const [d] = await Promise.all([page.waitForEvent("download"), (async () => {
                await page.click("#tb-download");
                if (pw) await clickModal(page, "will NOT be encrypted", "OK");
            })()]);
            return { filename: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
        };
        const setup = async (master) => {
            await login(page);
            await page.waitForSelector("#su-pwd", { timeout: 30000 });
            await page.fill("#su-pwd", master); await page.fill("#su-pwd2", master);
            await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
            await clickModal(page, "Recovery codes downloaded", "I've saved them");
            await onMain(page);
        };
        const dumpDrive = (name) => { const f = path.join(WORK, `${part}-${name}.json`); fs.writeFileSync(f, JSON.stringify([...drive.values()])); return f; };
        const loadDrive = (f) => { const t = JSON.parse(fs.readFileSync(f, "utf8")); drive.clear(); t.forEach((x) => drive.set(x.id, x)); };
        // In the app (logged in): every note shows, opens and downloads exactly as the truth.
        const labelsNow = async (n) => {
            await page.waitForFunction((k) => [...document.querySelectorAll("#file-select option")].filter((o) => o.textContent).length >= k, n, { timeout: 30000 }).catch(() => {});
            return page.$$eval("#file-select option", (os) => os.map((o) => o.textContent).filter(Boolean));
        };
        const checkInApp = async (label, master) => {
            await login(page); await unlockInput(page, master); await onMain(page);
            const labels = await labelsNow(NOTES.length);
            ok(JSON.stringify(labels) === JSON.stringify(truthLabels), `${label}: in the app, the same note list (padlocks included)`);
            const prints = [], off = [];
            for (const n of NOTES) {
                const d = await download(n.name, n.pw);
                const l = await M.look(page), html = n.kind === "new" ? await editorHtml() : null;
                prints.push(`${n.name} ${l.view} [${M.looksOf(l)}] ${html === null ? "-" : sha(html)} ${d.filename} ${sha(d.bytes)}`);
                const why = M.vsSamples(n, l, d); if (why) off.push(why);
            }
            ok(JSON.stringify(prints) === JSON.stringify(truthPrints), `${label}: in the app every note shows, opens and downloads EXACTLY as at the start (view, every picture / clip, content, Download by SHA-256) - ${NOTES.length} notes` +
                (JSON.stringify(prints) === JSON.stringify(truthPrints) ? "" : `\n      now:    ${prints.join("\n              ")}\n      before: ${truthPrints.join("\n              ")}`));
            ok(off.length === 0, `${label}: every note is still exactly its real sample files (pictures decode at their sizes, clips play for their lengths, uploads download byte for byte)` + (off.length ? `\n      ${off.join("\n      ")}` : ""));
            await logout(page);
        };

        // ---- 0. The notes, made in the app; the truth = the app's own Download of each ----
        console.log("0. The notes, made in the app from real sample files");
        const lab = await browser.newPage();
        const notReal = await M.checkRealInBrowser(lab);
        await lab.close();
        ok(notReal.length === 0 && M.checkRealPdf(), "the sample files are real: every picture decodes at its size, every audio / video clip plays for its length, the PDF has its 2 pages and their text" + (notReal.length ? `\n      ${notReal.join("\n      ")}` : ""));
        await setup(MASTER_A);
        for (const n of NOTES) {
            if (n.kind === "upload") {
                const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click(n.pw ? "#tb-upload-sensitive" : "#tb-upload")]);
                await fc.setFiles({ name: n.name, mimeType: n.mime, buffer: M.MEDIA[n.file].bytes });
            } else {
                await page.click(n.pw ? "#tb-new-sensitive" : "#tb-new");
                const m = modal(page, n.pw ? "new sensitive note" : "Enter a name for the new note");
                await m.locator("input").fill(n.name); await m.locator(".modal-actions button", { hasText: "OK" }).click();
            }
            if (n.pw) { const m = modal(page, "Choose an extra password"); await m.waitFor(); await fillPw(m, n.pw, n.pw); await clickModal(page, "Choose an extra password", "Create"); }
            await waitSel(n.name); await status();
            if (n.kind === "new" && n.body.length) { await M.writeBody(page, n.body); await page.click("#tb-save"); await status(); }
        }
        const truth = {}, truthPrints = [], off = [];
        for (const n of NOTES) {
            const d = await download(n.name, n.pw);
            const l = await M.look(page), html = n.kind === "new" ? await editorHtml() : null;
            truth[n.name] = d;
            truthPrints.push(`${n.name} ${l.view} [${M.looksOf(l)}] ${html === null ? "-" : sha(html)} ${d.filename} ${sha(d.bytes)}`);
            const why = M.vsSamples(n, l, d); if (why) off.push(why);
        }
        const truthLabels = await labelsNow(NOTES.length);
        ok(truthLabels.length === NOTES.length && NOTES.every((n) => truth[n.name].bytes.length > 0 || n.name.endsWith("empty")), `the app made ${NOTES.length} notes and downloads each`);
        const { pictures, clips } = M.countMedia(NOTES);
        ok(off.length === 0, `in the app every note is exactly its real sample files: ${pictures} picture(s) decode at their sizes, ${clips} clip(s) play for their lengths, each byte for byte its sample (SHA-256), every upload downloads as exactly its file, the text in order` + (off.length ? `\n      ${off.join("\n      ")}` : ""));
        ok([...drive.values()].every((f) => !M.leaks(f.content || "")), "nothing of the samples or the typed text is readable anywhere in Drive (all encrypted)");
        await logout(page);
        const fpA = fpOf(MASTER_A);
        // What the file password unlocks, per note (recorded now, from account A: later steps load other accounts).
        const ENV = Object.fromEntries(NOTES.map((n) => [n.name, C.decryptData(fileByName(n.name).content, fpA)]));
        const envelope = (n) => ENV[n.name];
        ok(NOTES.every((n) => envelope(n).startsWith(PREFIX) === !!n.pw), ANY_SENS ? "in Drive each sensitive note is double encrypted (its note password, then the file password), each other note encrypted with the file password" : "in Drive each note is encrypted with the file password");
        if (ANY_SENS) ok(NOTES.filter((n) => n.pw).every((n) => !M.leaks(envelope(n))), "a sensitive note opened with the file password alone shows nothing of its samples or text");
        // What a decrypting CLI mode must write: a normal note = the app's Download; a sensitive one = <name>.sensitive, still locked.
        const wantExport = {}, wantOpened = {};
        for (const n of NOTES) {
            if (n.pw) wantExport[E.buildNoteExport(n.name, envelope(n)).filename] = sha(envelope(n));
            else wantExport[truth[n.name].filename] = sha(truth[n.name].bytes);
            if (n.pw) wantOpened[truth[n.name].filename] = sha(truth[n.name].bytes);
        }
        const checkExport = (label, dir) => {
            const got = shasIn(dir);
            ok(sorted(got) === sorted(wantExport), `${label}: exactly ${Object.keys(wantExport).length} file(s), ` + (ANY_SENS ? "each sensitive note <name>.sensitive, still locked, each other note identical to the app's Download" : "each identical to the app's Download") + " (by SHA-256)" +
                (sorted(got) === sorted(wantExport) ? "" : `\n      got:  ${sorted(got)}\n      want: ${sorted(wantExport)}`));
            if (ANY_SENS) {
                const locked = Object.keys(got).filter((f) => f.endsWith(".sensitive"));
                ok(locked.length === NOTES.filter((n) => n.pw).length && locked.every((f) => { const b = fs.readFileSync(path.join(dir, f)); return b.toString("utf8").startsWith(PREFIX) && !M.leaks(b); }), `${label}: the .sensitive files hold no plaintext`);
            }
        };
        // '-m sensitive' on an export folder: every note opened = the app's Download.
        const openSensitive = (label, dir) => {
            const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sensitive")).sort();
            const pw = (f) => NOTES.find((n) => E.buildNoteExport(n.name, envelope(n)).filename === f).pw;
            const r = cli(["-m", "sensitive", "-s", dir], files.map(pw).join("\n") + "\n");
            const got = shasIn(folderIn(r.cwd, "eNotes Manager Sensitive_"));
            ok(r.code === 0 && sorted(got) === sorted(wantOpened), `${label} + '-m sensitive': every note opens to EXACTLY the app's Download (by SHA-256)` + (r.code === 0 ? "" : `: ${r.out.slice(-300)}`));
        };
        const checkDecrypting = (label, dir) => { checkExport(label, dir); if (ANY_SENS) openSensitive(label, dir); };

        // ---- 1. '-m on': online, decrypted ----
        console.log("1. '-m on' (online, decrypted)");
        const driveA = dumpDrive("A");
        let r = cli(["-m", "on", "-t", "GOODTOKEN"], `${MASTER_A}\n`, { driveFile: driveA });
        ok(r.code === 0, "'-m on': exit 0" + (r.code === 0 ? "" : `: ${r.out.slice(-300)}`));
        checkDecrypting("'-m on'", folderIn(r.cwd, "eNotes Manager Export_"));

        // ---- 2. '-m on -x' then '-m off' (offline) ----
        console.log("2. '-m on -x' (the encrypted copy), then '-m off' on it, offline");
        r = cli(["-m", "on", "-t", "GOODTOKEN", "-x"], "", { driveFile: driveA });
        const mirror = folderIn(r.cwd, "eNotes Manager_");
        ok(r.code === 0 && mirror && NOTES.every((n) => fs.readFileSync(path.join(mirror, "Entries", E.sanitizeName(n.name)), "utf8") === fileByName(n.name).content) &&
            fs.readFileSync(path.join(mirror, "Config", "config.json"), "utf8") === fileByName("config.json").content, "'-m on -x': every note and config.json byte for byte as in Drive");
        const cfg = path.join(mirror, "Config", "config.json"), ent = path.join(mirror, "Entries");
        r = cli(["-m", "off", "-c", cfg, "-d", ent], `${MASTER_A}\n`);
        ok(r.code === 0, "'-m off' on the copy (whole folder): exit 0");
        checkDecrypting("'-m off' on the copy", folderIn(r.cwd, "eNotes Manager Export_"));
        let each = 0;
        for (const n of NOTES) {
            const one = cli(["-m", "off", "-c", cfg, "-n", path.join(ent, E.sanitizeName(n.name))], `${MASTER_A}\n`);
            const got = shasIn(folderIn(one.cwd, "eNotes Manager Export_"));
            const f = n.pw ? E.buildNoteExport(n.name, envelope(n)).filename : truth[n.name].filename;
            if (one.code === 0 && sorted(got) === sorted({ [f]: wantExport[f] })) each++;
        }
        ok(each === NOTES.length, `'-m off -n', every note on its own: each exactly as expected (${each}/${NOTES.length})`);

        // ---- 3. '-m export' + '-m import' into a second account ----
        console.log("3. '-m export', a second account set up in the app, '-m import'");
        r = cli(["-m", "export"], `GOODTOKEN\n${MASTER_A}\n`, { driveFile: driveA });
        const T = folderIn(r.cwd, "eNotes Manager Transfer_");
        ok(r.code === 0 && T && fs.readdirSync(T).length === NOTES.length, `'-m export': ${NOTES.length} transfer files`);
        drive.clear();
        await setup(MASTER_B);
        await logout(page);
        const driveB = dumpDrive("B");
        r = cli(["-m", "import"], `${T}\n${MASTER_A}\nGOODTOKEN\n${MASTER_B}\ny\n`, { driveFile: driveB });
        ok(r.code === 0 && r.out.includes(`Imported ${NOTES.length} of ${NOTES.length}`), "'-m import': every note added" + (r.code === 0 ? "" : `: ${r.out.slice(-300)}`));
        loadDrive(driveB);
        await checkInApp("after '-m import' into the second account", MASTER_B);

        // ---- 4. '-m rotate' on the second account ----
        console.log("4. '-m rotate' on the second account (the app sets it up again, with a new master password)");
        const rotCwd = fs.mkdtempSync(path.join(WORK, `rotation-${part}-`));
        const fpB = fpOf(MASTER_B);
        const d1 = dumpDrive("B-rot1");
        r = cli(["-m", "rotate"], `GOODTOKEN\n${MASTER_B}\nWIPE ${EMAIL}\n`, { driveFile: d1, cwd: rotCwd });
        loadDrive(d1);
        ok(r.code === 1 && r.out.includes("Deleted.") && !fileByName("eNotes Manager"), "'-m rotate': saved, checked, deleted - waits for the set-up");
        await setup(MASTER_C);
        await logout(page);
        const fpC = fpOf(MASTER_C);
        const d2 = dumpDrive("B-rot2");
        r = cli(["-m", "rotate"], `\n${MASTER_B}\nGOODTOKEN\n${MASTER_C}\n`, { driveFile: d2, cwd: rotCwd });
        loadDrive(d2);
        ok(r.code === 0 && r.out.includes("Rotation finished") && fpC !== fpB, "'-m rotate' again: finished; the file password is new" + (r.code === 0 ? "" : `: ${r.out.slice(-300)}`));
        const entries = [...drive.values()].filter((f) => f.parents.includes(fileByName("Entries").id));
        ok(entries.length === NOTES.length && entries.every((f) => tryDec(f.content, fpB) === null && tryDec(f.content, fpC) !== null), "every note opens with the new file password, none with the old one");
        await checkInApp("after '-m rotate' (new master password)", MASTER_C);

        // ---- 5. The CLI on the rotated account ----
        console.log("5. '-m on', '-m on -x' and '-m off' on the rotated account");
        const driveR = dumpDrive("rotated");
        r = cli(["-m", "on", "-t", "GOODTOKEN"], `${MASTER_C}\n`, { driveFile: driveR });
        ok(r.code === 0, "'-m on' after the rotation: exit 0");
        checkDecrypting("'-m on' after the rotation", folderIn(r.cwd, "eNotes Manager Export_"));
        r = cli(["-m", "on", "-t", "GOODTOKEN", "-x"], "", { driveFile: driveR });
        const mirror2 = folderIn(r.cwd, "eNotes Manager_");
        r = cli(["-m", "off", "-c", path.join(mirror2, "Config", "config.json"), "-d", path.join(mirror2, "Entries")], `${MASTER_C}\n`);
        ok(r.code === 0, "'-m on -x' + '-m off' after the rotation: exit 0");
        checkDecrypting("'-m on -x' + '-m off' after the rotation", folderIn(r.cwd, "eNotes Manager Export_"));
        r = cli(["-m", "off", "-c", cfg, "-d", ent], `${MASTER_A}\n`);
        checkDecrypting("the copy from BEFORE everything, offline, still", folderIn(r.cwd, "eNotes Manager Export_"));

        ok(page.cspViolations.length === 0, "no CSP violations");
        await page.context().close();
    }
    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2);
});
