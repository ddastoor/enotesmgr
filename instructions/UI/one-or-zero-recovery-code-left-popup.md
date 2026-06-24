

1 or 0 recovery codes left popup { 

    popup title {
        if (recovery file count == 1) { "Only 1 recovery code left" }
        else if (recovery file count == 0) { "No recovery codes left" }
    }
    popup description { 
        if (recovery file count == 1) { "You have only 1 recovery code left. Generate more recovery codes to stay safe." }
        else if (recovery file count == 0) { "You have no recovery codes left. Generate more recovery codes to stay safe." }
    }
    
    'Generate more' button { 
        on click { 
            Redirect to UI @ ./menu/menu-items/recovery-codes.md
        }
    }
    'Later' button { 
        on click { 
            Close the popup and return to caller
        }
    }
    
    'Don\'t ask again' button { 
        on click { 
            Create 'one-or-no-recovery-files-left-dont-ask-marker-file' as an empty file
            Close the popup and return to caller
        }    
    } 

}