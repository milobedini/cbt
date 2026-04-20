// src/utils/suppression.ts
import type { OutcomeResult } from "../shared-types/types";

export const applySuppression = (
  counts: { numerator: number; denominator: number },
  { k, minN }: { k: number; minN: number },
): OutcomeResult => {
  const { numerator, denominator } = counts;
  if (denominator < k)
    return { rate: null, n: denominator, suppressed: true, reason: "below_k" };
  if (denominator < minN)
    return {
      rate: null,
      n: denominator,
      suppressed: true,
      reason: "below_min_n",
    };
  return {
    rate: numerator / denominator,
    n: denominator,
    suppressed: false,
    reason: null,
  };
};
