import { navigate, logout } from "../app.js";
import {
    state,
    CONFIG_FILE_NAME,
    SETTINGS_FILE_NAME,
} from "../state.js";
import { findChild, listChildren, downloadText, upsertTextFile, deleteFile } from "../drive.js";
import { appMetaProps } from "../lib/meta.js";
import { decryptData, encryptVerified } from "../crypto/crypto.js";
import { withStatus, showAlert } from "../lib/dialogs.js";
import { listRecoveryFiles, findRecoveryFile } from "../recovery.js";
import { maybeShowRecoveryReminder, requireCodesAfterReset } from "../recoveryReminder.js";
import { promptResetPassword } from "./resetMasterPassword.js";

let backGuard = null;

export function render(container) {
    container.innerHTML = `
        <div class="page page-centered unlock-page">
            <div class="auth-card">
                <h2 class="page-heading">Unlock eNotesMgr</h2>
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

// Load and decrypt config.json. Normally there is exactly one (unchanged path).
// If duplicates exist (Drive allows same-named files), be careful - one of them
// may be the ONLY key to the user's notes (see instructions/data-storage.md):
//   - use the copy whose file password actually opens the existing notes
//     (else the oldest by DateTimeCreated, else the first);
//   - delete only EXACT duplicates of it (same file password);
//   - never delete a copy that doesn't open with this master password, or that
//     holds a different file password.
// Returns the config json, or throws NO_CONFIG / DECRYPT_FAILED.
async function loadConfigJson(masterPassword) {
    const configFiles = (await listChildren(state.folders.config))
        .filter((f) => f.name === CONFIG_FILE_NAME);

    if (configFiles.length === 0) throw new Error("NO_CONFIG");

    if (configFiles.length === 1) {
        const cipher = await downloadText(configFiles[0].id);
        try {
            return JSON.parse(decryptData(cipher, masterPassword));
        } catch (_) {
            throw new Error("DECRYPT_FAILED");
        }
    }

    // Several copies: which ones open with this master password?
    const opened = [];
    for (const f of configFiles) {
        try {
            const json = JSON.parse(decryptData(await downloadText(f.id), masterPassword));
            if (json && typeof json.file_password === "string" && json.file_password) opened.push({ file: f, json });
        } catch (_) {
            /* not this password's copy - left alone */
        }
    }
    if (opened.length === 0) throw new Error("DECRYPT_FAILED"); // keep all, delete none

    const keeper = await pickConfigToUse(opened);

    for (const o of opened) {
        if (o !== keeper && o.json.file_password === keeper.json.file_password) {
            try {
                await deleteFile(o.file.id); // an exact duplicate: safe to remove
            } catch (delErr) {
                console.error("Failed to delete duplicate config.json", delErr);
            }
        }
    }
    return keeper.json;
}

// Of several config.json copies that open with the master password, the one to
// use: the one whose file password opens the existing notes (up to 5 notes are
// tried); otherwise the oldest (DateTimeCreated); otherwise the first.
async function pickConfigToUse(opened) {
    const byAge = [...opened].sort((a, b) =>
        ((a.file.appProperties || {}).DateTimeCreated || "9999").localeCompare((b.file.appProperties || {}).DateTimeCreated || "9999"));
    const distinctKeys = [...new Set(opened.map((o) => o.json.file_password))];
    if (distinctKeys.length === 1) return byAge[0];

    const notes = (await listChildren(state.folders.entries)).slice(0, 5);
    for (const note of notes) {
        let cipher;
        try { cipher = await downloadText(note.id); } catch (_) { continue; }
        const opens = distinctKeys.filter((key) => {
            try { decryptData(cipher, key); return true; } catch (_) { return false; }
        });
        if (opens.length === 1) return byAge.find((o) => o.json.file_password === opens[0]);
    }
    return byAge[0];
}

async function handleMasterPassword(masterPassword, err) {
    try {
        await withStatus("Unlocking...", async () => {
            const configJson = await loadConfigJson(masterPassword);
            state.configJson = configJson;

            // Settings are a convenience: if they can't be read (e.g. written with a
            // different key), use the defaults rather than blocking the unlock.
            // Saving the settings page writes them back with the right key.
            try {
                const settingsMeta = await findChild(state.folders.config, SETTINGS_FILE_NAME);
                if (settingsMeta) {
                    const settingsCipher = await downloadText(settingsMeta.id);
                    state.settingsJson = JSON.parse(decryptData(settingsCipher, configJson.file_password));
                }
            } catch (settingsErr) {
                console.error("Could not read settings; using defaults", settingsErr);
                state.settingsJson = null;
            }
        });
    } catch (e) {
        if (e.message === "DECRYPT_FAILED") {
            err.textContent = "Decryption failed. Please check your master password";
        } else if (e.message === "NO_CONFIG") {
            err.textContent = "Your config file is missing. Enter one of your recovery codes to restore access to your notes.";
        } else {
            console.error(e);
            err.textContent = "Something went wrong. Please try again.";
        }
        return;
    }

    removeBackGuard();
    navigate("main");
    await maybeShowRecoveryReminder();
}

async function handleRecoveryCode(code, err) {
    // Are there any recovery files at all?
    let recoveryFiles;
    try {
        recoveryFiles = await withStatus("Checking...", () => listRecoveryFiles());
    } catch (e) {
        console.error(e);
        err.textContent = "Something went wrong. Please try again.";
        return;
    }
    if (recoveryFiles.length === 0) {
        await showAlert(
            "Sorry, you're out of luck - you don't have any recovery codes left. Try your best to remember your master password!!",
            "No recovery codes"
        );
        exitToLogin();
        return;
    }

    // Try the code against each recovery file (slow Argon2id decryption, by
    // design - see recovery.js). None decrypting = wrong or already-used code.
    let found;
    try {
        found = await withStatus("Verifying...", () => findRecoveryFile(code, recoveryFiles));
    } catch (e) {
        console.error(e);
        err.textContent = "Something went wrong. Please try again.";
        return;
    }
    if (!found) {
        err.textContent = "Invalid recovery code";
        return;
    }
    const { file: recoveryFile, recoveryJson } = found;

    // Code valid: ask user for a new master password. The reset page installs
    // its own exit guards, so release ours while it is shown.
    removeBackGuard();
    const newMaster = await promptResetPassword();
    if (newMaster === null) {
        logout();
        return;
    }

    // 1) Reset the master password. The code is NOT used up yet, so if this
    //    fails the user can simply try again with the same code.
    try {
        await withStatus("Resetting master password...", async () => {
            state.configJson = recoveryJson;
            // Verify the re-encrypted config decrypts with the new master password
            // before overwriting config.json, so a bad write can't lock the user out.
            const configFile = encryptVerified(JSON.stringify(state.configJson), newMaster);
            await upsertTextFile(CONFIG_FILE_NAME, configFile, state.folders.config, appMetaProps("config"));
        });
    } catch (e) {
        console.error(e);
        // The reset page is still on screen (the unlock page's inline error area
        // is gone), so report in a popup, then start over at login. The code was
        // not used up, so the user can simply try again.
        await showAlert(
            e && e.message === "ENCRYPT_VERIFY_FAILED"
                ? "Could not securely reset your password (encryption self-check failed). Your old config was left untouched and your recovery code was not used up - please try again."
                : "Something went wrong resetting your password. Your recovery code was not used up - please try again.",
            "Reset failed"
        );
        exitToLogin();
        return;
    }

    // 2) Never let a recovery reset leave you with 0 or 1 codes: if you then
    //    forgot the new password too, you'd be locked out for good. So require
    //    10 new codes now, BEFORE this code is used up. If that fails and the
    //    user finishes anyway, the code is kept (not used up) as a way back in.
    const remainingAfterUse = recoveryFiles.length - 1;
    let keepCode = false;
    if (remainingAfterUse <= 1) {
        keepCode = !(await requireCodesAfterReset(remainingAfterUse));
    }

    // 3) Exhaust the code by deleting its recovery file (unless kept above).
    //    Reflect the settings too (non-fatal: the session ends right after).
    let exhausted = !keepCode;
    await withStatus("Finishing...", async () => {
        if (!keepCode) {
            try {
                await deleteFile(recoveryFile.id);
            } catch (e) {
                // 404: already gone - a new set was just generated above, which
                // replaced (deleted) all previous codes, this one included.
                if (!(e && e.status === 404)) {
                    console.error("Failed to exhaust recovery code", e);
                    exhausted = false;
                }
            }
        }
        try {
            const settingsMeta = await findChild(state.folders.config, SETTINGS_FILE_NAME);
            if (settingsMeta) {
                const settingsCipher = await downloadText(settingsMeta.id);
                state.settingsJson = JSON.parse(decryptData(settingsCipher, recoveryJson.file_password));
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    });

    await showAlert(
        keepCode
            ? "Your master password has been reset. You can now use your new master password to login. New recovery codes could not be generated, so the recovery code you just used was NOT used up and still works. Please generate new recovery codes after you log in."
            : exhausted
                ? "Recovery code used successfully and exhausted. Your master password has been reset. You can now use your new master password to login"
                : "Your master password has been reset. You can now use your new master password to login. However, this recovery code could not be marked as used, so please Wipe and re-Generate your recovery codes after logging in.",
        "Master password reset"
    );
    exitToLogin();
}
