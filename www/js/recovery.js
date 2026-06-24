// Recovery code generation / wiping. A recovery file is the config json
// encrypted with a 16-digit code, stored under a filename = sha256(code).

import { state, ONE_RECOVERY_LEFT_MARKER } from "./state.js";
import { listChildren, createTextFile, deleteFile, findChild } from "./drive.js";
import { createAppMeta } from "./lib/meta.js";
import { encryptData, sha256Hex } from "./crypto/crypto.js";

// All real recovery files (excludes the one-recovery-left marker). Returns [{id,name}].
export async function listRecoveryFiles() {
    const files = await listChildren(state.folders.recovery);
    return files.filter((f) => f.name !== ONE_RECOVERY_LEFT_MARKER);
}

function randomCode() {
    // 16-digit numeric code, leading zeros allowed.
    let code = "";
    const digits = new Uint32Array(16);
    window.crypto.getRandomValues(digits);
    for (let i = 0; i < 16; i++) code += (digits[i] % 10).toString();
    return code;
}

// Generate 10 new unique recovery codes, encrypt the current config json with
// each, and save them to the recovery folder. Triggers a download of the codes.
// Returns the list of plaintext codes.
export async function generateRecoveryCodes() {
    const existing = await listChildren(state.folders.recovery);
    const existingNames = new Set(existing.map((f) => f.name));

    const codes = [];
    const codeSet = new Set();
    const configText = JSON.stringify(state.configJson);

    while (codes.length < 10) {
        const code = randomCode();
        if (codeSet.has(code)) continue;
        const hash = await sha256Hex(code);
        if (existingNames.has(hash)) continue;
        codeSet.add(code);
        codes.push({ code, hash });
    }

    for (const { code, hash } of codes) {
        const encrypted = encryptData(configText, code);
        await createTextFile(hash, encrypted, state.folders.recovery, createAppMeta("recovery"));
    }

    // Remove the "only one recovery left" marker now that codes exist.
    const marker = existing.find((f) => f.name === ONE_RECOVERY_LEFT_MARKER);
    if (marker) await deleteFile(marker.id);

    downloadCodes(codes.map((c) => c.code));
    return codes.map((c) => c.code);
}

function downloadCodes(codes) {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "enotes_recovery_codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Delete all recovery files from the recovery folder (including marker).
export async function wipeRecoveryCodes() {
    const files = await listChildren(state.folders.recovery);
    for (const f of files) await deleteFile(f.id);
}

// Find a recovery file by the code's hash. Returns {id,name} or null.
export async function findRecoveryFile(code) {
    const hash = await sha256Hex(code);
    return findChild(state.folders.recovery, hash);
}

// True if the "only one recovery left / don't ask again" marker file exists.
export async function hasDontAskMarker() {
    return !!(await findChild(state.folders.recovery, ONE_RECOVERY_LEFT_MARKER));
}

// Create the "don't ask again" marker as an empty file (no-op if already present).
export async function createDontAskMarker() {
    if (await hasDontAskMarker()) return;
    await createTextFile(ONE_RECOVERY_LEFT_MARKER, "", state.folders.recovery);
}

// Delete the "don't ask again" marker if present (re-enables the reminder).
export async function deleteDontAskMarker() {
    const marker = await findChild(state.folders.recovery, ONE_RECOVERY_LEFT_MARKER);
    if (marker) await deleteFile(marker.id);
}
