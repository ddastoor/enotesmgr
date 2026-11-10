// Shared harness for the browser test suites: an in-memory fake Google Drive
// (served to the page by intercepting www.googleapis.com), a stub for Google
// sign-in (GIS), and page helpers. No real Google account is ever touched.
// Each suite is run as: node <suite>.test.cjs <baseUrl>  (see ../../run-all.mjs)
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.argv[2];
const FOLDER = "application/vnd.google-apps.folder";

// ---------------- fake Google Drive ----------------
const drive = new Map(); // id -> {id,name,mimeType,parents,appProperties,content}
let idc = 0;
const newId = () => "f" + (++idc).toString(36) + Math.random().toString(36).slice(2, 8);
const children = (pid) => [...drive.values()].filter((f) => f.parents.includes(pid));
const pub = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, appProperties: f.appProperties });
function delTree(id) { children(id).forEach((c) => delTree(c.id)); drive.delete(id); }
function folderByName(name) { return [...drive.values()].find((f) => f.name === name && f.mimeType === FOLDER); }
function parseMultipart(body, ctype) {
    const boundary = /boundary=(.+)$/.exec(ctype)[1];
    const parts = body.split("--" + boundary).slice(1, -1).map((p) => {
        const i = p.indexOf("\r\n\r\n");
        return p.slice(i + 4).replace(/\r\n$/, "");
    });
    return { meta: JSON.parse(parts[0]), content: parts[1] };
}
// File versions, like Drive keeps them: every content write adds one; the last
// is the head. id -> [{ id, size, content }]. Kept apart from `drive` so the
// suites' Drive dumps are unchanged.
const revisions = new Map();
let revc = 0;
function addRevision(f) {
    const list = revisions.get(f.id) || [];
    list.push({ id: "r" + (++revc), size: Buffer.byteLength(f.content || ""), content: f.content });
    revisions.set(f.id, list);
}
const revisionsOf = (id) => revisions.get(id) || [];
let driveCalls = 0;
const driveLog = []; // every Drive request (method + decoded URL)
async function driveRoute(route) {
    driveCalls++;
    const req = route.request();
    driveLog.push(req.method() + ' ' + decodeURIComponent(req.url()));
    const url = new URL(req.url());
    const m = req.method();
    const auth = req.headers()["authorization"] || "";
    const json = (obj, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(obj) });
    if (!auth.startsWith("Bearer fake-token")) return json({ error: "unauthorized" }, 401);
    // Failure injection, switched on by the suites via global flags.
    if (global.failUploads && m === "POST" && url.pathname === "/upload/drive/v3/files") return json({ error: "injected failure" }, 500);
    if (global.failConfigWrite && m === "PATCH" && url.pathname.startsWith("/upload/drive/v3/files/")) return json({ error: "injected failure" }, 500);
    if (global.failRecoveryUploads && m === "POST" && url.pathname === "/upload/drive/v3/files") {
        const { meta } = parseMultipart(req.postData(), req.headers()["content-type"]);
        const rec = folderByName("Recovery");
        if (rec && (meta.parents || []).includes(rec.id)) return json({ error: "injected failure" }, 500);
    }
    if (global.failDeletes && m === "DELETE") return json({ error: "injected failure" }, 500);
    if (global.failRevisions && url.pathname.includes("/revisions")) return json({ error: "injected failure" }, 500);
    const p = url.pathname;
    let mm;
    if (p === "/drive/v3/about") return json({ user: { emailAddress: "tester@gmail.com", displayName: "Test User" } });
    if (p === "/drive/v3/files" && m === "GET") {
        const q = url.searchParams.get("q");
        const parent = /'([^']+)' in parents/.exec(q)[1];
        const nm = /name='((?:\\.|[^'\\])*)'/.exec(q);
        const name = nm ? nm[1].replace(/\\(.)/g, "$1") : null;
        const folderOnly = q.includes("mimeType='" + FOLDER + "'");
        // Simulated Drive glitch: global.hideLookups = { "<name>": n } makes the next
        // n name lookups for <name> come back empty although the item exists.
        if (name !== null && global.hideLookups && global.hideLookups[name] > 0) {
            global.hideLookups[name]--;
            return json({ files: [] });
        }
        const files = children(parent).filter((f) => (name === null || f.name === name) && (!folderOnly || f.mimeType === FOLDER));
        return json({ files: files.map(pub) });
    }
    if (p === "/drive/v3/files" && m === "POST") {
        const meta = JSON.parse(req.postData());
        const f = { id: newId(), name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], appProperties: meta.appProperties, content: "" };
        drive.set(f.id, f);
        return json({ id: f.id, name: f.name });
    }
    if ((mm = /^\/drive\/v3\/files\/([^/]+)\/revisions$/.exec(p)) && m === "GET") {
        if (!drive.get(mm[1])) return json({ error: "not found" }, 404);
        return json({ revisions: revisionsOf(mm[1]).map((r) => ({ id: r.id, size: String(r.size) })) });
    }
    if ((mm = /^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/.exec(p)) && m === "DELETE") {
        const list = revisionsOf(mm[1]);
        const i = list.findIndex((r) => r.id === mm[2]);
        if (i === -1) return json({ error: "not found" }, 404);
        if (i === list.length - 1) return json({ error: "cannot delete the head revision" }, 403);
        list.splice(i, 1);
        return route.fulfill({ status: 204, body: "" });
    }
    if ((mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(p))) {
        const f = drive.get(mm[1]);
        if (!f) return json({ error: "not found" }, 404);
        if (m === "GET" && url.searchParams.get("alt") === "media") return route.fulfill({ status: 200, contentType: "text/plain", body: f.content });
        if (m === "GET" && url.searchParams.get("fields") === "headRevisionId") {
            const list = revisionsOf(f.id);
            return json(list.length ? { headRevisionId: list[list.length - 1].id } : {});
        }
        if (m === "PATCH") { Object.assign(f, { name: JSON.parse(req.postData()).name }); return json({ id: f.id, name: f.name }); }
        if (m === "DELETE") { delTree(f.id); return route.fulfill({ status: 204, body: "" }); }
    }
    if (p === "/upload/drive/v3/files" && m === "POST") {
        const { meta, content } = parseMultipart(req.postData(), req.headers()["content-type"]);
        const f = { id: newId(), name: meta.name, mimeType: meta.mimeType, parents: meta.parents, appProperties: meta.appProperties, content };
        drive.set(f.id, f);
        addRevision(f);
        return json({ id: f.id, name: f.name });
    }
    if ((mm = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)) && m === "PATCH") {
        const f = drive.get(mm[1]);
        if (!f) return json({ error: "not found" }, 404);
        if (url.searchParams.get("uploadType") === "media") f.content = req.postData();
        else {
            const { meta, content } = parseMultipart(req.postData(), req.headers()["content-type"]);
            f.content = content;
            f.appProperties = { ...(f.appProperties || {}), ...(meta.appProperties || {}) };
        }
        addRevision(f);
        return json({ id: f.id, name: f.name });
    }
    console.log("UNHANDLED drive call", m, req.url());
    return json({ error: "unhandled" }, 500);
}

