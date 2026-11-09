// Recovery codes. Each recovery code is a random 16-digit number; its recovery
// file is the config json encrypted with that code (same Argon2id + XSalsa20-
// Poly1305 crypto as config.json).
//
// A recovery file's NAME is random and says nothing about its code. There is
// deliberately no index, hash or mapping from code to file: anything derived
// from the code that is cheaper to check than the Argon2id decryption itself
// (e.g. naming files sha256(code), as earlier versions did) would let anyone who
// obtains the encrypted files test billions of code guesses per second and skip
// Argon2id entirely. So to find the file a code belongs to, we try to decrypt
// each recovery file with it (at most ~10 Argon2id runs, ~1-2 s). The only way
// to test a guess is the slow Argon2id decryption.
//
// "Exhausting" a code = deleting its recovery file once it has been used to
// reset the master password; the code then decrypts nothing and is rejected.

import { state, ONE_RECOVERY_LEFT_MARKER } from "./state.js";
import { listChildren, createTextFile, deleteFile, findChild, downloadText } from "./drive.js";
import { createAppMeta } from "./lib/meta.js";
import { decryptData, encryptVerified } from "./crypto/crypto.js";

const CODES_PER_BATCH = 10;

// All real recovery files (excludes the one-recovery-left marker). Returns [{id,name}].
export async function listRecoveryFiles() {
    const files = await listChildren(state.folders.recovery);
    return files.filter((f) => f.name !== ONE_RECOVERY_LEFT_MARKER);
}

// 16-digit numeric code, leading zeros allowed. Uniform digits: random bytes
// >= 250 are rejected so that every digit 0-9 is exactly equally likely.
function randomCode() {
    let code = "";
    const buf = new Uint8Array(32);
    while (code.length < 16) {
        window.crypto.getRandomValues(buf);
        for (const b of buf) {
            if (b < 250 && code.length < 16) code += String(b % 10);
        }
    }
    return code;
}

// Random, meaningless recovery file name (never derived from the code).
function randomRecoveryFileName() {
    return "recovery-" + window.crypto.randomUUID();
}

// Generate 10 new unique recovery codes, encrypt the current config json with
// each, and save them to the recovery folder. Triggers a download of the codes.
// Returns the list of plaintext codes.
export async function generateRecoveryCodes() {
    const existing = await listChildren(state.folders.recovery);

    const codes = new Set();
    while (codes.size < CODES_PER_BATCH) codes.add(randomCode());
    const configText = JSON.stringify(state.configJson);

    // Verified encrypt: never store a recovery file that its own code can't
    // open (you'd only find out the day you need it). All 10 are encrypted and
    // checked before anything is uploaded.
    const encryptedFiles = [...codes].map((code) => encryptVerified(configText, code));

    // Upload. If an upload fails midway, delete the ones already created: their
    // codes would never be shown to the user, so they'd only be dead weight.
    const created = [];
    try {
        for (const encrypted of encryptedFiles) {
            const f = await createTextFile(randomRecoveryFileName(), encrypted, state.folders.recovery, createAppMeta("recovery"));
            created.push(f.id);
        }
    } catch (err) {
        for (const id of created) {
            try { await deleteFile(id); } catch (_) { /* best effort */ }
        }
        throw err;
    }

    // Remove the "only one recovery left" marker now that codes exist.
    const marker = existing.find((f) => f.name === ONE_RECOVERY_LEFT_MARKER);
    if (marker) await deleteFile(marker.id);

    downloadCodes([...codes]);
    return [...codes];
}

// Filename of the downloaded recovery codes file, e.g.
// EnotesMgrRecoveryCodes__abc__2026-01-21.txt — tagged with the google username
// and the download date so multiple downloads don't clash / overwrite.
function recoveryCodesFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    // Keep the username filesystem-safe; fall back to "user" if unknown.
    const user = (state.username || "user").replace(/[^A-Za-z0-9._-]/g, "_");
    return `EnotesMgrRecoveryCodes__${user}__${date}.txt`;
}

function downloadCodes(codes) {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = recoveryCodesFilename();
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

// Find the recovery file this code unlocks by trying to decrypt each recovery
// file with it (see the header comment: there is no code -> file mapping).
// `files` is the list from listRecoveryFiles() (fetched if not given).
// Returns { file, recoveryJson } for the file that decrypts to a valid config
// json, or null if none does (a wrong code, or one already used up).
// Drive/network errors are thrown, not reported as an invalid code.
export async function findRecoveryFile(code, files = null) {
    const candidates = files || (await listRecoveryFiles());
    for (const file of candidates) {
        const cipher = await downloadText(file.id);
        let recoveryJson;
        try {
            recoveryJson = JSON.parse(decryptData(cipher, code));
        } catch (_) {
            continue; // not this code's file
        }
        if (recoveryJson && typeof recoveryJson.file_password === "string" && recoveryJson.file_password) {
            return { file, recoveryJson };
        }
    }
    return null;
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
