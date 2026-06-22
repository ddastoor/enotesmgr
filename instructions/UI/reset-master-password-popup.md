

Reset Master Password Page {

    contents {
        Introductory text: "Please reset your master password"

        New Master Password edit box with label "New master password:" {
            validation rules {
                The new master password should be at least 8 characters long and contain at least 1 digit.
            }
        }
        
        Re-enter New Master Password edit box with label "Re-enter new master password:" {
            validation rules {
                The new master password should be at least 8 characters long and contain at least 1 digit.
            }
        }

        Reset button {
            on click {
                if (all validation rules pass) {
                    Go back to the calling page with the new master password value in the master password edit box.  
                }
                else {
                    Show inline error messages and stay on this page.
                }
            }
        }
    
        Cancel button {
            on click {
                invalidate the google auth and redirect to the login page.
            }
        }

        validation rules {
            The master password edit box value and the re-enter master password edit box value should always be identical. If they're not, the user should not be allowed to proceed to the next step, with a meaningful inline text validation error.
        }


    }

    If the user presses the escape key OR presses the browser back button or gets out of this page in any other way, invalidate the google auth and redirect to the login page.


}




    