const GIS_STUB = `window.google = { accounts: { oauth2: { initTokenClient(cfg) {
  const c = { callback: cfg.callback, requestAccessToken() { setTimeout(() => c.callback({ access_token: "fake-token-1" }), 10); } };
  return c; } } } };`;

// ---------------- helpers ----------------
let failures = 0;
const ok = (c, msg) => { console.log((c ? "  PASS " : "  FAIL ") + msg); if (!c) failures++; };

async function newPage(browser, opts = {}) {
    const ctx = await browser.newContext({ acceptDownloads: true, ...opts });
    await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "application/javascript", body: GIS_STUB }));
    await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
    await ctx.route("https://www.googleapis.com/**", driveRoute);
    const page = await ctx.newPage();
    page.cspViolations = [];
    page.on("console", (msg) => { if (/Content Security Policy/i.test(msg.text())) page.cspViolations.push(msg.text()); });
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
    await page.goto(BASE);
    return page;
}
const modal = (page, text) => page.locator(".modal-card").filter({ hasText: text });
async function clickModal(page, text, label) {
    const m = modal(page, text);
    await m.waitFor();
    await m.locator(".modal-actions button", { hasText: label }).click();
}
async function login(page) {
    await page.click("#login-btn");
    await page.waitForSelector("#mp-input, #su-pwd");
}
async function unlockInput(page, value) {
    await page.fill("#mp-input", value);
    await page.press("#mp-input", "Enter");
}
async function onMain(page) {
    await page.waitForSelector("#file-select", { timeout: 20000 });
    await page.waitForTimeout(400); // let the low-codes reminder (if any) appear
    const r = page.locator(".modal-card").filter({ hasText: "recovery codes left" });
    if (await r.count()) { page.sawReminder = true; await r.locator(".modal-actions button", { hasText: "Later" }).click(); }
    else page.sawReminder = false;
}
async function logout(page) { await page.click("#btn-logout"); await page.waitForSelector("#login-btn"); }
const recoveryFiles = () => children(folderByName("Recovery").id).filter((f) => !f.name.startsWith("one-or-no"));
async function readDownload(dl) { return fs.readFileSync(await dl.path(), "utf8").trim().split("\n"); }

function finish() {
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
    process.exitCode = failures ? 1 : 0;
}

module.exports = {
    chromium, fs, BASE, FOLDER, drive, children, folderByName, parseMultipart, driveLog, driveRoute, GIS_STUB,
    revisionsOf, ok, finish, newPage, modal, clickModal, login, unlockInput, onMain, logout, recoveryFiles, readDownload,
};
