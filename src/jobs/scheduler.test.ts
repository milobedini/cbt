import { catchUpIfMissed, mostRecentScheduledSlot } from "./scheduler";
import JobRun from "../models/jobRunModel";
import MetricsRollup from "../models/metricsRollupModel";

describe("scheduler.mostRecentScheduledSlot", () => {
  it("returns today 02:00 London when now is after 02:00 London", () => {
    // 12:00 UTC in April = 13:00 London (BST). Most recent slot = today 02:00 London = 01:00 UTC.
    const now = new Date("2026-04-21T12:00:00Z");
    const slot = mostRecentScheduledSlot(now);
    expect(slot.toISOString()).toBe("2026-04-21T01:00:00.000Z");
  });

  it("returns yesterday 02:00 London when now is before 02:00 London", () => {
    // 00:30 UTC 21 April = 01:30 London (still before 02:00). Slot = 20 April 02:00 London = 19 April 01:00 UTC.
    const now = new Date("2026-04-21T00:30:00Z");
    const slot = mostRecentScheduledSlot(now);
    expect(slot.toISOString()).toBe("2026-04-20T01:00:00.000Z");
  });

  it("uses GMT in January (no DST offset)", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    const slot = mostRecentScheduledSlot(now);
    // London = UTC in January, so 02:00 London = 02:00 UTC.
    expect(slot.toISOString()).toBe("2026-01-15T02:00:00.000Z");
  });
});

describe("scheduler.catchUpIfMissed (integration)", () => {
  it("fires a rollup when no JobRun records exist", async () => {
    const now = new Date("2026-04-21T12:00:00Z");
    const fired = await catchUpIfMissed(now);
    expect(fired).toBe(true);
    const runs = await JobRun.find({ job: "rollupMetrics" });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
  });

  it("fires a rollup when the latest successful JobRun is older than the last scheduled slot", async () => {
    const now = new Date("2026-04-21T12:00:00Z"); // slot = 01:00 UTC 21 Apr
    await JobRun.create({
      job: "rollupMetrics",
      startedAt: new Date("2026-04-19T01:00:00Z"),
      completedAt: new Date("2026-04-19T01:05:00Z"), // two days ago — stale
      status: "success",
    });
    const fired = await catchUpIfMissed(now);
    expect(fired).toBe(true);
    const runs = await JobRun.find({ job: "rollupMetrics" }).sort({
      startedAt: 1,
    });
    expect(runs).toHaveLength(2);
  });

  it("does not fire when a successful JobRun has completed since the last slot", async () => {
    const now = new Date("2026-04-21T12:00:00Z"); // slot = 01:00 UTC 21 Apr
    await JobRun.create({
      job: "rollupMetrics",
      startedAt: new Date("2026-04-21T01:00:00Z"),
      completedAt: new Date("2026-04-21T01:05:00Z"), // after the slot
      status: "success",
    });
    const fired = await catchUpIfMissed(now);
    expect(fired).toBe(false);
    // No new rollup or JobRun should have been written by catch-up.
    expect(await JobRun.countDocuments({})).toBe(1);
    expect(await MetricsRollup.countDocuments({})).toBe(0);
  });

  it("treats a partial run as sufficient if it completed since the last slot", async () => {
    const now = new Date("2026-04-21T12:00:00Z");
    await JobRun.create({
      job: "rollupMetrics",
      startedAt: new Date("2026-04-21T01:00:00Z"),
      completedAt: new Date("2026-04-21T01:05:00Z"),
      status: "partial",
    });
    const fired = await catchUpIfMissed(now);
    expect(fired).toBe(false);
  });
});
