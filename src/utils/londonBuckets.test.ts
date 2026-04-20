// src/utils/londonBuckets.test.ts
import { weekBucket, monthBucket, enumerateBuckets } from "./londonBuckets";
import { DateTime } from "luxon";

describe("londonBuckets", () => {
  it("weekBucket anchors Monday 00:00 Europe/London for a Wednesday in summer", () => {
    const wed = new Date("2026-07-15T12:00:00Z");
    const b = weekBucket(wed);
    const londonStart = DateTime.fromJSDate(b.startsAt).setZone(
      "Europe/London",
    );
    expect(londonStart.weekday).toBe(1); // Monday
    expect(londonStart.hour).toBe(0);
    expect(b.endsAt.getTime() - b.startsAt.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it("weekBucket handles DST spring-forward correctly (25 March 2026)", () => {
    const dstWeek = new Date("2026-03-30T12:00:00Z"); // Monday after UK spring-forward
    const b = weekBucket(dstWeek);
    const londonStart = DateTime.fromJSDate(b.startsAt).setZone(
      "Europe/London",
    );
    expect(londonStart.weekday).toBe(1);
    expect(londonStart.hour).toBe(0);
  });

  it("monthBucket anchors 1st 00:00 Europe/London", () => {
    const mid = new Date("2026-05-15T09:00:00Z");
    const b = monthBucket(mid);
    const londonStart = DateTime.fromJSDate(b.startsAt).setZone(
      "Europe/London",
    );
    expect(londonStart.day).toBe(1);
    expect(londonStart.hour).toBe(0);
    expect(londonStart.month).toBe(5);
    const londonEnd = DateTime.fromJSDate(b.endsAt).setZone("Europe/London");
    expect(londonEnd.day).toBe(1);
    expect(londonEnd.month).toBe(6);
  });

  it("enumerateBuckets produces contiguous non-overlapping weeks", () => {
    const from = new Date("2026-01-05T00:00:00Z"); // Monday
    const to = new Date("2026-02-02T00:00:00Z");
    const buckets = enumerateBuckets({ from, to, granularity: "week" });
    expect(buckets.length).toBe(4);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].startsAt.getTime()).toBe(
        buckets[i - 1].endsAt.getTime(),
      );
    }
  });
});
