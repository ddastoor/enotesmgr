// Recovery codes: the "never get locked out" rules.
// See instructions/UI/one-or-zero-recovery-code-left-popup.md.
//
// Policy: the user is NEVER left with 0 recovery codes, and never kept at a
// single last one. (Using the last code and then forgetting the new master
// password would otherwise lock the user out for good.)
//   - Setup always generates codes; "Replace" generates new codes before
//     deleting the old ones (see recovery.js). There is no way to delete them all.
//   - After a master-password login with 0 or 1 codes left: generating 10 new
//     codes is MANDATORY, otherwise the user is logged out. No "Later", no
//     "Don't ask again".
//   - A recovery-code reset that would leave 0 or 1 codes requires 10 new codes
//     before the used code is exhausted: see requireCodesAfterReset().

import { logout, suspendSessionTimer, resumeSessionTimer } from "./app.js";
import { buildModal, withStatus, showAlert } from "./lib/dialogs.js";
import { generateRecoveryCodes, countRecoveryCodes } from "./recovery.js";

function textBody(message) {
    const body = document.createElement("div");
    body.className = "modal-text";
    body.textContent = message;
    return body;
}

// Generate 10 new recovery codes (downloads the codes file) with the usual
// status + confirmation. Auto-logout is paused while it runs. Returns true on
// success, false on failure (already logged to the console).
export async function generateRecoveryCodesWithUI() {
    suspendSessionTimer();
    try {
        await withStatus("Generating recovery codes...", () => generateRecoveryCodes());
    } catch (e) {
        console.error("Failed to generate recovery codes", e);
        return false;
    } finally {
        resumeSessionTimer();
    }
    await showAlert("Recovery codes downloaded. Save them very safely!", "Done");
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
    const message = (count === 1
        ? "You have only 1 recovery code left. If you used it and then forgot your new master password, you would be locked out for good. "
        : "You have no recovery codes. If you forgot your master password, you would be locked out for good. ") +
        "Generate 10 new recovery codes to keep using eNotes, or log out.";
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
