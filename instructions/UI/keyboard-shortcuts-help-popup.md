

Keyboard shortcuts help popup {

    A modal popup shown over the main page when the user presses '?' (see ./keyboard-shortcuts.md). PC only.

    popup title - "Keyboard shortcuts"

    popup body {
        A list of the available main-page keyboard shortcuts, each shown as the key(s) on the left and what it does on the right:

            "/  or  Ctrl + K"  ->  "Search notes"
            "Ctrl + S"         ->  "Save the current note"
            "N"                ->  "New note"
            "U"                ->  "Upload a file"
            "R"                ->  "Rename the current note"
            "D"                ->  "Download the current note"
            "X"                ->  "Delete the current note"
            "S"                ->  "Open Settings"
            "M"                ->  "Open the More options menu"
            "Q"                ->  "Log out"
            "?"                ->  "Show this keyboard shortcuts help"
            "Esc"              ->  "Move focus back to the page"
    }

    'Close' button {
        on click { Close the popup and return to caller. }
    }

}
