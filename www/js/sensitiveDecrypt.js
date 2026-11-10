// "Decrypt Sensitive File" (menu, PC only). Decrypts a sensitive-note file that the
// export utility wrote ("<name>.sensitive": still locked with that note's own
// password, since the utility only removes the file-password layer) and downloads
// the readable note, named and formatted exactly like the export utility / the
// app's Download would (shared noteExport.js rules).
//
// Entirely local and stateless: the picked file is read in the browser, decrypted
// by the WASM crypto with the password typed in, and offered as a download.
// Nothing is sent to Google Drive and nothing in the app changes (the open note,
// the file password, the master password flow are not touched).
// See instructions/sensitive-notes.md.

import { decryptData } from "./crypto/crypto.js";
import { showAlert, showPasswordPrompt, withStatus } from "./lib/dialogs.js";
import { findSensitivePayload, sensitiveBaseName } from "./lib/sensitiveNote.js";
import { buildNoteExport } from "./lib/noteExport.js";

const TITLE = "Decrypt Sensitive File";

// Open the file dialog; the rest happens once a file is picked.
export function decryptSensitiveFile() {
    // (An input left over from a dialog that was cancelled without a "cancel"
    // event, on older browsers.)
    const stale = document.getElementById("hidden-sensitive-decrypt");
    if (stale) stale.remove();
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    input.id = "hidden-sensitive-decrypt";
    input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        input.remove();
        if (file) decryptPickedFile(file);
    });
    // A cancelled dialog fires no "change": drop the input then too.
    input.addEventListener("cancel", () => input.remove());
    document.body.appendChild(input);
    input.click();
}

async function decryptPickedFile(file) {
    let payload = null;
    try {
        payload = findSensitivePayload(await file.text());
    } catch (e) {
        console.error(e);
    }
    if (!payload) {
        await showAlert(
            `"${file.name}" is not a sensitive note exported by eNotesMgr.\n\n` +
            "Pick a '.sensitive' file written by the export utility. (Files in an 'eNotes Manager_...' " +
            "mirror made with -x are still locked with your master password too: export them with " +
            "the utility first.)",
            TITLE);
        return;
    }

    let error = "";
    for (;;) {
        const pwd = await showPasswordPrompt(`Enter the password of the sensitive note "${file.name}":`, {
            title: TITLE,
            okLabel: "Decrypt",
            error,
        });
        if (pwd === null) return;
        const content = await withStatus("Decrypting...", async () => {
            try { return decryptData(payload, pwd); } catch (_) { return null; }
        });
        if (content !== null) {
            const { filename, bytes, mime } = buildNoteExport(sensitiveBaseName(file.name), content);
            downloadBlob(filename, new Blob([bytes], { type: mime }));
            return;
        }
        error = "Wrong password. Try again.";
    }
}

function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
