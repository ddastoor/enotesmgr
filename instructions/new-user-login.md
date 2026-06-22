
whether the app is using file scope or app scope {
    they should create the following if they don't already exist {
        entries folder 
        config folder 
        recovery folder
    }
}

create a new settings json with contents populated with default values from instructions/UI/settings-page.md


create new config json with contents {
    \{
        "file_password": <long generated UUID>
    \}
}

encrypt the config json using the master password to produce the encrypted config file.
encrypt the settings json using the file password to produce the encrypted settings file.
save encrypted config file and encrypted settings file to google drive 

The app should reflect the settings json values immediately.

if (the "Generate Recovery codes" checkbox was checked by the user during setup, i.e. the caller of this page) {
    the app should call the app's generate recovery functionality as if it was called from the recovery code menu option and tell the user via a popup that enotes_recovery_codes.txt is downloaded on their device.
}

Redirect the user to the app's main page
