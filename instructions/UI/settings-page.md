


Settings page {
    Title: Settings

    contents {
        A vertically scrollable area {
            contents {

                [

                'Session Timeout Seconds' {
                        The user's google session time in seconds
                        type: edit box that accepts only numbers 
                        default value: 300

                        validation {
                            minimum value is 60
                            maximum value is 3600
                        }

                        app behavior {
                            After no user activity for 'session timeout seconds', log out
                            The inactivity is measured in real (wall-clock) time, so time spent with the device asleep, the tab in the background, or the page in the browser's back/forward cache counts too: on any activity, or when the page becomes visible / focused / restored again, if 'session timeout seconds' have already passed since the last activity, log out instead of restarting the countdown.
                        } 

                    }

                'App Theme' {
                    type: dropdown 
                    default value: "Light"
                    
                    options {
                        "Light"
                        "Dark"
                    }

                    app behavior {
                        refreshes the app with the selected theme
                        In theme=dark, keep all labels/text contrasty per the "Dark theme contrast" rule in ./ui.md.
                    }

                }



                ]
            }
            
        }

        Save button {
            On click:
                validate all fields using the validation rules above
                if validation fails, show error message and do not proceed
                if validation succeeds, update settings json with the new values from the edit fields
                encrypt settings json using the file password
                save encrypted settings json to google drive
                app should reflect the changed settings values immediately from settings json
                Redirect to UI @ ./main-page.md
        }

        Cancel button {
            On click:
                Redirect to UI @ ./main-page.md without changing anything
        }

        Pressing the Escape key dismisses the settings page exactly like the Cancel button (redirect to UI @ ./main-page.md without changing anything).
    }

    on load {
        fetch settings json from config folder. Decrypt it using the file password to get settings json. 
        populate all settings page editable fields with the values from settings json
    }

}


