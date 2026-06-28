

'Login Page' contents {

    Title: eNotes
    Tagline: Your notes, securely stored on Google Drive.

    Button 'Login with Google' {
        on click {
            if the user successfully logins in \(with google oauth\) {
                Check if new user or not.
                if (it's a new user) { 
                    Redirect to UI @ ./setup-page.md 
                }
                else if (an existing user) { 
                    Redirect to UI @ ./master-password-popup.md 
                }
            }
        }
    }
}



