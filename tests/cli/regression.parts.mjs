// The parts tests/cli/regression.mjs can run on its own (environment variable ENOTES_TEST_PART):
// each vault's four modes ("<vault>:<mode>"), and "rest" (usage / help). tests/run-all.mjs finds
// this file next to the suite and runs them at once. regression.mjs checks that these are exactly
// its vaults and modes.
export const VAULTS = ["none", "mixed", "sensitive"];
export const MODES = ["on", "on-x", "off", "sensitive"];
export const PARTS = [...VAULTS.flatMap((v) => MODES.map((m) => `${v}:${m}`)), "rest"];
