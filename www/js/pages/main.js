import { navigate, logout } from "../app.js";
import { state, filePassword } from "../state.js";
import {
    listChildren,
    downloadText,
    createTextFile,
    updateTextFile,
    renameFile,
    deleteFile,
    findChild,
} from "../drive.js";
import { encryptData, decryptData } from "../crypto/crypto.js";
import { withStatus, flashStatus, showAlert, showPrompt, showConfirm, showYesNo, buildModal } from "../lib/dialogs.js";
import { nowStamp } from "../lib/meta.js";
import { showNoteSearch } from "../lib/searchDialog.js";
import { openMenu } from "./menu.js";

// --- page-local state --------------------------------------------------------
let entries = [];          // [{id, name}] sorted alphabetically
let current = null;        // {id, name, meta} or null (dummy); see note-meta-data.md
let dirty = false;
// SHA-256 (hex) of the loaded note's content, used to skip a Save when the
// content is unchanged. null when no richtext note is loaded. See
// snapshotContentHash() / saveCurrentNote().
let savedContentHash = null;

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

// SHA-256 of a string as a lowercase hex digest (Web Crypto; secure-context).
async function sha256Hex(str) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Snapshot the current editor content's hash as the "last saved" baseline, so a
// later Save can be skipped when nothing changed. Computed from the exact same
// serialization (readEditorContent) that Save uses, so an unchanged note hashes
// identically and the Save becomes a no-op.
async function snapshotContentHash() {
    savedContentHash = await sha256Hex(readEditorContent());
}

// --- note metadata -----------------------------------------------------------
// A note entry's metadata (DateTimeCreated/DateTimeModified/CreationMethod/
// FileType) is stored as Drive custom file properties (appProperties), NOT in the
// file contents - the encrypted file holds only the actual note content. See
// instructions/note-meta-data.md. nowStamp() lives in ../lib/meta.js.
//
// Legacy fallback: notes written before this change embedded the metadata in the
// content as a "[metadata begin]...[metadata end]" section followed by one
// newline. parseNote() below reads that old layout when a file has no
// appProperties; such notes migrate to appProperties the next time they're saved.
const META_BEGIN = "[metadata begin]";
const META_END = "[metadata end]";

// Map an uploaded file's MIME type to an allowed FileType, or null if neither
// image nor audio.
function fileTypeFromMime(mime) {
    if (mime && mime.startsWith("image/")) return "image";
    if (mime && mime.startsWith("audio/")) return "audio";
    return null;
}

// Strip a trailing extension from a user-entered filename ('mynote.txt' -> 'mynote').
function stripExtension(name) {
    return name.replace(/\.[^.]+$/, "");
}

// Parse a legacy decrypted note entry (metadata embedded in the content) into
// { meta, content }. Only used as a fallback for notes that have no appProperties
// metadata; the oldest files have no metadata section at all, so we infer it.
function parseNote(text) {
    const beginIdx = text.indexOf(META_BEGIN);
    const endIdx = text.indexOf(META_END);
    if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
        return { meta: inferLegacyMeta(text), content: text };
    }
    const meta = {};
    text.slice(beginIdx + META_BEGIN.length, endIdx).split("\n").forEach((line) => {
        const eq = line.indexOf("=");
        if (eq === -1) return;
        const key = line.slice(0, eq).trim();
        if (key) meta[key] = line.slice(eq + 1).trim();
    });
    // Content follows [metadata end] and exactly one newline.
    let rest = text.slice(endIdx + META_END.length);
    if (rest.startsWith("\r\n")) rest = rest.slice(2);
    else if (rest.startsWith("\n")) rest = rest.slice(1);
    return { meta, content: rest };
}

// Derive metadata for a legacy file that has no embedded metadata section.
function inferLegacyMeta(text) {
    const t = text.trimStart();
    const fileType = t.startsWith("data:image/") ? "image"
        : t.startsWith("data:audio/") ? "audio"
        : "richtext";
    return {
        DateTimeCreated: "",
        DateTimeModified: "",
        CreationMethod: fileType === "richtext" ? "new" : "upload",
        FileType: fileType,
    };
}

