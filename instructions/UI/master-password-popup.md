


Master password page {

        layout {
            The page shows a single card containing, top to bottom: a heading "Unlock eNotes", the introductory text, the master password edit box, an inline error area, and a row with the 'Cancel' and 'Unlock' buttons.

            if (on desktop / PC) {
                The card is centered both horizontally and vertically in the viewport (the existing default look).
            }
            if (on mobile) {
                The card is moved up — positioned toward the top of the screen instead of vertically centered (still horizontally centered).
                The card is also made vertically more compact than on desktop: reduced top/bottom padding, tighter spacing between the items inside the card, and a slightly smaller introductory text, so it occupies less vertical height.
                This compact + top-aligned treatment must apply ONLY to this "Unlock eNotes" card, not to the other similar-looking cards (login, setup, reset-master-password).
            }
        }

        contents {

            An introductory text like {
                "Enter your master password (or recovery code if you've forgotten your master password)"
            }

            Master password edit box {
                on enter {
                    perform submit action
                }
            }

            button 'Unlock' {
                on click {
                    perform submit action
                }
            }
            
            button 'Cancel' {

                on click {
                    Redirect to UI @ ./login-page.md
                }

            }

            submit action {
                if (the master password edit box is not empty) {
                    
                    If the entry in the master password edit box is made up of only digits, treat it as a recovery code. Else treat it as the master password.


                    if (it's a recovery code) {
                        
                        if (there are no recovery files left \(not counting file 'no-recovery-files-marker-file'\) ) {

                            Display an error message "Sorry, you're out of luck - you don't have any recovery codes left. Try your best to remember your master password!!". Once the user dismisses this message, end the session and redirect to UI @ ./login-page.md

                        }
                        else if (recovery file corresponding to recovery code doesn't exist) {
                            Display an error message "Invalid recovery code" and stay on this page.

                        }
                        else { 
                            Fetch the recovery file and try to decrypt it using the recovery code.
                            If (decryption fails) {
                                Display an error message "Invalid recovery code" and stay on this page.
                            }
                            else {
                                recovery json = it's decrypted contents
                                master password = fetch the new master password from the UI @ ./reset-master-password-popup.md
                                config json = recovery json
                                Encrypt config json using master password = config file
                                Save config file to google drive
                                Use "file_password" to decrypt the settings file = settings json
                                Reflect the settings json values immediately.
                                Display a message "Recovery code used successfully and exhausted. Your master password has been reset. You can now use your new master password to login"
                                Delete recovery file corresponding to this recovery code
                                Redirect to UI @ ./login-page.md
                            }
                        }

                    }
                    else {
                        Fetch the config file and settings file from google drive
                        Decrypt the config file using the master password
                        if (decryption fails) {
                            Display an error message "Decryption failed. Please check your master password", and stay on this page.
                        }
                        else {
                            config json = decrypted contents of config file
                            Use "file_password" to decrypt the settings file = settings json
                            The app should reflect the settings json values immediately.
                            Redirect to UI @ ./main-page.md 
                        }
                    }

                } 
                else {
                    Do nothing and stay on this page.
                }

            }

        }

    }

    
    If the user presses cancel OR presses the escape key OR presses the browser back button OR gets out of the popup in any other way, the app should invalidate the google auth and redirect to the login page.


}