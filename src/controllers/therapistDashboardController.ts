import { Request, Response } from "express";
import { Types } from "mongoose";
import { DateTime } from "luxon";
import User, { UserRole } from "../models/userModel";
import ModuleAttempt from "../models/moduleAttemptModel";
import ModuleAssignment from "../models/moduleAssignmentModel";
import { errorHandler } from "../utils/errorHandler";
import { LONDON_TZ } from "../shared-types/constants";
import type {
  DashboardClientItem,
  DashboardScorePreview,
  DashboardAssignmentSummary,
  TherapistDashboardResponse,
} from "../shared-types/types";

// Severity thresholds by module title
const SEVERE_THRESHOLDS: Record<string, number> = {
  "PHQ-9": 15,
  "GAD-7": 10,
  PDSS: 9,
};

const getWeekBoundaries = (): { weekStart: Date; weekEnd: Date } => {
  const now = DateTime.now().setZone(LONDON_TZ);
  const mondayStart = now.startOf("week"); // Luxon weeks start on Monday
  const weekStart = mondayStart.toUTC().toJSDate();
  const weekEnd = mondayStart.plus({ weeks: 1 }).toUTC().toJSDate();
  return { weekStart, weekEnd };
};

export const getTherapistDashboard = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const therapistId = req.user?._id as Types.ObjectId;
    if (!therapistId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    // Verify therapist role
    const therapist = await User.findById(
      therapistId,
      "roles isVerifiedTherapist patients",
    );
    if (!therapist || !therapist.roles.includes(UserRole.THERAPIST)) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const patientIds: Types.ObjectId[] = therapist.patients ?? [];
    const totalClients = patientIds.length;

    if (totalClients === 0) {
      const { weekStart } = getWeekBoundaries();
      const emptyResponse: TherapistDashboardResponse = {
        weekStart: weekStart.toISOString(),
        stats: {
          totalClients: 0,
          needsAttention: 0,
          submittedThisWeek: 0,
          overdueAssignments: 0,
        },
        needsAttention: [],
        completedThisWeek: [],
        noActivity: [],
      };
      res.status(200).json(emptyResponse);
      return;
    }

    const { weekStart, weekEnd } = getWeekBoundaries();
    const now = new Date();

    // Fetch patients
    const patients = await User.find(
      { _id: { $in: patientIds } },
      "_id username email name",
    ).lean();

    const patientMap = new Map(patients.map((p) => [p._id.toString(), p]));

    // 1. All submitted attempts this week for these clients
    const weekAttempts = await ModuleAttempt.find({
      user: { $in: patientIds },
      status: "submitted",
      completedAt: { $gte: weekStart, $lt: weekEnd },
    })
      .populate("module", "_id title")
      .sort({ completedAt: -1 })
      .lean();

    // Group week attempts by patient
    const weekAttemptsByPatient = new Map<string, typeof weekAttempts>();
    for (const attempt of weekAttempts) {
      const uid = attempt.user.toString();
      const existing = weekAttemptsByPatient.get(uid) ?? [];
      existing.push(attempt);
      weekAttemptsByPatient.set(uid, existing);
    }

    // 2. Latest scored questionnaire attempt per client (across all time)
    const latestScoredPipeline = [
      {
        $match: {
          user: { $in: patientIds },
          status: "submitted",
          moduleType: "questionnaire",
          totalScore: { $exists: true, $ne: null },
        },
      },
      { $sort: { completedAt: -1 as const } },
      {
        $group: {
          _id: "$user",
          attemptId: { $first: "$_id" },
          module: { $first: "$module" },
          totalScore: { $first: "$totalScore" },
          scoreBandLabel: { $first: "$scoreBandLabel" },
          completedAt: { $first: "$completedAt" },
        },
      },
      {
        $lookup: {
          from: "modules",
          localField: "module",
          foreignField: "_id",
          as: "moduleInfo",
          pipeline: [{ $project: { _id: 1, title: 1 } }],
        },
      },
      { $addFields: { moduleInfo: { $first: "$moduleInfo" } } },
    ];

    const latestScoredResults =
      await ModuleAttempt.aggregate(latestScoredPipeline);

    const latestScoreByPatient = new Map<
      string,
      {
        moduleTitle: string;
        moduleId: string;
        score: number;
        scoreBandLabel: string;
        submittedAt: Date;
      }
    >();

    for (const row of latestScoredResults) {
      latestScoreByPatient.set(row._id.toString(), {
        moduleTitle: row.moduleInfo?.title ?? "Unknown",
        moduleId: (row.module as Types.ObjectId).toString(),
        score: row.totalScore,
        scoreBandLabel: row.scoreBandLabel ?? "",
        submittedAt: row.completedAt,
      });
    }

    // 3. Previous scored attempt per client+module (for delta)
    // For each client's latest scored module, get the second-most-recent attempt
    const previousScorePipeline = [
      {
        $match: {
          user: { $in: patientIds },
          status: "submitted",
          moduleType: "questionnaire",
          totalScore: { $exists: true, $ne: null },
        },
      },
      { $sort: { completedAt: -1 as const } },
      {
        $group: {
          _id: { user: "$user", module: "$module" },
          scores: {
            $push: { totalScore: "$totalScore", completedAt: "$completedAt" },
          },
        },
      },
      {
        // Keep only groups with at least 2 scores (so we have a previous)
        $match: { "scores.1": { $exists: true } },
      },
      {
        $project: {
          user: "$_id.user",
          module: "$_id.module",
          previousScore: { $arrayElemAt: ["$scores", 1] },
        },
      },
    ];

    const previousScoreResults = await ModuleAttempt.aggregate(
      previousScorePipeline,
    );

    // Map: patientId -> { moduleId -> previousScore }
    const previousScoreMap = new Map<string, Map<string, number>>();
    for (const row of previousScoreResults) {
      const uid = row.user.toString();
      const mid = row.module.toString();
      const existing = previousScoreMap.get(uid) ?? new Map<string, number>();
      existing.set(mid, row.previousScore.totalScore);
      previousScoreMap.set(uid, existing);
    }

    // 4. Active assignments per client
    const activeAssignments = await ModuleAssignment.find({
      user: { $in: patientIds },
      status: { $in: ["assigned", "in_progress"] },
    }).lean();

    // Also get completed assignments this week
    const completedAssignmentsThisWeek = await ModuleAssignment.find({
      user: { $in: patientIds },
      status: "completed",
      updatedAt: { $gte: weekStart, $lt: weekEnd },
    }).lean();

    // Group assignments by patient
    const assignmentsByPatient = new Map<
      string,
      {
        active: typeof activeAssignments;
        completedThisWeek: typeof completedAssignmentsThisWeek;
      }
    >();
    for (const a of activeAssignments) {
      const uid = a.user.toString();
      const existing = assignmentsByPatient.get(uid) ?? {
        active: [],
        completedThisWeek: [],
      };
      existing.active.push(a);
      assignmentsByPatient.set(uid, existing);
    }
    for (const a of completedAssignmentsThisWeek) {
      const uid = a.user.toString();
      const existing = assignmentsByPatient.get(uid) ?? {
        active: [],
        completedThisWeek: [],
      };
      existing.completedThisWeek.push(a);
      assignmentsByPatient.set(uid, existing);
    }

    // 5. Get last interaction per client (latest attempt of any kind)
    const lastActivePipeline = [
      {
        $match: {
          user: { $in: patientIds },
        },
      },
      { $sort: { lastInteractionAt: -1 as const } },
      {
        $group: {
          _id: "$user",
          lastInteractionAt: { $first: "$lastInteractionAt" },
        },
      },
    ];

    const lastActiveResults = await ModuleAttempt.aggregate(lastActivePipeline);
    const lastActiveByPatient = new Map<string, Date>();
    for (const row of lastActiveResults) {
      lastActiveByPatient.set(row._id.toString(), row.lastInteractionAt);
    }

    // 6. Build client items
    const needsAttention: DashboardClientItem[] = [];
    const completedThisWeek: DashboardClientItem[] = [];
    const noActivity: DashboardClientItem[] = [];
    let totalOverdueAssignments = 0;

    for (const patientId of patientIds) {
      const pid = patientId.toString();
      const patient = patientMap.get(pid);
      if (!patient) continue;

      // Latest score
      const latestScoreData = latestScoreByPatient.get(pid);
      let latestScore: DashboardScorePreview | null = null;
      let previousScore: { score: number } | null = null;

      if (latestScoreData) {
        // Get band label (use scoreBandLabel from attempt or cache)
        const bandLabel = latestScoreData.scoreBandLabel || "";

        latestScore = {
          moduleTitle: latestScoreData.moduleTitle,
          moduleId: latestScoreData.moduleId,
          score: latestScoreData.score,
          band: bandLabel,
          scoreBandLabel: bandLabel,
          submittedAt: latestScoreData.submittedAt.toISOString(),
        };

        // Previous score for delta
        const prevMap = previousScoreMap.get(pid);
        const prevScore = prevMap?.get(latestScoreData.moduleId);
        if (prevScore !== undefined) {
          previousScore = { score: prevScore };
        }
      }

      // Assignments
      const patientAssignments = assignmentsByPatient.get(pid) ?? {
        active: [],
        completedThisWeek: [],
      };
      const overdueCount = patientAssignments.active.filter(
        (a) => a.dueAt && new Date(a.dueAt) < now,
      ).length;
      totalOverdueAssignments += overdueCount;

      const assignments: DashboardAssignmentSummary = {
        total:
          patientAssignments.active.length +
          patientAssignments.completedThisWeek.length,
        completed: patientAssignments.completedThisWeek.length,
        overdue: overdueCount,
      };

      // Last active
      const lastActiveDate = lastActiveByPatient.get(pid);
      const lastActive = lastActiveDate ? lastActiveDate.toISOString() : null;

      // Reasons for attention
      const reasons: Array<"severe_score" | "worsening" | "overdue"> = [];

      // Check severe score
      if (latestScoreData) {
        const threshold = SEVERE_THRESHOLDS[latestScoreData.moduleTitle];
        if (threshold !== undefined && latestScoreData.score >= threshold) {
          reasons.push("severe_score");
        }
      }

      // Check worsening (score increased vs previous)
      if (
        latestScore &&
        previousScore &&
        latestScore.score > previousScore.score
      ) {
        reasons.push("worsening");
      }

      // Check overdue
      if (overdueCount > 0) {
        reasons.push("overdue");
      }

      const clientItem: DashboardClientItem = {
        patient: {
          _id: patient._id.toString(),
          username: patient.username,
          email: patient.email,
          name: patient.name,
        },
        latestScore,
        previousScore,
        assignments,
        lastActive,
        reasons,
      };

      // Week attempts for this patient
      const patientWeekAttempts = weekAttemptsByPatient.get(pid) ?? [];
      const submittedThisWeek = patientWeekAttempts.length > 0;

      if (reasons.length > 0) {
        needsAttention.push(clientItem);
      } else if (submittedThisWeek) {
        completedThisWeek.push(clientItem);
      } else {
        noActivity.push(clientItem);
      }
    }

    // Sort needsAttention: severe first, then overdue count desc, then last active desc
    needsAttention.sort((a, b) => {
      const aSevere = a.reasons.includes("severe_score") ? 1 : 0;
      const bSevere = b.reasons.includes("severe_score") ? 1 : 0;
      if (bSevere !== aSevere) return bSevere - aSevere;

      if (b.assignments.overdue !== a.assignments.overdue) {
        return b.assignments.overdue - a.assignments.overdue;
      }

      const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0;
      const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0;
      return bTime - aTime;
    });

    // Sort completedThisWeek: most recent submission first
    completedThisWeek.sort((a, b) => {
      const aTime = a.latestScore?.submittedAt
        ? new Date(a.latestScore.submittedAt).getTime()
        : 0;
      const bTime = b.latestScore?.submittedAt
        ? new Date(b.latestScore.submittedAt).getTime()
        : 0;
      return bTime - aTime;
    });

    // Sort noActivity: longest gap first (oldest lastActive first, nulls first)
    noActivity.sort((a, b) => {
      const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0;
      const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0;
      return aTime - bTime;
    });

    // Stats
    const submittedThisWeekCount = [...weekAttemptsByPatient.keys()].length;

    const response: TherapistDashboardResponse = {
      weekStart: weekStart.toISOString(),
      stats: {
        totalClients,
        needsAttention: needsAttention.length,
        submittedThisWeek: submittedThisWeekCount,
        overdueAssignments: totalOverdueAssignments,
      },
      needsAttention,
      completedThisWeek,
      noActivity,
    };

    res.status(200).json(response);
  } catch (error) {
    errorHandler(res, error);
  }
};
