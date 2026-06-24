

Note search popup {

    Purpose: quickly find a note entry by name and select it. Opened from the 'Search button' next to the file selector dropdown on the main page (see ./main-page.md). Applies to both PC and mobile.

    layout {
        A modal dialog shown over the main page (centered, like the other modal dialogs), top to bottom:
            1. a search edit box at the top
            2. below it, a vertical scrollable list of note entry names
            3. below the list, a 'Cancel' button.

        On open, put the cursor (focus) in the search edit box.
    }

    contents {

        Search edit box {
            placeholder: "Search notes..."

            The list below reflects what is typed here:
                As the user types or deletes text, filter the list to show only the note entries whose name contains the typed text (case-insensitive substring match).
                A blank entry, or one that is only spaces, is treated as the empty string => show ALL note entries.

            When focus enters / returns to the search edit box, select its whole text (so the user can immediately overtype).
        }

        Note entries list {
            Contents: all note entry names from the entries folder, EXCEPT the dummy "" entry, sorted alphabetically. Keep it alphabetical.
            It is a scrollable vertical list. One entry is the "highlighted" (active) entry at a time, shown with a clear highlight.
            After every (re)filter, the highlight defaults to the first entry in the (filtered) list.
            If nothing matches the current search text, show a "No matching notes" message instead of the list items.
        }

        Cancel button {
            on click { Close the popup and return to caller without selecting anything. }
        }
    }

    keyboard / selection behavior {
        From the search edit box:
            Pressing Down arrow or Enter (when the list is non-empty) moves focus into the list and highlights the first entry.

        In the list:
            Up / Down arrows move the highlight (Home / End jump to first / last).
            Pressing Up arrow while the first entry is highlighted moves focus back up into the search edit box.
            Pressing Enter on the highlighted entry, OR double-clicking an entry (on PC), selects that entry.

        Tab / Shift-Tab move focus between the search edit box, the list, and the Cancel button in order; Shift-Tab from the list returns to the search edit box (which then selects its whole text as above).

        Escape, or clicking outside the dialog, cancels (same as Cancel).

        When an entry is selected (by any of the means above), close the popup and return that entry's name to the caller.
    }

    mobile ergonomics {
        The dialog, search box, list and buttons must be comfortably sized and usable on mobile.
        On mobile a single tap on a list entry selects it directly (there is no hover or reliable double-click on mobile).
        The list rows are larger / taller for comfortable tapping, and the list is scrollable.
    }

}
