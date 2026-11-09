// Preload: replaces fetch with an in-memory fake Google Drive (read-only API used by the CLI).
const fs = require("fs");
const files = JSON.parse(fs.readFileSync(process.env.FAKE_DRIVE, "utf8"));
const FOLDER = "application/vnd.google-apps.folder";
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const h = opts.headers || {};
  if ((h.Authorization || h.authorization) !== "Bearer GOODTOKEN") return new Response("unauthorized", { status: 401 });
  let mm;
  if (u.pathname === "/drive/v3/files") {
    const q = u.searchParams.get("q");
    const parent = /'([^']+)' in parents/.exec(q)[1];
    const nm = /name='((?:\\.|[^'\\])*)'/.exec(q);
    const name = nm ? nm[1].replace(/\\(.)/g, "$1") : null;
    const folderOnly = q.includes("mimeType='" + FOLDER + "'");
    const out = files.filter((f) => f.parents.includes(parent) && (name === null || f.name === name) && (!folderOnly || f.mimeType === FOLDER))
      .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }));
    return new Response(JSON.stringify({ files: out }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if ((mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)) && u.searchParams.get("alt") === "media") {
    const f = files.find((x) => x.id === mm[1]);
    return f ? new Response(f.content, { status: 200 }) : new Response("nf", { status: 404 });
  }
  return new Response("unhandled", { status: 500 });
};
