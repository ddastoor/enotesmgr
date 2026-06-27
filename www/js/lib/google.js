// Google OAuth via Google Identity Services (GIS) token client.
// We request a single Drive scope (drive.appdata by default — see driveConfig.js;
// the alternative is drive.file). The user's email is later obtained from the
// Drive about endpoint, so no extra profile scopes are needed.

import { DRIVE_SCOPE } from "./driveConfig.js";

const CLIENT_ID = "404699677771-aljb7q3d6789dh535g5r7piu3b2fdabf.apps.googleusercontent.com";
const SCOPE = DRIVE_SCOPE;

let tokenClient = null;
let gisReadyPromise = null;

function loadGisScript() {
    if (gisReadyPromise) return gisReadyPromise;
    gisReadyPromise = new Promise((resolve, reject) => {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
        document.head.appendChild(script);
    });
    return gisReadyPromise;
}

// Triggers the OAuth flow and resolves with an access token string.
// The consent screen only appears the first time; afterwards Google remembers
// the grant for this client and returns a token without re-prompting consent.
export async function requestAccessToken() {
    await loadGisScript();

    return new Promise((resolve, reject) => {
        if (!tokenClient) {
            tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPE,
                callback: (response) => {
                    if (response && response.access_token) {
                        resolve(response.access_token);
                    } else {
                        reject(new Error("No access token returned"));
                    }
                },
                error_callback: (err) => {
                    reject(new Error(err && err.type ? err.type : "OAuth failed"));
                },
            });
        } else {
            tokenClient.callback = (response) => {
                if (response && response.access_token) resolve(response.access_token);
                else reject(new Error("No access token returned"));
            };
        }
        // 'select_account' always shows the account chooser so the user can pick
        // which Google account to use. It does NOT re-show the consent screen
        // once the grant exists (consent is only prompted the first time).
        tokenClient.requestAccessToken({ prompt: "select_account" });
    });
}
