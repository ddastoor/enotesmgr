

google app's client id = "404699677771-aljb7q3d6789dh535g5r7piu3b2fdabf.apps.googleusercontent.com"

google drive api scope (active) = "https://www.googleapis.com/auth/drive.appdata"
google drive api scope (alternative, kept for roll-back) = "https://www.googleapis.com/auth/drive.file"

The app uses app scope (drive.appdata) by default, so the 'eNotes Manager' folder
tree lives inside Drive's hidden Application Data folder and is not visible to the
user. The scope/location are selected by a single switch (STORAGE_MODE) in
www/js/lib/driveConfig.js; switching it to file scope (drive.file) moves the same
tree to the visible Drive root. The export CLI keeps a matching switch.
