


mapping of what i say to what i mean {

    drive => { the user's google drive }

    'file scope' => { google drive .../auth/drive.file scope }
    'app scope' or 'appdata scope' => { google drive .../auth/drive.appdata scope }
    'entries folder' => { 'eNotes Manager' / Entries folder structure in the user's google drive }
    'config folder' => { 'eNotes Manager' / Config folder structure in the user's google drive }
    'recovery folder' => { 'eNotes Manager' / Recovery folder structure in the user's google drive }
    'recovery file' => { one of the potentially many encrypted files in the recovery folder. Its name is the sha256 hash of the recovery code it corresponds to. }
    'recovery json' => { the decrypted 'recovery file' json. }
    
    'config file' => { 'eNotes Manager' / Config / config.json file in the user's google drive. This is the encrypted json file. }
    config json => { the in-memory, decrypted "config file" json that the app stores - it can be initially empty \{\} }
    
    'settings file' => { 'eNotes Manager' / Config / settings.json file in the user's google drive. This is the encrypted json file }
    settings json => { the in-memory, decrypted "settings file" json that the app stores; it can be initially empty \{\} }

    'no-recovery-files-marker-file' => { a dumy marker file inthe recovery folder to indicate that the user doesn't have any recovery files and doesn't want to be asked again to generate recovery files. }

    'master password' => { the password that an existing user enters on the 'master password popup' screen or enters on the 'setup page' screen when they are setting up their account for the first time. 
    }

    file password => { "file_password" entry inside the config json }

    'user logs in' => { successful google oauth authentication \(can be an existing user or a new user\) }
    'new user' => { a user that has never logged in before \(if the config file doesn't exist yet, this means it's a new user\) }
    'existing user' => { a user that has logged in before \(if the config file exists, this means it's an existing user\) }

    'note metadata' or 'note meta data' => { 
        The metadata read from the entry's Google Drive custom file properties (appProperties), stored in the app's memory for that particular, currently loaded note.
        see ./note-meta-data.md ("note metadata storage")
        }

    'actual note contents' or 'actual note content' => { 
        The actual content of a note, whether it's a rich text note or an audio or image file. 
        see ./note-meta-data.md ("un-encrypted note entry content" / "actual note content")
        }

    'appProperties' or 'custom file properties' or 'file properties' => {
        The application-private custom properties the Google Drive API stores per Drive file/folder (the Files resource "appProperties").
        Clear-text, app-scoped key/value pairs (only this app can read/write them); they are never encrypted.
        Used to store note metadata and non-note app file metadata - see ./note-meta-data.md ("note metadata storage" and "non-note app file metadata").
        (If the public, cross-app property bag is ever meant instead it will be called "public properties" / Files resource "properties".)
        }


    'Invalidate google auth' OR 'Log out' OR 'Sign out' or 'logout' or 'sign out' => { 

        invalidate the google oauth session in such a way that next time the user logs in, he is not again asked for the oauth consent screen. 
        Clear all browser data (including session storage data) and redirect to UI @ ./login-page.md - but do this silently without any popup like "Your session has timed out. Please log in again."

    }
}
