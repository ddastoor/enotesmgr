        
        Generate Recovery Codes Page {
            contents {   
             page title - "Generate Recovery Codes" 

             page description {

                "Generate 10 new random 16-digit numeric codes. Use these numeric codes if you happen to forget your master password. Once a code is used, it is exhausted. Save these code very safely."

             }


             'Generate' button {
                label: "Generate"
                one description: "Generate 10 new random 16-digit numeric codes"

                on click {

                    `exist-rec-lst` = Get a list of all existing recovery filenames in the recovery folder = "existing recovery filenames list"

                    Generate 10 new, unique random 16-digit numeric codes such that their sha256s are not already present in `exist-rec-lst`

                    These numeric code are meant to be master password replacements in case the user forgets their master password. Each code can be used only once.

                    foreach (such new recovery code) {
                        Encrypt config json with it into a file with name = sha256(recovery code)
                        Save this encrypted file into the recovery folder.
                    }

                    Download the 10 recovery codes listed line by line in 'enotes_recovery_codes.txt' to the user's device and inform the user via a popup with message 'Recovery codes downloaded. Save them very safely!'

                }
             }


             'Wipe' button {
                description: "Delete all recovery codes"
                disabled if {
                    no recovery codes exists in the app
                }

                on click {
                    Ask the user for a confirmation dialog asking "Are you sure you want to delete all recovery codes?".
                    if (user confirms) {
                        Delete all files from the recovery folder.
                    }
                    else {do nothing, stay on the screen}
                }
             }


             'Done' button {
                on click {Redirect to UI @ ../../main-page.md}
             }

            }
        }


