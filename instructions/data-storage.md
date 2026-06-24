
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
}