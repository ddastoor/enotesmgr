

Only 1 recovery code left popup { 

    popup title - "Only 1 recovery code left"
    popup description { 
        "You have only 1 recovery code left. Generate more recovery codes to stay safe." 
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
            Create 'only-one-recovery-file-left-dont-ask-marker-file' as an empty file
            Close the popup and return to caller
        }    
    } 

}