import { runNewUserLogin } from "../newUserLogin.js";

// Master password must be >= 8 chars and contain at least one digit.
export function validateMasterPassword(pwd) {
    if (pwd.length < 8) return "Master password must be at least 8 characters long.";
    if (!/\d/.test(pwd)) return "Master password must contain at least 1 digit.";
    return null;
}

export function render(container) {
    container.innerHTML = `
        <div class="page page-centered">
            <div class="auth-card">
                <h1 class="brand-title small">eNotes</h1>
                <h2 class="page-heading">Set up your account</h2>

                <label class="field-label" for="su-pwd">Master password:</label>
                <input id="su-pwd" type="password" class="text-input" autocomplete="new-password" />

                <label class="field-label" for="su-pwd2">Re-enter master password:</label>
                <input id="su-pwd2" type="password" class="text-input" autocomplete="new-password" />

                <label class="checkbox-row">
                    <input id="su-gen" type="checkbox" checked />
                    <span>Generate Recovery codes</span>
                </label>

                <div id="su-error" class="inline-error"></div>

                <button id="su-finish" class="btn btn-filled full-width">Finish Setup</button>
            </div>
        </div>`;

    const pwd = container.querySelector("#su-pwd");
    const pwd2 = container.querySelector("#su-pwd2");
    const gen = container.querySelector("#su-gen");
    const err = container.querySelector("#su-error");

    container.querySelector("#su-finish").addEventListener("click", async () => {
        err.textContent = "";
        const p1 = pwd.value;
        const p2 = pwd2.value;

        const ruleError = validateMasterPassword(p1);
        if (ruleError) { err.textContent = ruleError; return; }
        if (p1 !== p2) { err.textContent = "The two passwords do not match."; return; }

        try {
            await runNewUserLogin(p1, gen.checked);
        } catch (e) {
            console.error(e);
            err.textContent = e && e.message === "ENCRYPT_VERIFY_FAILED"
                ? "Could not securely create your account (encryption self-check failed). Please try again."
                : "Something went wrong creating your account. Please try again.";
        }
    });
}
