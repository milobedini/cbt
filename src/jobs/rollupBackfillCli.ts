// src/jobs/rollupBackfillCli.ts
//
// Backfill historical rollup snapshots for the last N months. Each bucket is
// a snapshot point; for each of the last N London-months we call
// `runRollupForBucket(monthBucket(at))` which writes the trailing-90d
// snapshot as of that month boundary.
//
// Idempotent: `upsertRollup` uses `updateOne({ upsert: true })`, so re-running
// updates existing rows rather than duplicating them.
//
// Usage:
//   npm run rollup-metrics:backfill            # default: last 12 months
//   npm run rollup-metrics:backfill -- 24      # last 24 months

import mongoose from "mongoose";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import { runRollupForBucket } from "./rollupMetrics";
import { monthBucket, weekBucket } from "../utils/londonBuckets";

dotenv.config();

const DEFAULT_MONTHS = 12;
const DEFAULT_WEEKS = 12;
const TIMEZONE = "Europe/London";

const parseIntArg = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const main = async () => {
  const months = parseIntArg(process.argv[2], DEFAULT_MONTHS);
  const weeks = parseIntArg(process.argv[3], DEFAULT_WEEKS);

  await mongoose.connect(process.env.MONGO_URI as string);
  console.log(
    `[backfill] running for last ${months} months + last ${weeks} weeks (London)`,
  );

  const londonNow = DateTime.now().setZone(TIMEZONE);

  // Monthly snapshots — one bucket per month, oldest first.
  for (let m = months; m >= 0; m--) {
    const snapAt = londonNow.minus({ months: m }).startOf("month").toJSDate();
    const bucket = monthBucket(snapAt);
    const rows = await runRollupForBucket(bucket);
    console.log(
      `[backfill] month ${bucket.startsAt.toISOString()} → ${rows} rows`,
    );
  }

  // Weekly snapshots — last N London-weeks, oldest first.
  for (let w = weeks; w >= 0; w--) {
    const snapAt = londonNow.minus({ weeks: w }).startOf("week").toJSDate();
    const bucket = weekBucket(snapAt);
    const rows = await runRollupForBucket(bucket);
    console.log(
      `[backfill] week  ${bucket.startsAt.toISOString()} → ${rows} rows`,
    );
  }

  await mongoose.connection.close();
  console.log(`[backfill] done`);
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
