

Export CLI utility {

    Purpose {
        A single, self-contained, user-interactive Node command-line tool - 'mynotes-export.js' - that bulk-decrypts the user's notes and dumps them to local files. It runs with `node mynotes-export.js` on Node 18+ and needs NO npm install: it embeds everything it needs, including the wasm crypto module \(inlined as base64\). Don't bother about recovery codes.

        How it is built {
            It is a prebuilt artifact assembled from the SAME canonical crypto the app uses, so it never drifts. See src/export/. A build-hash guard fails loudly if the built file is stale.
        }
    }

    Output directory {
        For the decrypted-export operations \(online without -x, and offline\), the tool creates a timestamped directory named 'my-notes-export_<YYYYMMDD_HHMM>' in the current directory and writes all exported notes there.
        \(The online -x mode does NOT use this directory; it creates its own 'eNotes Manager_<YYYYMMDD_HHMM>' directory - see its description below.\)
    }

    It runs in two modes, selected by the command-line argument -m <on|off> {

        online \(-m on\) {
            Auth is by TOKEN HAND-OFF - the tool does NO Google OAuth itself \(this is the most future-proof: the CLI has no OAuth flow to be deprecated\). The SPA already signs in \(via Google's GIS library\) and holds a live drive.file access token; the user copies it from the app's menu \("Copy Export Token", PC only - see ./UI/menu/left-vertical-menu.md\) and gives it to the tool. The tool then calls the Google Drive REST API directly with that token. The token is valid for about an hour; an expired/invalid token yields a clear error telling the user to re-copy it.
            Note: drive.file restricts visibility to files created by the same OAuth client; the SPA's token is that client, so it sees exactly the right notes.

            Necessary and sufficient command-line arguments {
                -t \(optional\) : the export token. If omitted, the tool prompts the user to paste it.
                -x \(optional, flag\) : replicate-the-whole-tree mode \(see below\).
            }

            if (the -x flag is given) {
                Do NOT ask for the master password \(no decryption happens\) and do NOT use the normal 'my-notes-export_...' output directory.
                After obtaining the token, download the user's ENTIRE 'eNotes Manager' folder tree from Google Drive onto the LOCAL device, AS IS \(every subfolder and file mirrored locally, each file written still-encrypted exactly as stored\), into a new local directory named 'eNotes Manager_<YYYYMMDD_HHMM>'. Then exit.
            } else {
                Ask for the master password from the CLI \(hidden input\).

                Fetch config.json from the user's Config folder on Google Drive and decrypt it with the master password to get the file password \(see ./crypto.md\).
                Then loop through ALL the note files in the Entries folder, decrypt each one using the file password, and write each decrypted note into the output directory per 'Output rules'.
            }
        }

        offline \(-m off\) {
            No google oauth takes place here.

            This mode is an INTERACTIVE WIZARD. The user can just run 'node mynotes-export.js -m off' and be prompted for everything, in this order {
                1. Path to config.json \(the encrypted config file\).
                2. Whether to export a single note file or a whole directory of note files \(default: directory\).
                3. The path to that single file, or to that directory.
                4. The master password \(hidden input\).
                Any path that does not exist is re-prompted until valid.
            }

            The following are OPTIONAL command-line arguments that pre-fill wizard answers \(anything supplied is not asked for\) {
                -c : local file path of config.json.
                -n or -d \(if both are given, -d takes precedence\) {
                    -n <local file path of a single encrypted note file>
                    -d <local dir path containing ALL the encrypted note entry files>
                }
            }

            Decrypt the config.json with the master password to get the file password.
            Then decrypt the single note or every file in the directory using the file password, and write each into the output directory per 'Output rules'.
        }
    }

    Output rules \(same in both modes\) {
        Determine each note's type from its DECRYPTED CONTENT \(it is a data: URL - data:image/, data:audio/ or data:video/ - for an uploaded media note, otherwise it is rich text html\). The type is inferred from content in BOTH modes \(Drive appProperties are not relied upon\).

        if (it was an uploaded media note) {
            Save it under the same filename \(the note's own name, which already carries its original extension\), writing the decoded original bytes \(decode the data: URL\). If the name happens to have no extension, derive one from the content's MIME type.
        } else {
            It is a rich text note: create a standalone html file '<note-name>.html' that renders the rich note exactly how the app's rich text editor displayed it \(wrap the note's html in the editor's markup with the editor styles inlined; embedded images/audio are inline data: URLs so they render with no network\).
        }

        Filenames are made filesystem-safe, and on a name collision within the output directory a numeric suffix \(e.g. " (1)"\) is added so nothing is overwritten.
    }
}
