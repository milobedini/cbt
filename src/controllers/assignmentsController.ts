import { Request, Response } from "express";
import { Types } from "mongoose";
import ModuleAssignment from "../models/moduleAssignmentModel";
import ModuleAttempt from "../models/moduleAttemptModel";
import User from "../models/userModel";
import Module from "../models/moduleModel";
import { errorHandler } from "../utils/errorHandler";
import { computePercentCompleteForAttempt } from "./attemptsController";

export const createAssignment = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId;

    const { userId, moduleId, dueAt, notes, recurrence } = req.body;
    const mod = await Module.findById(moduleId);
    if (!mod) {
      res.status(404).json({ success: false, message: "Module not found" });
      return;
    }

    // Access denied if not your client:
    const user = await User.findById(userId);
    if (!user || user?.therapist?.toString() !== therapistId.toString()) {
      res
        .status(403)
        .json({ success: false, message: "You are not this user's therapist" });
      return;
    }

    // Do not create if the user already has an active assignment for the same module
    const existingAssignment = await ModuleAssignment.findOne({
      user: userId,
      module: mod._id,
      status: { $in: ["assigned", "in_progress"] },
    });
    if (existingAssignment) {
      res.status(409).json({
        success: false,
        message: "User already has an active assignment for this module",
      });
      return;
    }

    const asg = await ModuleAssignment.create({
      user: userId,
      therapist: therapistId,
      program: mod.program,
      module: mod._id,
      moduleType: mod.type,
      status: "assigned",
      dueAt: dueAt ? new Date(dueAt) : undefined,
      recurrence,
      notes,
    });

    res.status(201).json({ success: true, assignment: asg });
  } catch (error) {
    errorHandler(res, error);
  }
};

const getUrgencyWeight = (dueAt: Date | undefined | null): number => {
  if (!dueAt) return 3;
  const now = new Date();
  if (dueAt < now) return 0;
  if (dueAt <= new Date(now.getTime() + 48 * 60 * 60 * 1000)) return 1;
  return 2;
};

