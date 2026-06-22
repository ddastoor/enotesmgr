

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





                ]
            }
        }

        when escape is pressed { Dismiss the menu pane }

    }





