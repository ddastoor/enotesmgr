// Note-name search dialog. Shows a search box above a filterable, alphabetically
// sorted list of note names and resolves with the chosen name (or null if the
// user cancels / escapes). The caller is responsible for actually selecting the
// returned note. Renders into #overlay-root so it floats above the main page.

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

// names: an array of note names, already sorted alphabetically by the caller.
export function showNoteSearch(names) {
    return new Promise((resolve) => {
        const mobile = isMobile();

        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";

        const modal = document.createElement("div");
        modal.className = "modal-card search-modal";
        modal.innerHTML = `
            <input type="text" class="text-input search-input" placeholder="Search notes..."
                   autocomplete="off" autocapitalize="off" spellcheck="false" />
            <ul class="search-list" role="listbox" tabindex="0"></ul>
            <div class="modal-actions">
                <button type="button" class="btn btn-tonal search-cancel">Cancel</button>
            </div>`;

        const input = modal.querySelector(".search-input");
        const list = modal.querySelector(".search-list");
        const cancelBtn = modal.querySelector(".search-cancel");

        let filtered = [];   // names currently shown
        let activeIdx = -1;  // highlighted index within `filtered`

        function renderList() {
            // Blank or whitespace-only search is treated as empty -> show all.
            const q = input.value.trim().toLowerCase();
            filtered = q ? names.filter((n) => n.toLowerCase().includes(q)) : names.slice();

            list.innerHTML = "";
            if (filtered.length === 0) {
                const empty = document.createElement("li");
                empty.className = "search-empty";
                empty.textContent = "No matching notes";
                list.appendChild(empty);
                activeIdx = -1;
                return;
            }
            filtered.forEach((name, i) => {
                const li = document.createElement("li");
                li.className = "search-item";
                li.setAttribute("role", "option");
                li.dataset.idx = String(i);
                li.textContent = name;
                list.appendChild(li);
            });
            activeIdx = 0;
            paintActive();
        }

        function paintActive() {
            Array.from(list.querySelectorAll(".search-item")).forEach((li, i) => {
                const on = i === activeIdx;
                li.classList.toggle("active", on);
                li.setAttribute("aria-selected", on ? "true" : "false");
            });
            const el = list.querySelector(".search-item.active");
            if (el) el.scrollIntoView({ block: "nearest" });
        }

        function setActive(i) {
            if (filtered.length === 0) return;
            activeIdx = Math.max(0, Math.min(filtered.length - 1, i));
            paintActive();
        }

        let settled = false;
        function finish(value) {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onEsc);
            backdrop.remove();
            resolve(value);
        }
        function choose(i) {
            if (i >= 0 && i < filtered.length) finish(filtered[i]);
        }

        // Typing/deleting re-filters; refocusing the box selects the whole word.
        input.addEventListener("input", renderList);
        input.addEventListener("focus", () => input.select());
        input.addEventListener("keydown", (e) => {
            // Enter or ArrowDown drops focus into the list at the first match.
            if ((e.key === "ArrowDown" || e.key === "Enter") && filtered.length) {
                e.preventDefault();
                list.focus();
                setActive(0);
            }
        });

        list.addEventListener("focus", () => {
            if (activeIdx < 0 && filtered.length) setActive(0);
        });
        list.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIdx + 1); }
            else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (activeIdx <= 0) input.focus(); // step back up into the search box
                else setActive(activeIdx - 1);
            }
            else if (e.key === "Home") { e.preventDefault(); setActive(0); }
            else if (e.key === "End") { e.preventDefault(); setActive(filtered.length - 1); }
            else if (e.key === "Enter") { e.preventDefault(); choose(activeIdx); }
        });

        // On mobile a single tap selects (no hover/double-click); on PC a single
        // click highlights and a double-click selects.
        list.addEventListener("click", (e) => {
            const li = e.target.closest(".search-item");
            if (!li) return;
            const i = Number(li.dataset.idx);
            if (mobile) choose(i);
            else setActive(i);
        });
        list.addEventListener("dblclick", (e) => {
            const li = e.target.closest(".search-item");
            if (li) choose(Number(li.dataset.idx));
        });

        cancelBtn.addEventListener("click", () => finish(null));
        backdrop.addEventListener("click", (e) => { if (e.target === backdrop) finish(null); });

        function onEsc(e) { if (e.key === "Escape") finish(null); }
        document.addEventListener("keydown", onEsc);

        backdrop.appendChild(modal);
        document.getElementById("overlay-root").appendChild(backdrop);

        renderList();
        setTimeout(() => input.focus(), 0);
    });
}
