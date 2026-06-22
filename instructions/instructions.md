
I want to tweak this ".md like language" so i dont have to use tab hiearchies.
    see ./language.md for the tweaked "language"


See ./terms.md

Crypto { see ./crypto.md }

google related specific to this app { see ./google-specific.md }

User Authentication { see ./user-authentication.md }

Data Storage { see ./data-storage.md }

UI { see ./UI/ui.md }



When a new user logs in:
    - see ./new-user-login.md   

When existing user logs in:
    - see ./existing-user-login.md



Additional Things to note for:
    
    - Main Screen:
        - The app should decrypt the just fetched encrypted file from google drive (using the file password) before showing its contents in the editor area.
        - The app should encrypt the contents of the editor area (wether text or uploaded file) using the file password before saving the file to google drive.

    - Saving of config file and settings file to google drive should replace the existing files in google drive (if they already exist).


    - When a new user logs in and is shown the google oauth authorization screen, subsequent logins (following session logouts or app closes) should not ask for the authorization consent sreen again unless the user manually revokes the app's linkage to their google account.


TODO (don't do till i tell you):
    - see ./todo.md
