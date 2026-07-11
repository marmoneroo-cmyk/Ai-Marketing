import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react only auto-registers its afterEach(cleanup) when
// vitest's `test.globals` option is enabled. This config keeps globals off
// (tests import describe/it/expect/vi explicitly), so cleanup is wired up
// here instead to unmount each test's render tree from jsdom's document.
afterEach(() => {
  cleanup();
});
