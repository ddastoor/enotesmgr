// The parts tests/cli/rotate.mjs can run on its own (environment variable ENOTES_TEST_PART);
// tests/run-all.mjs finds this file next to the suite and runs them at once. rotate.mjs checks
// that these are exactly its parts.
export const PARTS = ["full", "guards", "resume", "failures", "settings-and-rest"];
