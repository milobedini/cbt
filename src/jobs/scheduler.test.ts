import {
  catchUpIfMissed,
  listMissedSlots,
  mostRecentScheduledSlot,
} from "./scheduler";
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

describe("scheduler.listMissedSlots", () => {
  const now = new Date("2026-04-21T12:00:00Z"); // most recent slot = 2026-04-21 01:00 UTC

  it("returns a single baseline slot when the job has never run", () => {
    const slots = listMissedSlots(null, now);
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-04-21T01:00:00.000Z",
    ]);
  });

  it("returns an empty list when the last success is already after the most recent slot", () => {
    expect(listMissedSlots(new Date("2026-04-21T05:00:00Z"), now)).toEqual([]);
  });

  it("enumerates every missed slot chronologically between the last success and now", () => {
    // Last success 2026-04-18 02:05 London = 2026-04-18 01:05 UTC.
    // Missed slots: 19, 20, 21 April 02:00 London.
    const slots = listMissedSlots(new Date("2026-04-18T01:05:00Z"), now);
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-04-19T01:00:00.000Z",
      "2026-04-20T01:00:00.000Z",
      "2026-04-21T01:00:00.000Z",
    ]);
  });

  it("caps at MAX_CATCHUP_SLOTS (60) when the gap is larger than the cap", () => {
    // 120 days ago — far beyond the cap.
    const slots = listMissedSlots(new Date("2025-12-22T01:05:00Z"), now);
    expect(slots).toHaveLength(60);
    // Most recent slot must be today's, and the oldest is 59 days earlier.
    expect(slots[slots.length - 1].toISOString()).toBe(
      "2026-04-21T01:00:00.000Z",
    );
    expect(slots[0].toISOString()).toBe("2026-02-21T02:00:00.000Z");
  });
});

describe("scheduler.catchUpIfMissed (integration)", () => {
  it("runs once when the job has never run", async () => {
    const now = new Date("2026-04-21T12:00:00Z");
    const replayed = await catchUpIfMissed(now);
    expect(replayed).toBe(1);
    const runs = await JobRun.find({ job: "rollupMetrics" });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
  });

  it("replays every missed slot when the last success is several days stale", async () => {
    const now = new Date("2026-04-21T12:00:00Z");
    await JobRun.create({
      job: "rollupMetrics",
      startedAt: new Date("2026-04-18T01:00:00Z"),
      completedAt: new Date("2026-04-18T01:05:00Z"),
      status: "success",
    });
    const replayed = await catchUpIfMissed(now);
    expect(replayed).toBe(3); // 19, 20, 21 April
    const runs = await JobRun.find({ job: "rollupMetrics" }).sort({
      startedAt: 1,
    });
    expect(runs).toHaveLength(4); // original + 3 replays
  });

  it("does not replay anything when a successful run has completed since the most recent slot", async () => {
    const now = new Date("2026-04-21T12:00:00Z");
    await JobRun.create({
      job: "rollupMetrics",
      startedAt: new Date("2026-04-21T01:00:00Z"),
      completedAt: new Date("2026-04-21T01:05:00Z"),
      status: "success",
    });
    const replayed = await catchUpIfMissed(now);
    expect(replayed).toBe(0);
    expect(await JobRun.countDocuments({})).toBe(1);
    expect(await MetricsRollup.countDocuments({})).toBe(0);
  });

  it("treats a partial run as sufficient if it completed since the most recent slot", async () => {
    const now = new Date("2026-04-21T12:00:00Z");
    await JobRun.create({
      job: "rollupMetrics",
      startedAt: new Date("2026-04-21T01:00:00Z"),
      completedAt: new Date("2026-04-21T01:05:00Z"),
      status: "partial",
    });
    const replayed = await catchUpIfMissed(now);
    expect(replayed).toBe(0);
  });
});
