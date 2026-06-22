


Settings page {
    Title: Settings

    contents {
        A vertically scrollable area {
            contents {

                [

                'Session Timeout Seconds' {
                        The user's google session time in seconds
                        type: edit box that accepts only numbers 
                        default value: 60

                        validation {
                            minimum value is 60
                            maximum value is 3600
                        }

                        app behavior {
                            After no user activity for 'session timeout seconds', log out
                        } 

                    },


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
    }

    on load {
        fetch settings json from config folder. Decrypt it using the file password to get settings json. 
        populate all settings page editable fields with the values from settings json
    }

}


