import { navigate } from "../app.js";
import { state, filePassword, SETTINGS_FILE_NAME, DEFAULT_SETTINGS } from "../state.js";
import { findChild, downloadText, upsertTextFile } from "../drive.js";
import { encryptData, decryptData } from "../crypto/crypto.js";
import { withStatus, showAlert } from "../lib/dialogs.js";

const MIN_TIMEOUT = 60;
const MAX_TIMEOUT = 3600;

export function render(container) {
    container.innerHTML = `
        <div class="page settings-page">
            <header class="app-header">
                <div class="header-top">
                    <h1 class="brand-title gradient small">Settings</h1>
                </div>
            </header>

            <section class="settings-scroll">
                <div class="setting-row">
                    <label class="field-label" for="set-timeout">Session Timeout Seconds</label>
                    <p class="muted small">Your Google session time in seconds (60–3600).</p>
                    <input id="set-timeout" type="number" min="60" max="3600" class="text-input" />
                </div>
                <div id="set-error" class="inline-error"></div>
            </section>

            <div class="button-row settings-actions">
                <button id="set-cancel" class="btn btn-tonal">Cancel</button>
                <button id="set-save" class="btn btn-filled">Save</button>
            </div>
        </div>`;

    const timeoutInput = container.querySelector("#set-timeout");
    const err = container.querySelector("#set-error");

    // Populate from settings json (load from Drive to be safe).
    loadSettings(timeoutInput);

    container.querySelector("#set-cancel").addEventListener("click", () => navigate("main"));
    container.querySelector("#set-save").addEventListener("click", () => onSave(timeoutInput, err));
}

async function loadSettings(timeoutInput) {
    // Reflect current in-memory value immediately, then refresh from Drive.
    const current = (state.settingsJson && state.settingsJson.session_timeout_seconds) || DEFAULT_SETTINGS.session_timeout_seconds;
    timeoutInput.value = current;
    try {
        const meta = await findChild(state.folders.config, SETTINGS_FILE_NAME);
        if (meta) {
            const cipher = await withStatus("Loading...", () => downloadText(meta.id));
            const json = JSON.parse(decryptData(cipher, filePassword()));
            state.settingsJson = json;
            timeoutInput.value = json.session_timeout_seconds;
        }
    } catch (e) {
        console.error(e);
    }
}

async function onSave(timeoutInput, err) {
    err.textContent = "";
    const value = parseInt(timeoutInput.value, 10);
    if (!Number.isInteger(value) || value < MIN_TIMEOUT || value > MAX_TIMEOUT) {
        err.textContent = `Session timeout must be a number between ${MIN_TIMEOUT} and ${MAX_TIMEOUT} seconds.`;
        return;
    }
    try {
        state.settingsJson = { ...state.settingsJson, session_timeout_seconds: value };
        await withStatus("Saving...", async () => {
            const cipher = encryptData(JSON.stringify(state.settingsJson), filePassword());
            await upsertTextFile(SETTINGS_FILE_NAME, cipher, state.folders.config);
        });
        navigate("main");
    } catch (e) {
        console.error(e);
        await showAlert("Could not save settings.", "Error");
    }
}
