import { navigate } from "../app.js";
import { state } from "../state.js";
import { showAlert } from "../lib/dialogs.js";
import { showRestartReminderPopup } from "../recoveryReminder.js";
import { wipeAppData } from "../wipeAppData.js";

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

// Download the prebuilt Node export CLI. It's a static same-origin file
// (www/mynotes-export.js); a download anchor saves it without loading it into
// JS memory. PC only (it's a command-line tool — see ../../instructions).
function downloadExportUtility() {
    const a = document.createElement("a");
    a.href = "mynotes-export.js";
    a.download = "mynotes-export.js";
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// Hand the current Drive access token to the export CLI's online mode (token
// hand-off — see ../../export-cli.md). The token is the live session token the
// app itself uses; the CLI pastes it and calls Drive directly, so the CLI needs
// no OAuth. Valid ~1 hour. PC only.
async function copyExportToken() {
    const token = state.accessToken;
    if (!token) {
        await showAlert("No active session token — please log in again.", "Export token");
        return;
    }
    let copied = false;
    try { await navigator.clipboard.writeText(token); copied = true; } catch { /* clipboard blocked */ }
    await showAlert(
        copied
            ? "Export token copied to the clipboard.\n\nIn a terminal run:\n  node mynotes-export.js -m on\n\nand paste the token when prompted. It is valid for about 1 hour."
            : "Copy this export token and paste it into the CLI ('node mynotes-export.js -m on') when prompted:\n\n" + token,
        "Export token"
    );
}

// Left vertical menu pane that slides in from the left. Rendered into
// #overlay-root so it floats above the current page.
export function openMenu() {
    const rootEl = document.getElementById("overlay-root");

    // The export utility is a desktop command-line tool, so its download item is
    // shown on PC only (not mobile).
    const exportItem = isMobile() ? "" : `
                <li class="drawer-section">Tools (PC only)</li>
                <li>
                    <button class="drawer-item" data-action="dl-export" title="Download the command-line export utility (mynotes-export.js)">
                        Download Export Utility
                    </button>
                </li>
                <li>
                    <button class="drawer-item" data-action="copy-token" title="Copy a token for the export utility's online mode">
                        Copy Export Token
                    </button>
                </li>`;

    // "Wipe all App Data" is destructive and desktop-only (PC only).
    const wipeItem = isMobile() ? "" : `
                <li class="drawer-section">Danger Zone (PC only)</li>
                <li>
                    <button class="drawer-item drawer-item-danger" data-action="wipe-data" title="Permanently delete the eNotes Manager folder and all its contents from Google Drive">
                        Wipe all App Data
                    </button>
                </li>`;

    const wrap = document.createElement("div");
    wrap.className = "drawer-backdrop";
    wrap.innerHTML = `
        <nav class="drawer">
            <button class="btn btn-tonal drawer-dismiss">Dismiss</button>
            <ul class="drawer-list">
                <li>
                    <button class="drawer-item" data-action="recovery" title="Generate Recovery Codes">
                        Recovery Codes
                    </button>
                </li>
                <li>
                    <button class="drawer-item" data-action="restart-reminder" title="Start recovery code generation reminder again">
                        Restart Recovery Reminders
                    </button>
                </li>${exportItem}${wipeItem}
            </ul>
        </nav>`;

    function close() {
        document.removeEventListener("keydown", onKey);
        wrap.remove();
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    wrap.addEventListener("click", (e) => {
        if (e.target === wrap) close(); // click outside the pane
    });
    wrap.querySelector(".drawer-dismiss").addEventListener("click", close);
    wrap.querySelector('[data-action="recovery"]').addEventListener("click", () => {
        close();
        navigate("recoveryCodes");
    });
    wrap.querySelector('[data-action="restart-reminder"]').addEventListener("click", () => {
        close();
        showRestartReminderPopup();
    });
    const exportBtn = wrap.querySelector('[data-action="dl-export"]');
    if (exportBtn) exportBtn.addEventListener("click", () => {
        close();
        downloadExportUtility();
    });
    const tokenBtn = wrap.querySelector('[data-action="copy-token"]');
    if (tokenBtn) tokenBtn.addEventListener("click", () => {
        close();
        copyExportToken();
    });
    const wipeBtn = wrap.querySelector('[data-action="wipe-data"]');
    if (wipeBtn) wipeBtn.addEventListener("click", () => {
        close();
        wipeAppData();
    });
    document.addEventListener("keydown", onKey);

    rootEl.appendChild(wrap);
    // Trigger slide-in animation.
    requestAnimationFrame(() => wrap.classList.add("open"));
}
