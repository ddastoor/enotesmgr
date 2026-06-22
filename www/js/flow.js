// Shared post-login flows used across pages.

import { state, CONFIG_FILE_NAME } from "./state.js";
import {
    getUserInfo,
    ensureFolder,
    findChild,
} from "./drive.js";

// Resolve the logged-in user's email/username and stash on state.
export async function loadUserInfo() {
    const user = await getUserInfo();
    state.userEmail = user.emailAddress || "";
    state.username = state.userEmail ? state.userEmail.split("@")[0] : (user.displayName || "user");
    state.fullName = user.displayName || "";
}

// Ensure the "eNotes Manager" folder tree exists; populate state.folders.
export async function ensureFolders() {
    const manager = await ensureFolder("eNotes Manager", "root");
    state.folders.manager = manager;
    state.folders.entries = await ensureFolder("Entries", manager);
    state.folders.config = await ensureFolder("Config", manager);
    state.folders.recovery = await ensureFolder("Recovery", manager);
}

// A user is "new" if no config file exists yet in the Config folder.
export async function isNewUser() {
    const cfg = await findChild(state.folders.config, CONFIG_FILE_NAME);
    return !cfg;
}
