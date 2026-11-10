Sensitive notes (an optional extra per-note password) {

    Purpose {
        The user can optionally give any note - existing or new, rich text or uploaded file - its own extra password: a 'note password'. Such a note is a 'sensitive note'. Opening it needs the note password in addition to the normal unlock (master password -> file password). The user can switch it on and off per note at any time (see 'Sensitive' toggle in ./UI/main-page.md).

        It does NOT change the master password, the file password, config.json, settings.json, recovery codes or any of their flows. Recovery codes restore the master password only: a forgotten note password can NOT be recovered (the app says so when the password is chosen).
    }

    Storage - order of the two passwords {
        Encryption (innermost first) {
            1. the actual note content (rich text html, or the data: URL of an uploaded file) is encrypted with the NOTE password (verified encrypt - see ./crypto.md - since nothing else can recover this layer),
            2. the result is marked: the 'sensitive envelope' = the fixed marker "<<eNotesMgr-sensitive-note-v1>>" followed by that base64 ciphertext,
            3. the envelope is encrypted with the FILE password and saved exactly like any other note (base64, same Drive file, same appProperties metadata).
        }
        Decryption is the reverse: file password first, which gives the envelope; then the note password, which gives the content.

        Why this order: everything that only handles the file-password layer keeps working unchanged - the export CLI (it only removes the file-password layer, so a sensitive note comes out still locked with its note password), the -x mirror, picking the right config.json by trying the notes. An exported sensitive note is protected by its note password alone.

        The marker can never start an ordinary note: rich text is the editor's html (a "<" typed as text is stored as "&lt;"), uploads are data: URLs and legacy notes start with "[metadata begin]". The envelope lives INSIDE the file-password layer, which is authenticated encryption, so it can't be forged or removed by someone who can only edit the Drive file.

        No extra metadata: whether a note is sensitive is known only from its content (the envelope), not from its appProperties - Drive's clear-text metadata does not reveal which notes are sensitive. The note's metadata (DateTimeCreated/Modified, CreationMethod, FileType) stays as it is; DateTimeModified is updated whenever the note is rewritten.

        The note password is never stored anywhere. While a sensitive note is the open note, the app holds its password in memory (it is needed to save the note again); it is dropped when another note is opened, when the main page is left (settings, recovery codes) and on logout / session timeout. Reopening the note then asks again. Reloading the open note (Refresh, or picking it again via search) reuses the held password.
    }

    Note password rules {
        At least 8 characters (the exported '.sensitive' file is protected by this password alone). Entered twice when chosen. Not trimmed.
    }

    Making a note sensitive (toggle on) {
        Ask for the new note password (twice), warning that it can't be recovered if forgotten.
        Rewrite the open note with both layers: rich text is taken from the editor as shown, INCLUDING unsaved changes (the dialog says so); an uploaded file is re-fetched from Drive.
        Then delete Drive's OLDER versions of that file: Google Drive keeps the previous contents of an updated file for about 30 days, and those older versions are protected by the file password only. The current version is identified by the file's headRevisionId AND must have exactly the size of what was just written, otherwise nothing is deleted. If the older versions can't be deleted, the note is still sensitive; the user is told that Drive deletes them automatically within about 30 days.
        If the rewrite fails, nothing changed (the note stays a normal note).
    }

    Removing the extra password (toggle off) {
        Ask for the note's password (it must match); then rewrite the note with the file password only (rich text: as shown, including unsaved changes).
    }

    Opening a sensitive note {
        After the file-password layer is removed and the envelope is found, ask "<name> is a sensitive note. Enter its password". A wrong password asks again with "Wrong password. Try again.". Cancel keeps the previously open note (the file selector goes back to it).
    }

    Saving a sensitive note {
        Same as any note (skip-unchanged, Saving..., DateTimeModified) but the content is locked with the note password before the file-password encryption. If the note password isn't available the save fails - a sensitive note is NEVER written with the file password alone.
    }

    Download (main page) of a sensitive note {
        The note is open (unlocked), so Download gives the readable file - after a warning that the downloaded file will NOT be encrypted (OK / Cancel).
    }

    Export CLI {
        See ../export-cli.md 'Output rules': a sensitive note is written as '<note-name>.sensitive' holding the envelope as-is (still locked with its note password), and the CLI tells the user how to open such files. An export CLI from before this feature wrote such a note as '<note-name>.html' wrapping the envelope; that file can be opened the same way.
    }

    'Upload Sensitive Note' (PC only) {
        See ./UI/menu/left-vertical-menu.md. Local and stateless: pick a '.sensitive' file (or an older CLI's '.html' of a sensitive note), enter that note's password, and the decrypted note is downloaded named and formatted exactly like the export CLI / the app's Download would (same 'Output rules'): '<name>.html' for rich text, the original file (its own name and extension) for an upload. It makes NO Google Drive calls and does not change anything in the app. A file that isn't a sensitive note (including a still-encrypted -x mirror file, which also needs the master password) is refused with a message.
    }

    Known limits (by design) {
        - Copies made BEFORE a note was made sensitive (earlier Downloads, CLI exports, -x mirrors) are not affected.
        - A Download of an open sensitive note, and files decrypted with 'Upload Sensitive Note', are NOT encrypted.
        - Browsers can't reliably wipe JavaScript strings: while a sensitive note is open its password and content are in the page's memory (as for every open note).
        - To change a note password: remove the extra password, then make the note sensitive again with the new one.
    }
}
