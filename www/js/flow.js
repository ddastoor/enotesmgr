// Shared post-login flows used across pages.
//
// Data-safety rules (see instructions/data-storage.md, "Never lose existing data"):
//   - Before concluding that something does NOT exist - and therefore creating a
//     folder or starting a fresh account setup - look again after a short pause.
//     A momentary Drive hiccup must never create a second folder tree or a
//     second config.json next to the user's real data.
//   - If duplicate folders exist anyway (Drive allows same-named items), use the
//     one that holds the user's data instead of whichever Drive lists first.
//     Nothing is ever deleted here.
// With exactly one of each (the normal case) behaviour is unchanged.

import { state, CONFIG_FILE_NAME, SETTINGS_FILE_NAME, ONE_RECOVERY_LEFT_MARKER } from "./state.js";
import {
    getUserInfo,
    createFolder,
    findChildren,
    listChildren,
} from "./drive.js";
import { DRIVE_ROOT_PARENT } from "./lib/driveConfig.js";

const MANAGER_FOLDER = "eNotes Manager";
const SUBFOLDERS = { entries: "Entries", config: "Config", recovery: "Recovery" };
const RECHECK_DELAY_MS = 1200;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolve the logged-in user's email/username and stash on state.
export async function loadUserInfo() {
    const user = await getUserInfo();
    state.userEmail = user.emailAddress || "";
    state.username = state.userEmail ? state.userEmail.split("@")[0] : (user.displayName || "user");
    state.fullName = user.displayName || "";
}

// All items named `name` under parentId. If none are found, look once more
// after a short pause before believing it (see the rules above).
async function findAllConfirmed(parentId, name, folderOnly = false) {
    const found = await findChildren(parentId, name, folderOnly);
    if (found.length) return found;
    await pause(RECHECK_DELAY_MS);
    return findChildren(parentId, name, folderOnly);
}

// Of several same-named folders, the one with the most items in it (the one
// actually in use). Ties: the first listed.
async function pickFullestFolder(folders) {
    let best = folders[0], bestCount = -1;
    for (const f of folders) {
        const count = (await listChildren(f.id)).length;
        if (count > bestCount) { best = f; bestCount = count; }
    }
    return best;
}

// Of several "eNotes Manager" trees, the one holding the user's data: has a
// config.json first, then the most notes. Ties: the first listed.
async function pickManagerWithData(managers) {
    let best = managers[0], bestScore = -1;
    for (const m of managers) {
        let score = 0;
        const config = (await findChildren(m.id, SUBFOLDERS.config, true))[0];
        if (config && (await findChildren(config.id, CONFIG_FILE_NAME)).length) score += 1e6;
        const entries = (await findChildren(m.id, SUBFOLDERS.entries, true))[0];
        if (entries) score += (await listChildren(entries.id)).length;
        if (score > bestScore) { best = m; bestScore = score; }
    }
    return best;
}

// Ensure the "eNotes Manager" folder tree exists; populate state.folders.
export async function ensureFolders() {
    // Top-level folder lives under the configured root (appDataFolder by default,
    // so it is hidden from the user; see lib/driveConfig.js).
    const managers = await findAllConfirmed(DRIVE_ROOT_PARENT, MANAGER_FOLDER, true);
    let manager, managerIsNew = false;
    if (managers.length === 0) {
        manager = (await createFolder(MANAGER_FOLDER, DRIVE_ROOT_PARENT)).id;
        managerIsNew = true;
    } else {
        manager = managers.length === 1 ? managers[0].id : (await pickManagerWithData(managers)).id;
    }
    state.folders.manager = manager;

    for (const [key, name] of Object.entries(SUBFOLDERS)) {
        // In a folder we just created there is nothing to look for.
        const found = managerIsNew ? [] : await findAllConfirmed(manager, name, true);
        let id;
        if (found.length === 0) id = (await createFolder(name, manager)).id;
        else if (found.length === 1) id = found[0].id;
        else id = (await pickFullestFolder(found)).id;
        state.folders[key] = id;
    }
}

// A user is "new" if no config file exists yet in the Config folder (confirmed
// with a second look, see the rules above).
export async function isNewUser() {
    return (await findAllConfirmed(state.folders.config, CONFIG_FILE_NAME)).length === 0;
}

// Called when config.json is missing: does this account already hold data?
// Returns { notes, recoveryCodes, settings } counts/flags; all zero/false for a
// genuinely new user.
export async function existingData() {
    const [entries, recovery, config] = await Promise.all([
        listChildren(state.folders.entries),
        listChildren(state.folders.recovery),
        listChildren(state.folders.config),
    ]);
    return {
        notes: entries.length,
        recoveryCodes: recovery.filter((f) => f.name !== ONE_RECOVERY_LEFT_MARKER).length,
        settings: config.some((f) => f.name === SETTINGS_FILE_NAME),
    };
}
