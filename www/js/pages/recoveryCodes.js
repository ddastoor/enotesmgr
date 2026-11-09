import { navigate } from "../app.js";
import { showAlert, showConfirm } from "../lib/dialogs.js";
import { generateRecoveryCodesWithUI } from "../recoveryReminder.js";

// Recovery codes page. Codes always come as one complete set of 10: generating
// new codes replaces ALL current ones, so the newest downloaded codes file
// always holds every valid code. The old codes are only deleted once the user
// confirms the new file is saved, and there is no way to delete all codes
// (see ../recoveryReminder.js).
export function render(container) {
    container.innerHTML = `
        <div class="page recovery-page">
            <header class="app-header">
                <div class="header-top">
                    <h1 class="brand-title gradient small">Generate Recovery Codes</h1>
                </div>
            </header>

            <section class="recovery-body">
                <p class="muted">
                    Generate 10 new random 16-digit numeric codes. Use these numeric codes if you
                    happen to forget your master password. Once a code is used, it is exhausted.
                    Save these codes very safely.
                </p>
                <p class="muted">
                    New codes <b>replace ALL your current codes</b>: only the codes in the newest
                    downloaded file work. (Also use this if your codes file may have been seen by someone.)
                </p>

                <div class="button-row recovery-actions">
                    <button id="rc-generate" class="btn btn-filled" title="Generate 10 new codes (they replace all your current codes)">Generate new codes</button>
                    <button id="rc-done" class="btn btn-tonal">Done</button>
                </div>
            </section>
        </div>`;

    container.querySelector("#rc-generate").addEventListener("click", onGenerate);
    container.querySelector("#rc-done").addEventListener("click", () => navigate("main"));
}

async function onGenerate() {
    const ok = await showConfirm(
        "Generate 10 new recovery codes? They replace ALL your current recovery codes, which stop working once you've saved the new file.",
        "Generate new recovery codes"
    );
    if (!ok) return;
    if (!(await generateRecoveryCodesWithUI())) {
        await showAlert("Could not generate recovery codes. Your current codes were left unchanged.", "Error");
    }
}
