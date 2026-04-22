import type { Request, Response } from "express";
import ModuleAttempt from "../models/moduleAttemptModel";
import Module from "../models/moduleModel";
import User from "../models/userModel";
import { errorHandler } from "../utils/errorHandler";

const MODULE_TYPES = [
  "questionnaire",
  "reading",
  "activity_diary",
  "five_areas_model",
  "general_goals",
  "weekly_goals",
] as const;
type ModuleTypeLiteral = (typeof MODULE_TYPES)[number];

const STALLED_THRESHOLD_DAYS = 7;

export const getAdminStalledAttempts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { moduleType, cursor, limit } = req.query as Record<string, string>;
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const threshold = new Date(
      Date.now() - STALLED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
    );

    // pageFilter: base stalled definition + moduleType + cursor
    const pageFilter: Record<string, unknown> = {
      status: "started",
      lastInteractionAt: { $lt: threshold },
    };
    if (
      moduleType &&
      (MODULE_TYPES as readonly string[]).includes(moduleType)
    ) {
      pageFilter.moduleType = moduleType;
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        // oldest first; cursor advances forward through time
        pageFilter.lastInteractionAt = {
          $lt: threshold,
          $gt: cursorDate,
        };
      }
    }

    // facetFilter mirrors pageFilter but strips cursor + moduleType so the
    // count per module type is stable across scroll and across selections.
    const facetFilter: Record<string, unknown> = {
      status: "started",
      lastInteractionAt: { $lt: threshold },
    };

    const [rows, typeFacets] = await Promise.all([
      ModuleAttempt.find(pageFilter)
        .sort({ lastInteractionAt: 1, _id: 1 })
        .limit(lim + 1)
        .lean(),
      ModuleAttempt.aggregate<{
        _id: ModuleTypeLiteral;
        count: number;
      }>([
        { $match: facetFilter },
        { $group: { _id: "$moduleType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const hasMore = rows.length > lim;
    const slice = hasMore ? rows.slice(0, lim) : rows;

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
      const t = r.therapist
        ? therapistById.get(r.therapist.toString())
        : undefined;
      const m = moduleById.get(r.module.toString());
      return {
        attemptId: r._id.toString(),
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
        startedAt: r.startedAt.toISOString(),
        lastInteractionAt: r.lastInteractionAt.toISOString(),
      };
    });

    res.status(200).json({
      success: true,
      items,
      nextCursor: hasMore
        ? slice[slice.length - 1].lastInteractionAt.toISOString()
        : null,
      facets: {
        moduleTypes: typeFacets.map((f) => ({
          moduleType: f._id,
          count: f.count,
        })),
      },
    });
  } catch (error) {
    errorHandler(res, error);
  }
};
