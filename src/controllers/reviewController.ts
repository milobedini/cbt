import type { Request, Response } from "express";
import { Types } from "mongoose";
import ModuleAssignment from "../models/moduleAssignmentModel";
import ModuleAttempt from "../models/moduleAttemptModel";
import User from "../models/userModel";
import { errorHandler } from "../utils/errorHandler";
import { assignmentToPracticeItem } from "../utils/practiceUtils";
import type {
  AttentionPriority,
  AttentionReason,
  ReviewItem,
} from "../shared-types/types";

const SEVERE_LABELS = ["Severe", "Moderately Severe"];
const ATTENTION_CAP = 20;

// Lower rank = more severe (sorted ascending). Matches FE severity color mapping.
const SEVERITY_PATTERNS: { pattern: RegExp; rank: number }[] = [
  { pattern: /severe|high/i, rank: 0 },
  { pattern: /moderate/i, rank: 1 },
  { pattern: /mild|minimal|low|subthreshold/i, rank: 2 },
];

const severityRank = (label?: string): number => {
  if (!label) return 99; // no score → least severe
  const match = SEVERITY_PATTERNS.find((s) => s.pattern.test(label));
  return match?.rank ?? 3;
};

const POPULATE_FIELDS = [
  { path: "module", select: "_id title type accessPolicy" },
  { path: "program", select: "_id title" },
  { path: "therapist", select: "name" },
  {
    path: "latestAttempt",
    select: [
      "_id",
      "status",
      "completedAt",
      "totalScore",
      "scoreBandLabel",
      "answers",
      "moduleSnapshot.questions",
      "diaryEntries.at",
      "diaryEntries.activity",
      "diaryEntries.mood",
      "diaryEntries.achievement",
      "diaryEntries.closeness",
      "diaryEntries.enjoyment",
      "moduleType",
      "startedAt",
      "lastInteractionAt",
      "iteration",
    ].join(" "),
  },
];

/**
 * Group items by their date bucket (same logic the FE uses) and sort
 * within each group by totalScore descending, then reassemble in order.
 */
const sortWithinDateGroups = (items: ReviewItem[]): ReviewItem[] => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const dow = today.getDay() || 7;
  const thisWeekStart = new Date(today.getTime() - (dow - 1) * 86_400_000);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const getBucket = (dateStr?: string): string => {
    if (!dateStr) return "unknown";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "unknown";
    if (d >= today) return "today";
    if (d >= yesterday) return "yesterday";
    if (d >= thisWeekStart) return "this-week";
    if (d >= lastWeekStart) return "last-week";
    if (d >= thisMonthStart) return "this-month";
    return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
  };

  // Group items into buckets preserving bucket order
  const bucketOrder: string[] = [];
  const buckets = new Map<string, ReviewItem[]>();
  for (const item of items) {
    const key = getBucket(item.latestAttempt?.completedAt);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      bucketOrder.push(key);
    }
    buckets.get(key)!.push(item);
  }

  // Sort within each bucket by clinical severity (band label), not raw score
  const result: ReviewItem[] = [];
  for (const key of bucketOrder) {
    const group = buckets.get(key)!;
    group.sort(
      (a, b) =>
        severityRank(a.latestAttempt?.scoreBandLabel) -
        severityRank(b.latestAttempt?.scoreBandLabel),
    );
    result.push(...group);
  }
  return result;
};

/**
 * GET /api/user/therapist/review
 * Therapist review feed with needs attention and paginated submissions.
 */
