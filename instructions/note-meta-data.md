
The following layout (un-encrypted note entry content) is strictly for actual note entries, i.e. files in the entries folder not settings file, config file, or any other file. The metadata (appProperties) described further below, however, applies to those non-note app files too — see "non-note app file metadata".

each notes data, whether it's a note created by the user (and shown in the rich text area) or a file uploaded by the user (an image or audio file shown in the media area, or any other file type which is not rendered - see ./UI/main-page.md "Media viewer"), should have it's own metadata. This metadata is NOT embedded in the file contents. Instead it is stored as Google Drive custom file properties on the entry's Drive file itself (using the file properties facility the Google Drive API provides).

So:

un-encrypted note entry content {

        actual note content {
            can be one of 
             {
                1) rich text (note created by user using 'new' option)
                2) any file uploaded by the user using the 'upload' option (an image or audio file, or any other file type)
             }
        }

}

i.e. the un-encrypted note entry content strictly contains ONLY the actual note content. There is no metadata section embedded in it and no separating newline.

note metadata storage {
    The metadata is stored as Google Drive custom file properties on the entry's Drive file, using the file's "appProperties" (the application-private properties the Google Drive API provides per file). Each acceptable metadata key below is stored as one appProperties key/value pair.

    The metadata is NEVER encrypted and is NEVER part of the file contents — it lives only in the Drive file's appProperties.
}

Every file this app creates — whether a note entry or a non-note app file (config file, settings file, recovery-folder files) — carries the FULL set of metadata keys defined below in its appProperties. None are optional or omitted for any file type.

acceptable metadata keys (each stored as a Google Drive file appProperties key/value pair) {
    
    "DateTimeCreated" { [date and time it was created in this exact format [date]T[time](e.g. 2026-01-21T10:30)}
    
    "DateTimeModified" { [date and time it was last modified in this exact format [date]T[time](e.g. 2026-01-21T10:30)}
    
    "CreationMethod" { "new", "upload", "app" }
    "FileType" { "richtext", "image", "audio", "config", "settings", "recovery", a detected MIME type string, "UNKNOWN" }

}

Currently Allowed FileType values {
    "richtext", "image", "audio", "config", "settings", "recovery"
    plus, for uploaded files that are neither image nor audio: the file's detected MIME type string (e.g. "application/pdf", "video/mp4") when its magic number is recognised, or "UNKNOWN" when it is not.
    (See ./UI/main-page.md "File type detection (magic number)" for how an upload's FileType is determined.)
}

Allowable creationMethod - filetype combinations {
    "new" -> "richtext"
    "upload" -> "image", "audio", any other detected MIME type string, or "UNKNOWN"
    "app" -> "config", "settings", "recovery"
}

Note Display Methods based on FileType {
    "richtext" => Display in rich text editor area
    "image"    => Display in image viewer area
    "audio"    => Display in audio player area
    any other uploaded type (a detected non-media MIME type, or "UNKNOWN") => do NOT render the contents; show the centered message "Download this note to view" in the media viewer (see ./UI/main-page.md "Media viewer")
    "config", "settings", "recovery" => not user-displayed (these are non-note app files, not note entries)
}


After fetching this notes entry file from entries folder {
    Read the metadata from the Drive file's appProperties (no decryption needed for metadata)
    Decrypt the file contents using file password to obtain the actual content (whether rich text or media)
    Display contents in the app using the right display controls according to metadata keys FileType and CreationMethod
}

On Saving the note { 
    Update the DateTimeModified field to current date and time in the same format as mentioned in metadata keys, and write it (along with any other changed metadata keys) to the Drive file's appProperties.
    The pre-encryption note entry file is just the actual note content (no metadata section, no separating newline). Encrypt that content and save it.
}

non-note app file metadata {
    The same appProperties metadata (see "note metadata storage") is also stored on the non-note app files, namely: the config file (config.json), the settings file (settings.json), and every file in the recovery folder (see ./terms.md for these file/folder definitions).

    For these non-note app files the metadata keys are set as follows {
        "CreationMethod" = "app"
        "FileType" = "config"   for the config file
        "FileType" = "settings" for the settings file
        "FileType" = "recovery" for files in the recovery folder
        "DateTimeCreated"  = set when the file is first created, in the same [date]T[time] format
        "DateTimeModified" = updated to current date and time whenever the file is written/updated, in the same [date]T[time] format
    }

    As with note entries, this metadata lives only in the Drive file's appProperties (clear-text, never encrypted, never part of the file contents). It does not change how these files are stored or used otherwise — they remain encrypted JSON as defined in their respective specs.
}
