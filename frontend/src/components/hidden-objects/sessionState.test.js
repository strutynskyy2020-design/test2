import {
  getMistakeLimit, getMistakesRemaining, getMistakesUsed, isHiddenObjectSessionFailed,
} from "./sessionState";

describe("hidden-object mistake limits", () => {
  test("reads the canonical server fields and derives a remaining count when needed", () => {
    expect(getMistakeLimit({ mistake_limit: 10, max_misses: 99 })).toBe(10);
    expect(getMistakesUsed({ mistakes: 3 })).toBe(3);
    expect(getMistakesRemaining({ mistake_limit: 10, mistakes: 3 })).toBe(7);
    expect(getMistakesRemaining({ mistake_limit: 10, mistakes: 3, mistakes_remaining: 6 })).toBe(6);
  });

  test("supports compatibility aliases and clamps invalid remaining counts", () => {
    expect(getMistakeLimit({ max_misses: "5" })).toBe(5);
    expect(getMistakesRemaining({ max_misses: 5, misses_remaining: 9 })).toBe(5);
    expect(getMistakesRemaining({ max_misses: 5, misses_used: 5 })).toBe(0);
  });

  test("recognizes both a failed session and the terminal action event", () => {
    expect(isHiddenObjectSessionFailed({ status: "failed" })).toBe(true);
    expect(isHiddenObjectSessionFailed({ status: "active" }, { failed: true })).toBe(true);
    expect(isHiddenObjectSessionFailed({ status: "active" }, { failed: false })).toBe(false);
  });
});

