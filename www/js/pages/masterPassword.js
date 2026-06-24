import { navigate, logout } from "../app.js";
import {
    state,
    CONFIG_FILE_NAME,
    SETTINGS_FILE_NAME,
} from "../state.js";
import { findChild, downloadText, upsertTextFile, deleteFile } from "../drive.js";
import { appMetaProps } from "../lib/meta.js";
import { decryptData, encryptData } from "../crypto/crypto.js";
import { withStatus, showAlert } from "../lib/dialogs.js";
import { listRecoveryFiles, findRecoveryFile } from "../recovery.js";
import { promptResetPassword } from "./resetMasterPassword.js";

let backGuard = null;

export function render(container) {
    container.innerHTML = `
        <div class="page page-centered unlock-page">
            <div class="auth-card">
                <h2 class="page-heading">Unlock eNotes</h2>
                <p class="muted">Enter your master password (or recovery code if you've forgotten your master password)</p>

                <div class="mp-input-wrap">
                    <input id="mp-input" type="password" class="text-input" autocomplete="off"
                           placeholder="Master password or recovery code" />
                    <button id="mp-go" type="button" class="mp-go-btn" aria-label="Unlock" title="Unlock"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
                </div>

                <div id="mp-error" class="inline-error"></div>

                <div class="button-row">
                    <button id="mp-cancel" class="btn btn-tonal">Cancel</button>
                    <button id="mp-unlock" class="btn btn-filled">Unlock</button>
                </div>
            </div>
        </div>`;

    const input = container.querySelector("#mp-input");
    const err = container.querySelector("#mp-error");

    setTimeout(() => input.focus(), 0);

    container.querySelector("#mp-unlock").addEventListener("click", () => submit(input, err));
    container.querySelector("#mp-go").addEventListener("click", () => submit(input, err));
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit(input, err);
    });
    container.querySelector("#mp-cancel").addEventListener("click", () => exitToLogin());

    installBackGuard();
}

export function teardown() {
    removeBackGuard();
}

// Leaving this popup in any way other than a successful unlock invalidates auth.
function exitToLogin() {
    removeBackGuard();
    logout();
}

function installBackGuard() {
    history.pushState({ mp: true }, "");
    backGuard = () => exitToLogin();
    window.addEventListener("popstate", backGuard);
    document.addEventListener("keydown", escHandler);
}

function escHandler(e) {
    if (e.key === "Escape") exitToLogin();
}

function removeBackGuard() {
    if (backGuard) {
        window.removeEventListener("popstate", backGuard);
        document.removeEventListener("keydown", escHandler);
        backGuard = null;
    }
}

async function submit(input, err) {
    err.textContent = "";
    const value = input.value;
    if (!value) return; // empty: do nothing

    // Exactly 16 digits (numbers only) means a recovery code. Anything with a
    // non-digit character — or any other length — is treated as a master password.
    const isRecoveryCode = /^\d{16}$/.test(value);
    if (isRecoveryCode) {
        await handleRecoveryCode(value, err);
    } else {
        await handleMasterPassword(value, err);
    }
}

async function handleMasterPassword(masterPassword, err) {
    try {
        await withStatus("Unlocking...", async () => {
            const configMeta = await findChild(state.folders.config, CONFIG_FILE_NAME);
            const settingsMeta = await findChild(state.folders.config, SETTINGS_FILE_NAME);
            const configCipher = await downloadText(configMeta.id);

            let configJson;
            try {
                configJson = JSON.parse(decryptData(configCipher, masterPassword));
            } catch (_) {
                throw new Error("DECRYPT_FAILED");
            }
            state.configJson = configJson;

            if (settingsMeta) {
                const settingsCipher = await downloadText(settingsMeta.id);
                state.settingsJson = JSON.parse(decryptData(settingsCipher, configJson.file_password));
            }
        });
    } catch (e) {
        if (e.message === "DECRYPT_FAILED") {
            err.textContent = "Decryption failed. Please check your master password";
        } else {
            console.error(e);
            err.textContent = "Something went wrong. Please try again.";
        }
        return;
    }

    removeBackGuard();
    navigate("main");
}

async function handleRecoveryCode(code, err) {
    // Are there any recovery files at all?
    const recoveryFiles = await withStatus("Checking...", () => listRecoveryFiles());
    if (recoveryFiles.length === 0) {
        await showAlert(
            "Sorry, you're out of luck - you don't have any recovery codes left. Try your best to remember your master password!!",
            "No recovery codes"
        );
        exitToLogin();
        return;
    }

    const recoveryFile = await findRecoveryFile(code);
    if (!recoveryFile) {
        err.textContent = "Invalid recovery code";
        return;
    }

    let recoveryJson;
    try {
        const cipher = await withStatus("Verifying...", () => downloadText(recoveryFile.id));
        recoveryJson = JSON.parse(decryptData(cipher, code));
    } catch (_) {
        err.textContent = "Invalid recovery code";
        return;
    }

    // Code valid: ask user for a new master password. The reset page installs
    // its own exit guards, so release ours while it is shown.
    removeBackGuard();
    const newMaster = await promptResetPassword();
    if (newMaster === null) {
        logout();
        return;
    }

    try {
        await withStatus("Resetting master password...", async () => {
            state.configJson = recoveryJson;
            const configFile = encryptData(JSON.stringify(state.configJson), newMaster);
            await upsertTextFile(CONFIG_FILE_NAME, configFile, state.folders.config, appMetaProps("config"));

            // Decrypt settings with the file password to reflect them.
            const settingsMeta = await findChild(state.folders.config, SETTINGS_FILE_NAME);
            if (settingsMeta) {
                const settingsCipher = await downloadText(settingsMeta.id);
                state.settingsJson = JSON.parse(decryptData(settingsCipher, recoveryJson.file_password));
            }

            await deleteFile(recoveryFile.id);
        });
    } catch (e) {
        console.error(e);
        err.textContent = "Something went wrong resetting your password. Please try again.";
        return;
    }

    await showAlert(
        "Recovery code used successfully and exhausted. Your master password has been reset. You can now use your new master password to login",
        "Master password reset"
    );
    exitToLogin();
}
