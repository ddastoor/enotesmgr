// Note / file metadata helpers. Metadata is stored as Google Drive custom file
// properties (appProperties) on each file, never embedded in the file contents.
// See instructions/note-meta-data.md.

// Current date/time in the [date]T[time] format, e.g. 2026-01-21T10:30.
export function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Full metadata set for a newly created non-note app file (config / settings /
// recovery). CreationMethod is always "app" for these. fileType is one of
// "config", "settings", "recovery".
export function createAppMeta(fileType) {
    const stamp = nowStamp();
    return {
        DateTimeCreated: stamp,
        DateTimeModified: stamp,
        CreationMethod: "app",
        FileType: fileType,
    };
}

// Metadata to merge when overwriting an existing non-note app file. Omits
// DateTimeCreated (so the original creation time is preserved via Drive's
// appProperties merge) but re-asserts the constant keys so files created before
// this metadata existed get backfilled.
export function updateAppMeta(fileType) {
    return {
        DateTimeModified: nowStamp(),
        CreationMethod: "app",
        FileType: fileType,
    };
}

// create/update metadata pair for upsertTextFile(...).
export function appMetaProps(fileType) {
    return { create: createAppMeta(fileType), update: updateAppMeta(fileType) };
}
