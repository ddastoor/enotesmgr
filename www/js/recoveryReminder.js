// "1 or no recovery codes left" reminder popup. Shown right after a login lands on
// the main page when the user has one or zero recovery codes remaining and has not
// opted out via the don't-ask marker.
// See instructions/UI/one-or-zero-recovery-code-left-popup.md.

import { navigate } from "./app.js";
import { buildModal } from "./lib/dialogs.js";
import { listRecoveryFiles, hasDontAskMarker, createDontAskMarker } from "./recovery.js";

// Check the recovery file count and, if one or zero are left (and the user hasn't
// chosen "don't ask again"), show the reminder popup over the main page. Any
// failure is logged and swallowed so it never blocks reaching the main page.
export async function maybeShowRecoveryReminder() {
    try {
        const files = await listRecoveryFiles();
        if (files.length > 1) return;
        if (await hasDontAskMarker()) return;
    } catch (e) {
        console.error("Recovery reminder check failed", e);
        return;
    }
    await showRecoveryReminderPopup();
}

async function showRecoveryReminderPopup() {
    const body = document.createElement("div");
    body.className = "modal-text";
    body.textContent =
        "You have 1 or no recovery codes left. Generate more recovery codes to stay safe.";

    const choice = await buildModal({
        title: "1 or no recovery codes left",
        body,
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
        } catch (e) {
            console.error("Failed to create don't-ask marker", e);
        }
    }
    // "later" or Escape: close the popup and stay on the main page.
}
