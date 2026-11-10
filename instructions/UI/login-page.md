

'Login Page' contents {

    Title: eNotesMgr
    Tagline: Your notes, securely stored on Google Drive.

    Button 'Login with Google' {
        on click {
            if the user successfully logins in \(with google oauth\) {
                Check if new user or not (config.json missing = new user; look twice before deciding, see ../data-storage.md "Never lose existing data").
                if (an existing user) {
                    Redirect to UI @ ./master-password-popup.md
                }
                else (config.json missing) {
                    Check whether the account already holds data (notes in the entries folder, recovery files in the recovery folder).
                    if (recovery files exist) {
                        Do NOT set up a new account. Show "Config file missing": "Your eNotesMgr data was found in Google Drive, but its config file is missing or couldn't be read. Nothing has been changed. If this was a temporary Google Drive problem, simply log in again. Otherwise, enter one of your recovery codes on the next screen: it restores access to all your notes."
                        Redirect to UI @ ./master-password-popup.md (a recovery code there recreates config.json with the original file password).
                    }
                    else if (notes exist but no recovery files) {
                        Show "Config file missing": "You have <N> note(s) in Google Drive, but their config file is missing and there are no recovery codes, so they can't be opened. If this is a temporary Google Drive problem, log out and try again later. Setting up a new account will NOT delete those notes, but they can't be opened with it."
                        Buttons: 'Log out' (default, also Escape) -> log out; 'Set up a new account' -> Redirect to UI @ ./setup-page.md
                    }
                    else (a genuinely new, empty account) {
                        Redirect to UI @ ./setup-page.md
                    }
                }
            }
        }
    }
}



