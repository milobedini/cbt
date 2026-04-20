// src/utils/iaptPairing.ts
import type { Instrument } from "../shared-types/types";

type Attempt = { userId: string; completedAt: Date; totalScore: number };

type InstrumentDef = {
  instrument: Instrument;
  clinicalCutoff: number;
  reliableChangeDelta: number | null;
};

type Counts = { numerator: number; denominator: number };

export type IaptMetricsResult = {
  recovery: Counts;
  reliableImprovement: Counts | null;
  reliableRecovery: Counts | null;
};

export const computeIaptMetrics = (
  attempts: Attempt[],
  def: InstrumentDef,
): IaptMetricsResult => {
  // Group by user
  const byUser = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const arr = byUser.get(a.userId);
    if (arr) arr.push(a);
    else byUser.set(a.userId, [a]);
  }

  let recoveryNum = 0;
  let recoveryDen = 0;
  let reliableImpNum = 0;
  let reliableImpDen = 0;
  let reliableRecNum = 0;
  let reliableRecDen = 0;

  for (const userAttempts of byUser.values()) {
    if (userAttempts.length < 2) continue;
    const sorted = [...userAttempts].sort(
      (a, b) => a.completedAt.getTime() - b.completedAt.getTime(),
    );
    const baseline = sorted[0];
    const endpoint = sorted[sorted.length - 1];

    const aboveCutoff = baseline.totalScore >= def.clinicalCutoff;
    const recovered = endpoint.totalScore < def.clinicalCutoff;
    const improved =
      def.reliableChangeDelta !== null &&
      baseline.totalScore - endpoint.totalScore >= def.reliableChangeDelta;

    if (aboveCutoff) {
      recoveryDen++;
      if (recovered) recoveryNum++;
      if (def.reliableChangeDelta !== null) {
        reliableRecDen++;
        if (recovered && improved) reliableRecNum++;
      }
    }

    if (def.reliableChangeDelta !== null) {
      reliableImpDen++;
      if (improved) reliableImpNum++;
    }
  }

  return {
    recovery: { numerator: recoveryNum, denominator: recoveryDen },
    reliableImprovement:
      def.reliableChangeDelta === null
        ? null
        : { numerator: reliableImpNum, denominator: reliableImpDen },
    reliableRecovery:
      def.reliableChangeDelta === null
        ? null
        : { numerator: reliableRecNum, denominator: reliableRecDen },
  };
};
