
General Web SPA UI Style instructions {
    Font: Nunito, SELF-HOSTED - never loaded from Google Fonts at runtime. The files in www/fonts/ (and www/css/fonts.css) are exactly what Google Fonts serves, downloaded by src/fonts-vendor/fetch-fonts.mjs (re-run it only to update the font; www/fonts/SOURCE.md records the files' SHA-256, checked by the tests).

    Browser tab title: the page title shown in the browser tab is "eNotesMgr" (www/index.html, and the repo-root redirect page index.html). Everywhere the app shows its name it says "eNotesMgr" (landing card, setup card, "Unlock eNotesMgr", main page header, messages) - see ./login-page.md, ./setup-page.md, ./master-password-popup.md, ./main-page.md. Only the Google Drive folder keeps its name "eNotes Manager" (renaming it would lose existing data).

    Whatever UI changes you make for this SPA project, make sure it always looks stylih and modern according to modern UI standards and also fits nicely and look nice on my phone's browser screen. Use google's Material 3 Expressive Design as for the UI design.

    Use different pastel colors for UI elements and avoid using too much of black and white for UI elements like buttons, etc, but don't have a general colored theme.

    Dark theme contrast {
        In theme=dark, every interactive element's label/text must stay contrasty and clearly readable against the dark surface. In particular keep these contrasty:
            - tonal buttons (the accent-labelled buttons)
            - icon buttons
            - format buttons
            - text input fields
            - file-selection dropdowns, including BOTH the closed control text and the open option list.
        Whenever you add a new button or text/dropdown control, make sure its label is given an explicit light text color in dark theme so it does not come out dim or invisible.
    }

    Make sure the UI is well spaced out on the PC browser and looks great on a wide range of screen sizes.

    For the mobiles UI version, the UI should look great too and fit on different phone sizes. Take care of all the resize and fitting of all the UI elements properly on different phone sizes. Make sure all the elements scroll peoperly on mobile screens.

    Transient status messages for all UI actions where the user would have to wait a bit for the action to complete. This applies to both PC and mobile. { 
        
        Show transient status messages for all UI actions where the user would have to wait a bit for the action to complete.
        For e.g. "Saving...", "Loading...", "Renaming...", etc.
        
        These transient messages should be displayed like a pop up overlay in the middle of the screen and should be disappear ONLY AFTER the action is completed; this is important. The opacity of this overlay should be around 50% so that the user can still see the background UI.

        NOTE: The original labels of UI elements like buttons should NOT change to become the transient message.

    }


}



Main App UI landing page when user loads the app { 
    see ./login-page.md 
    }

