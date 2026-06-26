// Magic-number file type detection — see instructions/UI/main-page.md
// ('File type detection (magic number)').
//
// We determine a user-provided file's type from its CONTENT (binary signature),
// NOT from its filename extension or the browser-provided File.type (both of
// which are merely extension-derived and easily spoofed). Detection is done by
// the locally-vendored, esbuild-bundled `file-type` library (the JS equivalent
// of libmagic / the `file` command) — no CDN, no runtime build step. See
// ./filetype-vendor/ and src/lib/filetype-vendor/.
import { fileTypeFromBuffer } from "./filetype-vendor/dist/filetype.js";

// Only the leading bytes of a file carry its magic number, so we read a small
// head slice instead of the whole file — detection stays memory-bounded even
// for very large uploads. file-type needs at most a few KB to identify the
// formats we care about; 64 KB is a comfortable margin.
const HEAD_BYTES = 64 * 1024;

// The SINGLE place to extend when adding new supported types later (e.g. video /
// PDF / MS Office): map a detected MIME type to the app's FileType enum, then
// add a matching viewer in displayNote(). `match` runs against the detected MIME
// string; the first matching rule wins.
const MIME_TO_FILETYPE = [
    { match: (mime) => mime.startsWith("image/"), fileType: "image" },
    { match: (mime) => mime.startsWith("audio/"), fileType: "audio" },
];

// Detect a File/Blob's app FileType from its content. Returns the FileType
// string (e.g. "image", "audio") or null when the type has no binary signature
// or maps to nothing supported (the caller decides what to do with null).
export async function detectFileType(file) {
    const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
    const result = await fileTypeFromBuffer(head);
    if (!result) return null; // no recognised binary signature
    const rule = MIME_TO_FILETYPE.find((r) => r.match(result.mime));
    return rule ? rule.fileType : null;
}
