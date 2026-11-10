// Transient status overlay + modal dialogs (alert / confirm / prompt).
// All overlays render into #overlay-root.

function root() {
    return document.getElementById("overlay-root");
}

let statusEl = null;

// Show a transient status overlay in the middle of the screen at ~50% opacity.
// Stays until hideStatus() is called. Safe to call repeatedly to update text.
export function showStatus(message) {
    if (!statusEl) {
        statusEl = document.createElement("div");
        statusEl.className = "status-overlay";
        statusEl.innerHTML = `
            <div class="status-box">
                <div class="status-spinner"></div>
                <div class="status-text"></div>
            </div>`;
        root().appendChild(statusEl);
    }
    statusEl.querySelector(".status-text").textContent = message;
    statusEl.style.display = "flex";
}

export function hideStatus() {
    if (statusEl) statusEl.style.display = "none";
}

// Briefly flash an informational status message (no spinner, since no work is
// happening), then auto-hide it. Used for quick notices like "Nothing to save..".
export async function flashStatus(message, ms = 1300) {
    showStatus(message);
    const spinner = statusEl.querySelector(".status-spinner");
    if (spinner) spinner.style.display = "none";
    try {
        await new Promise((resolve) => setTimeout(resolve, ms));
    } finally {
        hideStatus();
        if (spinner) spinner.style.display = ""; // restore for the next showStatus()
    }
}

// Run an async function while showing a status message; always hides after.
export async function withStatus(message, fn) {
    showStatus(message);
    try {
        return await fn();
    } finally {
        hideStatus();
    }
}

export function buildModal({ title, body, buttons }) {
    return new Promise((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";

        const modal = document.createElement("div");
        modal.className = "modal-card";

        const titleHtml = title ? `<h2 class="modal-title">${escapeHtml(title)}</h2>` : "";
        modal.innerHTML = `${titleHtml}<div class="modal-body"></div><div class="modal-actions"></div>`;
        modal.querySelector(".modal-body").append(body);

        const actions = modal.querySelector(".modal-actions");
        buttons.forEach((btn) => {
            const b = document.createElement("button");
            b.textContent = btn.label;
            b.className = "btn " + (btn.variant || "btn-tonal");
            b.addEventListener("click", () => {
                const value = btn.onClick ? btn.onClick() : btn.value;
                if (value === undefined) return; // validation may cancel close
                close(value);
            });
            actions.appendChild(b);
            if (btn.primary) setTimeout(() => b.focus(), 0);
        });

        function onKey(e) {
            // Popup removed without being answered (logout closes open popups):
            // drop this listener and never resolve, so a later Escape can't
            // trigger the old popup's cancel action.
            if (!backdrop.isConnected) {
                document.removeEventListener("keydown", onKey);
                return;
            }
            if (e.key === "Escape") {
                const cancelBtn = buttons.find((x) => x.isCancel);
                if (cancelBtn) close(cancelBtn.value);
            }
        }
        document.addEventListener("keydown", onKey);

        function close(value) {
            document.removeEventListener("keydown", onKey);
            backdrop.remove();
            resolve(value);
        }

        backdrop.appendChild(modal);
        root().appendChild(backdrop);
    });
}

export function showAlert(message, title = "") {
    const body = document.createElement("div");
    body.className = "modal-text";
    body.textContent = message;
    return buildModal({
        title,
        body,
        buttons: [{ label: "OK", value: true, primary: true, variant: "btn-filled", isCancel: true }],
    });
}

export function showConfirm(message, title = "") {
    const body = document.createElement("div");
    body.className = "modal-text";
    body.textContent = message;
    return buildModal({
        title,
        body,
        buttons: [
            { label: "Cancel", value: false, variant: "btn-tonal", isCancel: true },
            { label: "OK", value: true, primary: true, variant: "btn-filled" },
        ],
    });
}

