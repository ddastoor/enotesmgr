// The "new user login" routine (instructions/new-user-login.md). Runs after a
// new user finishes setup: creates config + settings, persists them encrypted,
// optionally generates recovery codes, then enters the main page.

import {
    state,
    DEFAULT_SETTINGS,
    CONFIG_FILE_NAME,
    SETTINGS_FILE_NAME,
} from "./state.js";
import { navigate } from "./app.js";
import { upsertTextFile } from "./drive.js";
import { encryptData } from "./crypto/crypto.js";
import { withStatus, showAlert } from "./lib/dialogs.js";
import { generateRecoveryCodes } from "./recovery.js";

export async function runNewUserLogin(masterPassword, generateRecovery) {
    await withStatus("Setting up your account...", async () => {
        // Build fresh settings + config json.
        state.settingsJson = { ...DEFAULT_SETTINGS };
        state.configJson = { file_password: crypto.randomUUID() };

        const configFile = encryptData(JSON.stringify(state.configJson), masterPassword);
        const settingsFile = encryptData(JSON.stringify(state.settingsJson), state.configJson.file_password);

        await upsertTextFile(CONFIG_FILE_NAME, configFile, state.folders.config);
        await upsertTextFile(SETTINGS_FILE_NAME, settingsFile, state.folders.config);
    });

    if (generateRecovery) {
        await withStatus("Generating recovery codes...", () => generateRecoveryCodes());
        await showAlert(
            "enotes_recovery_codes.txt has been downloaded to your device. Save it very safely!",
            "Recovery codes downloaded"
        );
    }

    navigate("main");
}
