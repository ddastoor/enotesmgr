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

// The specially-displayed media types: a detected MIME matching one of these
// rules is stored under that short FileType and rendered by its own viewer in
// displayNote(). This is the place to extend when adding a new in-app viewer
// later (e.g. video / PDF): add a row here and a matching viewer. `match` runs
// against the detected MIME string; the first matching rule wins.
const MIME_TO_FILETYPE = [
    { match: (mime) => mime.startsWith("image/"), fileType: "image" },
    { match: (mime) => mime.startsWith("audio/"), fileType: "audio" },
];

// Detect a File/Blob's app FileType from its content (magic number). Any file is
// allowed for upload; the type is recorded as best we can:
//   - "image" / "audio" for the specially-displayed media types,
//   - the detected MIME type string (e.g. "application/pdf", "video/mp4") for any
//     other recognised binary signature,
//   - "UNKNOWN" when no binary signature is recognised.
// Notes whose FileType is neither image nor audio are not rendered in-app (the
// media viewer just prompts the user to download them — see pages/main.js).
export async function detectFileType(file) {
    const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
    const result = await fileTypeFromBuffer(head);
    if (!result) return "UNKNOWN"; // no recognised binary signature
    const rule = MIME_TO_FILETYPE.find((r) => r.match(result.mime));
    return rule ? rule.fileType : result.mime; // keep the raw MIME for non-media types
}
