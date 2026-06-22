import { navigate, suspendSessionTimer, resumeSessionTimer } from "../app.js";
import { withStatus, showAlert, showConfirm } from "../lib/dialogs.js";
import { listRecoveryFiles, generateRecoveryCodes, wipeRecoveryCodes } from "../recovery.js";

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
                    Generate 10 new random 8-digit numeric codes. Use these numeric codes if you
                    happen to forget your master password. Once a code is used, it is exhausted.
                    Save these codes very safely.
                </p>

                <div class="button-row recovery-actions">
                    <button id="rc-generate" class="btn btn-filled" title="Generate 10 new random 8-digit numeric codes">Generate</button>
                    <button id="rc-wipe" class="btn btn-danger" title="Delete all recovery codes">Wipe</button>
                    <button id="rc-done" class="btn btn-tonal">Done</button>
                </div>
            </section>
        </div>`;

    const wipeBtn = container.querySelector("#rc-wipe");

    container.querySelector("#rc-generate").addEventListener("click", () => onGenerate(wipeBtn));
    wipeBtn.addEventListener("click", () => onWipe(wipeBtn));
    container.querySelector("#rc-done").addEventListener("click", () => navigate("main"));

    refreshWipeState(wipeBtn);
}

async function refreshWipeState(wipeBtn) {
    try {
        const files = await listRecoveryFiles();
        wipeBtn.disabled = files.length === 0;
    } catch (e) {
        console.error(e);
    }
}

async function onGenerate(wipeBtn) {
    // Generating codes can take a while; don't auto-logout mid-operation.
    suspendSessionTimer();
    try {
        await withStatus("Generating recovery codes...", () => generateRecoveryCodes());
        await showAlert("Recovery codes downloaded. Save them very safely!", "Done");
        refreshWipeState(wipeBtn);
    } catch (e) {
        console.error(e);
        await showAlert("Could not generate recovery codes.", "Error");
    } finally {
        resumeSessionTimer();
    }
}

async function onWipe(wipeBtn) {
    const ok = await showConfirm("Are you sure you want to delete all recovery codes?", "Wipe recovery codes");
    if (!ok) return;
    suspendSessionTimer();
    try {
        await withStatus("Deleting recovery codes...", () => wipeRecoveryCodes());
        refreshWipeState(wipeBtn);
    } catch (e) {
        console.error(e);
        await showAlert("Could not delete recovery codes.", "Error");
    } finally {
        resumeSessionTimer();
    }
}
