


Master password page {

        layout {
            The page shows a single card containing, top to bottom: a heading "Unlock eNotes", the introductory text, the master password edit box, an inline error area, and a row with the 'Cancel' and 'Unlock' buttons.

            The "Unlock eNotes" heading must NOT use the default plain/dark text color (it looks dull). Instead give it a lively pastel gradient fill — the same gradient treatment used for the "eNotes" brand title (a left-to-right pastel blend of the deep accent purple into pastel pink into pastel blue, applied as a clipped gradient on the text). This must look good in both light and dark themes (use the theme's pastel/accent color variables so it adapts). This styling applies on both desktop and mobile, and only to this card's heading.

            if (on desktop / PC) {
                The card is centered both horizontally and vertically in the viewport (the existing default look).
            }
            if (on mobile) {
                The card is moved up — positioned toward the top of the screen instead of vertically centered (still horizontally centered).
                The card is also made vertically more compact than on desktop: reduced top/bottom padding, tighter spacing between the items inside the card, and a slightly smaller introductory text, so it occupies less vertical height.
                This compact + top-aligned treatment must apply ONLY to this "Unlock eNotes" card, not to the other similar-looking cards (login, setup, reset-master-password).

                Inline "go" button inside the master password edit box (mobile only) {
                    Show a small round button docked inside the master password edit box at its right-hand edge, vertically centered within the box. It displays a right-pointing arrow ("->").
                    Clicking/tapping it performs the EXACT same action as the 'Unlock' button (the submit action described below) — it is just a convenient shortcut next to the field.
                    Render the arrow as an inline SVG (not a unicode/emoji character) so it always renders crisply on mobile, consistent with the logout icon rule in ./main-page.md.
                    Give the edit box enough right-side padding that the typed text never slides underneath this button.
                    This button appears ONLY on mobile; on desktop it is not shown (the 'Unlock' button alone is used there).
                }
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
                    
                    If the entry in the master password edit box is made up of exactly 16 digits (numbers only, nothing else), treat it as a recovery code. Else (it contains any non-digit character, or is any other length) treat it as the master password.


                    if (it's a recovery code) {
                        
                        if (recovery file count == 0) {

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
                                Encrypt config json using master password = config file. Use the "verified encrypt" operation (see ../crypto.md): do the encryption and its self-check BEFORE writing, so a failed self-check aborts the reset and leaves the existing config.json untouched. On such a failure, show an error like "Could not securely reset your password (encryption self-check failed). Your old config was left untouched - please try again." and do not proceed.
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