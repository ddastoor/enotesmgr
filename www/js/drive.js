// Thin wrapper over the Google Drive REST API (v3). All content we store is
// already-encrypted base64 text, saved with mimeType text/plain.

import { state } from "./state.js";

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

// Find a non-trashed child of parentId by exact name. Returns {id,name} or null.
export async function findChild(parentId, name, folderOnly = false) {
    let q = `name='${escapeQuery(name)}' and '${parentId}' in parents and trashed=false`;
    if (folderOnly) q += ` and mimeType='${FOLDER_MIME}'`;
    const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`;
    const res = await driveFetch(url, { headers: authHeaders() });
    const data = await res.json();
    return data.files && data.files.length ? data.files[0] : null;
}

// List all non-trashed children of parentId. Returns [{id,name}].
export async function listChildren(parentId) {
    const out = [];
    let pageToken = null;
    do {
        const q = `'${parentId}' in parents and trashed=false`;
        let url = `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&spaces=drive`;
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

// Create a new text file with the given content under parentId. Returns {id,name}.
export async function createTextFile(name, content, parentId) {
    const boundary = "enotes_boundary_" + Math.random().toString(36).slice(2);
    const metadata = { name, parents: [parentId], mimeType: "text/plain" };
    const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `${content}\r\n` +
        `--${boundary}--`;
    const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
        body,
    });
    return res.json();
}

// Replace the content of an existing file by id.
export async function updateTextFile(fileId, content) {
    const res = await driveFetch(`${UPLOAD}/files/${fileId}?uploadType=media&fields=id,name`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "text/plain" }),
        body: content,
    });
    return res.json();
}

// Create the file if absent, otherwise overwrite it. Returns {id,name}.
export async function upsertTextFile(name, content, parentId) {
    const existing = await findChild(parentId, name);
    if (existing) {
        await updateTextFile(existing.id, content);
        return existing;
    }
    return createTextFile(name, content, parentId);
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
