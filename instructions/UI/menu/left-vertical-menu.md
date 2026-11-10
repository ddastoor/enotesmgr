

    On both PC and mobiles, a scrollable vertical menu pane, when displayed, should come into view from the left side of the screen, and when dismissed, should disappear {

        contents {
            A button with label 'Dismiss' \(first item\) {
                on click { Dismiss the menu pane }
            }
            A scrollable list of menu items displayed vertically {
                [
                    
                     <!-- recovery codes  -->
                    {
                        menu item: "Recovery Codes" {
                            tooltip: "Generate Recovery Codes"
                            on click {
                                Dismiss the menu pane
                                Redirect to UI @ ./menu/menu-items/recovery-codes.md
                            }
                        }
                    }


                    <!-- export CLI tools (PC only - see ../../export-cli.md) -->
                    {
                        menu item: "Download Export Utility" {
                            PC only - this item is NOT shown on mobile \(it is a desktop command-line tool\). A non-clickable section label "Tools (PC only)" precedes it.
                            tooltip: "Download the command-line export utility (enotesmgr-export-cli.js)"
                            on click {
                                Dismiss the menu pane
                                Download the prebuilt self-contained 'enotesmgr-export-cli.js' tool to the user's device. See ../../export-cli.md.
                            }
                        }
                    }
                    {
                        menu item: "Copy Export Token" {
                            PC only - NOT shown on mobile.
                            tooltip: "Copy a token for the export utility's online mode"
                            on click {
                                Dismiss the menu pane
                                If there is no active session token, inform the user to log in again and stop.
                                Otherwise copy the app's current Google Drive access token to the clipboard \(if the clipboard is unavailable, show the token so it can be copied manually\), and tell the user to paste it into the export utility's online mode \(node enotesmgr-export-cli.js -m on\). The token is valid for about an hour. This is the 'token hand-off' that lets the CLI access Drive without doing its own OAuth - see ../../export-cli.md.
                            }
                        }
                    }
                    {
                        menu item: "Decrypt Sensitive File" {
                            PC only - NOT shown on mobile. In the "Tools (PC only)" section, after "Copy Export Token".
                            tooltip: "Decrypt a sensitive note file (.sensitive) exported by the export utility. Stays on this device: nothing is sent to Google Drive"
                            on click {
                                Dismiss the menu pane
                                Open a file dialog. For the picked file: find the sensitive envelope in it \(a '.sensitive' file from the export utility, or an older utility's '.html' of a sensitive note\); if there is none, say the file is not a sensitive note exported by eNotesMgr and stop.
                                Ask for that note's password \(wrong password: ask again\), decrypt it with the WASM crypto, and download the result named and formatted per ../../export-cli.md "Output rules" \(e.g. 'bank.sensitive' -> 'bank.html', 'photo.png.sensitive' -> 'photo.png'\).
                                Entirely local and stateless: NO Google Drive calls, and nothing in the app changes. See ../../sensitive-notes.md.
                            }
                        }
                    }

                    <!-- wipe all app data (PC only - destructive) -->
                    {
                        menu item: "Wipe all App Data" {
                            PC only - this item is NOT shown on mobile \(it is a destructive desktop action\). A non-clickable section label "Danger Zone (PC only)" precedes it, and the item is styled as a danger/destructive item.
                            tooltip: "Permanently delete the eNotes Manager folder and all its contents from Google Drive"
                            on click {
                                Dismiss the menu pane
                                Run the wipe-all-app-data flow \(see ./menu/menu-items/wipe-app-data.md\).
                            }
                        }
                    }





                ]
            }
        }

        when escape is pressed { Dismiss the menu pane }

    }





