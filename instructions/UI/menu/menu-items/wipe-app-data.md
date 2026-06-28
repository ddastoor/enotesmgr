

Wipe all App Data flow {

    Triggered from the "Wipe all App Data" item in the left vertical menu (see ../left-vertical-menu.md). PC only.

    Purpose {
        Permanently delete the user's ENTIRE 'eNotes Manager' folder tree (and everything inside it: all note entries, the config file, the settings file and all recovery files) from the user's google drive. After a successful wipe the user's account is effectively reset: their next login is treated as a 'new user' (the config file no longer exists - see ../../../terms.md and ../../../new-user-login.md).
    }

    on trigger {

        a) Confirmation {
            Show a confirmation dialog warning that this permanently deletes the entire 'eNotes Manager' folder and ALL its contents (notes, config and recovery codes) from google drive and cannot be undone.
            if (the user does NOT confirm) { Do nothing and stop. }
        }

        b) Re-enter master password {
            Prompt the user to re-enter their master password (hidden/password input) to confirm the wipe.
            if (the user cancels or leaves it empty) { Do nothing and stop. }

            Verify the entered master password the same way the unlock flow does: try to decrypt the config file with it (handling the normally-impossible case of duplicate config.json copies by trying each copy - see ../../master-password-popup.md). The master password is never held in memory, so this decrypt attempt IS the verification.

            if (no config.json copy decrypts with the entered password) {
                Show an error like "Incorrect master password. Your app data was NOT deleted." and stop (delete nothing).
            }
            if (verification errors out for some other reason) {
                Show an error like "Something went wrong. Your app data was NOT deleted." and stop (delete nothing).
            }
        }

        c) Delete the tree {
            Delete the whole 'eNotes Manager' folder from google drive. Deleting the folder removes all of its descendants in one call (no need to delete children individually).
            if (the delete fails) {
                Show an error like "Could not delete your app data. Please try again." and stop.
            }
        }

        d) After a successful wipe {
            Tell the user they have to set up their eNotes Manager again, then log out (see 'Log out' in ../../../terms.md): drop the session and return to UI @ ../../login-page.md.

            Note: logging out does NOT revoke the google grant, so when the user logs in again the google oauth consent screen must NOT reappear; because the config file is gone, that next login starts a fresh new-user setup.
        }
    }
}
