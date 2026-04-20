import type { Request, Response } from "express";
import mongoose from "mongoose";
import { DateTime } from "luxon";
import MetricsRollup from "../models/metricsRollupModel";
import JobRun from "../models/jobRunModel";
import { readThresholds } from "../utils/thresholds";
import { applySuppression } from "../utils/suppression";
import { enumerateBuckets } from "../utils/londonBuckets";
import { errorHandler } from "../utils/errorHandler";
import type {
  CareTier,
  Granularity,
  Instrument,
  MetricName,
} from "../shared-types/types";

const INSTRUMENTS: Instrument[] = ["phq9", "gad7", "pdss"];
const CARE_TIERS_ALL: CareTier[] = ["self_help", "cbt_guided", "pwp_guided"];
const GRANULARITIES: Granularity[] = ["week", "month"];

export const getAdminOutcomes = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { instrument, programmeId, careTier, granularity, from, to } =
      req.query as Record<string, string>;

    if (!instrument || !INSTRUMENTS.includes(instrument as Instrument)) {
      res.status(400).json({
        message:
          "instrument query param required and must be a known instrument",
      });
      return;
    }
    const gran: Granularity = (
      GRANULARITIES.includes(granularity as Granularity) ? granularity : "month"
    ) as Granularity;
    const programmeIdNorm =
      programmeId && programmeId !== "all"
        ? new mongoose.Types.ObjectId(programmeId)
        : null;
    const careTierNorm: CareTier | null =
      careTier &&
      careTier !== "all" &&
      CARE_TIERS_ALL.includes(careTier as CareTier)
        ? (careTier as CareTier)
        : null;

    const now = new Date();
    const thresholds = readThresholds();

    const defaultFrom =
      gran === "month"
        ? DateTime.fromJSDate(now, { zone: "Europe/London" })
            .minus({ months: 12 })
            .toJSDate()
        : DateTime.fromJSDate(now, { zone: "Europe/London" })
            .minus({ weeks: 12 })
            .toJSDate();

    const fromDate = from ? new Date(from) : defaultFrom;
    const toDate = to ? new Date(to) : now;
    if (fromDate.getTime() > toDate.getTime()) {
      res.status(400).json({ message: "from must be <= to" });
      return;
    }

    const buckets = enumerateBuckets({
      from: fromDate,
      to: toDate,
      granularity: gran,
    });

    // Single query for all relevant rollup rows
    const rollups = await MetricsRollup.find({
      "dimension.programmeId": programmeIdNorm,
      "dimension.careTier": careTierNorm,
      "dimension.instrument": instrument,
      "bucket.granularity": gran,
      "bucket.startsAt": { $gte: fromDate },
      "bucket.endsAt": { $lte: toDate },
    }).lean();

    const rowAt = (metric: MetricName, startsAt: Date) =>
      rollups.find(
        (r) =>
          r.metric === metric &&
          r.bucket.startsAt.getTime() === startsAt.getTime(),
      );

    const series = buckets.map((b) => {
      const rec = rowAt("recovery", b.startsAt);
      const rel = rowAt("reliable_improvement", b.startsAt);
      const relRec = rowAt("reliable_recovery", b.startsAt);
      return {
        bucket: {
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
        },
        recovery: applySuppression(
          {
            numerator: rec?.numerator ?? 0,
            denominator: rec?.denominator ?? 0,
          },
          thresholds,
        ),
        reliableImprovement: applySuppression(
          {
            numerator: rel?.numerator ?? 0,
            denominator: rel?.denominator ?? 0,
          },
          thresholds,
        ),
        reliableRecovery: applySuppression(
          {
            numerator: relRec?.numerator ?? 0,
            denominator: relRec?.denominator ?? 0,
          },
          thresholds,
        ),
      };
    });

    const lastRollup = await JobRun.findOne({
      job: "rollupMetrics",
      status: "success",
    })
      .sort({ completedAt: -1 })
      .lean();

    res.status(200).json({
      asOf: now.toISOString(),
      rollupAsOf: lastRollup?.completedAt
        ? lastRollup.completedAt.toISOString()
        : null,
      privacyMode: thresholds.privacyMode,
      dimension: {
        programmeId: programmeIdNorm ? programmeIdNorm.toString() : null,
        careTier: careTierNorm,
        instrument,
      },
      range: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        granularity: gran,
      },
      series,
    });
  } catch (error) {
    errorHandler(res, error);
  }
};
