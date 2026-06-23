


Main page {

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

        }


        Toolbar area (glassmorphism style) {

            contents {

                File selector dropdown {
                    Lists all note entries from entries folder , sorted alphabetically.
                    Always keep this list sorted alphabetically even when notes are added or removed.
                    The first entry of the list ahould be a dummy entry "" that displays by default
                    On file selection { trigger load the note functionality }
                }

                Refresh button {
                    label: "Refresh"
                    tooltip: "Refresh the current note"
                    on click {
                        Re-fetch the currently selected note file from entries folder, decrypt it using the file password and display the contents in the rich text editor or media viewer depending on the type of file that was selected.
                    }
                }

                New button {
                    label: "New"
                    tooltip: "Create a new note"
                    on click {
                        Ask the user to give a filename for the new note. Strip any extension from the filename if the user enters one. For e.g. if the user enters 'mynote.txt', then the actual filename used should be 'mynote'.
                        
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

                            Create this as 'un-encrypted note entry content'
                            Concatenate metadata + exactly one newline + actual note contents to form the un-encrypted note entry content.
                            Encrypt this with the file password and save it to the entries folder, then re-fetch and display according to 'Note Display Methods based on FileType' (see ./note-meta-data.md)
                            

                        }
                        
                    }
                }

                Upload Button {
                    label: "Upload"
                    tooltip: "Upload an image or audio file"
                    on click {

                        If (an existing note is already loaded \(i.e., file selector is not showing dummy entry ""\) ) {
                            
                            If (the creationmethod field is "new" \(and not "upload"\) and the current rich text editor contents are not saved) {
                                Ask the user if he wants to save the current note or not. If he says yes, save the current note. If he says no, do not save the current note.
                            }
                        } 

                        Popup a file dialog for the user to upload the file. If the filename to be uploaded is already present in entries folder, show an error message 'Filename already exists' and do not proceed. 
                        
                        If (user selected a new unique filename) {
                            Set the note metadata {
                                "DateTimeCreated" = current date and time in [date]T[time] format
                                "DateTimeModified" = same as "DateTimeCreated"
                                "CreationMethod" = "upload"
                                "FileType" = the filetype of the uploaded file
                            }

                            
                            Set the actual note contents to the uploaded file contents.

                            Update the file selector dropdown with the new filename

                            Create this as 'un-encrypted note entry content'
                            Concatenate metadata + exactly one newline + actual note contents to form the un-encrypted note entry content.
                            Encrypt this with the file password and save it to the entries folder, then re-fetch and display according to 'Note Display Methods based on FileType' (see ./note-meta-data.md)
                            

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
                    }
                }

                Rename button {
                    label: "Rename"
                    tooltip: "Rename the current note"

                    on click {
                        Ask the user to enter a new name for the current note. 
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

            }

            'save the current note' functionality {
                Set the modified 'DateTimeModified' metadata key to current date and time in the same format as mentioned in metadata keys.
                
                Update the actual note content.
                

                Encrypt the current file (whether an audio, image, or rich text file) using the file password and save the encrypted contents to the currently selected file in entries folder. Show the transient status "Saving..." while the save operation is in progress.

                See ./note-meta-data.md for logic related to 'On Saving the note, just before encrypting the note file contents'
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

