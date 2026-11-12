// The parts tests/cli/options.mjs can run on its own (environment variable ENOTES_TEST_PART): each
// vault's five groups of checks ("<vault>:<group>"), and "rest" (usage errors, --help, the real
// terminal). tests/run-all.mjs finds this file next to the suite and runs the parts at once.
// options.mjs checks that these are exactly its vaults and groups.
export const VAULTS = ["none", "mixed", "sensitive", "clash"];
export const GROUPS = ["offline", "offline-notes", "online", "mirror", "sensitive"];
export const PARTS = [...VAULTS.flatMap((v) => GROUPS.map((g) => `${v}:${g}`)), "rest"];
