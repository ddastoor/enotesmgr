// Single switch controlling WHERE the top-level "eNotes Manager" folder tree
// lives in the user's Google Drive, and the matching OAuth scope requested at
// sign-in. Nothing else about the app changes between modes — the folder tree,
// file names, metadata and behaviour are identical; only its LOCATION (and the
// scope) differ. See instructions/terms.md ('file scope' vs 'app scope').
//
//   "appdata"   -> the tree lives inside Drive's special Application Data folder
//                  (appDataFolder). It is HIDDEN from the user in the Drive UI
//                  and only this app can see it. Scope: drive.appdata.
//   "drivefile" -> the tree lives at the user's visible Drive root. Scope:
//                  drive.file (the app only sees files it created). Kept for an
//                  easy roll-back; not currently used.
//
// To switch modes, change STORAGE_MODE below and nothing else. (The CLI keeps
// its own copy of this mapping — see src/export/export-cli.js — because it is a
// self-contained bundle; keep the two in sync.)

export const STORAGE_MODE = "appdata"; // "appdata" | "drivefile"

const MODES = {
    appdata: {
        // View and manage its own configuration data in the user's Drive.
        scope: "https://www.googleapis.com/auth/drive.appdata",
        // Alias for the hidden Application Data folder, usable as a parent id
        // and in `'<id>' in parents` queries.
        rootParent: "appDataFolder",
        // files.list must scope the search to the appDataFolder corpus.
        spaces: "appDataFolder",
    },
    drivefile: {
        scope: "https://www.googleapis.com/auth/drive.file",
        rootParent: "root",
        spaces: "drive",
    },
};

export const DRIVE_SCOPE = MODES[STORAGE_MODE].scope;
export const DRIVE_ROOT_PARENT = MODES[STORAGE_MODE].rootParent;
export const DRIVE_SPACES = MODES[STORAGE_MODE].spaces;
