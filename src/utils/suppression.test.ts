// src/utils/suppression.test.ts
import { applySuppression } from "./suppression";

describe("applySuppression", () => {
  it("suppresses below_k when denominator < k", () => {
    expect(
      applySuppression({ numerator: 1, denominator: 3 }, { k: 5, minN: 20 }),
    ).toEqual({
      rate: null,
      n: 3,
      suppressed: true,
      reason: "below_k",
    });
  });

  it("suppresses below_min_n when denominator >= k but < minN", () => {
    expect(
      applySuppression({ numerator: 5, denominator: 10 }, { k: 5, minN: 20 }),
    ).toEqual({
      rate: null,
      n: 10,
      suppressed: true,
      reason: "below_min_n",
    });
  });

  it("returns rate when denominator >= minN", () => {
    expect(
      applySuppression({ numerator: 10, denominator: 25 }, { k: 5, minN: 20 }),
    ).toEqual({
      rate: 0.4,
      n: 25,
      suppressed: false,
      reason: null,
    });
  });

  it("handles zero denominator as below_k", () => {
    expect(
      applySuppression({ numerator: 0, denominator: 0 }, { k: 5, minN: 20 }),
    ).toEqual({
      rate: null,
      n: 0,
      suppressed: true,
      reason: "below_k",
    });
  });

  it("returns rate of 0 cleanly (not null)", () => {
    expect(
      applySuppression({ numerator: 0, denominator: 25 }, { k: 5, minN: 20 }),
    ).toEqual({
      rate: 0,
      n: 25,
      suppressed: false,
      reason: null,
    });
  });
});
