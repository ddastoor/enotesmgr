1 or 0 recovery codes left popup {

    Shown right after a login lands on the main page (see ./main-page.md). The rule is: you can never be left with a single, last recovery code you might use and then be locked out with - and you only ever have 0 codes by your own choice.

    Why {
        If you use your last recovery code to reset your master password and then forget the NEW master password too, there is no way back in. So:
            - 1 code left is only ever reached by using codes up -> generating more is MANDATORY.
            - 0 codes left is only ever reached by the user's own choice (setup with "Generate Recovery codes" unchecked, or the Wipe button) -> an optional reminder the user may silence.
        (The recovery-code reset itself also never leaves 0 or 1 codes - see ./master-password-popup.md.)
    }

    if (recovery file count == 1) {
        A MANDATORY popup, regardless of the 'one-or-no-recovery-files-left-dont-ask-marker-file' {
            popup title: "Only 1 recovery code left"
            popup description: "You have only 1 recovery code left. If you used it and then forgot your new master password, you would be locked out for good. Generate 10 new recovery codes to keep using eNotes, or log out."

            'Generate now' button {
                on click {
                    Generate 10 new recovery codes right here (same as the 'Generate' button of ./menu/menu-items/recovery-codes.md: downloads the codes file and shows "Recovery codes downloaded. Save them very safely!"). Auto-logout is paused while generating.
                    If generating fails, show "Could not generate recovery codes. Please try again." and show this popup again.
                    On success, close the popup and stay on the main page.
                }
            }
            'Log out' button (also: the Escape key) {
                on click { Log out (see ../terms.md) }
            }
            There is NO 'Later' and NO 'Don't ask again' here, and the popup can't be dismissed any other way. The main page behind it can't be used while it is shown (keyboard shortcuts are suppressed while a popup is open).
        }
    }

    else if (recovery file count == 0 AND the 'one-or-no-recovery-files-left-dont-ask-marker-file' does NOT exist) {
        An optional reminder popup {
            popup title: "No recovery codes left"
            popup description: "You have no recovery codes. If you forget your master password, you won't be able to get back in. Generate recovery codes to stay safe."

            'Generate more' button {
                on click { Redirect to UI @ ./menu/menu-items/recovery-codes.md }
            }
            'Later' button (also: the Escape key) {
                on click { Close the popup and return to caller }
            }
            'Don\'t ask again' button {
                on click {
                    Create 'one-or-no-recovery-files-left-dont-ask-marker-file' as an empty file
                    Tell the user: "OK, I won't remind you while you have no recovery codes. You can turn reminders back on any time from the menu: Restart Recovery Reminders." (If creating the marker fails: "Could not save that choice. You may be reminded again next time.")
                    Close the popup and return to caller
                }
            }
        }
    }

    The 'don't ask again' marker is removed (so reminders come back) when: the user turns reminders back on (./menu/menu-items/start-recovery-code-reminder.md), new recovery codes are generated, or the recovery codes are wiped.
}