export const getTherapistReview = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId;
    if (!therapistId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const {
      sort = "newest",
      patientId,
      moduleId,
      severity,
      dateFrom,
      dateTo,
      cursor,
      limit: limitStr,
    } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(limitStr) || 20, 50);

    // Get therapist's patients
    const therapist = await User.findById(therapistId, "patients").lean();
    const patientIds: Types.ObjectId[] = (therapist?.patients ?? []).map(
      (p: any) => new Types.ObjectId(p.toString()),
    );

    if (patientIds.length === 0) {
      res.status(200).json({
        success: true,
        needsAttention: [],
        submissions: { items: [], nextCursor: null, total: 0 },
      });
      return;
    }

    // Needs Attention
    const needsAttention = await computeNeedsAttention(therapistId, patientIds);

    // All Submissions (paginated)
    const submissionMatch: Record<string, any> = {
      user: { $in: patientId ? [new Types.ObjectId(patientId)] : patientIds },
      status: "completed",
    };
    if (moduleId) submissionMatch["module"] = new Types.ObjectId(moduleId);
    if (dateFrom || dateTo) {
      submissionMatch["completedAt"] = {};
      if (dateFrom) submissionMatch["completedAt"]["$gte"] = new Date(dateFrom);
      if (dateTo) submissionMatch["completedAt"]["$lte"] = new Date(dateTo);
    }
    if (cursor) {
      submissionMatch["completedAt"] = {
        ...(submissionMatch["completedAt"] ?? {}),
        ...(sort === "oldest"
          ? { $gt: new Date(cursor) }
          : { $lt: new Date(cursor) }),
      };
    }

    // For severity sort, fetch by date then re-sort within date groups by score.
    // For newest/oldest, sort by completedAt directly.
    const sortDir = sort === "oldest" ? 1 : -1;
    const dbSortField = { completedAt: sortDir };

    const submissions = await ModuleAssignment.find(submissionMatch)
      .sort(dbSortField as any)
      .limit(limit + 1)
      .populate(POPULATE_FIELDS)
      .populate("user", "_id name username email")
      .lean();

    const hasNext = submissions.length > limit;
    const page = hasNext ? submissions.slice(0, limit) : submissions;

    let submissionItems: ReviewItem[] = page.map((asg) => {
      const base = assignmentToPracticeItem({ ...asg, attemptCount: 0 });
      const userObj = asg.user as any;
      return {
        ...base,
        patientId: userObj?._id?.toString() ?? "",
        patientName: userObj?.name ?? userObj?.username ?? "",
      };
    });

    // For severity sort, re-sort within date groups by totalScore descending
    if (sort === "severity") {
      submissionItems = sortWithinDateGroups(submissionItems);
    }

    // Severity filter (post-query for simplicity)
    const filteredItems = severity
      ? submissionItems.filter((item) => {
          const band = item.latestAttempt?.scoreBandLabel?.toLowerCase() ?? "";
          if (severity === "severe")
            return band === "severe" || band === "moderately severe";
          if (severity === "moderate") return band === "moderate";
          if (severity === "mild") return band === "mild";
          return true;
        })
      : submissionItems;

    const countMatch: Record<string, any> = {
      user: { $in: patientId ? [new Types.ObjectId(patientId)] : patientIds },
      status: "completed",
    };
    if (moduleId) countMatch["module"] = new Types.ObjectId(moduleId);
    if (dateFrom || dateTo) {
      countMatch["completedAt"] = {};
      if (dateFrom) countMatch["completedAt"]["$gte"] = new Date(dateFrom);
      if (dateTo) countMatch["completedAt"]["$lte"] = new Date(dateTo);
    }
    const total = await ModuleAssignment.countDocuments(countMatch);

    const nextCursor =
      hasNext && page.length > 0
        ? (page[page.length - 1] as any).completedAt?.toISOString()
        : null;

    // When severity is applied post-query, the DB total is inaccurate —
    // signal this by omitting total so the FE uses the items count instead.
    const effectiveTotal = severity ? undefined : total;

    res.status(200).json({
      success: true,
      needsAttention,
      submissions: {
        items: filteredItems,
        nextCursor,
        total: effectiveTotal ?? filteredItems.length,
      },
    });
  } catch (error) {
    errorHandler(res, error);
  }
};

/**
 * Compute the "Needs Attention" list for a therapist's patients.
 */
