


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
        populate all settings page editable fields at once with the values from the settings json in memory
        fetch settings json from config folder. Decrypt it using the file password to get settings json. 
        populate all settings page editable fields with the values from settings json

        While that fetch is under way (the lookup in Drive, then the download with "Loading..." on screen), the editable fields and the Save button are disabled - so the settings can't be changed or saved until the fetched values are in. (Otherwise the fetched values would silently overwrite a change made meanwhile, and a Save made meanwhile would be undone in memory - stored in Drive but not used by the app until the next login.) Cancel and Escape work all the time.
        If the fetch fails, the fields keep the values from memory and are enabled (the settings can still be changed and saved).
        If the page is left before the fetch is done, its result is ignored: it changes nothing (not the settings in memory, not the page now shown) - a lookup still under way doesn't go on to download.
    }

}


