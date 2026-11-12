import { navigate } from "../app.js";
import { state, filePassword, SETTINGS_FILE_NAME, DEFAULT_SETTINGS } from "../state.js";
import { findChild, downloadText, upsertTextFile } from "../drive.js";
import { appMetaProps } from "../lib/meta.js";
import { encryptData, decryptData } from "../crypto/crypto.js";
import { withStatus, showAlert } from "../lib/dialogs.js";

const MIN_TIMEOUT = 60;
const MAX_TIMEOUT = 3600;

let escHandler = null;

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
                <div class="setting-row">
                    <label class="field-label" for="set-theme">App Theme</label>
                    <p class="muted small">Choose the appearance of the app.</p>
                    <select id="set-theme" class="text-input">
                        <option value="Light">Light</option>
                        <option value="Dark">Dark</option>
                    </select>
                </div>
                <div id="set-error" class="inline-error"></div>
            </section>

            <div class="button-row settings-actions">
                <button id="set-cancel" class="btn btn-tonal">Cancel</button>
                <button id="set-save" class="btn btn-filled">Save</button>
            </div>
        </div>`;

    const timeoutInput = container.querySelector("#set-timeout");
    const themeSelect = container.querySelector("#set-theme");
    const saveBtn = container.querySelector("#set-save");
    const err = container.querySelector("#set-error");

    // Populate from settings json (load from Drive to be safe).
    loadSettings(timeoutInput, themeSelect, saveBtn);

    container.querySelector("#set-cancel").addEventListener("click", () => navigate("main"));
    saveBtn.addEventListener("click", () => onSave(timeoutInput, themeSelect, err));

    // Escape dismisses the settings page, same as pressing Cancel.
    escHandler = (e) => { if (e.key === "Escape") navigate("main"); };
    document.addEventListener("keydown", escHandler);
}

export function teardown() {
    loadGeneration++; // a refresh from Drive still under way belongs to a page that is gone
    if (escHandler) {
        document.removeEventListener("keydown", escHandler);
        escHandler = null;
    }
}

// Counts the times the page was shown or left. A refresh from Drive only counts while the page it
// was started for is still the one shown; one that ends later is ignored.
let loadGeneration = 0;

async function loadSettings(timeoutInput, themeSelect, saveBtn) {
    const generation = ++loadGeneration;
    // Reflect current in-memory values immediately, then refresh from Drive.
    const cur = state.settingsJson || {};
    timeoutInput.value = cur.session_timeout_seconds || DEFAULT_SETTINGS.session_timeout_seconds;
    themeSelect.value = cur.app_theme || DEFAULT_SETTINGS.app_theme;
    // Until the refresh is done the settings can't be changed or saved: it overwrites the fields
    // (a change made meanwhile would silently be undone) and the settings in memory (a Save made
    // meanwhile would be undone in memory, though stored in Drive). Cancel / Escape still work.
    const controls = [timeoutInput, themeSelect, saveBtn];
    for (const c of controls) c.disabled = true;
    try {
        const meta = await findChild(state.folders.config, SETTINGS_FILE_NAME);
        if (meta && generation === loadGeneration) {
            const cipher = await withStatus("Loading...", () => downloadText(meta.id));
            if (generation !== loadGeneration) return; // the page was left meanwhile
            const json = JSON.parse(decryptData(cipher, filePassword()));
            state.settingsJson = json;
            timeoutInput.value = json.session_timeout_seconds || DEFAULT_SETTINGS.session_timeout_seconds;
            themeSelect.value = json.app_theme || DEFAULT_SETTINGS.app_theme;
        }
    } catch (e) {
        console.error(e);
    } finally {
        if (generation === loadGeneration) for (const c of controls) c.disabled = false;
    }
}

async function onSave(timeoutInput, themeSelect, err) {
    err.textContent = "";
    const value = parseInt(timeoutInput.value, 10);
    if (!Number.isInteger(value) || value < MIN_TIMEOUT || value > MAX_TIMEOUT) {
        err.textContent = `Session timeout must be a number between ${MIN_TIMEOUT} and ${MAX_TIMEOUT} seconds.`;
        return;
    }
    const theme = themeSelect.value === "Dark" ? "Dark" : "Light";
    try {
        state.settingsJson = { ...state.settingsJson, session_timeout_seconds: value, app_theme: theme };
        await withStatus("Saving...", async () => {
            const cipher = encryptData(JSON.stringify(state.settingsJson), filePassword());
            await upsertTextFile(SETTINGS_FILE_NAME, cipher, state.folders.config, appMetaProps("settings"));
        });
        // navigate() re-applies the theme from settings json, refreshing the app.
        navigate("main");
    } catch (e) {
        console.error(e);
        await showAlert("Could not save settings.", "Error");
    }
}
