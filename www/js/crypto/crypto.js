import { WASI, OpenFile, File, ConsoleStdout } from "./wasi-shim-vendor/dist/wasi-shim.js";

const wasi = new WASI([], [], [new OpenFile(new File([])), new ConsoleStdout(), new ConsoleStdout()]);

let wasmInstance = null;

async function initWasm() {
    const response = await fetch("js/crypto/crypto.wasm");
    const wasmBytes = await response.arrayBuffer();

    const wasmModule = await WebAssembly.instantiate(wasmBytes, {
        wasi_snapshot_preview1: wasi.wasiImport
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

export function encryptData(text, password) {
    const passwordBytes = utf8Encode(password);
    const passwordPtr = wasm_malloc(passwordBytes.length);
    writeBytes(passwordPtr, passwordBytes);

    const msgBytes = utf8Encode(text);
    const msgPtr = wasm_malloc(msgBytes.length);
    writeBytes(msgPtr, msgBytes);

    const outPtr = wasm_malloc(msgBytes.length + 512);

    const encLen = encrypt_sym(
        msgPtr,
        msgBytes.length,
        passwordPtr,
        passwordBytes.length,
        outPtr
    );

    if (encLen < 0) {
        wasm_free(msgPtr);
        wasm_free(outPtr);
        wasm_free(passwordPtr);
        throw new Error("encrypt_sym failed");
    }

    const encBytes = readBytes(outPtr, encLen);
    const base64Out = bytesToBase64(encBytes);

    wasm_free(msgPtr);
    wasm_free(outPtr);
    wasm_free(passwordPtr);

    return base64Out;
}

export function decryptData(base64Text, password) {
    const passwordBytes = utf8Encode(password);
    const passwordPtr = wasm_malloc(passwordBytes.length);
    writeBytes(passwordPtr, passwordBytes);

    const encBytes = base64ToBytes(base64Text);
    const encPtr = wasm_malloc(encBytes.length);
    writeBytes(encPtr, encBytes);

    const outPtr = wasm_malloc(encBytes.length);

    const decLen = decrypt_sym(
        encPtr,
        encBytes.length,
        passwordPtr,
        passwordBytes.length,
        outPtr
    );

    if (decLen < 0) {
        wasm_free(encPtr);
        wasm_free(outPtr);
        wasm_free(passwordPtr);
        throw new Error("Bad password or corrupted ciphertext");
    }

    const decBytes = readBytes(outPtr, decLen);
    const plainText = utf8Decode(decBytes);

    wasm_free(encPtr);
    wasm_free(outPtr);
    wasm_free(passwordPtr);

    return plainText;
}

// SHA-256 hex digest of a string, using the browser's Web Crypto (unrelated to
// the symmetric crypto above). Used to name recovery files.
export async function sha256Hex(str) {
    const data = utf8Encode(str);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
