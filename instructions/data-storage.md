
Storage of the user's data {
    This SPA Web app will be using the user's google drive to store all it's data after the user has loged in.

    Use google drive API for this.

    Any encrypted contents saved to google drive should be first base-64 encoded.
    Any encrypted contents retrived from google drive should be first base-64 decoded before decrypting it.

    No duplicate files on update {
        When the app updates an existing logical file (e.g. config.json, settings.json, a note entry), it must re-write the SAME google drive file (same file id) under the SAME name. It must never create a second, renamed, or duplicate copy of that file.

        Note that google drive allows two files with the same name in the same folder, and its name-based lookup is only eventually consistent (a file just created may briefly not show up in a name search). So an "update if exists, else create" that re-looks-up purely by name could accidentally create a duplicate. To prevent this, once the app has created or found a given logical file in a session, it should remember that file's id and always update by that id (not re-look-up and possibly re-create by name). Updating by id never changes the file's name and never makes a duplicate.

        This remembered id mapping is per session and must be cleared on logout (so it never carries across sessions / users).
    }

    Never lose existing data (duplicates and "missing" files) {
        config.json holds the file password - the key to ALL notes - so a lookup glitch must never lead to a second config.json with a new key, nor to a copy that holds the only key being deleted. With exactly one of each file / folder (the normal case) none of this changes anything.

        Look twice before creating: before concluding that the 'eNotes Manager' folder, one of its subfolders, or config.json does NOT exist - and therefore creating a folder or treating the user as new - look again once after a short pause (~1.2 s). (A folder that was just created by the app is not looked into.)

        Duplicate folders (Drive allows same-named folders): use the one holding the user's data - for 'eNotes Manager', the tree that has a config.json, then the one with the most notes; for a subfolder, the one with the most items. Never delete any of them.

        No setup over existing data: if config.json is missing (after the second look) but the account already holds data, do NOT show the setup page - see ./UI/login-page.md.

        Duplicate config.json files: see ./UI/master-password-popup.md - use the copy whose file password opens the existing notes, delete only exact duplicates (same file password), never a copy that doesn't open with the master password or holds a different file password.

        Unreadable settings.json (e.g. written with a different key): use the default settings instead of blocking the unlock; saving the settings page writes them back with the right key.
    }
}