const computeNeedsAttention = async (
  therapistId: Types.ObjectId,
  patientIds: Types.ObjectId[],
): Promise<ReviewItem[]> => {
  const items: (ReviewItem & { _sortPriority: number; _sortDate: Date })[] = [];

  // 1. Severe scores
  const severeAttempts = await ModuleAttempt.find({
    user: { $in: patientIds },
    status: "submitted",
    scoreBandLabel: { $in: SEVERE_LABELS },
  })
    .sort({ completedAt: -1 })
    .limit(ATTENTION_CAP)
    .populate("user", "_id name username")
    .populate("module", "_id title type")
    .lean();

  for (const att of severeAttempts) {
    const userObj = att.user as any;
    items.push({
      assignmentId: "",
      moduleId: (att.module as any)?._id?.toString() ?? "",
      moduleTitle: (att.module as any)?.title ?? "",
      moduleType: att.moduleType,
      programTitle: "",
      source: "therapist",
      status: "completed",
      percentComplete: 100,
      attemptCount: 0,
      latestAttempt: {
        attemptId: att._id.toString(),
        status: att.status,
        totalScore: att.totalScore ?? undefined,
        scoreBandLabel: att.scoreBandLabel ?? undefined,
        completedAt: att.completedAt?.toISOString(),
        iteration: att.iteration ?? 1,
      },
      patientId: userObj?._id?.toString() ?? "",
      patientName: userObj?.name ?? userObj?.username ?? "",
      attentionReason: "severe_score" as AttentionReason,
      attentionPriority: "high" as AttentionPriority,
      _sortPriority: 0,
      _sortDate: att.completedAt ?? new Date(),
    });
  }

  // 2. Score regression
  const regressions = await ModuleAttempt.aggregate([
    {
      $match: {
        user: { $in: patientIds },
        status: "submitted",
        moduleType: "questionnaire",
        totalScore: { $ne: null },
      },
    },
    { $sort: { completedAt: -1 } },
    {
      $group: {
        _id: { user: "$user", module: "$module" },
        scores: {
          $push: {
            score: "$totalScore",
            completedAt: "$completedAt",
            attemptId: "$_id",
          },
        },
      },
    },
    {
      $project: {
        latest: { $arrayElemAt: ["$scores", 0] },
        previous: { $arrayElemAt: ["$scores", 1] },
      },
    },
    {
      $match: {
        previous: { $ne: null },
        $expr: { $gt: ["$latest.score", "$previous.score"] },
      },
    },
  ]);

  for (const reg of regressions) {
    const attemptId = reg.latest.attemptId.toString();
    if (items.some((i) => i.latestAttempt?.attemptId === attemptId)) continue;

    const att = await ModuleAttempt.findById(reg.latest.attemptId)
      .populate("user", "_id name username")
      .populate("module", "_id title type")
      .lean();
    if (!att) continue;

    const userObj = att.user as any;
    items.push({
      assignmentId: "",
      moduleId: (att.module as any)?._id?.toString() ?? "",
      moduleTitle: (att.module as any)?.title ?? "",
      moduleType: att.moduleType,
      programTitle: "",
      source: "therapist",
      status: "completed",
      percentComplete: 100,
      attemptCount: 0,
      latestAttempt: {
        attemptId: att._id.toString(),
        status: att.status,
        totalScore: att.totalScore ?? undefined,
        scoreBandLabel: att.scoreBandLabel ?? undefined,
        completedAt: att.completedAt?.toISOString(),
        iteration: att.iteration ?? 1,
      },
      patientId: userObj?._id?.toString() ?? "",
      patientName: userObj?.name ?? userObj?.username ?? "",
      attentionReason: "score_regression" as AttentionReason,
      attentionPriority: "high" as AttentionPriority,
      _sortPriority: 0,
      _sortDate: att.completedAt ?? new Date(),
    });
  }

  // 3. Overdue + not started (2+ days past due)
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const overdueAssignments = await ModuleAssignment.find({
    user: { $in: patientIds },
    therapist: therapistId,
    status: "assigned",
    dueAt: { $lt: twoDaysAgo },
  })
    .limit(ATTENTION_CAP)
    .populate("module", "_id title type")
    .populate("user", "_id name username")
    .populate("program", "_id title")
    .lean();

  for (const asg of overdueAssignments) {
    const userObj = asg.user as any;
    items.push({
      assignmentId: asg._id.toString(),
      moduleId: (asg.module as any)?._id?.toString() ?? "",
      moduleTitle: (asg.module as any)?.title ?? "",
      moduleType: asg.moduleType,
      programTitle: (asg.program as any)?.title ?? "",
      source: (asg as any).source ?? "therapist",
      status: "not_started",
      dueAt: asg.dueAt?.toISOString(),
      percentComplete: 0,
      attemptCount: 0,
      patientId: userObj?._id?.toString() ?? "",
      patientName: userObj?.name ?? userObj?.username ?? "",
      attentionReason: "overdue" as AttentionReason,
      attentionPriority: "medium" as AttentionPriority,
      _sortPriority: 1,
      _sortDate: asg.dueAt ?? new Date(),
    });
  }

  // 4. First submission
  const firstSubmissions = await ModuleAttempt.aggregate([
    { $match: { user: { $in: patientIds }, status: "submitted" } },
    {
      $group: {
        _id: "$user",
        count: { $sum: 1 },
        latest: { $first: "$$ROOT" },
      },
    },
    { $match: { count: 1 } },
  ]);

  for (const fs of firstSubmissions) {
    const att = fs.latest;
    const attemptId = att._id.toString();
    if (items.some((i) => i.latestAttempt?.attemptId === attemptId)) continue;

    const userDoc = await User.findById(fs._id, "_id name username").lean();
    if (!userDoc) continue;
    const modDoc = await ModuleAttempt.findById(att._id)
      .populate("module", "_id title type")
      .lean();
    if (!modDoc) continue;

    items.push({
      assignmentId: "",
      moduleId: (modDoc.module as any)?._id?.toString() ?? "",
      moduleTitle: (modDoc.module as any)?.title ?? "",
      moduleType: att.moduleType,
      programTitle: "",
      source: "therapist",
      status: "completed",
      percentComplete: 100,
      attemptCount: 1,
      latestAttempt: {
        attemptId: att._id.toString(),
        status: att.status,
        totalScore: att.totalScore ?? undefined,
        scoreBandLabel: att.scoreBandLabel ?? undefined,
        completedAt: att.completedAt?.toISOString(),
        iteration: att.iteration ?? 1,
      },
      patientId: userDoc._id.toString(),
      patientName: (userDoc as any).name ?? (userDoc as any).username ?? "",
      attentionReason: "first_submission" as AttentionReason,
      attentionPriority: "low" as AttentionPriority,
      _sortPriority: 2,
      _sortDate: att.completedAt ?? new Date(),
    });
  }

  // Sort: priority asc, then date desc. Cap at ATTENTION_CAP.
  items.sort((a, b) => {
    if (a._sortPriority !== b._sortPriority)
      return a._sortPriority - b._sortPriority;
    return b._sortDate.getTime() - a._sortDate.getTime();
  });

  // Strip internal sort fields and cap
  return items
    .slice(0, ATTENTION_CAP)
    .map(({ _sortPriority, _sortDate, ...rest }) => rest);
};
