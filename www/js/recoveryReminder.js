// Recovery codes: the "never get locked out" rules.
// See instructions/UI/one-or-zero-recovery-code-left-popup.md.
//
// Policy: the user is NEVER left with 0 recovery codes, and never kept at a
// single last one. (Using the last code and then forgetting the new master
// password would otherwise lock the user out for good.)
//   - Setup always generates codes. Codes come as one complete set of 10:
//     generating a new set creates the new codes, downloads them and deletes the
//     old ones only once the user confirms the file is saved (see
//     generateRecoveryCodesWithUI). There is no way to delete them all.
//   - After a master-password login with 0 or 1 codes left: generating 10 new
//     codes is MANDATORY, otherwise the user is logged out. No "Later", no
//     "Don't ask again".
//   - A recovery-code reset that would leave 0 or 1 codes requires 10 new codes
//     before the used code is exhausted: see requireCodesAfterReset().

import { logout, suspendSessionTimer, resumeSessionTimer } from "./app.js";
import { buildModal, withStatus, showAlert } from "./lib/dialogs.js";
import {
    createNewRecoveryCodes,
    downloadRecoveryCodes,
    deleteOldRecoveryCodes,
    recoveryCodesFilename,
    countRecoveryCodes,
} from "./recovery.js";

function textBody(message) {
    const body = document.createElement("div");
    body.className = "modal-text";
    body.textContent = message;
    return body;
}

// Generate a complete NEW SET of 10 recovery codes, replacing ALL existing ones
// (the newest codes file then always holds every valid code):
//   1. create the new codes - the old ones are untouched (auto-logout paused);
//   2. download the codes file and ask the user to confirm it is saved
//      ("Download again" downloads it again);
//   3. only then delete the old codes.
// If the user never confirms (closes the tab, auto-logout), both sets keep
// working, so nothing is lost. Returns true once the new codes exist, false if
// creating them failed (logged to the console; nothing changed).
export async function generateRecoveryCodesWithUI() {
    let result;
    suspendSessionTimer();
    try {
        result = await withStatus("Generating recovery codes...", () => createNewRecoveryCodes());
    } catch (e) {
        console.error("Failed to generate recovery codes", e);
        return false;
    } finally {
        resumeSessionTimer();
    }
    const { codes, oldFiles } = result;

    downloadRecoveryCodes(codes);
    const oldNote = oldFiles.length === 0 ? ""
        : oldFiles.length === 1 ? " Once you continue, your previous recovery code stops working."
        : ` Once you continue, your previous ${oldFiles.length} recovery codes stop working.`;
    for (;;) {
        const choice = await buildModal({
            title: "Recovery codes downloaded",
            body: textBody(
                `Your new recovery codes file (${recoveryCodesFilename()}) has been downloaded. ` +
                "It holds ALL your recovery codes. Save it very safely!" + oldNote
            ),
            buttons: [
                { label: "Download again", value: "again", variant: "btn-tonal" },
                { label: "I've saved them", value: "saved", primary: true, variant: "btn-filled" },
            ],
        });
        if (choice === "saved") break;
        downloadRecoveryCodes(codes);
    }

    if (oldFiles.length) {
        const notDeleted = await withStatus("Finishing...", () => deleteOldRecoveryCodes(oldFiles));
        if (notDeleted) {
            await showAlert(
                `${notDeleted} of your previous recovery codes could not be removed and still work. ` +
                "Generate new codes again to remove them.",
                "Note"
            );
        }
    }
    return true;
}

// Called right after a login lands on the main page (master password login, or
// new-user setup). With 0 or 1 codes left, the user must generate new ones or is
// logged out. A failure to read the recovery folder is logged and swallowed so
// it never blocks reaching the main page.
export async function maybeShowRecoveryReminder() {
    let count;
    try {
        count = await countRecoveryCodes();
    } catch (e) {
        console.error("Recovery code check failed", e);
        return;
    }
    if (count > 1) return;
    await requireNewCodesAtLogin(count);
}

// 0 or 1 codes left: generate new codes, or log out. Retries on failure.
async function requireNewCodesAtLogin(count) {
    const title = count === 1 ? "Only 1 recovery code left" : "No recovery codes";
    const message = count === 1
        ? "You have only 1 recovery code left. If you used it and then forgot your new master password, you would be locked out for good. " +
          "Generate 10 new recovery codes (they replace your current one) to keep using eNotesMgr, or log out."
        : "You have no recovery codes. If you forgot your master password, you would be locked out for good. " +
          "Generate 10 new recovery codes to keep using eNotesMgr, or log out.";
    for (;;) {
        const choice = await buildModal({
            title,
            body: textBody(message),
            buttons: [
                { label: "Log out", value: "logout", variant: "btn-tonal", isCancel: true },
                { label: "Generate now", value: "generate", primary: true, variant: "btn-filled" },
            ],
        });
        if (choice !== "generate") {
            logout();
            return;
        }
        if (await generateRecoveryCodesWithUI()) return;
        await showAlert("Could not generate recovery codes. Please try again.", "Error");
    }
}

// Recovery-code reset (pages/masterPassword.js): the master password has just
// been reset with a recovery code, and using it would leave `remaining` (0 or 1)
// codes. Require 10 new codes now, before that code is used up. Returns true
// once new codes exist. If generating fails and the user chooses to finish
// anyway, returns false: the caller must then NOT use up the code, so the user
// still has a way back in.
export async function requireCodesAfterReset(remaining) {
    for (;;) {
        await buildModal({
            title: "Generate new recovery codes",
            body: textBody(
                (remaining === 0
                    ? "That was your last recovery code. "
                    : "That leaves you with only 1 recovery code. ") +
                "If you forgot your new master password too, you would be locked out for good, " +
                "so generate 10 new recovery codes now."
            ),
            buttons: [{ label: "Generate now", value: true, primary: true, variant: "btn-filled" }],
        });
        if (await generateRecoveryCodesWithUI()) return true;

        const retry = await buildModal({
            title: "Could not generate recovery codes",
            body: textBody(
                "Something went wrong generating new recovery codes. Try again? " +
                "If you finish without them, the recovery code you just used will NOT be used up, " +
                "so you can still use it."
            ),
            buttons: [
                { label: "Finish without new codes", value: false, variant: "btn-tonal", isCancel: true },
                { label: "Try again", value: true, primary: true, variant: "btn-filled" },
            ],
        });
        if (!retry) return false;
    }
}
