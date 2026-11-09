
'Setup page' {

    contents {

        Master password edit box with corresponding label "Master password:"
        Re-enter master password edit box with corresponding label "Re-enter master password:"
        
        A check box with text "Generate Recovery codes" - by default checked.

        'Finish Setup' button {
            on click {
                if (all validation rules pass) { Redirect to UI @ ./new-user-login.md }
                else { Show meaningful validation errors to the user. }
            }
        }
    
    }

    Validation Rules {

        The master password should be at least 8 characters long and contain at least 1 digit in it. It must NOT be exactly 16 digits (all numbers, nothing else): the master password popup treats exactly 16 digits as a recovery code, so such a master password could never be used to log in.

        The master password edit box contents and the re-enter master password edit box contents should always be identical, failing which the user should not be allowed to proceed to the next step, with a meaningful inline text validation error.
    }

}




