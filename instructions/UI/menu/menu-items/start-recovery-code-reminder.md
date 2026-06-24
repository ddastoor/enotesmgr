
'start remind user of recovery codes' popup again { 
    page title - "Start recovery code generation reminder again" 
    page description {
        "I'll start reminding you again when you have 1 or no more recovery codes left"
    }

    Ok button {
        on click {
            Delete file 'one-or-no-recovery-files-left-dont-ask-marker-file' if present
            Close the popup and return to caller
        }
    }
}