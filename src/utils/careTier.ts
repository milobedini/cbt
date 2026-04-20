// src/utils/careTier.ts
import type { CareTier, TherapistTier } from "../shared-types/types";

export const deriveCareTier = (args: {
  attemptTherapistId: string | null;
  therapistTierLookup: Record<string, TherapistTier | undefined>;
}): CareTier => {
  const { attemptTherapistId, therapistTierLookup } = args;
  if (!attemptTherapistId) return "self_help";
  const tier = therapistTierLookup[attemptTherapistId];
  if (tier === "cbt") return "cbt_guided";
  if (tier === "pwp") return "pwp_guided";
  return "self_help";
};
