// Preload (node -r) for the CLI tests.
//
// FAKE_NOW=<local time>, e.g. "2026-03-04T05:06:30": `new Date()` with no
//   arguments returns that time, so the dated folder names ('..._YYYYMMDD_HHMM')
//   are known in advance. Everything else about Date (Date.now, new Date(x),
//   parsing) is the real thing.
// FAKE_LATE_FOLDER=1: fs.existsSync says "not there" for any
//   'eNotes Manager Transfer_...' folder - as if such a folder only appeared
//   after the CLI looked (to test that the export still never writes into it).
"use strict";
const at = process.env.FAKE_NOW;
if (at) {
    const RealDate = Date;
    const fixed = new RealDate(at).getTime();
    if (Number.isNaN(fixed)) throw new Error("FAKE_NOW is not a date: " + at);
    globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
    };
}
if (process.env.FAKE_LATE_FOLDER) {
    const fs = require("node:fs");
    const path = require("node:path");
    const real = fs.existsSync;
    fs.existsSync = (p) => (path.basename(String(p)).startsWith("eNotes Manager Transfer_") ? false : real(p));
}
