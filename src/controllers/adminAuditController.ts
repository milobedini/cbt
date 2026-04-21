import type { Request, Response } from "express";
import mongoose from "mongoose";
import AdminAuditEvent from "../models/adminAuditEventModel";
import User from "../models/userModel";
import { errorHandler } from "../utils/errorHandler";

export const getAdminAudit = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { actorId, action, resourceType, resourceId, cursor, limit } =
      req.query as Record<string, string>;
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));

    // Filter used to paginate the events list (includes actor + cursor).
    const pageFilter: Record<string, unknown> = {};
    if (actorId && mongoose.Types.ObjectId.isValid(actorId))
      pageFilter.actorId = new mongoose.Types.ObjectId(actorId);
    if (action) pageFilter.action = action;
    if (resourceType) pageFilter.resourceType = resourceType;
    if (resourceId && mongoose.Types.ObjectId.isValid(resourceId))
      pageFilter.resourceId = new mongoose.Types.ObjectId(resourceId);
    if (cursor) pageFilter.at = { $lt: new Date(cursor) };

    // Facet filter mirrors pageFilter but without cursor (paginating should
    // not shift facets) and without the actor filter itself (so the actor
    // list shows every eligible actor even when one is selected).
    const facetFilter: Record<string, unknown> = {};
    if (action) facetFilter.action = action;
    if (resourceType) facetFilter.resourceType = resourceType;
    if (resourceId && mongoose.Types.ObjectId.isValid(resourceId))
      facetFilter.resourceId = new mongoose.Types.ObjectId(resourceId);

    const [rows, actorFacets] = await Promise.all([
      AdminAuditEvent.find(pageFilter).sort({ at: -1 }).limit(lim + 1).lean(),
      AdminAuditEvent.aggregate<{
        _id: mongoose.Types.ObjectId;
        count: number;
      }>([
        { $match: facetFilter },
        { $group: { _id: "$actorId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
    ]);

    const hasMore = rows.length > lim;
    const slice = hasMore ? rows.slice(0, lim) : rows;

    const allActorIds = new Set<string>();
    for (const e of slice) allActorIds.add(e.actorId.toString());
    for (const f of actorFacets) allActorIds.add(f._id.toString());

    const actors = await User.find(
      { _id: { $in: Array.from(allActorIds) } },
      { _id: 1, username: 1, name: 1 },
    ).lean();
    const actorById = new Map(actors.map((a) => [a._id.toString(), a]));

    const events = slice.map((e) => {
      const a = actorById.get(e.actorId.toString());
      return {
        _id: e._id.toString(),
        actorId: e.actorId.toString(),
        actor: a
          ? { _id: a._id.toString(), username: a.username, name: a.name }
          : { _id: e.actorId.toString(), username: "unknown" },
        actorRole: e.actorRole,
        impersonatorId: e.impersonatorId ? e.impersonatorId.toString() : null,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId ? e.resourceId.toString() : null,
        outcome: e.outcome,
        context: e.context,
        ip: e.ip,
        userAgent: e.userAgent,
        at: e.at.toISOString(),
      };
    });

    const actorFacetRows = actorFacets.map((f) => {
      const a = actorById.get(f._id.toString());
      return {
        _id: f._id.toString(),
        username: a?.username ?? "unknown",
        name: a?.name,
        count: f.count,
      };
    });

    res.status(200).json({
      success: true,
      events,
      nextCursor: hasMore ? slice[slice.length - 1].at.toISOString() : null,
      facets: { actors: actorFacetRows },
    });
  } catch (error) {
    errorHandler(res, error);
  }
};