const isMediaType = (meta) => meta && meta.FileType !== "richtext";

// Display content using the right control per the FileType metadata key.
function displayNote(meta, content) {
    switch (meta && meta.FileType) {
        case "image":
        case "audio":
            showMedia(content, meta.FileType);
            break;
        default:
            showEditor(content);
    }
}

// --- render ------------------------------------------------------------------
export function render(container) {
    container.innerHTML = `
        <div class="page main-page">
            <header class="app-header">
                <div class="header-top">
                    <h1 class="brand-title gradient">eNotes</h1>
                    <div class="header-actions">
                        <button id="btn-settings" class="icon-btn" title="Settings">⚙️</button>
                        <button id="btn-more" class="icon-btn" title="More options">☰</button>
                        <button id="btn-logout" class="icon-btn" title="Logout" aria-label="Logout"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M5 11H13V13H5V16L0 12L5 8V11ZM3.99927 18H6.70835C8.11862 19.2447 9.97111 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C9.97111 4 8.11862 4.75527 6.70835 6H3.99927C5.82368 3.57111 8.72836 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C8.72836 22 5.82368 20.4289 3.99927 18Z"/></svg></button>
                    </div>
                </div>
                <div id="username" class="username"></div>
                <div id="fullname" class="fullname"></div>
            </header>

            <section class="toolbar glass">
                <select id="file-select" class="file-select" title="Select a note"></select>
                <button id="tb-search" class="btn btn-tonal tb-search" title="Search notes" aria-label="Search notes"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></button>
                <button id="tb-refresh" class="btn btn-tonal" title="Refresh the current note">Refresh</button>
                <button id="tb-new" class="btn btn-tonal" title="Create a new note">New</button>
                <button id="tb-upload" class="btn btn-tonal" title="Upload an image or audio file">Upload</button>
                <button id="tb-save" class="btn btn-filled" title="Save the current note">Save</button>
                <button id="tb-rename" class="btn btn-tonal" title="Rename the current note">Rename</button>
                <button id="tb-delete" class="btn btn-danger" title="Delete the current note">Delete</button>
            </section>

            <section class="note-area">
                <div id="editor-wrap" class="editor-wrap">
                    <div class="editor-toolbar">
                        <button data-cmd="undo" class="fmt-btn fmt-btn-compact" title="Undo">↶</button>
                        <button data-cmd="redo" class="fmt-btn fmt-btn-compact" title="Redo">↷</button>
                        <button data-cmd="bold" class="fmt-btn" title="Bold"><b>B</b></button>
                        <button data-cmd="italic" class="fmt-btn" title="Italic"><i>I</i></button>
                        <button data-cmd="underline" class="fmt-btn" title="Underline"><u>U</u></button>
                        <button id="ins-image" class="fmt-btn" title="Insert Image from local device">🖼️</button>
                        <button id="ins-audio" class="fmt-btn" title="Insert Audio from local device">🔊</button>
                    </div>
                    <div id="editor" class="editor" contenteditable="true"
                         data-placeholder="Write your note here..."></div>
                </div>
                <div id="media-viewer" class="media-viewer" hidden></div>
            </section>
        </div>

        <input id="hidden-upload" type="file" accept="image/*,audio/*" hidden />
        <input id="hidden-ins-image" type="file" accept="image/*" hidden />
        <input id="hidden-ins-audio" type="file" accept="audio/*" hidden />`;

    container.querySelector("#username").textContent = state.username || "";
    container.querySelector("#fullname").textContent = state.fullName || "";

    // Header buttons
    container.querySelector("#btn-settings").addEventListener("click", () => navigate("settings"));
    container.querySelector("#btn-more").addEventListener("click", () => openMenu());
    container.querySelector("#btn-logout").addEventListener("click", () => logout());

    // Toolbar buttons
    container.querySelector("#tb-refresh").addEventListener("click", onRefresh);
    container.querySelector("#tb-new").addEventListener("click", onNew);
    container.querySelector("#tb-upload").addEventListener("click", () =>
        container.querySelector("#hidden-upload").click());
    container.querySelector("#tb-save").addEventListener("click", onSave);
    container.querySelector("#tb-rename").addEventListener("click", onRename);
    container.querySelector("#tb-delete").addEventListener("click", onDelete);

    container.querySelector("#file-select").addEventListener("change", onSelectChange);
    container.querySelector("#tb-search").addEventListener("click", onSearch);

    // Editor format buttons
    container.querySelectorAll(".editor-toolbar [data-cmd]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep selection in editor
            document.execCommand(btn.dataset.cmd, false, null);
            markDirty();
        });
    });
    container.querySelector("#ins-image").addEventListener("mousedown", (e) => {
        e.preventDefault();
        container.querySelector("#hidden-ins-image").click();
    });
    container.querySelector("#ins-audio").addEventListener("mousedown", (e) => {
        e.preventDefault();
        container.querySelector("#hidden-ins-audio").click();
    });

    container.querySelector("#editor").addEventListener("input", markDirty);

    // Keyboard undo/redo. Routed through the same execCommand the toolbar
    // Undo/Redo buttons use, so the keyboard and buttons share one history.
    // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo.
    container.querySelector("#editor").addEventListener("keydown", (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
            e.preventDefault();
            document.execCommand("undo");
            markDirty();
        } else if (k === "y" || (k === "z" && e.shiftKey)) {
            e.preventDefault();
            document.execCommand("redo");
            markDirty();
        }
    });

    // On PC, let the user click an embedded image/audio to select it and then
    // remove it with Delete / Backspace. (Mobile taps already open the image.)
    if (!isMobile()) wireEmbedSelection(container.querySelector("#editor"));

    // Hidden file inputs
    container.querySelector("#hidden-upload").addEventListener("change", onUploadFile);
    container.querySelector("#hidden-ins-image").addEventListener("change", onInsertImage);
    container.querySelector("#hidden-ins-audio").addEventListener("change", onInsertAudio);

    // Keyboard shortcuts are PC-only (see instructions/UI/keyboard-shortcuts.md).
    if (!isMobile()) {
        keydownHandler = onGlobalKeydown;
        document.addEventListener("keydown", keydownHandler);
    }

    refreshEntries();
}

