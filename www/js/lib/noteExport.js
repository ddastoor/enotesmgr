// Shared note-export logic, used by BOTH the in-app "Download" button
// (www/js/pages/main.js) and the Node export CLI (src/export/export-cli.js), so
// the two produce identical output. This module is PURE and environment-agnostic
// (no fs, no DOM): given a note's DECRYPTED content it returns the bytes + the
// filename that should be written/downloaded. It only uses APIs available in both
// browsers and Node 18+ (atob, TextEncoder, decodeURIComponent).

// A note's type from its DECRYPTED content: ANY uploaded file is stored as a
// data: URL (any MIME — image, audio, video, pdf, or an "UNKNOWN" upload);
// everything else is rich-text HTML. So a leading "data:" marks an uploaded file.
export function inferNoteType(content) {
    return (content || "").trimStart().startsWith("data:") ? "file" : "richtext";
}

// Preferred extension for a few common MIME types (used only to name an uploaded
// file whose note name has no extension). Anything not listed falls back to the
// MIME subtype, so every type still gets a sensible extension.
const MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "image/svg+xml": "svg", "image/bmp": "bmp",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg",
    "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/flac": "flac",
    "video/mp4": "mp4", "video/webm": "webm",
    "application/pdf": "pdf", "application/zip": "zip",
    "text/plain": "txt", "application/json": "json",
};

function extForMime(mime) {
    return MIME_EXT[mime] || (mime.split("/")[1] || "bin");
}

// Make a note name safe to use as a filename (strip path separators, reserved
// characters and control chars; spaces and dashes are kept).
export function sanitizeName(name) {
    const cleaned = (name || "note").replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").trim();
    return cleaned || "note";
}

// Minimal mirror of node's path.extname for our sanitized (slash-free) names:
// "" for no extension or a leading-dot dotfile, otherwise ".<ext>".
function extname(name) {
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot);
}

const utf8 = (str) => new TextEncoder().encode(str);

// Parse a data: URL into { bytes: Uint8Array, mime }, or null if unparseable.
function decodeDataUrl(dataUrl) {
    const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl.trim());
    if (!m) return null;
    const mime = m[1] || "application/octet-stream";
    let bytes;
    if (m[2]) {
        const bin = atob(m[3]);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
        bytes = utf8(decodeURIComponent(m[3]));
    }
    return { bytes, mime };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Faithful subset of the app's editor styles (www/css/styles.css), with CSS
// variables resolved to literals so the file is standalone. Runtime-only
// decorations (✕ button, selection outline) are intentionally omitted — they are
// never part of saved note content.
const EDITOR_CSS = `
  body { margin: 0; font-family: "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1b1f; background: #fff; }
  .editor { padding: 18px 20px; font-size: 16px; line-height: 1.6; }
  .editor img { max-width: 100%; }
  .media-embed { position: relative; display: inline-block; margin: 4px; padding: 4px; border: 2px solid #e8ddfb; border-radius: 10px; background: #f0edf7; vertical-align: middle; }
  .media-embed img { display: block; }
  audio { display: block; margin: 6px 0; }
`;

function richTextToHtml(title, contentHtml) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${EDITOR_CSS}</style></head>
<body><div class="editor">${contentHtml}</div></body></html>`;
}

// Turn a decrypted note into the artifact to write/download. Returns
// { filename, bytes: Uint8Array, mime }:
//   - rich text  -> a standalone <name>.html rendering the note as the editor did.
//   - uploaded file -> the original decoded bytes, under the note's own name
//     (keeping its extension, or deriving one from the data: URL's MIME).
export function buildNoteExport(noteName, content) {
    const safe = sanitizeName(noteName);

    if (inferNoteType(content) === "richtext") {
        const filename = safe.toLowerCase().endsWith(".html") ? safe : safe + ".html";
        return { filename, bytes: utf8(richTextToHtml(noteName, content)), mime: "text/html" };
    }

    const decoded = decodeDataUrl(content);
    if (!decoded) { // not a parseable data URL — dump the raw text
        return { filename: safe, bytes: utf8(content), mime: "text/plain" };
    }

    let filename = safe;
    if (!extname(filename)) filename += "." + extForMime(decoded.mime);
    return { filename, bytes: decoded.bytes, mime: decoded.mime };
}
