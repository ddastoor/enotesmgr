Sensitive notes (an optional extra per-note password, chosen when the note is created) {

    Purpose {
        When the user creates a NEW note - a rich text note or an uploaded file - they can create it as a 'sensitive note': it gets its own extra password, the 'note password'. Opening it needs the note password in addition to the normal unlock (master password -> file password).

        A note is sensitive or normal for its WHOLE life, decided when it is born {
            - New notes made with the ordinary 'New' / 'Upload' buttons are normal notes, exactly as before.
            - New notes made with the sensitive 'New' / 'Upload' buttons (padlock - see ./UI/main-page.md) are sensitive notes.
            - There is NO way to turn a normal note into a sensitive one or back. Existing notes are never touched by this feature: their content, metadata, loading, saving, downloading and export are exactly as before.
        }

        It does NOT change the master password, the file password, config.json, settings.json, recovery codes or any of their flows. Recovery codes restore the master password only: a forgotten note password can NOT be recovered (the app says so when the password is chosen).
    }

    Storage - order of the two passwords {
        Encryption (innermost first) {
            1. the actual note content (rich text html, or the data: URL of an uploaded file) is encrypted with the NOTE password (verified encrypt - see ./crypto.md - since nothing else can recover this layer),
            2. the result is marked: the 'sensitive envelope' = the fixed marker "<<eNotesMgr-sensitive-note-v1>>" followed by that base64 ciphertext,
            3. the envelope is encrypted with the FILE password and saved exactly like any other note (base64, same Drive file, same appProperties metadata).
        }
        Decryption is the reverse: file password first, which gives the envelope; then the note password, which gives the content.
        This is done from the very first write (creation) and on every save, so a sensitive note is never stored in Drive without its note password.

        Why this order: everything that only handles the file-password layer keeps working unchanged - the export CLI (it only removes the file-password layer, so a sensitive note comes out still locked with its note password), the -x mirror, picking the right config.json by trying the notes. An exported sensitive note is protected by its note password alone.
    }

    How a note is remembered as sensitive (two places) {
        1. Its metadata: the appProperty "Sensitive" = "yes" (see ./note-meta-data.md), written when the note is created and kept on every save. Only sensitive notes have this key. The app uses it to mark the note in the file selector (its name followed by a padlock 🔒), before the note is opened.
        2. Its content: the sensitive envelope inside the file-password layer. This is what decides how the note is decrypted, saved and exported - the export CLI's offline mode has no Drive metadata, and the envelope sits inside authenticated encryption, so it can't be forged or removed by someone who can only edit the Drive file.

        The two must agree {
            - While a sensitive note is open it is ALWAYS shown with its padlock (the file selector shows "<name> 🔒"). If its content is an envelope but the "Sensitive" key is missing, the padlock is shown anyway and the key is written back on the note's next save.
            - A note whose metadata says "Sensitive" = "yes" but whose content is NOT an envelope (it was changed outside the app) is never opened as a normal note (and so can never be saved unprotected): the app says so and stays on the current note.
        }

        The marker can never start an ordinary note: rich text is the editor's html (a "<" typed as text is stored as "&lt;"), uploads are data: URLs and legacy notes start with "[metadata begin]".

        The note password itself is never stored anywhere. While a sensitive note is the open note, the app holds its password in memory (it is needed to save the note again); it is dropped when another note is opened, when the main page is left (settings, recovery codes) and on logout / session timeout. The held password is only used to save the note and for its Download (after the warning) - it never opens a note: opening, including Refresh, always asks.
    }

    Note password rules {
        At least 8 characters (the exported '.sensitive' file is protected by this password alone). Entered twice when chosen. Not trimmed.
    }

    Creating a sensitive note {
        Sensitive 'New' (rich text): exactly like the 'New' button (name prompt, extension stripped, 'Filename already exists', save-current-note prompt) plus, after the name, the new note password (twice) with the warning that it can't be recovered and can't be switched off later. Cancel creates nothing.
        Sensitive 'Upload' (any file): exactly like the 'Upload' button (file dialog, type by magic number, save-current-note prompt, 'Filename already exists') plus the new note password (twice). Cancel creates nothing.
        The note's metadata is the usual set (DateTimeCreated, DateTimeModified, CreationMethod "new" / "upload", FileType) plus "Sensitive" = "yes". It is written already locked with both passwords.
    }

    Opening a sensitive note (selecting it in the file selector or via search, or pressing Refresh while it is open) {
        EVERY time - even if it is the note already open - ask "<name> is a sensitive note. Enter its password", once. Nothing of the note is shown before the right password is entered.
        If the user presses Cancel, or the password is wrong (a short "Wrong password - the note was not opened." message is flashed), abort: stay on the note that is currently shown (if any), exactly as it was (unsaved edits included), and put the file selector back on it (or on the empty entry if no note is shown). To try again the user selects the note again.
        (The usual "save the current note?" prompt still comes first when the current note has unsaved changes.)
        Refresh asks too: Cancel or a wrong password leaves the note on screen exactly as it was (unsaved edits included); the right password reloads it.
    }

    Saving a sensitive note {
        Same as any note (skip-unchanged, Saving..., DateTimeModified) but the content is locked with the note password before the file-password encryption. If the note password isn't available the save fails - a sensitive note is NEVER written with the file password alone.
    }

    Download (main page) of a sensitive note {
        The note is open (unlocked), so Download gives the readable file - after a warning that the downloaded file will NOT be encrypted (OK / Cancel).
    }

    Rename / Delete / Search: as for any note (the name is not secret - note names are never encrypted). The search popup lists a sensitive note with its padlock, like the file selector.

    Export CLI {
        See ../export-cli.md 'Output rules': a sensitive note is written as '<note-name>.sensitive' holding the envelope as-is (still locked with its note password), and the CLI tells the user how to open such files. An export CLI from before this feature wrote such a note as '<note-name>.html' wrapping the envelope; that file can be opened the same way.
    }

    'Decrypt Sensitive File' (PC only) {
        See ./UI/menu/left-vertical-menu.md. Local and stateless: pick a '.sensitive' file (or an older CLI's '.html' of a sensitive note), enter that note's password, and the decrypted note is downloaded named and formatted exactly like the export CLI / the app's Download would (same 'Output rules'): '<name>.html' for rich text, the original file (its own name and extension) for an upload. It makes NO Google Drive calls and does not change anything in the app. A file that isn't a sensitive note (including a still-encrypted -x mirror file, which also needs the master password) is refused with a message.
    }

    Known limits (by design) {
        - An existing note can't be made sensitive. To protect existing content: create a new sensitive note, copy the content in, and delete the old note - but copies of the old note made earlier (Downloads, CLI exports, -x mirrors) and Google Drive's own version history of the old file (kept about 30 days) are not affected.
        - A Download of an open sensitive note, and files decrypted with 'Decrypt Sensitive File', are NOT encrypted.
        - A note password can't be changed or removed.
        - Browsers can't reliably wipe JavaScript strings: while a sensitive note is open its password and content are in the page's memory (as for every open note).
    }
}
