
For crypto operations {

    Use ./src/crypto code to symmetrically encrypt and decrypt file contents and/or things in the app like in-memory json, etc. This has NOTHING to do with google auth and signing into the app using google oauth.

    Use the crypto.wasm code via the crypto.js access functions that were written for accessing the crypto.wasm code, from the ./src/crypto folder of the project, specifically 

    

    Verified encryption (self-check) {
        Provide a "verified encrypt" operation: encrypt the given text with the given password, then immediately decrypt that ciphertext back with the same password and confirm it reproduces the original text exactly. If the round-trip does NOT reproduce the original text (decryption errors out, or the decrypted text differs), the operation must FAIL (throw / signal an error) and return no ciphertext.

        Use this verified-encrypt for writing the config file (see ./new-user-login.md and the recovery reset in ./UI/master-password-popup.md), so the app never persists a config.json whose ciphertext would not decrypt cleanly with the password it was just encrypted under. The encryption and its self-check must happen BEFORE writing to google drive, so that a failed self-check aborts the write and leaves any existing file untouched. On such a failure, show the user an error and do not overwrite.
    }

}


