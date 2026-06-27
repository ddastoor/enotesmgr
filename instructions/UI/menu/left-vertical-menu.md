

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
                            tooltip: "Download the command-line export utility (mynotes-export.js)"
                            on click {
                                Dismiss the menu pane
                                Download the prebuilt self-contained 'mynotes-export.js' tool to the user's device. See ../../export-cli.md.
                            }
                        }
                    }
                    {
                        menu item: "Copy Export Token" {
                            PC only - NOT shown on mobile.
                            tooltip: "Copy a token for the export utility's online mode"
                            on click {
                                Dismiss the menu pane
                                Copy the app's current Google Drive access token to the clipboard \(if the clipboard is unavailable, show the token so it can be copied manually\), and tell the user to paste it into the export utility's online mode \(node mynotes-export.js -m on\). The token is valid for about an hour. This is the 'token hand-off' that lets the CLI access Drive without doing its own OAuth - see ../../export-cli.md.
                            }
                        }
                    }





                ]
            }
        }

        when escape is pressed { Dismiss the menu pane }

    }





