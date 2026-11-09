
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

encrypt the config json using the master password to produce the encrypted config file. Use the "verified encrypt" operation (see ./crypto.md) for this - if its self-check fails, do NOT save anything; show the user an error and abort account creation.
encrypt the settings json using the file password to produce the encrypted settings file.
save encrypted config file and encrypted settings file to google drive 

The app should reflect the settings json values immediately.

Always (recovery codes are never optional - the user is never left without any):
    the app should call the app's generate recovery functionality as if it was called from the recovery code menu option and tell the user via a popup that the recovery codes file ('EnotesMgrRecoveryCodes__<username>__<YYYY-MM-DD>.txt' - see ./UI/menu/menu-items/recovery-codes.md) is downloaded on their device.
    If generating fails, the account is still set up: continue to the main page, where the "No recovery codes" popup requires generating them (with retry) before the app can be used - see ./UI/one-or-zero-recovery-code-left-popup.md.

Redirect the user to the app's main page
