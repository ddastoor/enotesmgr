'start remind user of recovery codes' popup again {

    First check whether the 'one-or-no-recovery-files-left-dont-ask-marker-file' exists (status "Checking..."). If that check fails, show "Something went wrong. Please try again." and stop.

    if (the marker does NOT exist, i.e. reminders are already on) {
        Show a message, title "Recovery code reminders": "Recovery code reminders are already on. Whenever you log in with no recovery codes, you'll be reminded to generate some. (With only 1 left, you're always required to generate more.)"
    }
    else (the marker exists, i.e. the user chose "Don't ask again") {
        popup title - "Start recovery code generation reminder again"
        popup description - "Reminders are currently off (you chose "Don't ask again"). Turn them back on? Whenever you log in with no recovery codes, you'll be reminded to generate some."

        'Cancel' button (also: the Escape key) { Close the popup, change nothing }
        'Turn on' button {
            on click {
                Delete file 'one-or-no-recovery-files-left-dont-ask-marker-file' (status "Saving...")
                Show "Recovery code reminders are on again." (or, if the delete fails, "Could not turn reminders back on. Please try again.")
            }
        }
    }

    See ../../one-or-zero-recovery-code-left-popup.md for when reminders are shown.
}
