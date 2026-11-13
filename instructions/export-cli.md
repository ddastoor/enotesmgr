

Export CLI utility {

    Purpose {
        A single, self-contained, user-interactive Node command-line tool - 'enotesmgr-export-cli.js' - that bulk-decrypts the user's notes and dumps them to local files. It runs with `node enotesmgr-export-cli.js` on Node 18+ and needs NO npm install: it embeds everything it needs, including the wasm crypto module \(inlined as base64\). Don't bother about recovery codes.

        How it is built {
            It is a prebuilt artifact assembled from the SAME canonical crypto the app uses, so it never drifts. See src/export/. A build-hash guard fails loudly if the built file is stale.

            The 'Output rules' below (how a decrypted note becomes an output file: its type, filename, html wrapping and byte decoding) are ALSO shared with the app: the in-app 'Download' button (see ./UI/main-page.md) reuses the exact same logic, so a downloaded note and an exported note are byte-for-byte identical. The build-hash guard covers this shared module too.
        }
    }

    Help (-h or --help, anywhere on the command line) {
        Prints the full help on stdout and exits with code 0 (nothing else happens, whatever other options are given). It is written to be easy to read - short paragraphs, blank lines between them, at most 80 columns (except two example commands, kept whole so they can be copied) - in this order: what the tool is (self-contained, Node 18+, nothing to install); USAGE as a list of "what do you want to do?" with the command for each (save notes as readable files, keep an encrypted copy, read that copy offline, open sensitive notes, move notes to another account, give the account a new file password, show the help) and that everything is asked, secrets at hidden prompts; THE EXPORT TOKEN (which modes need it, where it comes from, valid about 1 hour); MODES - one paragraph each for -m on, -m on -x, -m off, -m sensitive, -m export, -m import, -m rotate (rotate's six steps numbered), each ending with what it asks for; OPTIONS (-t, -x, -c, -d, -n, -s, -h / --help and their mode; export / import / rotate take none; others are ignored; a missing path is asked for again); WHERE config.json COMES FROM; WHAT YOU GET; SECURITY (secrets only at hidden prompts - deliberately no options for them; output private 700 / 600; decrypted files are not encrypted; only -m import and -m rotate write to Drive - import only adds, rotate deletes only after everything is saved and checked and the user confirmed, then puts it all back - otherwise the tool never changes or deletes anything there); EXAMPLES.
    }

    Usage message {
        Shown (on stderr, exit code 1) when -m is missing or not 'on' / 'off' / 'sensitive' / 'export' / 'import' / 'rotate', and when online mode gets no token. It ends with "Run 'node enotesmgr-export-cli.js --help' for the full help.". Besides the options of all three modes it explains:
            - online without -x exports decrypted notes into 'eNotes Manager Export_<date>'; with -x it makes the still-encrypted local copy 'eNotes Manager_<date>'.
            - offline mode works on such a local copy, made earlier with '-m on -x': -c "eNotes Manager_<date>/Config/config.json" -d "eNotes Manager_<date>/Entries". config.json can't be downloaded from the Google Drive website (the app's data is in Drive's hidden app-data area), so '-m on -x' is the way to get it.
            - the master password needed is the one in use when that copy was made.
            - sensitive notes come out still locked as '<name>.sensitive', opened with '-m sensitive' or in the app (PC) with menu > 'Decrypt Sensitive File'.
    }

    Output directory {
        For the decrypted-export operations \(online without -x, and offline\), the tool creates a timestamped directory named 'eNotes Manager Export_<YYYYMMDD_HHMM>' in the current directory and writes all exported notes there.
        \(The online -x mode does NOT use this directory; it creates its own 'eNotes Manager_<YYYYMMDD_HHMM>' directory - see its description below.\)
    }

    It runs in six modes, selected by the command-line argument -m <on|off|sensitive|export|import|rotate> {

        online \(-m on\) {
            Auth is by TOKEN HAND-OFF - the tool does NO Google OAuth itself \(this is the most future-proof: the CLI has no OAuth flow to be deprecated\). The SPA already signs in \(via Google's GIS library\) and holds a live Drive access token \(drive.appdata by default, or drive.file - whichever STORAGE_MODE the app is built with\); the user copies it from the app's menu \("Copy Export Token", PC only - see ./UI/menu/left-vertical-menu.md\) and gives it to the tool. The tool then calls the Google Drive REST API directly with that token. The token is valid for about an hour; an expired/invalid token yields a clear error telling the user to re-copy it.
            Note: both scopes keep the notes app-private - drive.appdata confines them to the hidden Application Data folder, and drive.file restricts visibility to files created by the same OAuth client; either way the SPA's token sees exactly the right notes. The CLI must search the matching space \(appDataFolder vs drive\), which it selects via its own STORAGE_MODE switch kept in sync with the app.

            Necessary and sufficient command-line arguments {
                -t \(optional\) : the export token. If omitted, the tool prompts the user to paste it \(hidden input, like the master password, so the token isn't left on screen\).
                -x \(optional, flag\) : replicate-the-whole-tree mode \(see below\).
            }

            if (the -x flag is given) {
                Do NOT ask for the master password \(no decryption happens\) and do NOT use the normal 'eNotes Manager Export_...' output directory.
                After obtaining the token, download the user's ENTIRE 'eNotes Manager' folder tree from Google Drive onto the LOCAL device, AS IS \(every subfolder and file mirrored locally, each file written still-encrypted exactly as stored\), into a new local directory named 'eNotes Manager_<YYYYMMDD_HHMM>'. Then exit.
            } else {
                Ask for the master password from the CLI \(hidden input\).

                Fetch config.json from the user's Config folder on Google Drive and decrypt it with the master password to get the file password \(see ./crypto.md\).
                Then loop through ALL the note files in the Entries folder, decrypt each one using the file password, and write each decrypted note into the output directory per 'Output rules'.
            }
        }

        offline \(-m off\) {
            No google oauth takes place here.

            This mode is an INTERACTIVE WIZARD. The user can just run 'node enotesmgr-export-cli.js -m off' and be prompted for everything, in this order {
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

        sensitive \(-m sensitive\) {
            Decrypts sensitive notes that the other two modes wrote still locked with their note password ('<name>.sensitive' - see ./sensitive-notes.md). Exactly what the app's menu > 'Decrypt Sensitive File' does, with the same shared code and the same output, but with no browser, no Google Drive and no master password - so it works fully offline (e.g. -m on -x, later -m off, then -m sensitive).

            Optional command-line argument {
                -s <path> : a single '.sensitive' file, or a folder (e.g. an 'eNotes Manager Export_<date>' folder). If omitted, or the path doesn't exist, it is asked for (re-prompted until it exists).
            }

            A folder: its '.sensitive' files and its '.html' / '.htm' files (an export CLI from before this feature wrote a sensitive note as '<name>.html' wrapping the envelope), sorted by name; only files that really hold a sensitive note count, every other file is ignored. A single file: it must hold a sensitive note, else say it is not one (a note file of a '-m on -x' copy is still locked with the master password too: export it with '-m off' first) and exit with code 1. No sensitive note found in a folder: say so, exit 1.

            For each sensitive note, ask "Password for '<file>' (Enter to skip): " at a HIDDEN prompt. A wrong password says so and asks again; an empty answer skips that note. There is deliberately NO option to pass a password on the command line (it would end up in shell history / the process list). Nothing decrypted is ever printed.

            Each decrypted note is written, per 'Output rules', under the file's name without '.sensitive' (or without the old '.html'): 'bank.sensitive' -> 'bank.html', 'photo.png.sensitive' -> 'photo.png' - into a new folder 'eNotes Manager Sensitive_<YYYYMMDD_HHMM>' (0700, files 0600, " (1)" on name clashes), created only when the first note is decrypted. At the end: "Decrypted N of M sensitive note(s)" (+ which were skipped) and a reminder that these files are NOT encrypted. Exit code 0 (also when notes were skipped).
        }

        Moving all notes to another account: export \(-m export\) and import \(-m import\) {
            Purpose: take ALL of a person's notes to another account, quickly and in bulk, so that in the new account they are exactly as they were - as if entered there by hand: same names, same content, same metadata (type, dates, sensitive or not). Both modes are online (export token), take NO options (every other option is ignored) and ask for everything. Everything else in the CLI is unchanged by them.

            Transfer files {
                One file per note, 'note-0001.enotes', 'note-0002.enotes'... (numbered in Drive's listing order; the names reveal nothing).
                Content: the first line is the plain marker "eNotesMgr transfer v1" (so import recognises the file without a password); then one line of base64 ciphertext = the verified encryption, with the EXPORTING account's master password, of the JSON { "format": "eNotesMgr transfer", "version": 1, "name": <the note's exact name>, "appProperties": <its metadata exactly as stored, or null for a note from before the metadata existed>, "content": <its stored content after the file-password layer is removed - for a sensitive note its envelope, still locked with its note password> }.
                So the transfer folder is as safe as the account's notes in Drive (protected by the same master password), and sensitive notes stay additionally locked with their own note passwords.
            }

            export \(-m export\) {
                The transfer folder is made in the current folder (where the command is run - no folder is asked for), named with the date and time like the other modes' folders: 'eNotes Manager Transfer_<YYYYMMDD_HHMM>'. It is always a NEW folder: if a folder of that name is already there (an export made in the same minute), the export stops with a clear message ("... already exists here ... Nothing was written - wait a minute and run the export again."), exit 1 - checked first, before anything is asked, and again when the folder is created. It never writes into, or mixes with, an existing folder, and never adds " (1)".
                1. Ask for the export token (hidden) of the account to export; find its data like the other online modes (same duplicate / glitch rules); no data / incomplete data: clear error, exit 1.
                2. Ask the account's master password (hidden), get its file password (wrong password: error, exit 1, nothing written).
                3. Create the transfer folder (0700) and write one transfer file (0600) per note; show the folder's full path (the import asks for it). A note that can't be read is reported (SKIPPED) and the others are still exported (exit 1).
                4. Say how many notes (and sensitive notes) were exported, into which folder, that the files are locked with this account's master password, and how to import them. Export only reads Google Drive.
            }

            import \(-m import\) {
                1. Ask for the transfer folder (re-asked until it exists). Only its own TOP-LEVEL transfer files are read: sub-folders (and everything in them) and every other file are ignored (and listed). No transfer files: say so, exit 1 - before asking any password.
                2. Ask the master password of the OLD account (hidden) and open every transfer file with it. None opens: clear error ("use the master password the OLD account had when they were exported"), exit 1, before asking for the token. Files that don't open (exported with another password, or damaged) are listed and skipped (exit 1 at the end).
                3. Ask the export token of the NEW account (hidden; from the app logged in with it), find its data (no data: "set it up first", exit 1), ask the NEW account's master password (hidden) and get its file password.
                4. Already there? A note whose exact copy is already in the account - same name (or a " (n)" copy of that name), same metadata and same content - is skipped. So running the import again (e.g. after a failure) adds only what is missing, never anything twice. Nothing left to add: "Nothing to import: every note is already there.", exit 0.
                5. Show the account's e-mail address and the counts and ask "Add these N note(s) to <account>? (y/N)". Anything but y / yes: "Nothing imported.", exit 0.
                6. Create each note in the account's Entries folder: the same name - " (1)", " (2)"... before the extension if taken -, the same metadata, the same content, encrypted (verified) with the NEW account's file password. Never change or delete anything that is there. A note Drive refuses is listed as FAILED, the others are still added, exit 1 ("run the import again to add them").
            }
        }

        Rotating the file password: rotate \(-m rotate\) {
            Purpose: give an account a NEW file password - the key every note and the settings are encrypted with (see ./crypto.md) - and new recovery codes, for the SAME account, losing nothing: every note comes back exactly as it was (name - also two notes with the same name -, metadata incl. dates, content; sensitive notes still locked with their own note password) and the settings (settings.json: theme, session timeout, every key) come back too. It is online, takes NO options (every other option is ignored) and asks for everything. The file password can only be made by the app's set-up, so the rotation deletes the account's eNotesMgr data and the app sets it up again in the middle.

            Everything it writes is in ONE new folder 'eNotes Manager Rotation_<YYYYMMDD_HHMM>' in the current folder (0700, files 0600; a folder of that name already there: stop before asking anything, like -m export): backup/ (the account's whole eNotesMgr data, still encrypted, as '-m on -x' writes it), transfer/ (one transfer file per note - a normal transfer folder, '-m import' takes it too), 'settings.enotes-settings' (the settings: a plain first line "eNotesMgr settings v1", then the verified encryption with the master password of { "format": "eNotesMgr settings", "version": 1, "settings": <settings.json's JSON> }) and rotation.json (the progress - account e-mail, phase, number of notes, settings or not; no secrets).

            1. Ask the export token (hidden), find the account's data like the other online modes (no data: say so - and where a stopped rotation is continued - exit 1, nothing written), ask the master password (hidden), get the file password.
            2. Before writing anything: everything the deletion would delete must be carried over. Files anywhere else than the Entries / Config / Recovery folders in use (a 2nd Entries folder with notes, another folder with files, another 'eNotes Manager' folder with files): say what, stop, exit 1, nothing done. Other 'eNotes Manager' folders that hold no files at all (Drive glitch leftovers) are deleted with the data, so the app's set-up starts clean.
            3. Back up (backup/ must hold as many files as the data); save every note (as '-m export') and the settings (settings.json opened with the file password; none or not readable: say so - the app's defaults will apply); read every transfer file and the settings file back with the master password and compare with what was saved. A note that can't be read, or any mismatch: stop, exit 1, "Nothing was deleted".
            4. Show what will be deleted and ask to type exactly "WIPE <account e-mail>". Anything else: "Stopped: nothing was deleted", exit 0 (the folder is left for the user to delete).
            5. Delete the data in Drive (the 'eNotes Manager' folder in use, with everything in it - like the app's 'Wipe all App Data' - plus the empty leftover folders). rotation.json says "wiping" before and "wiped" after. Deletion fails: say so ("Your notes are safe"), exit 1.
            6. Tell the user to set the account up again in the app (log in again, choose a master password - the same or a new one; the app makes the new file password and new recovery codes; keep them) and paste a NEW export token. The token must be for the same account (another account: say so, ask again) and the account must be set up (not yet: say so, ask again). Still the OLD data (its config.json is byte for byte one in the backup: the deletion didn't happen): say so, ask the confirmation again, delete, go on. Ask the master password chosen at the set-up; get the new file password (the same as the old one: stop - it was not set up again).
            7. Put every note back (as '-m import' step 4 and 6, without asking): a note already there identical is skipped - so a re-run adds only what is missing; every note keeps its exact name, also two notes with the same name; a name is changed (" (1)") only if a note that is not one of the saved notes has it. Put the settings back: settings.json overwritten with the saved settings, encrypted (verified) with the new file password, with the metadata the app writes on a save (DateTimeModified now, CreationMethod app, FileType settings; DateTimeCreated kept) - or created if missing.
            8. Check in Drive: every saved note is there exactly, opening with the new file password (each Drive note counts for one saved note), and the settings. rotation.json "done". Say: the file password is new (the old one opens nothing), all notes are back, settings back (or the defaults), the recovery codes are the new ones, and that the rotation folder (locked with the master password of before) can be deleted.

            Stopping after the deletion never loses anything: no token, input ended, a wrong password, a note Drive refuses, the settings can't be saved, a check fails - say "The rotation is NOT finished ... Nothing is lost", how to finish, exit 1. Running '-m rotate' again in the same folder finds the rotation whose rotation.json says "wiping" or "wiped" and asks "Continue it? (Y/n)" (Enter = yes; no: stop, exit 1 - a new rotation is never started over an unfinished one); it asks the master password the notes were saved with (every transfer file must open and their number must be the one recorded - else stop, pointing to the backup), then goes on at step 6.
        }
    }

    Output rules \(same in the online and offline modes\) {
        Determine each note's type from its DECRYPTED CONTENT \(it is a data: URL of ANY MIME type - data:image/, data:audio/, data:video/, data:application/pdf, etc., including uploads the app recorded as "UNKNOWN" - for an uploaded file note, otherwise it is rich text html\). The type is inferred from content in BOTH modes \(Drive appProperties are not relied upon\); a leading "data:" marks an uploaded file.

        if (it was an uploaded file note) {
            Save it under the same filename \(the note's own name, which already carries its original extension\), writing the decoded original bytes \(decode the data: URL\). If the name happens to have no extension, derive one from the content's MIME type. This applies to ALL uploaded file types \(image, audio, video, PDF, and any other\), not just media.
        } else {
            It is a rich text note: create a standalone html file '<note-name>.html' that renders the rich note exactly how the app's rich text editor displayed it \(wrap the note's html in the editor's markup with the editor styles inlined; embedded images/audio are inline data: URLs so they render with no network\).
        }

        if (it is a sensitive note - its file-password-decrypted content is a sensitive envelope, see ./sensitive-notes.md) {
            The CLI cannot open the note-password layer. Write the envelope as-is (still locked with the note password) to '<note-name>.sensitive' (e.g. 'bank.sensitive', 'photo.png.sensitive'). This check comes BEFORE the two cases above. After exporting, if any were written, tell the user how many and that they open with the app's menu > 'Decrypt Sensitive File' (PC). The -x mirror is unaffected (files are copied as stored).
        }

        Filenames are made filesystem-safe, and on a name collision within the output directory a numeric suffix \(e.g. " (1)"\) is added so nothing is overwritten.

        Everything the tool writes is private to the current user: directories are created with mode 0700 and files with mode 0600 \(ignored on Windows\).
        In the -x mirror, a Drive name of exactly "." or ".." is written as "_." / "_.." so nothing can ever be written outside the mirror directory.
        In the -x mirror, same-named items in one Drive folder (Drive allows duplicates, e.g. two config.json) are all kept: the 2nd, 3rd... get " (1)", " (2)"... before the extension, so no copy overwrites another in the backup.

        Finding the data in Drive (online mode, including -x) uses the SAME rules as the app (see ./data-storage.md "Never lose existing data"); the CLI only reads Drive, except '-m import' (only adds notes) and '-m rotate' (see there) {
            Before reporting the 'eNotes Manager' folder, a subfolder or config.json as missing, look again once after a short pause (~1.2 s).
            Several 'eNotes Manager' folders: use the one with a config.json, then the most notes (the -x mirror says when others exist). Several Config / Entries folders: the one with the most items.
            Several config.json files: of those that open with the master password, use the one whose file password opens the notes (up to 5 tried), else the oldest (DateTimeCreated), else the first.
            No config.json at all: say so, and that unlocking in the app with a recovery code restores it.
        }
    }
}
