import { navigate, suspendSessionTimer, resumeSessionTimer } from "../app.js";
import { withStatus, showAlert, showConfirm } from "../lib/dialogs.js";
import { generateRecoveryCodes, replaceRecoveryCodes } from "../recovery.js";

// Recovery codes page. "Generate" adds 10 more codes (existing ones keep
// working). "Replace" swaps ALL codes for 10 new ones (old ones stop working).
// There is deliberately no way to delete all codes: you're never left without
// any (see ../recoveryReminder.js).
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
                    <b>Generate</b> adds 10 more codes; your current codes keep working.
                    <b>Replace</b> gives you 10 new codes and makes ALL your current codes stop
                    working (use it if your codes file may have been seen by someone).
                </p>

                <div class="button-row recovery-actions">
                    <button id="rc-generate" class="btn btn-filled" title="Generate 10 more codes (your current codes keep working)">Generate</button>
                    <button id="rc-replace" class="btn btn-danger" title="Replace all your codes with 10 new ones (current codes stop working)">Replace</button>
                    <button id="rc-done" class="btn btn-tonal">Done</button>
                </div>
            </section>
        </div>`;

    container.querySelector("#rc-generate").addEventListener("click", onGenerate);
    container.querySelector("#rc-replace").addEventListener("click", onReplace);
    container.querySelector("#rc-done").addEventListener("click", () => navigate("main"));
}

async function onGenerate() {
    // Generating codes can take a while; don't auto-logout mid-operation.
    suspendSessionTimer();
    try {
        await withStatus("Generating recovery codes...", () => generateRecoveryCodes());
        await showAlert("Recovery codes downloaded. Save them very safely!", "Done");
    } catch (e) {
        console.error(e);
        await showAlert("Could not generate recovery codes.", "Error");
    } finally {
        resumeSessionTimer();
    }
}

async function onReplace() {
    const ok = await showConfirm(
        "Replace all your recovery codes? 10 new codes will be generated and downloaded, and ALL your current recovery codes will stop working.",
        "Replace recovery codes"
    );
    if (!ok) return;
    suspendSessionTimer();
    try {
        // New codes are created (and downloaded) before any old one is deleted.
        const notDeleted = await withStatus("Replacing recovery codes...", () => replaceRecoveryCodes());
        await showAlert(
            notDeleted === 0
                ? "Your recovery codes have been replaced. The new codes were downloaded - save them very safely! Your old codes no longer work."
                : `New recovery codes were downloaded - save them very safely! However, ${notDeleted} of your old codes could not be removed and still work. Press Replace again to remove them.`,
            "Codes replaced"
        );
    } catch (e) {
        console.error(e);
        await showAlert("Could not generate new recovery codes. Your current codes were left unchanged.", "Error");
    } finally {
        resumeSessionTimer();
    }
}
