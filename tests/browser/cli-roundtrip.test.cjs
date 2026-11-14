// App -> export CLI consistency: data created by the CURRENT app (notes, uploads,
// renames, deletes, recovery codes, a master-password reset) is exported by the
// CURRENT export CLI (www/enotesmgr-export-cli.js) in every mode, and the CLI's
// files are byte-for-byte what the app's own Download button gives. Made from REAL sample files
// (tests/lib/media.cjs): a picture and an audio clip in a rich text note, an uploaded picture, PDF and video.
// Usage: node cli-roundtrip.test.cjs <baseUrl>   (normally via ../run-all.mjs)
const {
    chromium, fs, drive, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, readDownload,
} = require("./lib/harness.cjs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const M = require("../lib/media.cjs"); // real sample files (tests/fixtures/media)

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "www", "enotesmgr-export-cli.js");
const FAKEFETCH = path.join(ROOT, "tests", "cli", "fakefetch.cjs");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "enotes-roundtrip-"));
// The notes the app ends up with, and the sample each upload is.
const FILES = ["bank.html", "photo.png", "doc.pdf", "movie.mp4"];
const UPLOADED = { "photo.png": "picture.png", "doc.pdf": "doc.pdf", "movie.mp4": "movie.mp4" };

// Write the fake Drive (as the app left it) where the CLI's fake fetch reads it.
function dumpDrive() {
    const file = path.join(WORK, "drive.json");
    fs.writeFileSync(file, JSON.stringify([...drive.values()]));
    return file;
}
// Run the CLI in a fresh folder; returns { code, out, dir, files: {relPath: Buffer} }.
function cli(args, input, driveFile) {
    const cwd = fs.mkdtempSync(path.join(WORK, "run-"));
    const preload = driveFile ? ["-r", FAKEFETCH] : []; // offline mode doesn't touch Drive
    const r = spawnSync(process.execPath, [...preload, CLI, ...args], {
        cwd, input, encoding: "utf8", env: { ...process.env, FAKE_DRIVE: driveFile || "" },
    });
    const files = {};
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else files[path.relative(cwd, p).replace(/^[^/\\]+[/\\]/, "")] = fs.readFileSync(p);
    });
    walk(cwd);
    return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), dir: cwd, files };
}
const status = (page) => page.waitForFunction(() => { const s = document.querySelector(".status-overlay"); return !s || s.style.display === "none"; });

