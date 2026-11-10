// Sensitive notes: a note can carry an EXTRA per-note password on top of the
// normal file password. See instructions/sensitive-notes.md.
//
// How a sensitive note is stored (innermost first):
//   1. the actual note content (rich text html, or a data: URL for an upload)
//   2. encrypted with the NOTE password, then marked:  SENSITIVE_PREFIX + base64
//   3. that text encrypted with the FILE password and base64'd - exactly like
//      every other note, so everything that only handles the file-password layer
//      (the export CLI, the -x mirror, picking the right config.json) still works.
// Decryption is the reverse: file password first, then the note password.
//
// This module is PURE and environment-agnostic (no DOM, no fs, no crypto): it only
// knows the envelope format, so the app, the "Upload Sensitive Note" tool and the
// export CLI (through noteExport.js) all agree on it.

export const SENSITIVE_PREFIX = "<<eNotesMgr-sensitive-note-v1>>";

// Extension of the file the export CLI writes for a sensitive note (still locked
// with its note password), e.g. "bank.sensitive", "photo.png.sensitive".
export const SENSITIVE_EXT = ".sensitive";

const B64 = "[A-Za-z0-9+/]+={0,2}";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FIND_RE = new RegExp(escapeRe(SENSITIVE_PREFIX) + "(" + B64 + ")");
const WHOLE_RE = new RegExp("^" + B64 + "$");

// True if a note's file-password-decrypted text is a sensitive-note envelope.
// No ordinary note can start with "<<": rich text is the editor's innerHTML (a
// "<" typed as text is always serialised as "&lt;" and no tag name starts with
// "<"), uploads are "data:" URLs and legacy notes start with "[metadata begin]".
export function isSensitiveContent(text) {
    return typeof text === "string" && text.startsWith(SENSITIVE_PREFIX);
}

// innerCipher: the content encrypted with the note password (base64).
export function wrapSensitive(innerCipher) {
    return SENSITIVE_PREFIX + innerCipher;
}

// The note-password ciphertext (base64) inside an envelope, or null if `text`
// isn't a well-formed envelope.
export function unwrapSensitive(text) {
    if (!isSensitiveContent(text)) return null;
    const b64 = text.slice(SENSITIVE_PREFIX.length).trim();
    return WHOLE_RE.test(b64) ? b64 : null;
}

// Find the envelope in a file the user picked for "Upload Sensitive Note": a
// "<name>.sensitive" file written by the export CLI, or the "<name>.html" that an
// export CLI from before this feature wrote for a sensitive note (it wrapped the
// envelope in html). Returns the note-password ciphertext (base64), or null.
export function findSensitivePayload(fileText) {
    const m = FIND_RE.exec(typeof fileText === "string" ? fileText : "");
    return m ? m[1] : null;
}

// The note's name, from the picked file's name: "bank.sensitive" -> "bank",
// "photo.png.sensitive" -> "photo.png" (an older CLI's "bank.html" -> "bank").
// The shared export rules (noteExport.js) then add the right extension.
export function sensitiveBaseName(fileName) {
    const name = String(fileName || "");
    const strip = (re) => name.replace(re, "") || "note";
    if (/\.sensitive$/i.test(name)) return strip(/\.sensitive$/i);
    if (/\.html?$/i.test(name)) return strip(/\.html?$/i);
    return name || "note";
}
