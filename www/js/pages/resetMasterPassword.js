import { validateMasterPassword } from "./setup.js";

// Renders the reset-master-password UI into #app and resolves with the chosen
// new master password, or null if the user cancels / escapes / navigates back.
export function promptResetPassword() {
    return new Promise((resolve) => {
        const container = document.getElementById("app");
        container.innerHTML = `
            <div class="page page-centered">
                <div class="auth-card">
                    <h2 class="page-heading">Reset master password</h2>
                    <p class="muted">Please reset your master password</p>

                    <label class="field-label" for="rmp-pwd">New master password:</label>
                    <input id="rmp-pwd" type="password" class="text-input" autocomplete="new-password" />

                    <label class="field-label" for="rmp-pwd2">Re-enter new master password:</label>
                    <input id="rmp-pwd2" type="password" class="text-input" autocomplete="new-password" />

                    <div id="rmp-error" class="inline-error"></div>

                    <div class="button-row">
                        <button id="rmp-cancel" class="btn btn-tonal">Cancel</button>
                        <button id="rmp-reset" class="btn btn-filled">Reset</button>
                    </div>
                </div>
            </div>`;

        const pwd = container.querySelector("#rmp-pwd");
        const pwd2 = container.querySelector("#rmp-pwd2");
        const err = container.querySelector("#rmp-error");

        setTimeout(() => pwd.focus(), 0);

        let settled = false;
        function finish(value) {
            if (settled) return;
            settled = true;
            window.removeEventListener("popstate", onPop);
            document.removeEventListener("keydown", onKey);
            resolve(value);
        }

        function onPop() { finish(null); }
        function onKey(e) { if (e.key === "Escape") finish(null); }

        history.pushState({ rmp: true }, "");
        window.addEventListener("popstate", onPop);
        document.addEventListener("keydown", onKey);

        container.querySelector("#rmp-cancel").addEventListener("click", () => finish(null));
        container.querySelector("#rmp-reset").addEventListener("click", () => {
            err.textContent = "";
            const p1 = pwd.value;
            const p2 = pwd2.value;
            const ruleError = validateMasterPassword(p1);
            if (ruleError) { err.textContent = ruleError; return; }
            if (p1 !== p2) { err.textContent = "The two passwords do not match."; return; }
            finish(p1);
        });
    });
}

// Router entry point (not normally used directly; reset is driven via the
// promise helper above from the recovery flow).
export function render() {
    promptResetPassword();
}
