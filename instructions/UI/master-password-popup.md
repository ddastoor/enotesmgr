


Master password page {

        layout {
            The page shows a single card containing, top to bottom: a heading "Unlock eNotesMgr", the introductory text, the master password edit box, an inline error area, and a row with the 'Cancel' and 'Unlock' buttons.

            The "Unlock eNotesMgr" heading must NOT use the default plain/dark text color (it looks dull). Instead give it a lively pastel gradient fill — the same gradient treatment used for the "eNotesMgr" brand title on the main page (a left-to-right pastel blend of the deep accent purple into pastel pink into pastel blue, applied as a clipped gradient on the text). This must look good in both light and dark themes (use the theme's pastel/accent color variables so it adapts). This styling applies on both desktop and mobile, and only to this card's heading.

            if (on desktop / PC) {
                The card is centered both horizontally and vertically in the viewport (the existing default look).
            }
            if (on mobile) {
                The card is moved up — positioned toward the top of the screen instead of vertically centered (still horizontally centered).
                The card is also made vertically more compact than on desktop: reduced top/bottom padding, tighter spacing between the items inside the card, and a slightly smaller introductory text, so it occupies less vertical height.
                This compact + top-aligned treatment must apply ONLY to this "Unlock eNotesMgr" card, not to the other similar-looking cards (login, setup, reset-master-password).

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
                        else if (the recovery code does not successfully decrypt ANY recovery file - try to decrypt each recovery file in turn with the recovery code; there is no code -> file name mapping, see ./menu/menu-items/recovery-codes.md 'Recovery file naming') {
                            Display an error message "Invalid recovery code" and stay on this page.

                        }
                        else { 
                            (The recovery file corresponding to the recovery code is the one it successfully decrypted above.)
                            If (decryption fails) {
                                Display an error message "Invalid recovery code" and stay on this page.
                            }
                            else {
                                recovery json = it's decrypted contents
                                master password = fetch the new master password from the UI @ ./reset-master-password-popup.md
                                config json = recovery json
                                Encrypt config json using master password = config file. Use the "verified encrypt" operation (see ../crypto.md): do the encryption and its self-check BEFORE writing, so a failed self-check aborts the reset and leaves the existing config.json untouched. On such a failure, show an error like "Could not securely reset your password (encryption self-check failed). Your old config was left untouched - please try again." and do not proceed.
                                Save config file to google drive. If this fails (or the self-check fails), show the error in a popup, do NOT use up the recovery code, and redirect to UI @ ./login-page.md so the user can try again.
                                Never leave the user with 0 or 1 recovery codes after this reset (if they then forgot the new master password too, they'd be locked out for good) {
                                    if (recovery file count, not counting the one being used, is 0 or 1) {
                                        Show a popup that can only be answered with 'Generate now' - title "Generate new recovery codes", text: ("That was your last recovery code. " if 0 left, else "That leaves you with only 1 recovery code. ") + "If you forgot your new master password too, you would be locked out for good, so generate 10 new recovery codes now."
                                        Run 'Generate a new set of recovery codes' (./menu/menu-items/recovery-codes.md) BEFORE using up the current code. The new set replaces all previous codes - the one just used included - once the user confirms the new file is saved.
                                        If generating fails, offer 'Try again' or 'Finish without new codes'. On 'Finish without new codes', do NOT use up (delete) the recovery code just used - it stays valid as a way back in - and say so in the final message: "Your master password has been reset. You can now use your new master password to login. New recovery codes could not be generated, so the recovery code you just used was NOT used up and still works. Please generate new recovery codes after you log in."
                                    }
                                }
                                Use "file_password" to decrypt the settings file = settings json
                                Reflect the settings json values immediately.
                                Display a message "Recovery code used successfully and exhausted. Your master password has been reset. You can now use your new master password to login"
                                Delete recovery file corresponding to this recovery code (this "exhausts" the code: it now decrypts nothing and is rejected as invalid). Do this only AFTER the new config file has been saved, so a failed save does not use up the code. If the delete fails, the password reset still succeeded - say so, and tell the user to Wipe and re-Generate their recovery codes.
                                Redirect to UI @ ./login-page.md
                            }
                        }

                    }
                    else {
                        Fetch the config file and settings file from google drive

                        Load + decrypt the config file using the master password, handling the (normally impossible) case of duplicate config.json files {
                            Look at how many config.json files exist in the config folder.

                            if (there is exactly one config.json) {
                                Decrypt it using the master password.
                                if (decryption fails) { it's a decryption failure (see below). }
                            }
                            else if (there is more than one config.json) {
                                Try to decrypt each config.json copy with the master password, and pick the single copy that decrypts successfully.
                                if (one of them decrypts) {
                                    Use that decrypted copy as the config json, KEEP that copy, and DELETE all the other config.json copies (so only the genuine one survives).
                                }
                                else (none of them decrypt) {
                                    Treat it as a decryption failure and DELETE NOTHING (it is likely just a wrong master password, so we must not destroy any copy).
                                }
                            }
                        }

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