export function teardown() {
    if (keydownHandler) {
        document.removeEventListener("keydown", keydownHandler);
        keydownHandler = null;
    }
}

// --- keyboard shortcuts (PC only) --------------------------------------------
let keydownHandler = null;

// True while a modal/drawer popup is open over the main page; shortcuts are
// suppressed in that case. The transient status spinner (.status-overlay) is
// intentionally not counted as a popup.
function popupOpen() {
    return !!document.querySelector(".modal-backdrop, .drawer-backdrop");
}

function clickToolbar(id) {
    const btn = document.getElementById(id);
    if (btn) btn.click(); // disabled buttons ignore clicks, so state is respected
}

function onGlobalKeydown(e) {
    if (isMobile()) return;
    if (popupOpen()) return; // no shortcuts while another popup is over the page

    const editor = document.getElementById("editor");
    const ae = document.activeElement;
    const inEditor = !!(editor && ae && (ae === editor || editor.contains(ae)));

    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // Ctrl+S: Save. Works anywhere, including inside the editor.
    if (ctrl && !e.altKey && key === "s") {
        e.preventDefault();
        clickToolbar("tb-save");
        return;
    }
    // Ctrl+K: open search. Not while typing in the editor.
    if (ctrl && !e.altKey && key === "k") {
        if (inEditor) return;
        e.preventDefault();
        clickToolbar("tb-search");
        return;
    }

    // Remaining shortcuts: single keys, no Ctrl/Alt/Meta, and not in the editor.
    if (ctrl || e.altKey) return;
    if (inEditor) return;

    switch (e.key) {
        case "/": e.preventDefault(); clickToolbar("tb-search"); break;
        case "?": e.preventDefault(); showShortcutsHelp(); break;
        case "n": case "N": e.preventDefault(); clickToolbar("tb-new"); break;
        case "u": case "U": e.preventDefault(); clickToolbar("tb-upload"); break;
        case "r": case "R": e.preventDefault(); clickToolbar("tb-rename"); break;
        case "d": case "D": e.preventDefault(); clickToolbar("tb-delete"); break;
    }
}

