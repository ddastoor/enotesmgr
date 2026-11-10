import { navigate, logout } from "../app.js";
import { state } from "../state.js";
import { requestAccessToken } from "../lib/google.js";
import { withStatus, showAlert, buildModal } from "../lib/dialogs.js";
import { loadUserInfo, ensureFolders, isNewUser, existingData } from "../flow.js";
import { cryptoReady } from "../crypto/crypto.js";

export function render(container) {
    container.innerHTML = `
        <div class="page page-centered">
            <div class="auth-card">
                <h1 class="brand-title">eNotesMgr</h1>
                <p class="tagline">Your notes, securely stored on Google Drive.</p>
                <button id="login-btn" class="btn btn-filled btn-google">
                    <span class="g-icon">G</span>
                    Login with Google
                </button>
            </div>
        </div>`;

    container.querySelector("#login-btn").addEventListener("click", onLogin);
}

async function onLogin() {
    let token;
    try {
        token = await requestAccessToken();
    } catch (err) {
        await showAlert("Google sign-in was cancelled or failed. Please try again.", "Sign-in failed");
        return;
    }
    state.accessToken = token;

    try {
        await withStatus("Loading...", async () => {
            await cryptoReady; // ensure WASM crypto is ready for the session
            await loadUserInfo();
            await ensureFolders();
        });

        const newUser = await withStatus("Loading...", () => isNewUser());
        if (!newUser) {
            navigate("masterPassword");
            return;
        }
        // No config.json. Only a genuinely empty account gets the setup page:
        // setting up over existing data would create a second config.json with
        // a NEW key, next to the real one (see instructions/data-storage.md).
        const data = await withStatus("Loading...", () => existingData());
        if (data.recoveryCodes > 0) {
            await showAlert(
                "Your eNotesMgr data was found in Google Drive, but its config file is missing or couldn't be read. " +
                "Nothing has been changed. If this was a temporary Google Drive problem, simply log in again. " +
                "Otherwise, enter one of your recovery codes on the next screen: it restores access to all your notes.",
                "Config file missing"
            );
            navigate("masterPassword");
        } else if (data.notes > 0) {
            const choice = await buildModal({
                title: "Config file missing",
                body: Object.assign(document.createElement("div"), {
                    className: "modal-text",
                    textContent:
                        `You have ${data.notes} note(s) in Google Drive, but their config file is missing and there are no recovery codes, ` +
                        "so they can't be opened. If this is a temporary Google Drive problem, log out and try again later. " +
                        "Setting up a new account will NOT delete those notes, but they can't be opened with it.",
                }),
                buttons: [
                    { label: "Log out", value: "logout", primary: true, variant: "btn-filled", isCancel: true },
                    { label: "Set up a new account", value: "setup", variant: "btn-tonal" },
                ],
            });
            if (choice === "setup") navigate("setup");
            else logout();
        } else {
            navigate("setup"); // a genuinely new user
        }
    } catch (err) {
        console.error(err);
        await showAlert("Could not access your Google Drive. Please try logging in again.", "Error");
    }
}
