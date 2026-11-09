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
//
// Codes always come as ONE complete set of 10: generating new codes replaces
// ALL existing ones, so the newest downloaded codes file always holds every
// valid code. (The app can't add the existing codes to a new file: it never
// stores the codes themselves - only files encrypted WITH them.)
//
// The user is never left with 0 recovery codes (see recoveryReminder.js):
// setup always generates them, a new set is created before the old one is
// deleted (and only once the user confirms the new file is saved), and logging
// in / resetting with 0 or 1 left requires a new set.

import { state, ONE_RECOVERY_LEFT_MARKER } from "./state.js";
import { listChildren, createTextFile, deleteFile, downloadText } from "./drive.js";
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

// Step 1 of generating a new set: create 10 new unique recovery codes, encrypt
// the current config json with each and save them to the recovery folder. The
// OLD codes are NOT touched here (see deleteOldRecoveryCodes). Throws - leaving
// everything as it was - if anything fails.
// Returns { codes: [plaintext codes], oldFiles: [the previous recovery files] }.
export async function createNewRecoveryCodes() {
    const existing = await listChildren(state.folders.recovery);
    const oldFiles = existing.filter((f) => f.name !== ONE_RECOVERY_LEFT_MARKER);

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

    // Remove a leftover "don't ask again" marker from the old app (best effort).
    const marker = existing.find((f) => f.name === ONE_RECOVERY_LEFT_MARKER);
    if (marker) {
        try { await deleteFile(marker.id); } catch (e) { console.error("Failed to remove the old don't-ask marker", e); }
    }

    return { codes: [...codes], oldFiles };
}

// Filename of the downloaded recovery codes file, e.g.
// EnotesMgrRecoveryCodes__abc__2026-01-21.txt — tagged with the google username
// and the download date so multiple downloads don't clash / overwrite.
export function recoveryCodesFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    // Keep the username filesystem-safe; fall back to "user" if unknown.
    const user = (state.username || "user").replace(/[^A-Za-z0-9._-]/g, "_");
    return `EnotesMgrRecoveryCodes__${user}__${date}.txt`;
}

// Download the codes file (one code per line). Can be called again ("Download
// again") with the same codes.
export function downloadRecoveryCodes(codes) {
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

// Step 2 of generating a new set (once the user confirmed the new codes file is
// saved): delete the previous recovery files, so only the new set works.
// Returns how many could NOT be deleted (they still work; the user is told).
export async function deleteOldRecoveryCodes(oldFiles) {
    let notDeleted = 0;
    for (const f of oldFiles) {
        try {
            await deleteFile(f.id);
        } catch (e) {
            console.error("Failed to delete an old recovery code", e);
            notDeleted++;
        }
    }
    return notDeleted;
}

// Number of recovery codes left. Also removes the "don't ask again" marker file
// if an older version of the app left one behind: having no recovery codes is
// no longer allowed, so the marker has no meaning any more (best effort).
export async function countRecoveryCodes() {
    const files = await listChildren(state.folders.recovery);
    const marker = files.find((f) => f.name === ONE_RECOVERY_LEFT_MARKER);
    if (marker) {
        try {
            await deleteFile(marker.id);
        } catch (e) {
            console.error("Failed to remove the old don't-ask marker", e);
        }
    }
    return files.filter((f) => f.name !== ONE_RECOVERY_LEFT_MARKER).length;
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
