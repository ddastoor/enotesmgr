


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
                        Ask the user to give a filename for the new note. If the filename already exists in entries folder, show an error message 'Filename already exists' and do not proceed. 
                        
                        If (user entered a new unique filename) {

                            If (an existing note is already loaded \(i.e., file selector is not showing dummy entry ""\) ) {
                                If (the rich text editor is currently visible and the current rich text editor contents are not saved) {
                                    Ask the user if he wants to save the current note or not. If he says yes, save the current note. If he says no, do not save the current note.
                                }
                            } 

                            Encrypt "" with file password as the new file contents and save the new encrypted file to entries folder.
                            Update the file selector dropdown with the new filename and clear out the editor area if the rich text editor is currently visible, else make the rich text editor visible with empty contents.
                        }
                        
                    }
                }

                Upload Button {
                    label: "Upload"
                    tooltip: "Upload an image or audio file"
                    on click {

                        If (an existing note is already loaded \(i.e., file selector is not showing dummy entry ""\) ) {
                            If (the rich text editor is currently visible and the current rich text editor contents are not saved) {
                                Ask the user if he wants to save the current note or not. If he says yes, save the current note. If he says no, do not save the current note.
                            }
                        } 

                        Popup a file dialog for te user to upload the file. If the filename to be uploaded is already present in entries folder, show an error message 'Filename already exists' and do not proceed. 
                        
                        If (user selected a new unique filename) {
                            Save the uploaded file to entries folder after encrypting it with the file password.
                            Add the new filename to the file selector dropdown after sorting the list, then clear out the editor area/media viewer area \(whichever is currently visible\) and load the uploaded media file into the media viewer area. 
                            
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

                Disable and enable the above buttons appropriately based on the entry currently selected in the file selector dropdown. Additionally, the Save button should be disabled for the dummy file entry and uploaded media files, otherwise enabled.                 

            }

            'load the note' functionality {
                
                Fetch the selected file from entries folder, decrypt the file using the file password.

                If (the file was previously an uploaded audio or image file) {
                    Show the media viewer instead of the rich text editor area and display/play the media file.
                }
                else if (the file is a note that was previously added by the user) {
                    Show the rich text editor instead of the media viewer area and display the note in the editor area.
                }

            }

            'save the current note' functionality {
                If (the file was previously an uploaded audio or image file) {
                    Encrypt the audio or image file contents using the file password and save the encrypted contents to the currently selected file in entries folder. Show the transient status "Saving..." while the save operation is in progress
                }
                else if (the file is a note that was previously added by the user) {
                    Encrypt the rich text editor's contents using the file password and save the encrypted contents to the currently selected file in entries folder. Show the transient status "Saving..." while the save operation is in progress
                }
            }



        }


        Note display area {
            contents {

                Rich text editor {
                    Toolbar with {
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