// '?' help popup listing the main-page keyboard shortcuts.
function showShortcutsHelp() {
    const rows = [
        ["/ &nbsp;or&nbsp; Ctrl + K", "Search notes"],
        ["Ctrl + S", "Save the current note"],
        ["N", "New note"],
        ["U", "Upload an image or audio file"],
        ["R", "Rename the current note"],
        ["D", "Delete the current note"],
        ["?", "Show this keyboard shortcuts help"],
    ];
    const body = document.createElement("div");
    body.className = "modal-text";
    body.innerHTML = `<dl class="shortcuts-list">${rows
        .map(([k, d]) => `<div><dt>${k}</dt><dd>${d}</dd></div>`)
        .join("")}</dl>`;
    return buildModal({
        title: "Keyboard shortcuts",
        body,
        buttons: [{ label: "Close", value: true, primary: true, variant: "btn-filled", isCancel: true }],
    });
}

// --- entries / selector ------------------------------------------------------
function sortEntries() {
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function rebuildSelect(selectedName = "") {
    const sel = document.getElementById("file-select");
    sel.innerHTML = "";
    const dummy = document.createElement("option");
    dummy.value = "";
    dummy.textContent = "";
    sel.appendChild(dummy);
    entries.forEach((e) => {
        const opt = document.createElement("option");
        opt.value = e.name;
        opt.textContent = e.name;
        sel.appendChild(opt);
    });
    sel.value = selectedName;
}

async function refreshEntries(selectedName = "") {
    try {
        const files = await withStatus("Loading...", () => listChildren(state.folders.entries));
        entries = files.map((f) => ({ id: f.id, name: f.name, meta: f.appProperties || null }));
        sortEntries();
        rebuildSelect(selectedName);
        updateButtons();
    } catch (e) {
        console.error(e);
        await showAlert("Could not load your notes.", "Error");
    }
}

async function onSelectChange(e) {
    const name = e.target.value;
    if (!name) {
        current = null;
        showEditor("");
        savedContentHash = null;
        dirty = false;
        updateButtons();
        return;
    }
    const entry = entries.find((x) => x.name === name);
    if (entry) await loadNote(entry);
}

// Open the note-search dialog; if the user picks a note, select it in the
// dropdown and run the normal file-selection flow.
async function onSearch() {
    const chosen = await showNoteSearch(entries.map((e) => e.name)); // entries are pre-sorted
    if (!chosen) return;
    const sel = document.getElementById("file-select");
    sel.value = chosen;
    sel.dispatchEvent(new Event("change"));
}

// --- load / save -------------------------------------------------------------
async function loadNote(entry) {
    try {
        const { meta, content } = await withStatus("Loading...", async () => {
            const cipher = await downloadText(entry.id);
            const decrypted = decryptData(cipher, filePassword());
            // Metadata comes from the file's appProperties; the decrypted file is
            // pure content. Fall back to the legacy embedded-metadata layout for
            // notes saved before this change (they have no appProperties).
            if (entry.meta && entry.meta.FileType) {
                return { meta: entry.meta, content: decrypted };
            }
            return parseNote(decrypted);
        });
        current = { id: entry.id, name: entry.name, meta };
        displayNote(meta, content);
        if (isMediaType(meta)) savedContentHash = null;
        else await snapshotContentHash();
        dirty = false;
        updateButtons();
    } catch (e) {
        console.error(e);
        await showAlert("Could not open this note.", "Error");
    }
}

async function onRefresh() {
    if (!current) return;
    const entry = entries.find((x) => x.id === current.id);
    if (entry) await loadNote(entry);
}

// Returns true if it actually wrote to Drive, false if it was a no-op
// (content unchanged) so callers can react (e.g. flash "Nothing to save..").
async function saveCurrentNote() {
    if (!current || isMediaType(current.meta)) return false;
    const content = readEditorContent();
    // Skip the Drive round trip entirely if the content is byte-for-byte what we
    // last loaded/saved (compared via SHA-256 of the content only).
    const hash = await sha256Hex(content);
    if (hash === savedContentHash) {
        dirty = false;
        return false;
    }
    // Content changed: encrypt the content alone and update the file's metadata
    // (appProperties) with a refreshed DateTimeModified.
    const meta = { ...current.meta, DateTimeModified: nowStamp() };
    await withStatus("Saving...", async () => {
        const cipher = encryptData(content, filePassword());
        await updateTextFile(current.id, cipher, meta);
    });
    current.meta = meta;
    const listed = entries.find((x) => x.id === current.id);
    if (listed) listed.meta = meta;
    savedContentHash = hash;
    dirty = false;
    return true;
}

async function onSave() {
    if (!current || isMediaType(current.meta)) return;
    try {
        const saved = await saveCurrentNote();
        if (!saved) await flashStatus("Nothing to save..", 600);
    } catch (e) {
        console.error(e);
        await showAlert("Could not save this note.", "Error");
    }
}

// If a note created via "new" (a rich text note) has unsaved changes, offer to
// save it. Returns false if the user cancelled the surrounding action entirely.
async function maybeSaveBeforeSwitch() {
    if (current && current.meta.CreationMethod === "new" && dirty) {
        const ans = await showYesNo("Do you want to save the current note?", "Unsaved changes");
        if (ans === "cancel") return false;
        if (ans === "yes") await saveCurrentNote();
    }
    return true;
}

// --- New / Upload / Rename / Delete -----------------------------------------
async function onNew() {
    const entered = await showPrompt("Enter a name for the new note:", { title: "New note" });
    if (!entered) return;
    const name = stripExtension(entered.trim());
    if (!name) return;
    if (entries.some((e) => e.name === name)) {
        await showAlert("Filename already exists", "Error");
        return;
    }
    if (current) {
        const proceed = await maybeSaveBeforeSwitch();
        if (!proceed) return;
    }
    try {
        const stamp = nowStamp();
        const meta = {
            DateTimeCreated: stamp,
            DateTimeModified: stamp,
            CreationMethod: "new",
            FileType: "richtext",
        };
        const created = await withStatus("Creating...", async () => {
            const cipher = encryptData("", filePassword());
            return createTextFile(name, cipher, state.folders.entries, meta);
        });
        entries.push({ id: created.id, name, meta });
        sortEntries();
        rebuildSelect(name);
        current = { id: created.id, name, meta };
        displayNote(meta, "");
        await snapshotContentHash();
        dirty = false;
        updateButtons();
    } catch (e) {
        console.error(e);
        await showAlert("Could not create the note.", "Error");
    }
}

async function onUploadFile(e) {
    const file = e.target.files[0];
    e.target.value = ""; // allow re-selecting same file later
    if (!file) return;

    const fileType = fileTypeFromMime(file.type);
    if (!fileType) {
        await showAlert("Only image or audio files can be uploaded.", "Error");
        return;
    }
    if (current) {
        const proceed = await maybeSaveBeforeSwitch();
        if (!proceed) return;
    }
    if (entries.some((x) => x.name === file.name)) {
        await showAlert("Filename already exists", "Error");
        return;
    }
    try {
        const dataUrl = await readFileAsDataURL(file);
        const stamp = nowStamp();
        const meta = {
            DateTimeCreated: stamp,
            DateTimeModified: stamp,
            CreationMethod: "upload",
            FileType: fileType,
        };
        const created = await withStatus("Uploading...", async () => {
            const cipher = encryptData(dataUrl, filePassword());
            return createTextFile(file.name, cipher, state.folders.entries, meta);
        });
        entries.push({ id: created.id, name: file.name, meta });
        sortEntries();
        rebuildSelect(file.name);
        current = { id: created.id, name: file.name, meta };
        displayNote(meta, dataUrl);
        dirty = false;
        updateButtons();
    } catch (err) {
        console.error(err);
        await showAlert("Could not upload the file.", "Error");
    }
}

async function onRename() {
    if (!current) return;
    const name = await showPrompt("Enter a new name for this note:", {
        title: "Rename note",
        initial: current.name,
    });
    if (!name || name === current.name) return;
    if (entries.some((x) => x.name === name)) {
        await showAlert("Filename already exists", "Error");
        return;
    }
    try {
        await withStatus("Renaming...", () => renameFile(current.id, name));
        const entry = entries.find((x) => x.id === current.id);
        if (entry) entry.name = name;
        current.name = name;
        sortEntries();
        rebuildSelect(name);
        updateButtons();
    } catch (e) {
        console.error(e);
        await showAlert("Could not rename the note.", "Error");
    }
}

async function onDelete() {
    if (!current) return;
    const ok = await showConfirm(`Delete "${current.name}"? This cannot be undone.`, "Delete note");
    if (!ok) return;
    try {
        await withStatus("Deleting...", () => deleteFile(current.id));
        entries = entries.filter((x) => x.id !== current.id);
        current = null;
        sortEntries();
        rebuildSelect("");
        showEditor("");
        dirty = false;
        updateButtons();
    } catch (e) {
        console.error(e);
        await showAlert("Could not delete the note.", "Error");
    }
}

// --- editor / media views ----------------------------------------------------
function showEditor(html) {
    document.getElementById("media-viewer").hidden = true;
    const wrap = document.getElementById("editor-wrap");
    wrap.hidden = false;
    const editor = document.getElementById("editor");
    editor.innerHTML = html;
    decorateEmbeds(editor);
}

function showMedia(dataUrl, fileType) {
    document.getElementById("editor-wrap").hidden = true;
    const viewer = document.getElementById("media-viewer");
    viewer.hidden = false;
    viewer.innerHTML = "";
    if (fileType === "image") {
        const img = document.createElement("img");
        img.src = dataUrl;
        img.className = "viewer-image";
        if (isMobile()) {
            img.classList.add("mobile-img");
            img.addEventListener("click", () => openInNewWindow(dataUrl));
        }
        viewer.appendChild(img);
    } else {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = dataUrl;
        viewer.appendChild(audio);
    }
}

// --- rich text embeds --------------------------------------------------------
async function onInsertImage(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    const span = document.createElement("span");
    span.className = "media-embed";
    span.contentEditable = "false";
    const img = document.createElement("img");
    img.src = dataUrl;
    if (isMobile()) {
        img.className = "mobile-img";
        img.addEventListener("click", () => openInNewWindow(dataUrl));
    }
    span.appendChild(img);
    addEmbedDeleteButton(span);
    insertNodeAtCursor(span);
    markDirty();
}

async function onInsertAudio(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    const span = document.createElement("span");
    span.className = "media-embed";
    span.contentEditable = "false";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = dataUrl;
    span.appendChild(audio);
    addEmbedDeleteButton(span);
    insertNodeAtCursor(span);
    markDirty();
}

// Re-decorate embeds after loading saved HTML: mobile tap-to-open handlers, and
// on PC the ✕ delete button on each embed.
function decorateEmbeds(editor) {
    if (isMobile()) {
        editor.querySelectorAll(".media-embed img").forEach((img) => {
            img.classList.add("mobile-img");
            img.addEventListener("click", () => openInNewWindow(img.src));
        });
    }
    editor.querySelectorAll(".media-embed").forEach(addEmbedDeleteButton);
}

// Add a ✕ button to an embed so it can be removed with a click/tap.
// Idempotent: never adds a second button to the same embed.
//   - PC: the badge shows on hover/selection (CSS) and the ✕ click is handled by
//     the delegated handler in wireEmbedSelection().
//   - Mobile: the badge is always visible (CSS); since mobile has no easy undo,
//     the tap here confirms before deleting.
function addEmbedDeleteButton(embed) {
    if (embed.querySelector(":scope > .embed-del")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "embed-del";
    btn.title = "Remove";
    btn.textContent = "✕";
    btn.contentEditable = "false";
    if (isMobile()) {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const kind = embed.querySelector("audio") ? "audio" : "image";
            if (await showConfirm(`Remove this ${kind}?`, "Remove")) deleteEmbed(embed);
        });
    }
    embed.appendChild(btn);
}

