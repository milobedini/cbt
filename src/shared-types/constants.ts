// CONSTANTS
export const SLOT_START_HOUR = 6 as const;
export const SLOT_END_HOUR = 24 as const;
export const SLOT_STEP_HOURS = 2 as const;
export const LONDON_TZ = "Europe/London" as const;

// Admin — primitives (v1)
export const INSTRUMENTS = ["phq9", "gad7", "pdss"] as const;
export const CARE_TIERS = ["self_help", "cbt_guided", "pwp_guided"] as const;
export const THERAPIST_TIERS = ["cbt", "pwp"] as const;
export const AUDITED_ACTIONS = [
  "therapist.verified",
  "therapist.unverified",
  "user.viewed",
  "patient.attemptsViewed",
  "module.created",
  "admin.loggedIn",
] as const;
export const METRIC_NAMES = [
  "recovery",
  "reliable_improvement",
  "reliable_recovery",
] as const;
export const PRIVACY_MODES = ["production", "reduced"] as const;
export const GRANULARITIES = ["week", "month"] as const;
