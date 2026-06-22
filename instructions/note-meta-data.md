
The following is strictly for actual note entries, i.e. files in the entries folder not settings file, config file, or any other file:

each notes data, whether it's a note created by the user (and shown in the rich text area) or a media image or audio file uploded by the user (and shown in the media area), should have it's own metadata embedded in the file itself. 

So:

un-encrypted note entry content {

        meta data section  {
            [metadata begin]
                key1 = value1
                key2 = value2
                ...
                keyN = valueN
            [metadata end]
        }

        <exactly one newline>

        actual note content {
            can be one of 
             {
                1) rich text (note created by user using 'new' option)
                2) media (image or audio) uploaded by user using 'upload image/audio' option
             }
        }


}

acceptable metadata keys {
    
    "DateTimeCreated" { [date and time it was created in this exact format [date]T[time](e.g. 2026-01-21T10:30)}
    
    "DateTimeModified" { [date and time it was last modified in this exact format [date]T[time](e.g. 2026-01-21T10:30)}
    
    "CreationMethod" { "new", "upload" }
    "FileType" { "richtext", "image", "audio" }

}

Currently Allowed FileType values { "richtext", "image", "audio" }

Allowable creationMethod - filetype combinations {
    "new" -> "richtext"
    "upload" -> "image", "audio"
}

Note Display Methods based on FileType {
    "richtext" => Display in rich text editor area
    "image"    => Display in image viewer area
    "audio"    => Display in audio player area
}


After fetching this notes entry file from entries folder {
    Decrypt the contents using file password
    Extract metadata
    Extract actual content (whether rich text or media)
    Display contents in the app using the right display controls according to metadata keys FileType and CreationMethod
}

On Saving the note, just before encrypting the note file contents { 
    Update the DateTimeModified field to current date and time in the same format as mentioned in metadata keys.
    Then create the complete, pre-encryption, note entry file (by concatenating the updated metadata section, a blank line and actual content section as mentioned in the layout).

    }
    