

Main page keyboard shortcuts {

    Applies to the main page (./main-page.md) only.

    These keyboard shortcuts are PC-only. On mobile they are not active at all.

    Global conditions (apply to every shortcut below) {
        - They are only active while the main page is showing.
        - They are suppressed whenever any other popup / dialog / menu is open over the main page UI
          (e.g. the search popup, the recovery reminder popup, the menu pane, a rename/new/confirm dialog, the shortcuts-help popup, etc).
          A transient "loading/saving" status spinner does NOT count as a popup.
        - "not in the rich text area" means the text caret / focus is NOT inside the rich text editor.
          When focus is inside the rich text editor, those shortcuts that require "not in the rich text area" must NOT fire and the key must behave normally (e.g. typing '/' inserts a '/').
        - When a shortcut fires, prevent the browser's default handling of that key (e.g. Ctrl+S must not trigger the browser "save page", Ctrl+K must not focus the browser's search/address bar).
        - The letter shortcuts are case-insensitive.
        - "like pressing the <X> button" means: do exactly what clicking that toolbar button on the main page does, including respecting whether that button is currently disabled (a disabled button's shortcut does nothing).
    }

    Shortcuts {

        '/' or 'Ctrl+K' {
            focus condition: not in the rich text area.
            action: open the note search functionality (same as pressing the Search button - see ./note-search-popup.md).
        }

        'Ctrl+S' {
            focus condition: anywhere (including inside the rich text editor).
            action: like pressing the Save button.
        }

        'N' {
            focus condition: not in the rich text area.
            action: like pressing the New button.
        }

        'U' {
            focus condition: not in the rich text area.
            action: like pressing the Upload button.
        }

        'R' {
            focus condition: not in the rich text area.
            action: like pressing the Rename button.
        }

        'D' {
            focus condition: not in the rich text area.
            action: like pressing the Delete button.
        }

        'S' {
            focus condition: not in the rich text area.
            action: like pressing the settings button.
        }

        'M' {
            focus condition: not in the rich text area.
            action: like pressing the 'More options' button.
        }


        'X' or 'Q' {
            focus condition: not in the rich text area.
            action: like pressing the Logout button.
        }

        '?' {
            focus condition: not in the rich text area.
            action: show the keyboard shortcuts help popup - see ./keyboard-shortcuts-help-popup.md.
        }

    }

}
