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

    const filter: Record<string, unknown> = {};
    if (actorId && mongoose.Types.ObjectId.isValid(actorId))
      filter.actorId = new mongoose.Types.ObjectId(actorId);
    if (action) filter.action = action;
    if (resourceType) filter.resourceType = resourceType;
    if (resourceId && mongoose.Types.ObjectId.isValid(resourceId))
      filter.resourceId = new mongoose.Types.ObjectId(resourceId);
    if (cursor) filter.at = { $lt: new Date(cursor) };

    const rows = await AdminAuditEvent.find(filter)
      .sort({ at: -1 })
      .limit(lim + 1)
      .lean();
    const hasMore = rows.length > lim;
    const slice = hasMore ? rows.slice(0, lim) : rows;

    const actorIds = Array.from(
      new Set(slice.map((e) => e.actorId.toString())),
    );
    const actors = await User.find(
      { _id: { $in: actorIds } },
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

    res.status(200).json({
      success: true,
      events,
      nextCursor: hasMore ? slice[slice.length - 1].at.toISOString() : null,
    });
  } catch (error) {
    errorHandler(res, error);
  }
};
