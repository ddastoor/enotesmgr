// Router + bootstrap. Pages are modules exposing render(container, params).
// Navigation is purely in-memory (single page app); we never change the URL so
// the OAuth redirect/popup flow stays simple.

import { state, resetState, DEFAULT_SETTINGS } from "./state.js";
import { hideStatus } from "./lib/dialogs.js";
import { clearFileIdCache } from "./drive.js";

import * as login from "./pages/login.js";
import * as setup from "./pages/setup.js";
import * as masterPassword from "./pages/masterPassword.js";
import * as resetMasterPassword from "./pages/resetMasterPassword.js";
import * as main from "./pages/main.js";
import * as settings from "./pages/settings.js";
import * as recoveryCodes from "./pages/recoveryCodes.js";

const routes = {
    login,
    setup,
    masterPassword,
    resetMasterPassword,
    main,
    settings,
    recoveryCodes,
};

let currentPage = null;

export function navigate(pageName, params = {}) {
    const page = routes[pageName];
    if (!page) throw new Error(`Unknown page: ${pageName}`);

    // Pages that require an authenticated session enable the inactivity timer;
    // login/auth pages stop it.
    if (["main", "settings", "recoveryCodes"].includes(pageName)) {
        startSessionTimer();
    } else {
        stopSessionTimer();
    }

    if (currentPage && currentPage.teardown) currentPage.teardown();
    hideStatus();

    applyTheme();

    const container = document.getElementById("app");
    container.innerHTML = "";
    currentPage = page;
    page.render(container, params);
}

// Reflect the App Theme setting on the document. Driven by settings json, so it
// applies as soon as settings are loaded (login) or changed (settings save) and
// the next navigation happens; falls back to the default before login.
export function applyTheme() {
    const theme = (state.settingsJson && state.settingsJson.app_theme) || DEFAULT_SETTINGS.app_theme;
    document.documentElement.dataset.theme = theme === "Dark" ? "dark" : "light";
}

// ---- Logout -----------------------------------------------------------------

// Invalidate the session silently: drop the token, clear all browser storage,
// and return to login. Does NOT revoke the Google grant.
export function logout() {
    stopSessionTimer();
    resetState();
    clearFileIdCache();
    // Close any open popup / menu drawer. They live in #overlay-root, which page
    // navigation doesn't touch, so after an auto-logout e.g. the search popup
    // (listing note names) would otherwise stay on screen over the login page.
    // (The status spinner is kept: it is reused, and navigate() hides it.)
    document.querySelectorAll("#overlay-root > .modal-backdrop, #overlay-root > .drawer-backdrop")
        .forEach((el) => el.remove());
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (_) {}
    navigate("login");
}

// ---- Inactivity session timeout --------------------------------------------
//
// Measured in wall-clock time (Date.now), not just with a setTimeout: timers
// don't advance while a laptop sleeps, a phone suspends the tab, or the page sits
// in the back/forward cache, and the first mouse move / touch on return used to
// simply restart the countdown, leaving the vault unlocked indefinitely. Now any
// activity, and the page becoming visible / focused / restored again, first
// checks how long it has really been since the last activity and logs out if
// the timeout has passed.

let timerId = null;
let suspendCount = 0;
let sessionActive = false;
let lastActivity = 0; // Date.now() of the last user activity
const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
const wakeEvents = [
    [document, "visibilitychange"],
    [window, "pageshow"],
    [window, "focus"],
];

function timeoutSeconds() {
    const s = state.settingsJson && state.settingsJson.session_timeout_seconds;
    return Number.isFinite(s) ? s : DEFAULT_SETTINGS.session_timeout_seconds;
}

function isExpired() {
    return sessionActive && suspendCount === 0 &&
        Date.now() - lastActivity >= timeoutSeconds() * 1000;
}

// (Re)arm the timer for whatever is left of the timeout since lastActivity.
function scheduleTimer() {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    if (!sessionActive || suspendCount > 0) return;
    const remaining = Math.max(0, timeoutSeconds() * 1000 - (Date.now() - lastActivity));
    timerId = setTimeout(checkSession, remaining);
}

// Timer fired, or the page woke up: log out if the timeout really has passed.
function checkSession() {
    if (isExpired()) logout();
    else scheduleTimer();
}

function onActivity() {
    if (isExpired()) {
        logout();
        return;
    }
    lastActivity = Date.now();
    scheduleTimer();
}

function onWake() {
    if (document.visibilityState === "hidden") return;
    checkSession();
}

function startSessionTimer() {
    if (!sessionActive) {
        // A fresh authenticated session starts its countdown now.
        sessionActive = true;
        lastActivity = Date.now();
        activityEvents.forEach((ev) => document.addEventListener(ev, onActivity, { passive: true }));
        wakeEvents.forEach(([target, ev]) => target.addEventListener(ev, onWake));
    }
    // Navigating between authenticated pages: re-arm (picks up a changed timeout
    // setting). An already-expired session is logged out by the timer right away.
    scheduleTimer();
}

function stopSessionTimer() {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    sessionActive = false;
    activityEvents.forEach((ev) => document.removeEventListener(ev, onActivity));
    wakeEvents.forEach(([target, ev]) => target.removeEventListener(ev, onWake));
}

// Suspend auto-logout during long operations (e.g. generating recovery codes).
export function suspendSessionTimer() {
    suspendCount++;
    if (timerId) clearTimeout(timerId);
    timerId = null;
}

export function resumeSessionTimer() {
    suspendCount = Math.max(0, suspendCount - 1);
    if (suspendCount === 0) {
        // The long operation counts as activity: restart the full timeout.
        lastActivity = Date.now();
        scheduleTimer();
    }
}

// ---- Boot -------------------------------------------------------------------

// Refuse to run inside another site's frame (clickjacking: a hostile page could
// overlay this app invisibly and trick clicks, e.g. on "Copy Export Token").
// GitHub Pages can't send X-Frame-Options and a <meta> CSP can't set
// frame-ancestors, so it's done here. The app is never legitimately framed.
function isFramed() {
    try {
        return window.top !== window.self;
    } catch (_) {
        return true; // cross-origin access error: we are framed
    }
}

if (isFramed()) {
    document.body.textContent =
        "For your security, eNotes can't be shown inside another website. Open it directly in its own tab.";
} else {
    navigate("login");
}
