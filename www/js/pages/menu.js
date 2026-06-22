import { navigate } from "../app.js";

// Left vertical menu pane that slides in from the left. Rendered into
// #overlay-root so it floats above the current page.
export function openMenu() {
    const rootEl = document.getElementById("overlay-root");

    const wrap = document.createElement("div");
    wrap.className = "drawer-backdrop";
    wrap.innerHTML = `
        <nav class="drawer">
            <button class="btn btn-tonal drawer-dismiss">Dismiss</button>
            <ul class="drawer-list">
                <li>
                    <button class="drawer-item" data-action="recovery" title="Generate Recovery Codes">
                        Recovery Codes
                    </button>
                </li>
            </ul>
        </nav>`;

    function close() {
        document.removeEventListener("keydown", onKey);
        wrap.remove();
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    wrap.addEventListener("click", (e) => {
        if (e.target === wrap) close(); // click outside the pane
    });
    wrap.querySelector(".drawer-dismiss").addEventListener("click", close);
    wrap.querySelector('[data-action="recovery"]').addEventListener("click", () => {
        close();
        navigate("recoveryCodes");
    });
    document.addEventListener("keydown", onKey);

    rootEl.appendChild(wrap);
    // Trigger slide-in animation.
    requestAnimationFrame(() => wrap.classList.add("open"));
}
