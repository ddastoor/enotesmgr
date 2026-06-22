// // entry.js
// export {
//     WASI,
//     OpenFile,
//     File,
//     ConsoleStdout
// } from "@bjorn3/browser_wasi_shim";

import * as wasiShim from "@bjorn3/browser_wasi_shim";

export const WASI = wasiShim.WASI;
export const OpenFile = wasiShim.OpenFile;
export const File = wasiShim.File;
export const ConsoleStdout = wasiShim.ConsoleStdout;

// npx esbuild entry.js --bundle --outfile=dist/wasi-shim.js --format=esm --target=es2022


