import type { Request, Response } from "express";
import mongoose from "mongoose";
import { DateTime } from "luxon";
import Program from "../models/programModel";
import Module from "../models/moduleModel";
import ModuleAttempt from "../models/moduleAttemptModel";
import MetricsRollup from "../models/metricsRollupModel";
import JobRun from "../models/jobRunModel";
import User from "../models/userModel";
import { readThresholds } from "../utils/thresholds";
import { applySuppression } from "../utils/suppression";
import { deriveCareTier } from "../utils/careTier";
import { errorHandler } from "../utils/errorHandler";
import type { CareTier, Instrument, MetricName } from "../shared-types/types";

const CARE_TIERS: CareTier[] = ["self_help", "cbt_guided", "pwp_guided"];

export const getAdminProgrammeDetail = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid programme id" });
      return;
    }
    const programme = await Program.findById(id);
    if (!programme) {
      res.status(404).json({ message: "Programme not found" });
      return;
    }

    const thresholds = readThresholds();
    const now = new Date();
    const londonNow = DateTime.fromJSDate(now, { zone: "Europe/London" });
    const sevenDaysAgo = londonNow.minus({ days: 7 }).toJSDate();

    // Enrolment — distinct users who have any attempt in this programme
    const enrolledUsers = await ModuleAttempt.distinct("user", {
      program: programme._id,
    });
    // Care tier breakdown — look at each enrolled user's attempts
    const therapists = (await User.find(
      { roles: "therapist" },
      { _id: 1, therapistTier: 1 },
    ).lean()) as unknown as Array<{
      _id: mongoose.Types.ObjectId;
      therapistTier?: "cbt" | "pwp";
    }>;
    const tierLookup: Record<string, "cbt" | "pwp" | undefined> = {};
    for (const t of therapists) tierLookup[t._id.toString()] = t.therapistTier;

    // Pick one attempt per user to determine tier (latest attempt's therapist)
    const tierByUser = await ModuleAttempt.aggregate([
      { $match: { program: programme._id } },
      { $sort: { completedAt: -1 } },
      { $group: { _id: "$user", therapist: { $first: "$therapist" } } },
    ]);

    const enrolByTier: Record<CareTier, number> = {
      self_help: 0,
      cbt_guided: 0,
      pwp_guided: 0,
    };
    for (const row of tierByUser) {
      const tier = deriveCareTier({
        attemptTherapistId: row.therapist ? row.therapist.toString() : null,
        therapistTierLookup: tierLookup,
      });
      enrolByTier[tier]++;
    }

    // Clinical modules in this programme
    const modules = await Module.find(
      { program: programme._id, instrument: { $ne: null } },
      { instrument: 1, clinicalCutoff: 1, reliableChangeDelta: 1 },
    ).lean();
    const byInstrument = await Promise.all(
      modules.map(async (m) => {
        // Each rollup row is a trailing-90d snapshot at bucket.endsAt.
        // For "last 90d", read the most recent snapshot per metric.
        const latestFor = async (metric: MetricName, tier: CareTier | null) => {
          const row = await MetricsRollup.findOne({
            metric,
            "dimension.programmeId": programme._id,
            "dimension.careTier": tier,
            "dimension.instrument": m.instrument as Instrument,
          })
            .sort({ "bucket.endsAt": -1 })
            .lean();
          return applySuppression(
            row
              ? { numerator: row.numerator, denominator: row.denominator }
              : { numerator: 0, denominator: 0 },
            thresholds,
          );
        };
        const overall = {
          recovery: await latestFor("recovery", null),
          reliableImprovement: await latestFor("reliable_improvement", null),
          reliableRecovery: await latestFor("reliable_recovery", null),
        };
        const byCareTier = await Promise.all(
          CARE_TIERS.map(async (tier) => ({
            careTier: tier,
            recovery: await latestFor("recovery", tier),
            reliableImprovement: await latestFor("reliable_improvement", tier),
            reliableRecovery: await latestFor("reliable_recovery", tier),
          })),
        );
        return {
          instrument: m.instrument as Instrument,
          cutoff: m.clinicalCutoff as number,
          reliableChangeDelta: m.reliableChangeDelta ?? null,
          window: "last_90d" as const,
          overall,
          byCareTier,
        };
      }),
    );

    // Work (programme-scoped)
    const programmeModuleIds = (
      await Module.find({ program: programme._id }, { _id: 1 }).lean()
    ).map((m) => m._id);
    const [completedLast7d, stalled7d, byTypeAgg] = await Promise.all([
      ModuleAttempt.countDocuments({
        status: "submitted",
        module: { $in: programmeModuleIds },
        completedAt: { $gte: sevenDaysAgo },
      }),
      ModuleAttempt.countDocuments({
        status: "started",
        module: { $in: programmeModuleIds },
        lastInteractionAt: { $lt: sevenDaysAgo },
      }),
      ModuleAttempt.aggregate([
        {
          $match: {
            status: "submitted",
            module: { $in: programmeModuleIds },
            completedAt: { $gte: sevenDaysAgo },
          },
        },
        { $group: { _id: "$moduleType", count: { $sum: 1 } } },
        { $project: { _id: 0, moduleType: "$_id", count: 1 } },
      ]),
    ]);

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
      programme: {
        _id: (programme._id as mongoose.Types.ObjectId).toString(),
        title: programme.title,
        description: programme.description,
      },
      enrolment: {
        total: enrolledUsers.length,
        byCareTier: CARE_TIERS.map((t) => ({
          careTier: t,
          count: enrolByTier[t],
        })),
      },
      outcomesByInstrument: byInstrument,
      work: {
        completedAttemptsLast7d: completedLast7d,
        stalledAttempts7d: stalled7d,
        byType: byTypeAgg,
      },
    });
  } catch (error) {
    errorHandler(res, error);
  }
};
