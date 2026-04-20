// src/utils/iaptPairing.test.ts
import { computeIaptMetrics } from "./iaptPairing";

type Att = { userId: string; completedAt: Date; totalScore: number };

const phq9 = {
  instrument: "phq9" as const,
  clinicalCutoff: 10,
  reliableChangeDelta: 6,
};
const gad7 = {
  instrument: "gad7" as const,
  clinicalCutoff: 8,
  reliableChangeDelta: 4,
};
const pdss = {
  instrument: "pdss" as const,
  clinicalCutoff: 8,
  reliableChangeDelta: null,
};

const date = (iso: string) => new Date(iso);

describe("computeIaptMetrics", () => {
  it("requires at least 2 attempts per user", () => {
    const attempts: Att[] = [
      { userId: "u1", completedAt: date("2026-01-01"), totalScore: 15 },
    ];
    const res = computeIaptMetrics(attempts, phq9);
    expect(res.recovery.denominator).toBe(0);
    expect(res.reliableImprovement!.denominator).toBe(0);
  });

  it("pairs baseline (earliest) and endpoint (latest) per user", () => {
    const attempts: Att[] = [
      { userId: "u1", completedAt: date("2026-01-01"), totalScore: 15 },
      { userId: "u1", completedAt: date("2026-01-15"), totalScore: 8 },
    ];
    const res = computeIaptMetrics(attempts, phq9);
    // baseline 15 >= 10 → recovery eligible
    // endpoint 8 < 10 → recovered
    expect(res.recovery).toEqual({ numerator: 1, denominator: 1 });
    // (15 - 8) = 7 >= 6 → reliably improved
    expect(res.reliableImprovement).toEqual({ numerator: 1, denominator: 1 });
    // both → reliable recovery
    expect(res.reliableRecovery).toEqual({ numerator: 1, denominator: 1 });
  });

  it("excludes sub-clinical baselines from recovery denominator but includes in reliable-improvement", () => {
    const attempts: Att[] = [
      { userId: "u1", completedAt: date("2026-01-01"), totalScore: 8 }, // below cutoff 10
      { userId: "u1", completedAt: date("2026-01-15"), totalScore: 2 },
    ];
    const res = computeIaptMetrics(attempts, phq9);
    expect(res.recovery.denominator).toBe(0);
    expect(res.reliableRecovery!.denominator).toBe(0);
    expect(res.reliableImprovement).toEqual({ numerator: 1, denominator: 1 }); // delta 6 >= 6
  });

  it("counts non-recovered patients in denominator but not numerator", () => {
    const attempts: Att[] = [
      { userId: "u1", completedAt: date("2026-01-01"), totalScore: 15 },
      { userId: "u1", completedAt: date("2026-01-15"), totalScore: 14 }, // still above cutoff
    ];
    const res = computeIaptMetrics(attempts, phq9);
    expect(res.recovery).toEqual({ numerator: 0, denominator: 1 });
  });

  it("returns null for reliableImprovement when reliableChangeDelta is undefined", () => {
    const attempts: Att[] = [
      { userId: "u1", completedAt: date("2026-01-01"), totalScore: 15 },
      { userId: "u1", completedAt: date("2026-01-15"), totalScore: 6 },
    ];
    const res = computeIaptMetrics(attempts, pdss);
    expect(res.reliableImprovement).toBeNull();
    expect(res.reliableRecovery).toBeNull();
    expect(res.recovery.denominator).toBe(1);
  });

  it("aggregates multiple users", () => {
    const attempts: Att[] = [
      { userId: "u1", completedAt: date("2026-01-01"), totalScore: 15 },
      { userId: "u1", completedAt: date("2026-01-15"), totalScore: 5 }, // recovered + reliable
      { userId: "u2", completedAt: date("2026-01-02"), totalScore: 12 },
      { userId: "u2", completedAt: date("2026-01-20"), totalScore: 11 }, // not recovered
      { userId: "u3", completedAt: date("2026-01-03"), totalScore: 9 }, // sub-clinical
      { userId: "u3", completedAt: date("2026-01-10"), totalScore: 3 }, // reliable improvement only
    ];
    const res = computeIaptMetrics(attempts, phq9);
    expect(res.recovery).toEqual({ numerator: 1, denominator: 2 });
    expect(res.reliableImprovement).toEqual({ numerator: 2, denominator: 3 }); // u1 + u3
  });
});
