        
        Generate Recovery Codes Page {
            contents {   
             page title - "Generate Recovery Codes" 

             page description {

                "Generate 10 new random 16-digit numeric codes. Use these numeric codes if you happen to forget your master password. Once a code is used, it is exhausted. Save these code very safely."

             }


             page note: "New codes replace ALL your current codes: only the codes in the newest downloaded file work. (Also use this if your codes file may have been seen by someone.)"

             Recovery codes always come as ONE complete set of 10 {
                Generating new codes always REPLACES all current codes, so the newest downloaded codes file always holds every valid code. (The app can't put the existing codes into a new file: it never stores the codes themselves, only files encrypted with them - see 'Recovery file naming' below.)
                There is no way to delete all recovery codes (no 'Wipe') and no way to "add" codes to the current set - the user is never left without codes, and never with codes that aren't in their newest file. See ../../one-or-zero-recovery-code-left-popup.md.
             }

             'Generate new codes' button {
                label: "Generate new codes"
                tooltip: "Generate 10 new codes (they replace all your current codes)"

                on click {
                    Ask for confirmation: "Generate 10 new recovery codes? They replace ALL your current recovery codes, which stop working once you've saved the new file."
                    if (user confirms) { run 'Generate a new set of recovery codes' (below) }
                    If it fails: show "Could not generate recovery codes. Your current codes were left unchanged."
                }
             }

             'Generate a new set of recovery codes' operation (also used by setup, the 1-or-0-codes-left popup and the recovery-code reset) {
                1) Remember the list of current recovery files (the OLD set).
                2) Generate 10 new, unique random 16-digit numeric codes (every digit uniformly random). These numeric codes are meant to be master password replacements in case the user forgets their master password. Each code can be used only once.
                   foreach (such new recovery code) {
                       Encrypt config json with it (use the "verified encrypt" operation, see ../../../crypto.md) into a file with a RANDOM name (e.g. 'recovery-<uuid>') - see 'Recovery file naming' below
                       Save this encrypted file into the recovery folder.
                   }
                   (All 10 are encrypted and self-checked before any is uploaded; if an upload fails midway, the new files already created are deleted and the OLD set is left untouched.)
                   Auto-logout is paused while this runs.
                   Delete the (legacy) 'one-or-no-recovery-files-left-dont-ask-marker-file' from the recovery folder if it exists.
                3) Download the 10 recovery codes listed line by line to the user's device, into a file named 'EnotesMgrRecoveryCodes__<username>__<YYYY-MM-DD>.txt' (the username is the local part of the user's google email, see ../../main-page.md "Username display" - and the date is the day of download; both tag the file so repeated downloads don't clash).
                4) Show a popup that can't be dismissed, title "Recovery codes downloaded": "Your new recovery codes file (<filename>) has been downloaded. It holds ALL your recovery codes. Save it very safely!" + (if there was an OLD set) " Once you continue, your previous <N> recovery codes stop working."
                   Buttons: 'Download again' (downloads the same file again and shows the popup again) and 'I've saved them'.
                5) Only after 'I've saved them': delete every file of the OLD set. If some can't be deleted, say: "<N> of your previous recovery codes could not be removed and still work. Generate new codes again to remove them."
                If the user never confirms (closes the tab, auto-logout), the old AND new codes both keep working - nothing is lost.
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
