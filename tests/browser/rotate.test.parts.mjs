// The parts tests/browser/rotate.test.cjs can run on its own (environment variable ENOTES_TEST_PART): the
// whole rotation once per group of notes - rich text; uploaded pictures and audio clips; uploaded videos and
// documents. tests/run-all.mjs finds this file next to the suite and runs them at once.
export const PARTS = ["rich", "uploads-media", "uploads-files"];
