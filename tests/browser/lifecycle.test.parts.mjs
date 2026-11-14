// The parts tests/browser/lifecycle.test.cjs can run on its own (environment variable ENOTES_TEST_PART):
// the whole chain once per group of notes - rich text; uploaded pictures and audio clips; uploaded videos
// and documents - each normal and sensitive, and one account with all of them mixed. tests/run-all.mjs
// finds this file next to the suite and runs them at once.
export const PARTS = ["rich", "rich-sensitive", "uploads-media", "uploads-media-sensitive", "uploads-files", "uploads-files-sensitive", "mixed"];
