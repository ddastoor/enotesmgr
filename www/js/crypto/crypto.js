import { WASI, OpenFile, File, ConsoleStdout } from "./wasi-shim-vendor/dist/wasi-shim.js";

const wasi = new WASI([], [], [new OpenFile(new File([])), new ConsoleStdout(), new ConsoleStdout()]);

// The WASI shim's random_get (which supplies every salt and nonce) silently
// falls back to Math.random() when globalThis.crypto is missing. Never allow
// that: fail loudly instead of producing predictable salts/nonces.
const wasiImports = {
    ...wasi.wasiImport,
    random_get(bufPtr, bufLen) {
        const c = globalThis.crypto;
        if (!c || typeof c.getRandomValues !== "function") {
            throw new Error("No secure random number source (crypto.getRandomValues) available");
        }
        return wasi.wasiImport.random_get(bufPtr, bufLen);
    },
};

let wasmInstance = null;

async function initWasm() {
    // Self-contained builds (the Node export CLI, enotesmgr-export-cli.js) inline the
    // wasm as base64 on this global, since there is no server to fetch() from.
    // When the global is absent (the normal online app) we fetch as before — so
    // the online browser code path is completely unchanged.
    const inlined = globalThis.__CRYPTO_WASM_BYTES__;
    const wasmBytes = inlined
        ? base64ToBytes(inlined).buffer
        : await (await fetch("js/crypto/crypto.wasm")).arrayBuffer();

    const wasmModule = await WebAssembly.instantiate(wasmBytes, {
        wasi_snapshot_preview1: wasiImports
    });

    wasmInstance = wasmModule.instance;
    wasi.initialize(wasmInstance);

    // This module's _start is a WASI "command" entry point that ends by calling
    // proc_exit, which the shim surfaces as a trap. That's expected — swallow it
    // and proceed to the real initializer below.
    if (wasmInstance.exports._start) {
        try {
            wasmInstance.exports._start();
        } catch (_) {
            /* expected proc_exit trap */
        }
    }
    if (wasmInstance.exports.crypto_init) {
        wasmInstance.exports.crypto_init();
    }
}

// Resolves once the WASM crypto module is ready to use. Callers should await
// this before invoking encryptData / decryptData.
export const cryptoReady = initWasm().catch((err) => {
    console.error("Failed to init wasm:", err);
    throw err;
});

function wasm_malloc(size) {
    if (!wasmInstance) throw new Error("WASM not initialized");
    return wasmInstance.exports.wasm_malloc(size);
}

function wasm_free(ptr) {
    if (!wasmInstance) throw new Error("WASM not initialized");
    wasmInstance.exports.wasm_free(ptr);
}

function encrypt_sym(msgPtr, msgLen, pwdPtr, pwdLen, outPtr) {
    if (!wasmInstance) throw new Error("WASM not initialized");
    return wasmInstance.exports.encrypt_sym(msgPtr, msgLen, pwdPtr, pwdLen, outPtr);
}

function decrypt_sym(encPtr, encLen, pwdPtr, pwdLen, outPtr) {
    if (!wasmInstance) throw new Error("WASM not initialized");
    return wasmInstance.exports.decrypt_sym(encPtr, encLen, pwdPtr, pwdLen, outPtr);
}

function utf8Encode(str) {
    return new TextEncoder().encode(str);
}

function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
}

function writeBytes(ptr, bytes) {
    const memory = new Uint8Array(wasmInstance.exports.memory.buffer);
    memory.set(bytes, ptr);
}

function readBytes(ptr, len) {
    const memory = new Uint8Array(wasmInstance.exports.memory.buffer);
    return memory.slice(ptr, ptr + len);
}

function bytesToBase64(bytes) {
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// A missing password must never reach the cipher: TextEncoder turns undefined
// into "" and null into "null", so e.g. a missing file_password would otherwise
// "encrypt" with an empty, trivially guessable password.
function assertPassword(password) {
    if (typeof password !== "string" || password.length === 0) {
        throw new Error("Missing password");
    }
}

// Zero a WASM heap buffer, then free it. wasm_free alone leaves the bytes in
// place, so passwords and decrypted text would linger in WASM memory long after
// use. (A ptr of 0 means the allocation failed: nothing to wipe or free.)
function wipeAndFree(ptr, len) {
    if (!ptr || !wasmInstance) return;
    new Uint8Array(wasmInstance.exports.memory.buffer).fill(0, ptr, ptr + len);
    wasm_free(ptr);
}

export function encryptData(text, password) {
    assertPassword(password);
    const passwordBytes = utf8Encode(password);
    const msgBytes = utf8Encode(text);
    const outLen = msgBytes.length + 512;
    let passwordPtr = 0, msgPtr = 0, outPtr = 0;
    try {
        passwordPtr = wasm_malloc(passwordBytes.length);
        writeBytes(passwordPtr, passwordBytes);

        msgPtr = wasm_malloc(msgBytes.length);
        writeBytes(msgPtr, msgBytes);

        outPtr = wasm_malloc(outLen);

        const encLen = encrypt_sym(
            msgPtr,
            msgBytes.length,
            passwordPtr,
            passwordBytes.length,
            outPtr
        );

        if (encLen < 0) throw new Error("encrypt_sym failed");

        return bytesToBase64(readBytes(outPtr, encLen));
    } finally {
        // Always runs (success or error): wipe every buffer, then free it.
        wipeAndFree(msgPtr, msgBytes.length);
        wipeAndFree(outPtr, outLen);
        wipeAndFree(passwordPtr, passwordBytes.length);
        passwordBytes.fill(0);
        msgBytes.fill(0);
    }
}

// Encrypt `text` with `password`, then immediately decrypt the result and
// confirm it matches `text` byte-for-byte before returning the ciphertext.
// Throws ENCRYPT_VERIFY_FAILED if the round-trip does not reproduce the input,
// so callers can refuse to persist ciphertext that would not decrypt cleanly.
export function encryptVerified(text, password) {
    const cipher = encryptData(text, password);
    let roundTrip;
    try {
        roundTrip = decryptData(cipher, password);
    } catch (_) {
        throw new Error("ENCRYPT_VERIFY_FAILED");
    }
    if (roundTrip !== text) throw new Error("ENCRYPT_VERIFY_FAILED");
    return cipher;
}

export function decryptData(base64Text, password) {
    assertPassword(password);
    const passwordBytes = utf8Encode(password);
    const encBytes = base64ToBytes(base64Text);
    let passwordPtr = 0, encPtr = 0, outPtr = 0;
    let decBytes = null;
    try {
        passwordPtr = wasm_malloc(passwordBytes.length);
        writeBytes(passwordPtr, passwordBytes);

        encPtr = wasm_malloc(encBytes.length);
        writeBytes(encPtr, encBytes);

        outPtr = wasm_malloc(encBytes.length);

        const decLen = decrypt_sym(
            encPtr,
            encBytes.length,
            passwordPtr,
            passwordBytes.length,
            outPtr
        );

        if (decLen < 0) throw new Error("Bad password or corrupted ciphertext");

        decBytes = readBytes(outPtr, decLen);
        return utf8Decode(decBytes);
    } finally {
        // Always runs (success or error): wipe every buffer, then free it.
        wipeAndFree(encPtr, encBytes.length);
        wipeAndFree(outPtr, encBytes.length);
        wipeAndFree(passwordPtr, passwordBytes.length);
        passwordBytes.fill(0);
        if (decBytes) decBytes.fill(0);
    }
}
