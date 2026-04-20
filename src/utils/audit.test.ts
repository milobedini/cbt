// src/utils/audit.test.ts
import { logAdminAction } from "./audit";
import AdminAuditEvent from "../models/adminAuditEventModel";
import type { Request } from "express";
import mongoose from "mongoose";

const fakeReq = (userId: string, opts: Partial<Request> = {}): Request =>
  ({
    user: { _id: new mongoose.Types.ObjectId(userId) },
    ip: "127.0.0.1",
    get: (h: string) => (h === "user-agent" ? "jest" : undefined),
    ...opts,
  }) as unknown as Request;

describe("logAdminAction", () => {
  it("writes an AdminAuditEvent with the expected shape", async () => {
    const actorId = new mongoose.Types.ObjectId().toString();
    const resourceId = new mongoose.Types.ObjectId();

    await logAdminAction(fakeReq(actorId), {
      action: "therapist.verified",
      resourceType: "therapist",
      resourceId,
      outcome: "success",
      context: { therapistTier: "cbt" },
    });

    const events = await AdminAuditEvent.find({});
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      actorRole: "admin",
      impersonatorId: null,
      action: "therapist.verified",
      resourceType: "therapist",
      outcome: "success",
      context: { therapistTier: "cbt" },
      ip: "127.0.0.1",
      userAgent: "jest",
    });
  });

  it("accepts null resourceId for system events", async () => {
    const actorId = new mongoose.Types.ObjectId().toString();
    await logAdminAction(fakeReq(actorId), {
      action: "admin.loggedIn",
      resourceType: "system",
      resourceId: null,
      outcome: "success",
    });
    const events = await AdminAuditEvent.find({});
    expect(events[0].resourceId).toBeNull();
  });
});
