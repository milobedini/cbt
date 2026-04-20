// src/utils/londonBuckets.ts
import { DateTime } from "luxon";
import type { Granularity } from "../shared-types/types";

const ZONE = "Europe/London";

export const weekBucket = (
  at: Date,
): { startsAt: Date; endsAt: Date; granularity: "week" } => {
  const london = DateTime.fromJSDate(at, { zone: ZONE });
  const startsAt = london.startOf("week").startOf("day").toJSDate();
  const endsAt = london
    .startOf("week")
    .startOf("day")
    .plus({ weeks: 1 })
    .toJSDate();
  return { startsAt, endsAt, granularity: "week" };
};

export const monthBucket = (
  at: Date,
): { startsAt: Date; endsAt: Date; granularity: "month" } => {
  const london = DateTime.fromJSDate(at, { zone: ZONE });
  const startsAt = london.startOf("month").startOf("day").toJSDate();
  const endsAt = london
    .startOf("month")
    .startOf("day")
    .plus({ months: 1 })
    .toJSDate();
  return { startsAt, endsAt, granularity: "month" };
};

export const enumerateBuckets = (args: {
  from: Date;
  to: Date;
  granularity: Granularity;
}): Array<{ startsAt: Date; endsAt: Date; granularity: Granularity }> => {
  const { from, to, granularity } = args;
  const out: Array<{ startsAt: Date; endsAt: Date; granularity: Granularity }> =
    [];
  let cursor =
    granularity === "week"
      ? weekBucket(from).startsAt
      : monthBucket(from).startsAt;
  const end = to.getTime();
  while (cursor.getTime() < end) {
    const bucket =
      granularity === "week" ? weekBucket(cursor) : monthBucket(cursor);
    out.push(bucket);
    cursor = bucket.endsAt;
  }
  return out;
};