export const listAssignmentsForTherapist = async (
  req: Request,
  res: Response,
) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId;

    const {
      patientId,
      moduleId,
      status,
      urgency,
      sortBy = "urgency",
      page = "1",
      limit = "20",
    } = req.query as {
      patientId?: string;
      moduleId?: string;
      status?: string;
      urgency?: string;
      sortBy?: string;
      page?: string;
      limit?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));

    // Base filter: always scoped to this therapist and active statuses
    const filter: Record<string, unknown> = {
      therapist: therapistId,
      status: { $in: ["assigned", "in_progress"] },
    };

    // Apply optional filters
    if (patientId) {
      filter["user"] = new Types.ObjectId(patientId);
    }
    if (moduleId) {
      filter["module"] = new Types.ObjectId(moduleId);
    }
    // Override status filter if explicitly requested
    if (status && ["assigned", "in_progress"].includes(status)) {
      filter["status"] = status;
    }

    // Urgency filter against dueAt
    if (urgency) {
      const now = new Date();
      const soon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      if (urgency === "overdue") {
        filter["dueAt"] = { $lt: now };
      } else if (urgency === "due_soon") {
        filter["dueAt"] = { $gte: now, $lte: soon };
      } else if (urgency === "on_track") {
        filter["dueAt"] = { $gt: soon };
      } else if (urgency === "no_due_date") {
        filter["$and"] = [{ $or: [{ dueAt: { $exists: false } }, { dueAt: null }] }];
      }
    }

    const totalItems = await ModuleAssignment.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limitNum);

    const rawItems = await ModuleAssignment.find(filter)
      .sort({ user: 1, dueAt: 1 })
      .populate("user", "_id username email name")
      .populate("module", "_id title type")
      .populate("program", "_id title")
      .populate(
        "latestAttempt",
        "_id status completedAt totalScore scoreBandLabel",
      )
      .lean();

    // Compute attempt counts per user+module pair using aggregation
    const userModulePairs = rawItems.map((a) => ({
      user: a.user as unknown as Types.ObjectId,
      module: a.module as unknown as Types.ObjectId,
    }));

    const attemptCounts =
      userModulePairs.length > 0
        ? await ModuleAttempt.aggregate<{
            _id: { user: string; module: string };
            count: number;
          }>([
            {
              $match: {
                $or: userModulePairs.map((p) => ({
                  user:
                    typeof p.user === "object" && "_id" in p.user
                      ? (p.user as unknown as { _id: Types.ObjectId })._id
                      : p.user,
                  module:
                    typeof p.module === "object" && "_id" in p.module
                      ? (p.module as unknown as { _id: Types.ObjectId })._id
                      : p.module,
                })),
              },
            },
            {
              $group: {
                _id: { user: "$user", module: "$module" },
                count: { $sum: 1 },
              },
            },
          ])
        : [];

    const attemptCountMap = new Map<string, number>();
    attemptCounts.forEach((entry) => {
      const key = `${entry._id.user}_${entry._id.module}`;
      attemptCountMap.set(key, entry.count);
    });

    // Attach attemptCount to each item
    const itemsWithCount = rawItems.map((a) => {
      const userId =
        typeof a.user === "object" && a.user !== null && "_id" in a.user
          ? String((a.user as { _id: unknown })._id)
          : String(a.user);
      const modId =
        typeof a.module === "object" && a.module !== null && "_id" in a.module
          ? String((a.module as { _id: unknown })._id)
          : String(a.module);
      const attemptCount = attemptCountMap.get(`${userId}_${modId}`) ?? 0;
      return { ...a, attemptCount };
    });

    // Sort by patient grouping then by the requested sort within each group
    const grouped = new Map<string, typeof itemsWithCount>();
    itemsWithCount.forEach((a) => {
      const userId =
        typeof a.user === "object" && a.user !== null && "_id" in a.user
          ? String((a.user as { _id: unknown })._id)
          : String(a.user);
      if (!grouped.has(userId)) grouped.set(userId, []);
      grouped.get(userId)!.push(a);
    });

    // Sort within each patient group
    grouped.forEach((assignments) => {
      assignments.sort((a, b) => {
        if (sortBy === "newest") {
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        }
        if (sortBy === "oldest") {
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        }
        if (sortBy === "module") {
          const aTitle =
            typeof a.module === "object" &&
            a.module !== null &&
            "title" in a.module
              ? String((a.module as { title: unknown }).title)
              : "";
          const bTitle =
            typeof b.module === "object" &&
            b.module !== null &&
            "title" in b.module
              ? String((b.module as { title: unknown }).title)
              : "";
          return aTitle.localeCompare(bTitle);
        }
        // Default: urgency
        return getUrgencyWeight(a.dueAt) - getUrgencyWeight(b.dueAt);
      });
    });

    // Sort groups themselves by their most urgent assignment (or patient name for 'module')
    const sortedGroups = Array.from(grouped.entries()).sort(
      ([, aGroup], [, bGroup]) => {
        const repA = aGroup[0];
        const repB = bGroup[0];
        if (sortBy === "module") {
          // Sort groups by patient name alphabetically
          const aName =
            typeof repA.user === "object" &&
            repA.user !== null &&
            "name" in repA.user
              ? String((repA.user as { name: unknown }).name)
              : "";
          const bName =
            typeof repB.user === "object" &&
            repB.user !== null &&
            "name" in repB.user
              ? String((repB.user as { name: unknown }).name)
              : "";
          return aName.localeCompare(bName);
        }
        if (sortBy === "newest") {
          return (
            new Date(repB.createdAt).getTime() -
            new Date(repA.createdAt).getTime()
          );
        }
        if (sortBy === "oldest") {
          return (
            new Date(repA.createdAt).getTime() -
            new Date(repB.createdAt).getTime()
          );
        }
        // Default: urgency — sort groups by their most urgent item
        return getUrgencyWeight(repA.dueAt) - getUrgencyWeight(repB.dueAt);
      },
    );

    // Flatten back to a list and paginate
    const flat = sortedGroups.flatMap(([, assignments]) => assignments);
    const start = (pageNum - 1) * limitNum;
    const items = flat.slice(start, start + limitNum);

    res
      .status(200)
      .json({ success: true, items, page: pageNum, totalPages, totalItems });
  } catch (error) {
    errorHandler(res, error);
  }
};

