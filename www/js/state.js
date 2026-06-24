// In-memory application state. Nothing here is persisted across reloads — on
// logout everything is dropped and browser storage cleared.

export const state = {
    accessToken: null,
    userEmail: null,        // full email, e.g. abc@gmail.com
    username: null,         // local part, e.g. abc
    fullName: null,         // Google account display name, e.g. "Jane Doe"

    folders: {              // Drive folder ids, resolved after login
        manager: null,
        entries: null,
        config: null,
        recovery: null,
    },

    configJson: null,       // decrypted config: { file_password: "..." }
    settingsJson: null,     // decrypted settings: { session_timeout_seconds: N, app_theme: "Light"|"Dark" }

    // Used transiently to carry a freshly chosen master password between the
    // setup / reset flows and the new-user-login routine.
    pendingMasterPassword: null,
    generateRecoveryOnSetup: false,
};

export function filePassword() {
    return state.configJson && state.configJson.file_password;
}

export function resetState() {
    state.accessToken = null;
    state.userEmail = null;
    state.username = null;
    state.fullName = null;
    state.folders = { manager: null, entries: null, config: null, recovery: null };
    state.configJson = null;
    state.settingsJson = null;
    state.pendingMasterPassword = null;
    state.generateRecoveryOnSetup = false;
}

export const DEFAULT_SETTINGS = { session_timeout_seconds: 60, app_theme: "Light" };

export const CONFIG_FILE_NAME = "config.json";
export const SETTINGS_FILE_NAME = "settings.json";
export const ONE_RECOVERY_LEFT_MARKER = "only-one-recovery-file-left-dont-ask-marker-file";