(async () => {
    const browser = await chromium.launch();
    const page = await newPage(browser);

    console.log("1. The app creates real data");
    await login(page);
    await page.fill("#su-pwd", "Master123"); await page.fill("#su-pwd2", "Master123");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#su-finish")]);
    const codes = await readDownload(dl);
    await clickModal(page, "Recovery codes downloaded", "I've saved them");
    await onMain(page);
    const newNote = async (name, text) => {
        await page.click("#tb-new");
        await modal(page, "Enter a name").locator("input").fill(name);
        await clickModal(page, "Enter a name", "OK");
        await page.click("#editor"); await page.keyboard.type(text);
        await page.click("#tb-save"); await status(page);
    };
    await newNote("bank", "PIN 4242 café ✓ ");
    await M.writeBody(page, [M.I("photo.jpg"), M.T(" and a voice clip "), M.A("voice.mp3")]);
    await page.click("#tb-save"); await status(page);
    await newNote("temp", "to be deleted");
    await page.click("#tb-delete"); await clickModal(page, "cannot be undone", "OK"); await status(page);
    for (const [name, f] of [["pic.png", "picture.png"], ["doc.pdf", "doc.pdf"], ["movie.mp4", "movie.mp4"]]) {
        await page.setInputFiles("#hidden-upload", { name, mimeType: M.MEDIA[f].mime, buffer: M.MEDIA[f].bytes });
        await page.waitForFunction((n) => document.querySelector("#file-select").value === n, name); await status(page);
    }
    await page.selectOption("#file-select", "pic.png"); await status(page);
    await page.click("#tb-rename");
    await modal(page, "new name").locator("input").fill("photo.png");
    await clickModal(page, "new name", "OK"); await status(page);
    // The app's own Download of each note, to compare with the CLI byte for byte.
    const appDownload = {};
    for (const name of ["bank", "photo.png", "doc.pdf", "movie.mp4"]) {
        await page.selectOption("#file-select", name); await status(page);
        const [d] = await Promise.all([page.waitForEvent("download"), page.click("#tb-download")]);
        appDownload[d.suggestedFilename()] = fs.readFileSync(await d.path());
    }
    ok(Object.keys(appDownload).join() === FILES.join(), "app created: bank (text + picture + audio clip), photo.png (renamed upload), doc.pdf, movie.mp4; 'temp' deleted");
    ok(Object.entries(UPLOADED).every(([f, sample]) => M.sha(appDownload[f]) === M.MEDIA[sample].sha256), "the app's Download of each upload is exactly the real file (SHA-256)");
    await logout(page);
    let driveFile = dumpDrive();

    console.log("2. Online export (-m on) of the app's data");
    let r = cli(["-m", "on", "-t", "GOODTOKEN"], "Master123\n", driveFile);
    ok(r.code === 0, "CLI succeeds");
    ok(Object.keys(r.files).sort().join() === [...FILES].sort().join(), "exports exactly the 4 notes the app has (deleted one absent, renamed name used)");
    ok(FILES.every((f) => r.files[f] && Buffer.compare(r.files[f], appDownload[f]) === 0),
        "every exported file is byte-for-byte the app's own Download of that note");
    {
        const html = r.files["bank.html"].toString(), jpg = html.indexOf(M.MEDIA["photo.jpg"].b64), mp3 = html.indexOf(M.MEDIA["voice.mp3"].b64);
        ok(html.includes("PIN 4242 café ✓") && jpg > 0 && mp3 > jpg, "bank.html has the text, the inserted picture and the audio clip - byte for byte, in order");
    }
    ok(Object.entries(UPLOADED).every(([f, sample]) => M.sha(r.files[f]) === M.MEDIA[sample].sha256), "uploads come back as the original files (picture, PDF, video by SHA-256)");
    r = cli(["-m", "on", "-t", "GOODTOKEN"], "WrongPass1\n", driveFile);
    ok(r.code === 1 && r.out.includes("Could not decrypt config.json"), "wrong master password: clear error");

    console.log("3. Mirror (-x) of the app's Drive tree, then offline export (-m off) from it");
    r = cli(["-m", "on", "-t", "GOODTOKEN", "-x"], "", driveFile);
    const mirrored = Object.keys(r.files);
    ok(r.code === 0 && mirrored.length === 4 + 2 + 10, `mirror: ${mirrored.length} files = 4 notes + config + settings + 10 recovery codes`);
    ok(mirrored.filter((f) => /Recovery[/\\]recovery-[0-9a-f-]{36}$/.test(f)).length === 10, "recovery files mirrored under their random names");
    const mirrorRoot = fs.readdirSync(r.dir).find((d) => d.startsWith("eNotes Manager_"));
    const off = cli(["-m", "off", "-c", path.join(r.dir, mirrorRoot, "Config", "config.json"), "-d", path.join(r.dir, mirrorRoot, "Entries")], "Master123\n");
    ok(off.code === 0 && FILES.every((f) => off.files[f] && Buffer.compare(off.files[f], appDownload[f]) === 0),
        "offline export from the mirror gives the same files" + (off.code === 0 ? "" : ` (exit ${off.code}: ${off.out.slice(-300)})`));

    console.log("4. After a master-password reset in the app (recovery code)");
    await login(page);
    await unlockInput(page, codes[3]);
    await page.waitForSelector("#rmp-pwd", { timeout: 30000 });
    await page.fill("#rmp-pwd", "NewPass789"); await page.fill("#rmp-pwd2", "NewPass789"); await page.click("#rmp-reset");
    await clickModal(page, "Master password reset", "OK");
    await page.waitForSelector("#login-btn");
    driveFile = dumpDrive();
    r = cli(["-m", "on", "-t", "GOODTOKEN"], "NewPass789\n", driveFile);
    ok(r.code === 0 && FILES.every((f) => r.files[f] && Buffer.compare(r.files[f], appDownload[f]) === 0),
        "CLI works with the NEW master password, same files");
    r = cli(["-m", "on", "-t", "GOODTOKEN"], "Master123\n", driveFile);
    ok(r.code === 1, "and the OLD master password no longer works in the CLI either");

    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
    finish();
})().catch((e) => {
    console.error("HARNESS ERROR", e);
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
    process.exit(2); // exit even if a browser is still open
});
