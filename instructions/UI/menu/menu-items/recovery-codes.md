        
        Generate Recovery Codes Page {
            contents {   
             page title - "Generate Recovery Codes" 

             page description {

                "Generate 10 new random 16-digit numeric codes. Use these numeric codes if you happen to forget your master password. Once a code is used, it is exhausted. Save these code very safely."

             }


             'Generate' button {
                label: "Generate"
                one description: "Generate 10 new random 16-digit numeric codes"

                on click {

                    `exist-rec-lst` = Get a list of all existing recovery filenames in the recovery folder = "existing recovery filenames list"

                    Generate 10 new, unique random 16-digit numeric codes (every digit uniformly random)

                    These numeric code are meant to be master password replacements in case the user forgets their master password. Each code can be used only once.

                    foreach (such new recovery code) {
                        Encrypt config json with it (use the "verified encrypt" operation, see ../../../crypto.md) into a file with a RANDOM name (e.g. 'recovery-<uuid>') - see 'Recovery file naming' below
                        Save this encrypted file into the recovery folder.
                    }

                    Download the 10 recovery codes listed line by line to the user's device, into a file named 'EnotesMgrRecoveryCodes__<username>__<YYYY-MM-DD>.txt' (the username is the local part of the user's google email, see ../../main-page.md "Username display" - and the date is the day of download; both tag the file so repeated downloads don't clash). Inform the user via a popup with message 'Recovery codes downloaded. Save them very safely!'
                    Delete the 'one-or-no-recovery-files-left-dont-ask-marker-file' from the recovery folder if it exists.

                }
             }


             'Wipe' button {
                description: "Delete all recovery codes"
                disabled if {
                    no recovery codes exists in the app
                }

                on click {
                    Ask the user for a confirmation dialog asking "Are you sure you want to delete all recovery codes?".
                    if (user confirms) {
                        Delete all files from the recovery folder.
                    }
                    else {do nothing, stay on the screen}
                }
             }


             'Done' button {
                on click {Redirect to UI @ ../../main-page.md}
             }

            }
        }

Recovery file naming {
    A recovery file's name must NEVER be derived from its recovery code - no sha256(code), no other hash, and no stored code -> file mapping or index.

    Why: anything derived from the code that is cheaper to check than the Argon2id decryption itself lets anyone who obtains the (encrypted) recovery files test code guesses at that cheap speed. A plain sha256(code) filename can be brute-forced over all 10^16 codes in hours to days on one GPU, bypassing Argon2id entirely and revealing the file password.

    So recovery files get random names, and the only way to tell which file (if any) a code belongs to is to try to decrypt each recovery file with it (see ../../master-password-popup.md). With ~10 files that is ~10 Argon2id runs (~1-2 s) - acceptable since recovery codes are used rarely.

    Encrypt all 10 recovery files (each with the verified-encrypt self-check) BEFORE uploading any, and if an upload fails midway, delete the recovery files already created in that batch (their codes were never shown to the user).
}
