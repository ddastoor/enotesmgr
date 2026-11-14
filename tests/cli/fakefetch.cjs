// Preload: replaces fetch with an in-memory fake Google Drive (the API the CLI
// uses). Reads are served from FAKE_DRIVE; files that '-m import' creates are
// added and written back to FAKE_DRIVE, so a test can inspect them afterwards.
// FAKE_FAIL_CREATE="name1,name2": creating a file with one of these names fails.
// FAKE_EMAIL: the account's e-mail address (default tester@gmail.com).
const fs = require("fs");
const files = JSON.parse(fs.readFileSync(process.env.FAKE_DRIVE, "utf8"));
const failCreate = new Set((process.env.FAKE_FAIL_CREATE || "").split(",").filter(Boolean));
let created = 0;
// FAKE_HIDE_ONCE="name1,name2": the first lookup of each name comes back empty
// (a simulated momentary Drive miss), later lookups find it.
const hideOnce = new Set((process.env.FAKE_HIDE_ONCE || "").split(",").filter(Boolean));
const FOLDER = "application/vnd.google-apps.folder";
// For '-m rotate' (everything below is off unless a test switches it on):
// FAKE_SETUP_TREE: a JSON list of items = an account freshly set up in the app (a
//   new config.json, settings, recovery files, an empty Entries folder). The token
//   NEWTOKEN is then accepted too: as soon as it is used while the account has no
//   'eNotes Manager' folder (it was wiped), that tree is added - as if the user had
//   set the account up again in the app and copied a new export token.
// FAKE_NEW_EMAIL: the e-mail address NEWTOKEN belongs to (default: FAKE_EMAIL).
// FAKE_FAIL_DELETE=1 / FAKE_FAIL_UPDATE=1: deleting / updating a file fails.
// Deleting a folder deletes everything in it; deletes and updates are written back.
const save = () => fs.writeFileSync(process.env.FAKE_DRIVE, JSON.stringify(files));
const isManager = (f) => f.name === "eNotes Manager" && f.mimeType === FOLDER && f.parents.includes("appDataFolder");
const multipart = (opts) => {
  const ctype = (opts.headers || {})["Content-Type"] || (opts.headers || {})["content-type"] || "";
  const boundary = /boundary=(.+)$/.exec(ctype)[1];
  const parts = String(opts.body).split("--" + boundary).slice(1, -1).map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));
  return { meta: JSON.parse(parts[0]), content: parts[1] };
};
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const h = opts.headers || {};
  const auth = h.Authorization || h.authorization;
  const newToken = auth === "Bearer NEWTOKEN" && process.env.FAKE_SETUP_TREE;
  if (auth !== "Bearer GOODTOKEN" && !newToken) return new Response("unauthorized", { status: 401 });
  if (newToken && !files.some(isManager)) { files.push(...JSON.parse(fs.readFileSync(process.env.FAKE_SETUP_TREE, "utf8"))); save(); }
  let mm;
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
  if (u.pathname === "/drive/v3/about") return json({ user: { emailAddress: (newToken && process.env.FAKE_NEW_EMAIL) || process.env.FAKE_EMAIL || "tester@gmail.com", displayName: "Test User" } });
  if ((mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)) && opts.method === "DELETE") {
    if (process.env.FAKE_FAIL_DELETE) return json({ error: "injected failure" }, 500);
    if (!files.some((f) => f.id === mm[1])) return json({ error: "not found" }, 404);
    const gone = new Set([mm[1]]);
    for (let grew = true; grew;) { grew = false; for (const f of files) if (!gone.has(f.id) && f.parents.some((p) => gone.has(p))) { gone.add(f.id); grew = true; } }
    for (let i = files.length - 1; i >= 0; i--) if (gone.has(files[i].id)) files.splice(i, 1);
    save();
    return new Response(null, { status: 204 });
  }
  if ((mm = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)) && opts.method === "PATCH") {
    if (process.env.FAKE_FAIL_UPDATE) return json({ error: "injected failure" }, 500);
    const f = files.find((x) => x.id === mm[1]);
    if (!f) return json({ error: "not found" }, 404);
    const { meta, content } = multipart(opts);
    f.content = content;
    if (meta.appProperties) f.appProperties = { ...(f.appProperties || {}), ...meta.appProperties };
    save();
    return json({ id: f.id, name: f.name });
  }
  if (u.pathname === "/upload/drive/v3/files" && (opts.method || "GET") === "POST") {
    const ctype = h["Content-Type"] || h["content-type"] || "";
    const boundary = /boundary=(.+)$/.exec(ctype)[1];
    const parts = String(opts.body).split("--" + boundary).slice(1, -1).map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));
    const meta = JSON.parse(parts[0]);
    if (failCreate.has(meta.name)) return json({ error: "injected failure" }, 500);
    const f = { id: "created" + (++created) + "-" + Math.random().toString(36).slice(2, 8), name: meta.name, parents: meta.parents || [], mimeType: meta.mimeType, content: parts[1] };
    if (meta.appProperties) f.appProperties = meta.appProperties;
    files.push(f);
    fs.writeFileSync(process.env.FAKE_DRIVE, JSON.stringify(files));
    return json({ id: f.id, name: f.name });
  }
  if (u.pathname === "/drive/v3/files") {
    const q = u.searchParams.get("q");
    const parent = /'([^']+)' in parents/.exec(q)[1];
    const nm = /name='((?:\\.|[^'\\])*)'/.exec(q);
    const name = nm ? nm[1].replace(/\\(.)/g, "$1") : null;
    const folderOnly = q.includes("mimeType='" + FOLDER + "'");
    if (name !== null && hideOnce.delete(name)) {
      return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const out = files.filter((f) => f.parents.includes(parent) && (name === null || f.name === name) && (!folderOnly || f.mimeType === FOLDER))
      .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, appProperties: f.appProperties }));
    return new Response(JSON.stringify({ files: out }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if ((mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)) && u.searchParams.get("alt") === "media") {
    const f = files.find((x) => x.id === mm[1]);
    return f ? new Response(f.content, { status: 200 }) : new Response("nf", { status: 404 });
  }
  return new Response("unhandled", { status: 500 });
};
