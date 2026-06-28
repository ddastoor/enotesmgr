


Main page {

    Keyboard shortcuts (PC only) for this page are defined in ./keyboard-shortcuts.md.

    on reaching this page right after a login (whether via master password or as a new user) {
        Check the 'recovery file count'.
        if (recovery file count <= 1 \(i.e. 1 or 0\) AND the 'one-or-no-recovery-files-left-dont-ask-marker-file' does NOT exist) {
            Redirect to UI @ ./one-or-zero-recovery-code-left-popup.md (shown as a popup over this page).
        }
        This check only runs on the login that lands here; navigating back to the main page from within an authenticated session (e.g. returning from the settings or recovery-codes page) does NOT re-trigger it.
    }

    contents {

        header area {
            Title: "eNotes" (gradient styled)
            
            Settings button {
                position: to the right of title
                tooltip: "Settings"
                on click {
                    Redirect to UI @ ./settings-page.md
                }
            }

            'More Options' button {
                tooltip: "More options"
                position: to the right of settings button
                on click {
                    Redirect to UI @ ./menu/left-vertical-menu.md
                }
            }

            Logout button {
                tooltip: "Logout"
                position: to the right of "More Options" button

                icon {
                    A "logout / sign-out" icon: a circular outline with a short arrow pointing left and exiting out through the left side of the circle (the Remix Icon "logout-circle-line" glyph).

                    It MUST be implemented as an inline SVG embedded directly in the button (vector paths), NOT as a unicode/emoji character or an icon-font glyph. This is deliberate: a power/symbol unicode character (e.g. ⏻) is missing from many mobile system fonts and renders as a broken "tofu" box, whereas an inline SVG renders identically on PC and mobile with no font dependency.

                    The SVG must use fill="currentColor" so it inherits the icon button's text color and therefore looks correct in both light and dark themes. Size it to about 22px square inside the circular 44px icon button, and keep it centered within the button.

                    accessibility: the button has an aria-label of "Logout" and the SVG is aria-hidden.
                }

                on click {
                    log out
                }
            }

            Username display {
                shows the logged-in google user's username once a user logs in {
                    for e.g. if my email address is abc@gmail.com, then display 'abc'
                }
                position: below the title and above the toolbar
                font style: bold
                color: some nice pastel color that contrasts well with the title.
            }

            Fullname display {
                shows the logged-in google user's full name once a user logs in 
                position: below the username and above the toolbar
                font style: bold
                color: some nice pastel color that contrasts well with the title.
            }

            Keyboard shortcuts hint {
                PC only - not shown on mobile.
                position: directly below the Fullname display.
                text: "(? for keyboard shortcuts)" (including the surrounding parentheses).
                font style: bold and small.
                color: blue. It must contrast well with the Fullname display's color (the full name is a pastel teal). Use a blue that stays readable in both light and dark themes (a deeper blue in light theme, a lighter blue in dark theme).
                Purpose: hints the user that pressing '?' opens the keyboard shortcuts help (see ./keyboard-shortcuts.md).
            }

        }


        Toolbar area (glassmorphism style) {

            contents {

                File selector dropdown {
                    Lists all note entries from entries folder , sorted alphabetically.
                    Always keep this list sorted alphabetically even when notes are added or removed.
                    The first entry of the list ahould be a dummy entry "" that displays by default
                    On file selection { trigger load the note functionality }
                }

                Search button {
                    Position: right next to the file selector dropdown. On both PC and mobile.
                    label/icon: a magnifying glass icon (rendered as an inline SVG, not a unicode/emoji character, consistent with the logout icon rule above).
                    tooltip: "Search notes"
                    on click {
                        Redirect to UI @ ./note-search-popup.md (shown as a popup over this page).
                        When that popup returns a chosen note name, set the file selector dropdown's selected entry to that name and trigger the usual file selection operation (i.e. the same as if the user had picked it directly from the dropdown - see 'load the note' functionality).
                        If the popup is cancelled, do nothing.
                    }
                }

                Refresh button {
                    label: the clockwise round-arrow character "↻" (Unicode U+21BB, CLOCKWISE OPEN CIRCLE ARROW). aria-label "Refresh".
                    tooltip: "Refresh the current note"
                    on click {
                        Re-fetch the currently selected note file from entries folder, decrypt it using the file password and display the contents in the rich text editor or media viewer depending on the type of file that was selected.
                    }
                }

                New button {
                    label: "New"
                    tooltip: "Create a new note"
                    on click {
                        Ask the user to give a filename for the new note. When this filename prompt opens, the cursor/focus must be inside the (empty) filename edit box, ready to type.

                        Strip any extension from the filename if the user enters one. For e.g. if the user enters 'mynote.txt', then the actual filename used should be 'mynote'.
                        
                        If the filename already exists in entries folder, show an error message 'Filename already exists' and do not proceed. 
                        
                        If (user entered a new unique filename) {

                            If (an existing note is already loaded \(i.e., file selector is not showing dummy entry ""\) ) {
                                
                                If (the creationmethod field is "new" \(and not "upload"\) and the current rich text editor contents are not saved) {
                                    Ask the user if he wants to save the current note or not. If he says yes, save the current note. If he says no, do not save the current note.
                                }
                            } 

                            Set the note meta data {
                                "DateTimeCreated" = current date and time in [date]T[time] format
                                "DateTimeModified" = same as "DateTimeCreated"
                                "CreationMethod" = "new"
                                "FileType" = "richtext"
                            }

                            
                            Set the actual note contents to empty.

                            Update the file selector dropdown with the new filename

                            The 'un-encrypted note entry content' is the actual note contents only (no metadata section, no separating newline).
                            Encrypt this with the file password and save it to the entries folder. Write the note metadata to the entry's Google Drive custom file properties (appProperties) — see ./note-meta-data.md. Then re-fetch and display according to 'Note Display Methods based on FileType' (see ./note-meta-data.md)

                            A new note is always a richtext note, so after it is saved and displayed, put the cursor/focus into the rich text editing area so the user can start typing right away (same focus behaviour as loading a richtext note - see 'load the note' functionality).
                            

                        }
                        
                    }
                }

                Upload Button {
                    label: "↑U"
                    tooltip: "Upload"
                    on click {

                        If (an existing note is already loaded \(i.e., file selector is not showing dummy entry ""\) ) {
                            
                            If (the creationmethod field is "new" \(and not "upload"\) and the current rich text editor contents are not saved) {
                                Ask the user if he wants to save the current note or not. If he says yes, save the current note. If he says no, do not save the current note.
                            }
                        } 

                        Popup a file dialog for the user to upload the file.

                        Determine the uploaded file's type by its CONTENT (magic number), NOT by its filename extension or the browser-provided File.type — see 'File type detection (magic number)'. If the detected type is not a currently-supported uploadable type (image or audio), show the error 'Only image or audio files can be uploaded.' and do not proceed.

                        If the filename to be uploaded is already present in entries folder, show an error message 'Filename already exists' and do not proceed. 
                        
                        If (user selected a new unique filename) {
                            Set the note metadata {
                                "DateTimeCreated" = current date and time in [date]T[time] format
                                "DateTimeModified" = same as "DateTimeCreated"
                                "CreationMethod" = "upload"
                                "FileType" = the file's type as detected by content (magic number) — see 'File type detection (magic number)'
                            }

                            
                            Set the actual note contents to the uploaded file contents.

                            Update the file selector dropdown with the new filename

                            The 'un-encrypted note entry content' is the actual note contents only (no metadata section, no separating newline).
                            Encrypt this with the file password and save it to the entries folder. Write the note metadata to the entry's Google Drive custom file properties (appProperties) — see ./note-meta-data.md. Then re-fetch and display according to 'Note Display Methods based on FileType' (see ./note-meta-data.md)
                            

                        }

                        
                    }
                }

                Save button {
                    label: "Save"
                    tooltip: "Save the current note"
                    disabled if {
                        no note is currently selected OR the note file is an uploaded audio or image media file
                    }
                    on click {
                        save the current note functionality

                        After the save operation, move the cursor/focus OUT of the rich text editing area (back onto the main page, i.e. not inside the editor). This applies whether the save was triggered by clicking Save or via the Ctrl+S keyboard shortcut.
                    }
                }

                Rename button {
                    label: "Rename"
                    tooltip: "Rename the current note"

                    on click {
                        Ask the user to enter a new name for the current note. When this rename prompt opens, the cursor/focus must be inside the edit box, pre-filled with the current name AND with that whole existing name selected/highlighted, so the user can immediately overtype it.

                        If (user entered a new unique filename) {
                            Rename the current note's filename to the new filename in the entries folder
                            Update the file selector dropdown with the new filename
                        }
                        else {
                            Show an error message 'Filename already exists' and do not proceed. 
                        }
                    }
                }

                Delete button {
                    label: "Delete"
                    tooltip: "Delete the current note"
                    on click {
                        delete the current note functionality and clear out the editor area/media viewer area (whichever is currently visible) and select the dummy file entry in the file selector dropdown
                    }
                }

                Disable and enable the above buttons appropriately based on the file meta data keys "FileType" and "CreationMethod" for the current note. 
                Additionally, the Save button should be disabled for the dummy file entry and for CreationMethod = "upload", otherwise the Save button should be enabled.                 

            }

            'load the note' functionality {
                
                Fetch the selected file from entries folder, decrypt the file using the file password.

                See ./note-meta-data.md and use it to display the note in the app using the right display controls according to note meta data keys FileType and CreationMethod

                After the note is loaded and displayed, if the note's appProperty "FileType" is "richtext", put the cursor/focus into the rich text editing area so the user can start typing right away. (This applies on both PC and mobile. For non-richtext / media notes, do not move focus into the editor.)

            }

            'save the current note' functionality {

                Skip-unchanged optimization (avoid pointless Google Drive writes) {
                    Goal: if the note content has not actually changed since it was last loaded or last saved, the save must be a complete no-op — no metadata change, no encryption, and NO write/round-trip to Google Drive.

                    How to detect "unchanged" {
                        Maintain a stored "last saved content hash" for the currently loaded note: a SHA-256 hash (hex) computed over the note CONTENT (which is the entire un-encrypted note entry content, since metadata is no longer embedded in the file — see ./note-meta-data.md; metadata now lives in the entry's Google Drive custom file properties).

                        The hash must be computed over the exact same content serialization that a save would write (the editor's content with any runtime-only decorations such as the embedded-media ✕ delete buttons and selection highlight removed). Compute the load-time/baseline hash and the save-time hash through that same serialization so that an unchanged note hashes identically. (Rationale: when content is loaded into the editor the browser may normalize the HTML, so hashing the raw stored bytes vs the editor's re-serialized content could differ even with no edit; using one consistent serialization avoids that.)

                        Set/refresh this stored hash:
                            - when a rich text note is loaded/opened (baseline = hash of the loaded content),
                            - when a brand-new rich text note is created (baseline = hash of its empty content),
                            - after every successful real save (baseline = hash of the content just saved).
                        When no rich text note is loaded (dummy entry selected, or a media/image/audio note), there is no stored hash.
                    }

                    On a save request, recompute the SHA-256 of the current content and compare it to the stored "last saved content hash":
                        if (the two hashes are equal) {
                            Do nothing — no DateTimeModified update, no encryption, no Drive write (this is the no-op).
                            If the save was triggered by the user explicitly clicking the Save button, briefly flash the transient status message "Nothing to save.." in the centered status overlay for about 600 ms (short, just long enough to read) and then auto-hide it. This informational flash shows NO spinner (nothing is actually working). Do NOT show this flash for internal/automatic saves such as the "save before switching notes?" flow.
                        }
                        else {
                            Proceed with the actual save below, and update the stored "last saved content hash" to the new content's hash afterwards.
                        }
                }

                Actual save (only when the content changed) {
                    Set the modified 'DateTimeModified' metadata key to current date and time in the same format as mentioned in metadata keys, and write it to the entry's Google Drive custom file properties (appProperties) — see ./note-meta-data.md.

                    Update the actual note content.

                    Encrypt the current file (whether an audio, image, or rich text file) using the file password and save the encrypted contents to the currently selected file in entries folder. Show the transient status "Saving..." while the save operation is in progress.

                    See ./note-meta-data.md for logic related to 'On Saving the note, just before encrypting the note file contents'
                }
            }


            'File type detection (magic number)' {
                Wherever the app needs to determine the type of a user-provided file — namely the Upload button — it MUST detect the type from the file's CONTENT (its magic-number / file signature, like the Linux `file` command), NOT from the filename extension and NOT from the browser-provided File.type (which is itself only derived from the extension and is unreliable / spoofable).

                Use a no-build, browser-side JavaScript magic-number library for this (the JS equivalent of libmagic / `file`), able to recognise at least images, audio, video, PDF and MS Office documents by their binary signature. Requirements {
                    - It must be vendored locally as a pre-bundled ES module, with NO bundler / npm build step, following the same local-vendoring pattern already used for the WASI shim (the wasi-shim-vendor folder). Do NOT load it from a live CDN — the app stays self-contained / offline-capable.
                    - Detection must read only the leading bytes of the file (so it stays memory-bounded even for large files).
                }

                Map the detected MIME type to the app's FileType enum (see ./note-meta-data.md). This mime→FileType mapping is the SINGLE place to extend when adding new supported types later (e.g. video / PDF / MS Office): add a viewer for display and a row to this map, with no other redesign.

                Everything with a real binary signature is identified by content.
            }


        }


        Note display area {
            contents {

                Rich text editor {
                    Toolbar with {
                        Undo button {
                            Label: ↶
                            tooltip: "Undo"
                            Position: at the far left of the toolbar, before all the other toolbar buttons (Undo first, then Redo, then the rest).

                            Behavior {
                                Clicking it undoes the last change made in the rich text editor — typed/deleted text as well as inserted or deleted embedded image/audio containers — by stepping back through the editor's native edit history.
                                It must operate on the SAME single edit history that the keyboard shortcuts and all other edit actions use, so the button and the keyboard always stay in sync (one shared undo/redo stack).
                                The undo history is per-note and resets when a different note is loaded/opened (a freshly loaded note starts with an empty history).
                            }
                        }

                        Redo button {
                            Label: ↷
                            tooltip: "Redo"
                            Position: immediately to the right of the Undo button.

                            Behavior {
                                Clicking it re-applies the most recently undone change, using the same shared edit history as the Undo button and the keyboard shortcuts.
                            }
                        }

                        Undo/Redo keyboard shortcuts {
                            if (on PC) {
                                Ctrl+Z (or Cmd+Z on Mac) performs Undo.
                                Ctrl+Y (or Cmd+Y), and also Ctrl+Shift+Z (or Cmd+Shift+Z), perform Redo.
                                These shortcuts must drive the exact same shared edit history as the Undo/Redo toolbar buttons, so pressing a shortcut and clicking a button are interchangeable and never diverge.
                            }
                            if (on mobile) {
                                There are no undo/redo keyboard shortcuts (mobile has no reliable undo key); the Undo and Redo toolbar buttons are the only way to undo/redo.
                                On mobile the Undo and Redo buttons must be rendered small and compact so they take up minimal toolbar space, noticeably smaller than the other toolbar buttons.
                            }
                        }

                        Bold button 
                        Italic button
                        Underline button

                        Insert Image button {
                            Label: 🖼️
                            tooltip: "Insert Image from local device"

                            The user should be able to upload an image from his local device and insert it into the rich text editor at the cursor's current position in an embedded "container" (like microsoft OLE image container), so that I can simply select the embedded image viewer and press delete to remove the image, from the rich text editor at the place it was inserted, not from the user's device.


                            if (on PC) {
                                The inserted image should be at the original 100% picture resolution, not expanded or distorted.
                            }
                            else if (on mobile) {
                                The inserted image should be at a fixed resolution that looks good and fits on a mobile screens, not expanded or distorted.

                                Additionally, when I tap the image, it should open in a new browser window where I can view and download it.
                            }

                        }

                        Insert Audio button {
                            Label: 🔊
                            tooltip: "Insert Audio from local device"

                            The user should be able to upload an audio file from his local device and insert it into the rich text editor at the cursor's current position, where it should be shown as an embedded audio player inside an embedded "container" (similar to OLE audio container), so that I can simply select the embedded audio player and press delete to remove the audio file from the rich text editor at the place it was inserted, not from the user's device.
                            
                            
                        }



                    }

                    Pasting an image {
                        When the user pastes an image (e.g. a screenshot, or any image on the clipboard) into the rich text editor, it must be inserted at the cursor's current position inside the SAME kind of embedded "container" that the Insert Image button produces — NOT as a bare/plain pasted image. This means the pasted image gets the identical embedded-image-container treatment: the same selection-and-delete behaviour and the same ✕ delete button described in 'Embedded media selection and deletion' below (including the PC vs mobile differences, the resolution rules, and the tap-to-open-in-new-window behaviour on mobile), so it can be removed from the note just like an inserted image, and is removed only from the note, not from the user's device.

                        Only image content on the clipboard is intercepted this way. Pasting other clipboard content (e.g. plain text) keeps its normal default paste behaviour.
                    }

                    Embedded media selection and deletion {
                        Embedded images and audio players are inserted as non-editable "containers", so the text caret cannot enter them and the browser will NOT delete them on its own. The app must handle this explicitly.

                        if (on PC) {
                            There are two ways to delete an embedded image or audio container, both of which remove it only from the note, not from the user's device:

                            1. Select-and-delete with the keyboard {
                                Clicking an embedded image or audio container selects it and shows a clear selection highlight (an accent outline) around that container.
                                While an embed is selected, pressing Delete or Backspace removes that embed from the rich text editor.
                                The Delete/Backspace handling must work even when the embed container (which is non-editable) does not hold the text caret/keyboard focus.
                                Clicking elsewhere in the editor, or outside the editor, clears the selection highlight.
                            }

                            2. The ✕ delete button {
                                Each embedded image or audio container shows a small ✕ delete button at its top-right corner. The button appears when the user hovers over the container or when the container is selected, and is hidden otherwise.
                                Clicking the ✕ button removes that embed immediately.
                            }

                            For an embedded audio container, its play/pause controls must still work normally even though the container can be selected and shows the ✕ button.

                            Deleting an embed (by either method) must be undoable with Ctrl+Z, exactly like deleting plain text — pressing Ctrl+Z brings the deleted image/audio container back. So the deletion has to go through the editor's normal undo history, not a raw DOM removal that the browser's undo cannot track.

                            The ✕ delete button and the selection highlight are runtime-only decorations: they must NEVER be persisted into the saved note content.
                        }

                        if (on mobile) {
                            On mobile, tapping an embedded image opens it in a new browser tab and long-pressing it brings up the browser's own image menu (download etc.), so those gestures are reserved and are NOT used for deletion.

                            To delete an embedded image or audio container, each container shows a ✕ delete button at its top-right corner that is ALWAYS visible (there is no hover on mobile) and sized large enough to tap comfortably.

                            Tapping the ✕ button first asks the user to confirm ("Remove this image?" / "Remove this audio?"), and only removes the embed if confirmed. The confirmation is required because mobile has no easy undo (unlike Ctrl+Z on PC). Deletion removes the embed only from the note, not from the user's device.

                            For an embedded audio container, its play/pause controls must still work normally even though the container shows the ✕ button.

                            The ✕ delete button is a runtime-only decoration: it must NEVER be persisted into the saved note content.
                        }
                    }

                    Rich text editing area {
                        should have a vertical and horizontal scrollbar if needed both on PC and mobile.
                        should have a placeholder text "Write your note here..."
                    }
                    
                }


                Media viewer {
                    should have a vertical and horizontal scrollbar if needed both on PC and mobile.

                    hidden by default, shown when an image or audio file that the user uploaded is selected instead of the text editor

                    if (it's an image file) {
                        The image should be displayed at its original 100% resolution without being expanded or distorted. If the image is larger than the display area, it should be scrollable, else it should be centered in the display area.
                    }
                    else if (it's an audio file) {
                        display the embedded audio player
                    }
                }
            }
        }

    }

}

