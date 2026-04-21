import cron, { type ScheduledTask } from "node-cron";
import { DateTime } from "luxon";
import { runNightlyRollup } from "./rollupMetrics";
import JobRun from "../models/jobRunModel";

const TIMEZONE = "Europe/London";
const SCHEDULE = "0 2 * * *"; // 02:00 every day, TIMEZONE
const ROLLUP_JOB_NAME = "rollupMetrics";

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
 * Fire `runNightlyRollup` immediately if the last scheduled slot was missed —
 * either because the process was down at 02:00 (free-tier spin-down, laptop
 * asleep, deploy restart) or because the job has never been run.
 *
 * Idempotent: `upsertRollup` uses `updateOne({ upsert: true })`, so running
 * twice for the same bucket updates the row rather than duplicating it.
 */
export const catchUpIfMissed = async (
  now: Date = new Date(),
): Promise<boolean> => {
  const lastSlot = mostRecentScheduledSlot(now);
  const recentSuccess = await JobRun.findOne({
    job: ROLLUP_JOB_NAME,
    status: { $in: ["success", "partial"] },
    completedAt: { $ne: null, $gte: lastSlot },
  })
    .sort({ completedAt: -1 })
    .lean();
  if (recentSuccess) return false;
  console.log(
    `[scheduler] catch-up triggered — no successful rollup since ${lastSlot.toISOString()}`,
  );
  await runNightlyRollup(now);
  return true;
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
