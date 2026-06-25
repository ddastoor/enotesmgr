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
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (_) {}
    navigate("login");
}

// ---- Inactivity session timeout --------------------------------------------

let timerId = null;
let suspendCount = 0;
const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];

function timeoutSeconds() {
    const s = state.settingsJson && state.settingsJson.session_timeout_seconds;
    return Number.isFinite(s) ? s : DEFAULT_SETTINGS.session_timeout_seconds;
}

function resetTimer() {
    if (timerId) clearTimeout(timerId);
    if (suspendCount > 0) return;
    timerId = setTimeout(() => logout(), timeoutSeconds() * 1000);
}

function startSessionTimer() {
    activityEvents.forEach((ev) => document.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();
}

function stopSessionTimer() {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    activityEvents.forEach((ev) => document.removeEventListener(ev, resetTimer));
}

// Suspend auto-logout during long operations (e.g. generating recovery codes).
export function suspendSessionTimer() {
    suspendCount++;
    if (timerId) clearTimeout(timerId);
}

export function resumeSessionTimer() {
    suspendCount = Math.max(0, suspendCount - 1);
    if (suspendCount === 0) resetTimer();
}

// ---- Boot -------------------------------------------------------------------

navigate("login");
