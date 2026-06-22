import { navigate } from "../app.js";
import { state } from "../state.js";
import { requestAccessToken } from "../lib/google.js";
import { withStatus, showAlert } from "../lib/dialogs.js";
import { loadUserInfo, ensureFolders, isNewUser } from "../flow.js";
import { cryptoReady } from "../crypto/crypto.js";

export function render(container) {
    container.innerHTML = `
        <div class="page page-centered">
            <div class="auth-card">
                <h1 class="brand-title">eNotes</h1>
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
        if (newUser) {
            navigate("setup");
        } else {
            navigate("masterPassword");
        }
    } catch (err) {
        console.error(err);
        await showAlert("Could not access your Google Drive. Please try logging in again.", "Error");
    }
}