const VALID_ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const updateAssignment = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId;

    const { assignmentId } = req.params;
    const { status, dueAt, notes, recurrence } = req.body as {
      status?: string;
      dueAt?: string | null;
      notes?: string;
      recurrence?: { freq: string; interval?: number };
    };

    // Validate status only if it was provided
    if (
      status !== undefined &&
      !VALID_ASSIGNMENT_STATUSES.includes(
        status as (typeof VALID_ASSIGNMENT_STATUSES)[number],
      )
    ) {
      res.status(400).json({
        success: false,
        message: `status must be one of: ${VALID_ASSIGNMENT_STATUSES.join(", ")}`,
      });
      return;
    }

    const updateSet: Record<string, unknown> = {};
    const updateUnset: Record<string, unknown> = {};

    if (status !== undefined) updateSet["status"] = status;
    if (notes !== undefined) updateSet["notes"] = notes;
    if (recurrence !== undefined) updateSet["recurrence"] = recurrence;

    if (dueAt === null) {
      // Explicitly remove the dueAt field
      updateUnset["dueAt"] = "";
    } else if (dueAt !== undefined) {
      updateSet["dueAt"] = new Date(dueAt);
    }

    if (
      Object.keys(updateSet).length === 0 &&
      Object.keys(updateUnset).length === 0
    ) {
      res.status(400).json({
        success: false,
        message: "No fields provided to update",
      });
      return;
    }

    const updateOp: Record<string, unknown> = {};
    if (Object.keys(updateSet).length > 0) updateOp["$set"] = updateSet;
    if (Object.keys(updateUnset).length > 0) updateOp["$unset"] = updateUnset;

    const asg = await ModuleAssignment.findOneAndUpdate(
      { _id: assignmentId, therapist: therapistId },
      updateOp,
      { new: true },
    );
    if (!asg) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }
    res.status(200).json({ success: true, assignment: asg });
  } catch (error) {
    errorHandler(res, error);
  }
};

/** @deprecated Use updateAssignment instead */
export const updateAssignmentStatus = updateAssignment;

export const getMyAssignments = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const { status = "active" } = req.query as {
      status?: "active" | "completed" | "all";
    };
    const statuses =
      status === "active"
        ? ["assigned", "in_progress"]
        : status === "completed"
          ? ["completed"]
          : ["assigned", "in_progress", "completed", "cancelled"];

    const items = await ModuleAssignment.find({
      user: userId,
      status: { $in: statuses },
    })
      .sort({ dueAt: 1, createdAt: -1 })
      .populate("module", "_id title type accessPolicy")
      .populate("program", "_id title description")
      .populate(
        "latestAttempt",
        [
          "_id",
          "status",
          "completedAt",
          "totalScore",
          "scoreBandLabel",
          "answers",
          "moduleSnapshot.questions",
          // ⬇️ include required diary fields
          "diaryEntries.at",
          "diaryEntries.activity",
          "diaryEntries.mood",
          "diaryEntries.achievement",
          "diaryEntries.closeness",
          "diaryEntries.enjoyment",
          "moduleType",
          "startedAt",
          "lastInteractionAt",
        ].join(" "),
      )
      .populate("therapist", "name")
      .lean();

    const assignments = items.map((asg) => {
      const la = asg.latestAttempt as unknown as
        | Parameters<typeof computePercentCompleteForAttempt>[0]
        | undefined;
      const percentComplete =
        asg.status === "completed"
          ? 100
          : la
            ? computePercentCompleteForAttempt(la)
            : 0;
      return { ...asg, percentComplete };
    });

    res.status(200).json({ success: true, assignments });
  } catch (error) {
    errorHandler(res, error);
  }
};

export const removeAssignment = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId;

    const { assignmentId } = req.params;

    const asg = await ModuleAssignment.findOneAndDelete({
      _id: assignmentId,
      therapist: therapistId,
    });
    if (!asg) {
      res.status(404).json({ success: false, message: "Assignment not found" });
      return;
    }
    res
      .status(200)
      .json({ success: true, message: "Assignment removed successfully" });
  } catch (error) {
    errorHandler(res, error);
  }
};
