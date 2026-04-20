import cron, { type ScheduledTask } from "node-cron";
import { runNightlyRollup } from "./rollupMetrics";

let task: ScheduledTask | null = null;

export const startScheduler = (): void => {
  if (process.env.ROLLUP_JOB_ENABLED === "false") {
    console.log("[scheduler] ROLLUP_JOB_ENABLED=false → skipping");
    return;
  }
  task = cron.schedule(
    "0 2 * * *",
    async () => {
      console.log("[scheduler] running nightly rollup");
      try {
        await runNightlyRollup();
      } catch (err) {
        console.error("[scheduler] nightly rollup failed", err);
      }
    },
    { timezone: "Europe/London" },
  );
  console.log("[scheduler] nightly rollup scheduled for 02:00 Europe/London");
};

export const stopScheduler = (): void => {
  if (task) {
    task.stop();
    task = null;
  }
};
