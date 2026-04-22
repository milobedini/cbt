import type { Request, Response } from "express";
import ModuleAssignment from "../models/moduleAssignmentModel";
import Module from "../models/moduleModel";
import User from "../models/userModel";
import { errorHandler } from "../utils/errorHandler";

type OrphanReason = "therapist_unverified" | "therapist_missing";

export const getAdminOrphanedAssignments = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { reason, cursor, limit } = req.query as Record<string, string>;
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));

    // Verified-therapist set defines the "not orphaned" group.
    const verifiedTherapistIds = (
      await User.find(
        { roles: "therapist", isVerifiedTherapist: true },
        { _id: 1 },
      ).lean()
    ).map((u) => u._id);

    // Base page filter: assignments pointing to a therapist who is not in
    // the verified set. Matches the /overview orphaned count exactly.
    const basePageFilter: Record<string, unknown> = {
      therapist: { $exists: true, $ne: null, $nin: verifiedTherapistIds },
    };

    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        basePageFilter.createdAt = { $lt: cursorDate };
      }
    }

    // Facet count per reason doesn't depend on cursor; derived below from
    // the unfiltered (reason-less) base set.
    const baseFacetFilter = {
      therapist: { $exists: true, $ne: null, $nin: verifiedTherapistIds },
    };

    // Reason filter narrows the page but not the facets. To apply it we need
    // the set of unverified therapist ids (so `therapist_unverified` matches
    // therapists who exist-and-are-unverified; the rest = missing).
    const unverifiedTherapistIds = (
      await User.find(
        { roles: "therapist", isVerifiedTherapist: false },
        { _id: 1 },
      ).lean()
    ).map((u) => u._id);

    const pageFilter: Record<string, unknown> = { ...basePageFilter };
    if (reason === "therapist_unverified") {
      pageFilter.therapist = { $in: unverifiedTherapistIds };
    } else if (reason === "therapist_missing") {
      pageFilter.therapist = {
        $exists: true,
        $ne: null,
        $nin: [...verifiedTherapistIds, ...unverifiedTherapistIds],
      };
    }

    const [rows, unverifiedCount, totalOrphaned] = await Promise.all([
      ModuleAssignment.find(pageFilter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(lim + 1)
        .lean(),
      ModuleAssignment.countDocuments({
        therapist: { $in: unverifiedTherapistIds },
      }),
      ModuleAssignment.countDocuments(baseFacetFilter),
    ]);

    const missingCount = Math.max(0, totalOrphaned - unverifiedCount);

    const hasMore = rows.length > lim;
    const slice = hasMore ? rows.slice(0, lim) : rows;

    const unverifiedSet = new Set(
      unverifiedTherapistIds.map((id) => id.toString()),
    );

    const userIds = new Set<string>();
    const therapistIds = new Set<string>();
    const moduleIds = new Set<string>();
    for (const r of slice) {
      userIds.add(r.user.toString());
      if (r.therapist) therapistIds.add(r.therapist.toString());
      moduleIds.add(r.module.toString());
    }

    const [users, therapists, modules] = await Promise.all([
      User.find(
        { _id: { $in: Array.from(userIds) } },
        { _id: 1, username: 1, name: 1 },
      ).lean(),
      User.find(
        { _id: { $in: Array.from(therapistIds) } },
        { _id: 1, username: 1, name: 1, isVerifiedTherapist: 1 },
      ).lean(),
      Module.find(
        { _id: { $in: Array.from(moduleIds) } },
        { _id: 1, title: 1 },
      ).lean(),
    ]);

    const userById = new Map(users.map((u) => [u._id.toString(), u]));
    const therapistById = new Map(therapists.map((t) => [t._id.toString(), t]));
    const moduleById = new Map(modules.map((m) => [m._id.toString(), m]));

    const items = slice.map((r) => {
      const u = userById.get(r.user.toString());
      const tIdStr = r.therapist ? r.therapist.toString() : null;
      const t = tIdStr ? therapistById.get(tIdStr) : undefined;
      const m = moduleById.get(r.module.toString());
      const rowReason: OrphanReason = t
        ? "therapist_unverified"
        : tIdStr && unverifiedSet.has(tIdStr)
          ? "therapist_unverified"
          : "therapist_missing";
      return {
        assignmentId: r._id.toString(),
        moduleType: r.moduleType,
        module: {
          _id: r.module.toString(),
          title: m?.title ?? "Unknown module",
        },
        user: u
          ? { _id: u._id.toString(), username: u.username, name: u.name }
          : { _id: r.user.toString(), username: "unknown" },
        therapist: t
          ? {
              _id: t._id.toString(),
              username: t.username,
              name: t.name,
              isVerifiedTherapist: Boolean(t.isVerifiedTherapist),
            }
          : null,
        reason: rowReason,
        status: r.status,
        assignedAt: r.createdAt.toISOString(),
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      };
    });

    res.status(200).json({
      success: true,
      items,
      nextCursor: hasMore
        ? slice[slice.length - 1].createdAt.toISOString()
        : null,
      facets: {
        reasons: [
          { reason: "therapist_unverified", count: unverifiedCount },
          { reason: "therapist_missing", count: missingCount },
        ].filter((r) => r.count > 0),
      },
    });
  } catch (error) {
    errorHandler(res, error);
  }
};