// Serialize the editor's note content, stripping runtime-only decorations (the
// ✕ delete buttons and the selection highlight) so they never get persisted.
function readEditorContent() {
    const clone = document.getElementById("editor").cloneNode(true);
    clone.querySelectorAll(".embed-del").forEach((el) => el.remove());
    clone.querySelectorAll(".media-embed.selected")
        .forEach((el) => el.classList.remove("selected"));
    return clone.innerHTML;
}

// Remove an embed via execCommand so the removal is recorded on the
// contenteditable native undo stack (Ctrl+Z). A direct embed.remove() mutates
// the DOM outside that stack and so cannot be undone.
function deleteEmbed(embed) {
    const editor = document.getElementById("editor");
    editor.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNode(embed);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("delete");
    markDirty();
}

// Allow embedded media (images / audio) to be selected by clicking and then
// removed with Delete or Backspace. Embeds are contenteditable="false", so the
// browser won't let the caret enter them or delete them normally; we handle the
// selection and removal ourselves.
function wireEmbedSelection(editor) {
    const clearSelection = () =>
        editor.querySelectorAll(".media-embed.selected")
            .forEach((el) => el.classList.remove("selected"));

    editor.addEventListener("click", (e) => {
        // Clicking the ✕ button removes the embed outright.
        if (e.target.closest(".embed-del")) {
            const embed = e.target.closest(".media-embed");
            if (embed) deleteEmbed(embed);
            return;
        }
        const embed = e.target.closest(".media-embed");
        clearSelection();
        if (embed) embed.classList.add("selected");
    });

    // The Delete/Backspace and outside-click handlers live on `document` because
    // a contenteditable="false" embed does NOT give keyboard focus to the
    // editor, so a keydown listener on the editor itself would never fire.
    // Registered once at module level so re-rendering the page doesn't stack up
    // duplicate document listeners.
    if (!wireEmbedSelection.bound) {
        const clearAll = () =>
            document.querySelectorAll(".media-embed.selected")
                .forEach((el) => el.classList.remove("selected"));

        // Clicking anywhere outside an editor drops the selection highlight.
        document.addEventListener("click", (e) => {
            if (e.target.closest(".editor")) return;
            clearAll();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            const selected = document.querySelector(".media-embed.selected");
            if (!selected) return;
            e.preventDefault();
            deleteEmbed(selected);
        });

        wireEmbedSelection.bound = true;
    }
}

function insertNodeAtCursor(node) {
    const editor = document.getElementById("editor");
    editor.focus();
    const sel = window.getSelection();
    let range;
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
        range.deleteContents();
    } else {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
    }
    range.insertNode(node);
    // Place a space + caret after the embed so typing continues normally.
    const space = document.createTextNode(" ");
    range.setStartAfter(node);
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

function openInNewWindow(dataUrl) {
    const w = window.open();
    if (w) {
        w.document.write(
            `<title>Image</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh">` +
            `<img src="${dataUrl}" style="max-width:100%;height:auto" /></body>`
        );
        w.document.close();
    }
}

// --- helpers -----------------------------------------------------------------
function markDirty() { dirty = true; }

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function updateButtons() {
    const isDummy = !current;
    const isMedia = current && isMediaType(current.meta);

    document.getElementById("tb-refresh").disabled = isDummy;
    document.getElementById("tb-rename").disabled = isDummy;
    document.getElementById("tb-delete").disabled = isDummy;
    // Save disabled for the dummy entry and for uploaded media files.
    document.getElementById("tb-save").disabled = isDummy || isMedia;
}
