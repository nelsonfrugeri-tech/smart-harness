import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  history.replaceState(null, "", "/workspace");
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});
