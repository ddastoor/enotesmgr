// "Wipe all App Data" flow (PC only — wired from the More options menu).
//
// Permanently deletes the entire "eNotes Manager" folder (and everything inside
// it: notes, config, recovery codes) from the user's Google Drive, after the
// user confirms and re-enters their master password. On success the session is
// dropped and the user is returned to the login screen; their next login starts
// a fresh new-user setup (no config.json exists anymore).

import { state, CONFIG_FILE_NAME } from "./state.js";
import { listChildren, downloadText, deleteFile } from "./drive.js";
import { decryptData } from "./crypto/crypto.js";
import { showConfirm, showPrompt, showAlert, withStatus } from "./lib/dialogs.js";
import { logout } from "./app.js";

// The master password is never held in memory (only the file_password is), so we
// verify it the same way unlock does: try to decrypt config.json with it.
// Returns true if any config.json copy decrypts with this password.
async function verifyMasterPassword(masterPassword) {
    const configFiles = (await listChildren(state.folders.config))
        .filter((f) => f.name === CONFIG_FILE_NAME);
    for (const f of configFiles) {
        try {
            JSON.parse(decryptData(await downloadText(f.id), masterPassword));
            return true;
        } catch (_) {
            /* not this copy / wrong password — try the next */
        }
    }
    return false;
}

export async function wipeAppData() {
    // a) Confirm.
    const confirmed = await showConfirm(
        "This permanently deletes your entire 'eNotes Manager' folder and ALL its contents (notes, config and recovery codes) from Google Drive. This cannot be undone. Are you sure?",
        "Wipe all App Data"
    );
    if (!confirmed) return;

    // b) Re-enter the master password; only proceed if it is correct.
    const masterPassword = await showPrompt("Enter your master password to confirm:", {
        title: "Wipe all App Data",
        type: "password",
        placeholder: "Master password",
    });
    if (!masterPassword) return; // cancelled

    let ok;
    try {
        ok = await withStatus("Verifying...", () => verifyMasterPassword(masterPassword));
    } catch (e) {
        console.error(e);
        await showAlert("Something went wrong. Your app data was NOT deleted.", "Error");
        return;
    }
    if (!ok) {
        await showAlert("Incorrect master password. Your app data was NOT deleted.", "Wipe all App Data");
        return;
    }

    // c) Delete the whole "eNotes Manager" tree. Deleting the folder removes all
    //    of its descendants in one call.
    try {
        await withStatus("Wiping all app data...", () => deleteFile(state.folders.manager));
    } catch (e) {
        console.error(e);
        await showAlert("Could not delete your app data. Please try again.", "Error");
        return;
    }

    await showAlert("You have to setup your eNotes Manager again", "App data wiped");
    logout(); // drops the session and returns to the login screen
}
