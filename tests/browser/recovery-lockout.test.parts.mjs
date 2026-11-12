// The parts tests/browser/recovery-lockout.test.cjs can run on its own (environment variable
// ENOTES_TEST_PART); tests/run-all.mjs finds this file next to the suite and runs them at once.
// Each part starts from a freshly set-up account; the suite checks that these are its parts.
export const PARTS = ["last-code", "reset", "code-sets", "setup"];
