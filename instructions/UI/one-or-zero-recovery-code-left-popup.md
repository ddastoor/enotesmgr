1 or 0 recovery codes left popup {

    The rule: the user is NEVER left with 0 recovery codes, and never kept at a single, last one.

    Why {
        If you use your last recovery code to reset your master password and then forget the NEW master password too, there is no way back in. So nothing in the app lets you end up with 0 or 1 codes and keep going:
            - Setup always generates 10 codes (../new-user-login.md).
            - There is no "delete all codes": the recovery codes page has 'Replace', which generates 10 new codes BEFORE deleting the old ones (./menu/menu-items/recovery-codes.md).
            - A recovery-code reset that would leave 0 or 1 codes requires 10 new ones first (./master-password-popup.md).
            - And this popup, after every master-password login with 0 or 1 codes left.
        There is no "Later", no "Don't ask again" and no way to turn this off.
    }

    Shown right after a login lands on the main page (see ./main-page.md) when (recovery file count <= 1). It is MANDATORY {
        popup title {
            if (recovery file count == 1) { "Only 1 recovery code left" }
            else { "No recovery codes" }
        }
        popup description {
            if (recovery file count == 1) { "You have only 1 recovery code left. If you used it and then forgot your new master password, you would be locked out for good. Generate 10 new recovery codes to keep using eNotes, or log out." }
            else { "You have no recovery codes. If you forgot your master password, you would be locked out for good. Generate 10 new recovery codes to keep using eNotes, or log out." }
        }

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
        The popup can't be dismissed any other way, and the main page behind it can't be used while it is shown (keyboard shortcuts are suppressed while a popup is open).
    }

    While counting, if the (legacy) 'one-or-no-recovery-files-left-dont-ask-marker-file' is found in the recovery folder, delete it (best effort) - it has no meaning any more.
}
