import type { Request, Response } from "express";
import { DateTime } from "luxon";
import User from "../models/userModel";
import ModuleAttempt from "../models/moduleAttemptModel";
import ModuleAssignment from "../models/moduleAssignmentModel";
import AdminAuditEvent from "../models/adminAuditEventModel";
import JobRun from "../models/jobRunModel";
import Program from "../models/programModel";
import Module from "../models/moduleModel";
import MetricsRollup from "../models/metricsRollupModel";
import { readThresholds } from "../utils/thresholds";
import { applySuppression } from "../utils/suppression";
import { errorHandler } from "../utils/errorHandler";

const ZONE = "Europe/London";

export const getAdminOverview = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const now = new Date();
    const thresholds = readThresholds();

    const londonNow = DateTime.fromJSDate(now, { zone: ZONE });
    const thisWeekStart = londonNow.startOf("week").toJSDate();
    const lastWeekStart = londonNow
      .startOf("week")
      .minus({ weeks: 1 })
      .toJSDate();
    const sevenDaysAgo = londonNow.minus({ days: 7 }).toJSDate();
    const fourteenDaysAgo = londonNow.minus({ days: 14 }).toJSDate();
    const thirtyDaysAgo = londonNow.minus({ days: 30 }).toJSDate();
    const sixtyDaysAgo = londonNow.minus({ days: 60 }).toJSDate();

    // Users
    const [
      total,
      patients,
      therapistsTotal,
      therapistsVerified,
      therapistsUnverified,
      newThisWeek,
      newLastWeek,
      zeroPatientsCount,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ roles: "patient" }),
      User.countDocuments({ roles: "therapist" }),
      User.countDocuments({ roles: "therapist", isVerifiedTherapist: true }),
      User.countDocuments({ roles: "therapist", isVerifiedTherapist: false }),
      User.countDocuments({ createdAt: { $gte: thisWeekStart } }),
      User.countDocuments({
        createdAt: { $gte: lastWeekStart, $lt: thisWeekStart },
      }),
      User.countDocuments({ roles: "therapist", patients: { $size: 0 } }),
    ]);

    // Active users (30d and previous 30d)
    const activeLast30dDocs = await ModuleAttempt.distinct("user", {
      status: "submitted",
      completedAt: { $gte: thirtyDaysAgo },
    });
    const activeLast30dPreviousDocs = await ModuleAttempt.distinct("user", {
      status: "submitted",
      completedAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
    });

    // Work
    const [completedLast7d, completedPreviousWeek, stalled7d] =
      await Promise.all([
        ModuleAttempt.countDocuments({
          status: "submitted",
          completedAt: { $gte: sevenDaysAgo },
        }),
        ModuleAttempt.countDocuments({
          status: "submitted",
          completedAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo },
        }),
        ModuleAttempt.countDocuments({
          status: "started",
          lastInteractionAt: { $lt: sevenDaysAgo },
        }),
      ]);

    const byTypeAgg = await ModuleAttempt.aggregate([
      {
        $match: { status: "submitted", completedAt: { $gte: sevenDaysAgo } },
      },
      { $group: { _id: "$moduleType", count: { $sum: 1 } } },
      { $project: { _id: 0, moduleType: "$_id", count: 1 } },
    ]);

    // Orphaned assignments: therapist user missing OR not verified
    const verifiedTherapistIds = (
      await User.find(
        { roles: "therapist", isVerifiedTherapist: true },
        { _id: 1 },
      ).lean()
    ).map((u) => u._id);
    const orphanedAssignments = await ModuleAssignment.countDocuments({
      therapist: { $exists: true, $ne: null, $nin: verifiedTherapistIds },
    });

    // Audit events in last 7d
    const auditEventsLast7d = await AdminAuditEvent.countDocuments({
      at: { $gte: sevenDaysAgo },
    });

    // Programme summaries (last 90d window) — read rollups, primary instrument per programme
    const programmes = await Program.find({}, { _id: 1, title: 1 }).lean();
    const moduleByProgramme = await Module.find(
      { instrument: { $ne: null } },
      { _id: 1, program: 1, instrument: 1, clinicalCutoff: 1 },
    ).lean();

    const programmeCards = await Promise.all(
      programmes.map(async (p) => {
        const enrolledUsers = (
          await ModuleAttempt.distinct("user", { program: p._id })
        ).length;
        const primary = moduleByProgramme.find(
          (m) => m.program.toString() === p._id.toString(),
        );
        if (!primary) {
          return {
            programmeId: p._id.toString(),
            title: p.title,
            enrolledUsers,
            outcomes: null,
          };
        }
        // Each rollup row is a trailing-90d snapshot at bucket.endsAt. The
        // "last 90d" rate for the overview is simply the most recent snapshot
        // per metric — no summing across buckets (which would double-count
        // patients who appear in multiple bucket windows).
        const latestRows = await MetricsRollup.aggregate<{
          _id: string;
          numerator: number;
          denominator: number;
        }>([
          {
            $match: {
              "dimension.programmeId": p._id,
              "dimension.careTier": null,
              "dimension.instrument": primary.instrument,
            },
          },
          { $sort: { "bucket.endsAt": -1 } },
          {
            $group: {
              _id: "$metric",
              numerator: { $first: "$numerator" },
              denominator: { $first: "$denominator" },
            },
          },
        ]);
        const latestBy = new Map<
          string,
          { numerator: number; denominator: number }
        >();
        for (const row of latestRows)
          latestBy.set(row._id, {
            numerator: row.numerator,
            denominator: row.denominator,
          });
        const latestFor = (metric: string) =>
          applySuppression(
            latestBy.get(metric) ?? { numerator: 0, denominator: 0 },
            thresholds,
          );

        return {
          programmeId: p._id.toString(),
          title: p.title,
          enrolledUsers,
          outcomes: {
            window: "last_90d" as const,
            instrument: primary.instrument,
            recovery: latestFor("recovery"),
            reliableImprovement: latestFor("reliable_improvement"),
            reliableRecovery: latestFor("reliable_recovery"),
          },
        };
      }),
    );

    // Verification queue: oldest 5 unverified therapists
    const oldest = await User.find(
      { roles: "therapist", isVerifiedTherapist: false },
      {
        _id: 1,
        username: 1,
        email: 1,
        name: 1,
        createdAt: 1,
        therapistTier: 1,
      },
    )
      .sort({ createdAt: 1 })
      .limit(5)
      .lean();

    const lastRollup = await JobRun.findOne(
      { job: "rollupMetrics", status: "success" },
      { completedAt: 1 },
    )
      .sort({ completedAt: -1 })
      .lean();

    res.status(200).json({
      asOf: now.toISOString(),
      rollupAsOf: lastRollup?.completedAt
        ? lastRollup.completedAt.toISOString()
        : null,
      privacyMode: thresholds.privacyMode,
      operational: {
        users: {
          total,
          patients,
          therapists: {
            total: therapistsTotal,
            verified: therapistsVerified,
            unverified: therapistsUnverified,
            zeroPatients: zeroPatientsCount,
          },
          newThisWeek,
          newLastWeek,
          activeLast30d: activeLast30dDocs.length,
          activeLast30dPrevious: activeLast30dPreviousDocs.length,
        },
        work: {
          completedAttemptsLast7d: completedLast7d,
          completedAttemptsPreviousWeek: completedPreviousWeek,
          stalledAttempts7d: stalled7d,
          orphanedAssignments,
          byType: byTypeAgg,
        },
        audit: {
          eventsLast7d: auditEventsLast7d,
        },
      },
      programmes: programmeCards,
      verificationQueue: {
        count: therapistsUnverified,
        oldest: oldest.map((u) => ({
          userId: u._id.toString(),
          username: u.username,
          email: u.email,
          name: u.name,
          createdAt: u.createdAt.toISOString(),
          therapistTier: u.therapistTier ?? null,
        })),
      },
    });
  } catch (error) {
    errorHandler(res, error);
  }
};

export const getAdminSystemHealth = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const lastRun = await JobRun.findOne({ job: "rollupMetrics" })
      .sort({ startedAt: -1 })
      .lean();
    const auditEventsTotal = await AdminAuditEvent.estimatedDocumentCount();
    res.status(200).json({
      rollupLastRun: lastRun
        ? {
            startedAt: lastRun.startedAt.toISOString(),
            completedAt: lastRun.completedAt
              ? lastRun.completedAt.toISOString()
              : null,
            status: lastRun.status,
            rowsWritten: lastRun.rowsWritten,
          }
        : null,
      auditEventsTotal,
    });
  } catch (error) {
    errorHandler(res, error);
  }
};
