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

// Run an async function while showing a status message; always hides after.
export async function withStatus(message, fn) {
    showStatus(message);
    try {
        return await fn();
    } finally {
        hideStatus();
    }
}

function buildModal({ title, body, buttons }) {
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

// Returns the entered string, or null if cancelled.
export function showPrompt(message, { title = "", initial = "", placeholder = "" } = {}) {
    const body = document.createElement("div");
    body.className = "modal-text";
    const label = document.createElement("div");
    label.textContent = message;
    label.style.marginBottom = "10px";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.value = initial;
    input.placeholder = placeholder;
    const err = document.createElement("div");
    err.className = "inline-error";
    body.append(label, input, err);

    setTimeout(() => input.focus(), 0);

    const result = buildModal({
        title,
        body,
        buttons: [
            { label: "Cancel", value: null, variant: "btn-tonal", isCancel: true },
            {
                label: "OK",
                primary: true,
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
