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
import { withStatus, showAlert, showPrompt, showConfirm, showYesNo } from "../lib/dialogs.js";
import { openMenu } from "./menu.js";

// --- page-local state --------------------------------------------------------
let entries = [];          // [{id, name}] sorted alphabetically
let current = null;        // {id, name, meta} or null (dummy); see note-meta-data.md
let dirty = false;

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

// --- embedded note metadata --------------------------------------------------
// Each note entry file is, before encryption, a metadata section + exactly one
// newline + the actual content. See instructions/note-meta-data.md.
const META_BEGIN = "[metadata begin]";
const META_END = "[metadata end]";

// Current date/time in the [date]T[time] format, e.g. 2026-01-21T10:30.
function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

// Build the un-encrypted note entry content: metadata section + one newline + content.
function serializeNote(meta, content) {
    const lines = [META_BEGIN];
    for (const [k, v] of Object.entries(meta)) lines.push(`${k} = ${v}`);
    lines.push(META_END);
    return lines.join("\n") + "\n" + content;
}

// Parse decrypted note entry text into { meta, content }. Files written before
// metadata was embedded have no metadata section, so we infer it from the content.
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
                        <button id="btn-logout" class="icon-btn" title="Logout">⏻</button>
                    </div>
                </div>
                <div id="username" class="username"></div>
                <div id="fullname" class="fullname"></div>
            </header>

            <section class="toolbar glass">
                <select id="file-select" class="file-select" title="Select a note"></select>
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

    // On PC, let the user click an embedded image/audio to select it and then
    // remove it with Delete / Backspace. (Mobile taps already open the image.)
    if (!isMobile()) wireEmbedSelection(container.querySelector("#editor"));

    // Hidden file inputs
    container.querySelector("#hidden-upload").addEventListener("change", onUploadFile);
    container.querySelector("#hidden-ins-image").addEventListener("change", onInsertImage);
    container.querySelector("#hidden-ins-audio").addEventListener("change", onInsertAudio);

    refreshEntries();
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
        entries = files.map((f) => ({ id: f.id, name: f.name }));
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
        dirty = false;
        updateButtons();
        return;
    }
    const entry = entries.find((x) => x.name === name);
    if (entry) await loadNote(entry);
}

// --- load / save -------------------------------------------------------------
async function loadNote(entry) {
    try {
        const { meta, content } = await withStatus("Loading...", async () => {
            const cipher = await downloadText(entry.id);
            return parseNote(decryptData(cipher, filePassword()));
        });
        current = { id: entry.id, name: entry.name, meta };
        displayNote(meta, content);
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

async function saveCurrentNote() {
    if (!current || isMediaType(current.meta)) return;
    // Update DateTimeModified and the actual content, then re-serialize and encrypt.
    const meta = { ...current.meta, DateTimeModified: nowStamp() };
    const content = readEditorContent();
    await withStatus("Saving...", async () => {
        const cipher = encryptData(serializeNote(meta, content), filePassword());
        await updateTextFile(current.id, cipher);
    });
    current.meta = meta;
    dirty = false;
}

async function onSave() {
    if (!current || isMediaType(current.meta)) return;
    try {
        await saveCurrentNote();
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
            const cipher = encryptData(serializeNote(meta, ""), filePassword());
            return createTextFile(name, cipher, state.folders.entries);
        });
        entries.push({ id: created.id, name });
        sortEntries();
        rebuildSelect(name);
        current = { id: created.id, name, meta };
        displayNote(meta, "");
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
            const cipher = encryptData(serializeNote(meta, dataUrl), filePassword());
            return createTextFile(file.name, cipher, state.folders.entries);
        });
        entries.push({ id: created.id, name: file.name });
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
        return;
    }
    editor.querySelectorAll(".media-embed").forEach(addEmbedDeleteButton);
}

// Add a ✕ button to an embed (PC only) so it can be removed with a click.
// Idempotent: never adds a second button to the same embed.
function addEmbedDeleteButton(embed) {
    if (isMobile()) return;
    if (embed.querySelector(":scope > .embed-del")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "embed-del";
    btn.title = "Remove";
    btn.textContent = "✕";
    btn.contentEditable = "false";
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
