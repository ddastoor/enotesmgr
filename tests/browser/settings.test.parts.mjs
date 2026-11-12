// The parts tests/browser/settings.test.cjs can run on its own (environment variable
// ENOTES_TEST_PART); tests/run-all.mjs finds this file next to the suite and runs them at once.
// The suite checks that these are exactly its parts.
export const PARTS = ["loading", "change", "leave", "fail-cancel"];
