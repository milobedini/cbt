import cron, { type ScheduledTask } from "node-cron";
import { DateTime } from "luxon";
import { runNightlyRollup } from "./rollupMetrics";
import JobRun from "../models/jobRunModel";

const TIMEZONE = "Europe/London";
const SCHEDULE = "0 2 * * *"; // 02:00 every day, TIMEZONE
const ROLLUP_JOB_NAME = "rollupMetrics";
// Cap on how far back catch-up will replay missed slots. A free-tier web
// service that slept for months should not trigger years of backfill at wake.
const MAX_CATCHUP_SLOTS = 60;

let task: ScheduledTask | null = null;

/**
 * Return the most recent 02:00 Europe/London slot at or before `now`.
 * If `now` is before today's 02:00, return yesterday's 02:00 instead.
 */
export const mostRecentScheduledSlot = (now: Date = new Date()): Date => {
  const london = DateTime.fromJSDate(now, { zone: TIMEZONE });
  const today0200 = london.set({
    hour: 2,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const slot = today0200 <= london ? today0200 : today0200.minus({ days: 1 });
  return slot.toJSDate();
};

/**
 * List the 02:00 London slots that should have been rolled up but were not,
 * given the last successful `JobRun.completedAt` (or null if the job has
 * never run).
 *
 * - No prior success → a single baseline slot (the most recent one) so the
 *   first boot establishes rollups without back-filling ancient history.
 * - Prior success → every slot strictly after that success up to and
 *   including the most recent one, capped at `MAX_CATCHUP_SLOTS` to guard
 *   against a months-long outage causing a stampede at wake.
 *
 * Slots are returned chronologically (oldest first) so logs read naturally
 * as the replay progresses.
 */
export const listMissedSlots = (
  lastSuccessAt: Date | null,
  now: Date = new Date(),
): Date[] => {
  const mostRecent = DateTime.fromJSDate(mostRecentScheduledSlot(now), {
    zone: TIMEZONE,
  });
  if (!lastSuccessAt) return [mostRecent.toJSDate()];

  const lastLondon = DateTime.fromJSDate(lastSuccessAt, { zone: TIMEZONE });
  if (lastLondon >= mostRecent) return [];

  // First missed slot is the first 02:00 London strictly after lastSuccessAt.
  let firstMissed = lastLondon.set({
    hour: 2,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  if (firstMissed <= lastLondon) firstMissed = firstMissed.plus({ days: 1 });

  const slots: DateTime[] = [];
  let cursor = mostRecent;
  while (cursor >= firstMissed && slots.length < MAX_CATCHUP_SLOTS) {
    slots.push(cursor);
    cursor = cursor.minus({ days: 1 });
  }
  return slots.reverse().map((s) => s.toJSDate());
};

/**
 * Fire `runNightlyRollup` for every 02:00 London slot that should have been
 * rolled up but was not — free-tier spin-down, laptop asleep, deploy restart,
 * or the job has never run.
 *
 * Replay is chronological (oldest first). Each slot writes its own `JobRun`.
 * Idempotent: `upsertRollup` keys on (metric × dimension × bucket) and uses
 * `updateOne({ upsert: true })`, so re-running a slot updates rather than
 * duplicates.
 *
 * Returns the number of slots replayed.
 */
export const catchUpIfMissed = async (
  now: Date = new Date(),
): Promise<number> => {
  const latest = await JobRun.findOne({
    job: ROLLUP_JOB_NAME,
    status: { $in: ["success", "partial"] },
    completedAt: { $ne: null },
  })
    .sort({ completedAt: -1 })
    .lean();
  const slots = listMissedSlots(latest?.completedAt ?? null, now);
  if (slots.length === 0) return 0;

  console.log(
    `[scheduler] catch-up replaying ${slots.length} missed slot(s), ${slots[0].toISOString()} → ${slots[slots.length - 1].toISOString()}`,
  );
  for (const slot of slots) {
    await runNightlyRollup(slot);
  }
  return slots.length;
};

export const startScheduler = (): void => {
  if (process.env.ROLLUP_JOB_ENABLED === "false") {
    console.log("[scheduler] ROLLUP_JOB_ENABLED=false → skipping");
    return;
  }
  task = cron.schedule(
    SCHEDULE,
    async () => {
      console.log("[scheduler] running nightly rollup");
      try {
        await runNightlyRollup();
      } catch (err) {
        console.error("[scheduler] nightly rollup failed", err);
      }
    },
    { timezone: TIMEZONE },
  );
  console.log("[scheduler] nightly rollup scheduled for 02:00 Europe/London");

  // Catch-up on boot — don't block startup; log errors rather than crashing.
  catchUpIfMissed().catch((err) =>
    console.error("[scheduler] catch-up failed", err),
  );
};

export const stopScheduler = (): void => {
  if (task) {
    task.stop();
    task = null;
  }
};
