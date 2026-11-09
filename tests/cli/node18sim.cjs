// Preload (node -r): simulate Node 18, which has no globalThis.crypto by default.
delete globalThis.crypto; if (globalThis.crypto) throw new Error("could not remove crypto");
