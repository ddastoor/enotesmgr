// The parts tests/cli/options.mjs can run on its own (environment variable ENOTES_TEST_PART): its
// four vaults, and "rest" (usage errors, --help, the real terminal). tests/run-all.mjs runs them at
// once. One list for both, so a vault can't be added without being run; options.mjs checks that
// this list is exactly its vaults + "rest".
export const OPTIONS_PARTS = ["none", "mixed", "sensitive", "clash", "rest"];
