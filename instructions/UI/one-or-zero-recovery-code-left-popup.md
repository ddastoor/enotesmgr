

1 or 0 recovery codes left popup { 

    popup title - "1 or no recovery codes left"
    popup description { 
        "You have 1 or no recovery codes left. Generate more recovery codes to stay safe." 
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