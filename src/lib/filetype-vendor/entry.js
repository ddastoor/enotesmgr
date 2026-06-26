// entry.js — local vendoring entry point for the `file-type` magic-number library.
//
// Bundled into a single self-contained ESM file with esbuild (no runtime build
// step, no CDN), the same way the WASI shim is vendored. Rebuild with:
//
//     npm install && npm run build
//
// which writes dist/filetype.js. That built file is then copied to
// www/js/lib/filetype-vendor/dist/filetype.js for the app to import.
//
// We only need buffer-based detection: the caller slices the leading bytes of a
// file and passes them here, so detection stays memory-bounded for large files.
export { fileTypeFromBuffer } from "file-type";
