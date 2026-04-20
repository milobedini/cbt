// src/utils/audit.ts
import type { Request } from "express";
import type { Types } from "mongoose";
import AdminAuditEvent from "../models/adminAuditEventModel";

type AuditedAction =
  | "therapist.verified"
  | "therapist.unverified"
  | "user.viewed"
  | "patient.attemptsViewed"
  | "module.created"
  | "admin.loggedIn";

type ResourceType =
  | "user"
  | "therapist"
  | "patient"
  | "module"
  | "attempt"
  | "system";

type LogParams = {
  action: AuditedAction;
  resourceType: ResourceType;
  resourceId: Types.ObjectId | string | null;
  outcome: "success" | "failure";
  context?: Record<string, unknown>;
};

export const logAdminAction = async (
  req: Request,
  params: LogParams,
): Promise<void> => {
  try {
    await AdminAuditEvent.create({
      actorId: req.user?._id,
      actorRole: "admin",
      impersonatorId: null,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      outcome: params.outcome,
      context: params.context,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      at: new Date(),
    });
  } catch (err) {
    console.error("logAdminAction failed", err);
    // Deliberately swallow — audit failures must not break the caller
  }
};
