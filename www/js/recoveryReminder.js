// Recovery code reminders and the "never get locked out" rules.
// See instructions/UI/one-or-zero-recovery-code-left-popup.md and
// instructions/UI/menu/menu-items/start-recovery-code-reminder.md.
//
// Policy:
//   - 1 code left (only ever reached by using codes up): generating more is
//     MANDATORY. After a master-password login the user must generate 10 new
//     codes or is logged out; "Later" / "Don't ask again" are not offered and the
//     don't-ask marker is ignored. (Using that last code and then forgetting the
//     new password would otherwise lock the user out for good.)
//   - 0 codes left (only ever reached by the user's own choice: setup without
//     codes, or Wipe): an optional reminder with Generate more / Later /
//     Don't ask again. "Don't ask again" is honoured until the user turns
//     reminders back on (menu: Restart Recovery Reminders) or generates codes.
//   - 2+ codes: nothing.
// The recovery-code reset itself (pages/masterPassword.js) never leaves the
// user with 0 or 1 codes either: see requireCodesAfterReset().

import { navigate, logout, suspendSessionTimer, resumeSessionTimer } from "./app.js";
import { buildModal, withStatus, showAlert } from "./lib/dialogs.js";
import {
    listRecoveryFiles,
    generateRecoveryCodes,
    hasDontAskMarker,
    createDontAskMarker,
    deleteDontAskMarker,
} from "./recovery.js";

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
// new-user setup). Applies the policy above. A failure to read the recovery
// folder is logged and swallowed so it never blocks reaching the main page.
export async function maybeShowRecoveryReminder() {
    let count;
    try {
        count = (await listRecoveryFiles()).length;
    } catch (e) {
        console.error("Recovery reminder check failed", e);
        return;
    }
    if (count > 1) return;
    if (count === 1) {
        await requireNewCodesAtLogin();
        return;
    }
    // count === 0: optional reminder, unless the user chose "Don't ask again".
    try {
        if (await hasDontAskMarker()) return;
    } catch (e) {
        console.error("Recovery reminder check failed", e);
        return;
    }
    await showNoCodesReminder();
}

// 1 code left: generate new codes, or log out. Retries on failure.
async function requireNewCodesAtLogin() {
    for (;;) {
        const choice = await buildModal({
            title: "Only 1 recovery code left",
            body: textBody(
                "You have only 1 recovery code left. If you used it and then forgot your new master password, " +
                "you would be locked out for good. Generate 10 new recovery codes to keep using eNotes, or log out."
            ),
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

// 0 codes left (by the user's own choice): optional reminder.
async function showNoCodesReminder() {
    const choice = await buildModal({
        title: "No recovery codes left",
        body: textBody(
            "You have no recovery codes. If you forget your master password, you won't be able to get back in. " +
            "Generate recovery codes to stay safe."
        ),
        buttons: [
            { label: "Generate more", value: "generate", primary: true, variant: "btn-filled" },
            { label: "Later", value: "later", variant: "btn-tonal", isCancel: true },
            { label: "Don't ask again", value: "dontask", variant: "btn-tonal" },
        ],
    });

    if (choice === "generate") {
        navigate("recoveryCodes");
    } else if (choice === "dontask") {
        try {
            await createDontAskMarker();
            await showAlert(
                "OK, I won't remind you while you have no recovery codes. " +
                "You can turn reminders back on any time from the menu: Restart Recovery Reminders.",
                "Reminders off"
            );
        } catch (e) {
            console.error("Failed to create don't-ask marker", e);
            await showAlert("Could not save that choice. You may be reminded again next time.", "Error");
        }
    }
    // "later" or Escape: close the popup and stay on the main page.
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

// Menu: "Restart Recovery Reminders". Shows whether reminders are currently on
// or off ("Don't ask again" was chosen) and lets the user turn them back on.
export async function showRestartReminderPopup() {
    let off;
    try {
        off = await withStatus("Checking...", () => hasDontAskMarker());
    } catch (e) {
        console.error("Failed to check reminder state", e);
        await showAlert("Something went wrong. Please try again.", "Error");
        return;
    }

    if (!off) {
        await showAlert(
            "Recovery code reminders are already on. Whenever you log in with no recovery codes, " +
            "you'll be reminded to generate some. (With only 1 left, you're always required to generate more.)",
            "Recovery code reminders"
        );
        return;
    }

    const choice = await buildModal({
        title: "Start recovery code generation reminder again",
        body: textBody(
            "Reminders are currently off (you chose \"Don't ask again\"). Turn them back on? " +
            "Whenever you log in with no recovery codes, you'll be reminded to generate some."
        ),
        buttons: [
            { label: "Cancel", value: "cancel", variant: "btn-tonal", isCancel: true },
            { label: "Turn on", value: "on", primary: true, variant: "btn-filled" },
        ],
    });
    if (choice !== "on") return;

    try {
        await withStatus("Saving...", () => deleteDontAskMarker());
        await showAlert("Recovery code reminders are on again.", "Recovery code reminders");
    } catch (e) {
        console.error("Failed to delete don't-ask marker", e);
        await showAlert("Could not turn reminders back on. Please try again.", "Error");
    }
}