// Returns the entered string, or null if cancelled. When selectAll is true the
// initial text is selected (highlighted) once focused, so the user can overtype.
export function showPrompt(message, { title = "", initial = "", placeholder = "", selectAll = false, type = "text" } = {}) {
    const body = document.createElement("div");
    body.className = "modal-text";
    const label = document.createElement("div");
    label.textContent = message;
    label.style.marginBottom = "10px";
    const input = document.createElement("input");
    input.type = type;
    input.autocomplete = "off";
    input.className = "text-input";
    input.value = initial;
    input.placeholder = placeholder;
    const err = document.createElement("div");
    err.className = "inline-error";
    body.append(label, input, err);

    setTimeout(() => {
        input.focus();
        if (selectAll) input.select();
    }, 0);

    const result = buildModal({
        title,
        body,
        buttons: [
            { label: "Cancel", value: null, variant: "btn-tonal", isCancel: true },
            {
                label: "OK",
                variant: "btn-filled",
                onClick: () => {
                    const v = input.value.trim();
                    if (!v) {
                        err.textContent = "Please enter a value.";
                        return undefined;
                    }
                    return v;
                },
            },
        ],
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const v = input.value.trim();
            if (v) {
                input.closest(".modal-card").querySelectorAll(".modal-actions .btn")[1].click();
            }
        }
    });

    return result;
}

// Password dialog, used for sensitive notes' own passwords. Unlike showPrompt the
// value is NOT trimmed (every character of a password counts). Options:
//   confirm  - ask twice (a NEW password): both entries must match.
//   validate - (pwd) => error message or null; an error keeps the dialog open.
//   warning  - text shown in a highlighted box under the message.
//   error    - pre-filled inline error (e.g. "Wrong password. Try again.").
// Resolves with the password, or null if cancelled.
export function showPasswordPrompt(message, {
    title = "", okLabel = "OK", confirm = false, validate = null, warning = "", error = "",
} = {}) {
    const body = document.createElement("div");
    body.className = "modal-text";
    const label = document.createElement("div");
    label.textContent = message;
    label.style.marginBottom = "10px";
    body.append(label);
    if (warning) {
        const warn = document.createElement("div");
        warn.className = "modal-warning";
        warn.textContent = warning;
        body.append(warn);
    }
    const field = (placeholder) => {
        const input = document.createElement("input");
        input.type = "password";
        // Keep browsers from filling in / offering to save the master password here.
        input.autocomplete = confirm ? "new-password" : "off";
        input.spellcheck = false;
        input.className = "text-input pwd-input";
        input.placeholder = placeholder;
        body.append(input);
        return input;
    };
    const pwd = field(confirm ? "New password" : "Password");
    const pwd2 = confirm ? field("Re-enter the new password") : null;
    const err = document.createElement("div");
    err.className = "inline-error";
    err.textContent = error;
    body.append(err);

    setTimeout(() => pwd.focus(), 0);

    const submit = () => {
        const v = pwd.value;
        if (!v) { err.textContent = "Please enter a password."; return undefined; }
        if (pwd2 && v !== pwd2.value) { err.textContent = "The two passwords don't match."; return undefined; }
        const problem = validate ? validate(v) : null;
        if (problem) { err.textContent = problem; return undefined; }
        return v;
    };
    const result = buildModal({
        title,
        body,
        buttons: [
            { label: "Cancel", value: null, variant: "btn-tonal", isCancel: true },
            { label: okLabel, variant: "btn-filled", onClick: submit },
        ],
    });
    [pwd, pwd2].filter(Boolean).forEach((input) => input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (pwd2 && input === pwd && !pwd2.value) { pwd2.focus(); return; }
        input.closest(".modal-card").querySelectorAll(".modal-actions .btn")[1].click();
    }));
    return result;
}

// Yes / No / Cancel style confirm used for "save current note?" prompts.
// Returns "yes", "no", or "cancel".
export function showYesNo(message, title = "") {
    const body = document.createElement("div");
    body.className = "modal-text";
    body.textContent = message;
    return buildModal({
        title,
        body,
        buttons: [
            { label: "Cancel", value: "cancel", variant: "btn-tonal", isCancel: true },
            { label: "No", value: "no", variant: "btn-tonal" },
            { label: "Yes", value: "yes", primary: true, variant: "btn-filled" },
        ],
    });
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
