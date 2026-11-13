// The parts tests/cli/transfer.mjs can run on its own (environment variable ENOTES_TEST_PART);
// tests/run-all.mjs finds this file next to the suite and runs them at once. transfer.mjs checks
// that these are exactly its parts.
export const PARTS = ["export", "export-errors", "import", "import-errors", "rest"];
