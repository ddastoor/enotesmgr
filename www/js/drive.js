// Thin wrapper over the Google Drive REST API (v3). All content we store is
// already-encrypted base64 text, saved with mimeType text/plain.

import { state } from "./state.js";
import { DRIVE_SPACES } from "./lib/driveConfig.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function authHeaders(extra = {}) {
    return { Authorization: `Bearer ${state.accessToken}`, ...extra };
}

async function driveFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`Drive API error ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
    }
    return res;
}

// Returns the authenticated user's info { displayName, emailAddress }.
export async function getUserInfo() {
    const res = await driveFetch(`${API}/about?fields=user`, { headers: authHeaders() });
    const data = await res.json();
    return data.user || {};
}

function escapeQuery(name) {
    return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Find a non-trashed child of parentId by exact name. Returns {id,name,appProperties}
// or null. appProperties holds the file's metadata (see note-meta-data.md).
export async function findChild(parentId, name, folderOnly = false) {
    let q = `name='${escapeQuery(name)}' and '${parentId}' in parents and trashed=false`;
    if (folderOnly) q += ` and mimeType='${FOLDER_MIME}'`;
    const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,appProperties)&spaces=${DRIVE_SPACES}`;
    const res = await driveFetch(url, { headers: authHeaders() });
    const data = await res.json();
    return data.files && data.files.length ? data.files[0] : null;
}

// List all non-trashed children of parentId. Returns [{id,name,mimeType,appProperties}].
export async function listChildren(parentId) {
    const out = [];
    let pageToken = null;
    do {
        const q = `'${parentId}' in parents and trashed=false`;
        let url = `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,appProperties)&pageSize=1000&spaces=${DRIVE_SPACES}`;
        if (pageToken) url += `&pageToken=${pageToken}`;
        const res = await driveFetch(url, { headers: authHeaders() });
        const data = await res.json();
        (data.files || []).forEach((f) => out.push(f));
        pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
}

export async function createFolder(name, parentId) {
    const metadata = { name, mimeType: FOLDER_MIME };
    if (parentId) metadata.parents = [parentId];
    const res = await driveFetch(`${API}/files?fields=id,name`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(metadata),
    });
    return res.json();
}

export async function ensureFolder(name, parentId) {
    const existing = await findChild(parentId, name, true);
    if (existing) return existing.id;
    const created = await createFolder(name, parentId);
    return created.id;
}

// Download a file's text content by id.
export async function downloadText(fileId) {
    const res = await driveFetch(`${API}/files/${fileId}?alt=media`, { headers: authHeaders() });
    return res.text();
}

// Build a multipart/related body carrying JSON metadata + the text content.
function multipartBody(metadata, content) {
    const boundary = "enotes_boundary_" + Math.random().toString(36).slice(2);
    const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `${content}\r\n` +
        `--${boundary}--`;
    return { boundary, body };
}

// Create a new text file with the given content under parentId. Returns {id,name}.
// appProperties (optional) is the file's metadata (see note-meta-data.md), stored
// clear-text as Drive custom file properties.
export async function createTextFile(name, content, parentId, appProperties = null) {
    const metadata = { name, parents: [parentId], mimeType: "text/plain" };
    if (appProperties) metadata.appProperties = appProperties;
    const { boundary, body } = multipartBody(metadata, content);
    const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
        body,
    });
    return res.json();
}

// Replace the content of an existing file by id. When appProperties is given the
// metadata is updated in the same request (a multipart update); Drive merges the
// supplied appProperties keys, leaving other existing keys untouched.
export async function updateTextFile(fileId, content, appProperties = null) {
    if (!appProperties) {
        const res = await driveFetch(`${UPLOAD}/files/${fileId}?uploadType=media&fields=id,name`, {
            method: "PATCH",
            headers: authHeaders({ "Content-Type": "text/plain" }),
            body: content,
        });
        return res.json();
    }
    const { boundary, body } = multipartBody({ appProperties }, content);
    const res = await driveFetch(`${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,name`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
        body,
    });
    return res.json();
}

// Remembers the Drive file id of each (parentId, name) we've upserted this
// session. Drive allows two files with the same name in one folder, and its
// name-query index is only eventually consistent (a just-created file can be
// briefly invisible to a name lookup). Without this cache, a second upsert of
// the same logical file (e.g. config.json) could miss the first one and create a
// DUPLICATE. Caching the id and always updating it guarantees every later write
// re-writes the exact same file under the same name - never a renamed/duplicate
// copy. Keyed by parentId (a Drive-global-unique folder id, so keys never
// collide across users); cleared on logout via clearFileIdCache().
const upsertIdCache = new Map();
const upsertKey = (parentId, name) => `${parentId} ${name}`;

export function clearFileIdCache() {
    upsertIdCache.clear();
}

// Create the file if absent, otherwise overwrite the SAME existing file (by id).
// Never creates a renamed/duplicate copy of a file it has already written.
// metaProps.create is the full metadata written on first creation;
// metaProps.update is the (partial) metadata merged when overwriting (see
// note-meta-data.md) - it should omit DateTimeCreated so that key is preserved.
export async function upsertTextFile(name, content, parentId, metaProps = {}) {
    const key = upsertKey(parentId, name);

    // Prefer the id we already know for this file this session; only fall back
    // to a name lookup when we haven't written it yet.
    let id = upsertIdCache.get(key);
    if (!id) {
        const existing = await findChild(parentId, name);
        if (existing) id = existing.id;
    }

    if (id) {
        await updateTextFile(id, content, metaProps.update || null);
        upsertIdCache.set(key, id);
        return { id, name };
    }

    const created = await createTextFile(name, content, parentId, metaProps.create || null);
    upsertIdCache.set(key, created.id);
    return created;
}

export async function renameFile(fileId, newName) {
    const res = await driveFetch(`${API}/files/${fileId}?fields=id,name`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: newName }),
    });
    return res.json();
}

export async function deleteFile(fileId) {
    await driveFetch(`${API}/files/${fileId}`, { method: "DELETE", headers: authHeaders() });
}
