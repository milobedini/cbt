import request from "supertest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "../test-utils/app";
import { createUser } from "../test-utils/factories";
import AdminAuditEvent from "../models/adminAuditEventModel";

const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "7d",
  });

describe("GET /api/admin/audit", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  it("returns events newest-first, paginated by cursor", async () => {
    const admin = await createUser({ role: "admin" });
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      await AdminAuditEvent.create({
        actorId: admin._id,
        actorRole: "admin",
        impersonatorId: null,
        action: "admin.loggedIn",
        resourceType: "system",
        resourceId: null,
        outcome: "success",
        at: new Date(now.getTime() - i * 1000),
      });
    }
    const res = await request(buildTestApp())
      .get("/api/admin/audit?limit=2")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
    expect(res.body.nextCursor).toBeTruthy();
  });

  it("returns actor facets with counts, independent of cursor and actor filter", async () => {
    const adminA = await createUser({ role: "admin" });
    const adminB = await createUser({ role: "admin" });
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      await AdminAuditEvent.create({
        actorId: adminA._id,
        actorRole: "admin",
        impersonatorId: null,
        action: "admin.loggedIn",
        resourceType: "system",
        resourceId: null,
        outcome: "success",
        at: new Date(now.getTime() - i * 1000),
      });
    }
    for (let i = 0; i < 2; i++) {
      await AdminAuditEvent.create({
        actorId: adminB._id,
        actorRole: "admin",
        impersonatorId: null,
        action: "admin.loggedIn",
        resourceType: "system",
        resourceId: null,
        outcome: "success",
        at: new Date(now.getTime() - (10 + i) * 1000),
      });
    }

    const res = await request(buildTestApp())
      .get(`/api/admin/audit?actorId=${adminA._id.toString()}&limit=2`)
      .set("Cookie", [`token=${signToken(adminA._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.events.every((e: { actorId: string }) =>
      e.actorId === adminA._id.toString(),
    )).toBe(true);
    expect(res.body.facets.actors).toHaveLength(2);

    const byId = new Map<string, { count: number }>(
      res.body.facets.actors.map((a: { _id: string; count: number }) => [
        a._id,
        a,
      ]),
    );
    expect(byId.get(adminA._id.toString())?.count).toBe(3);
    expect(byId.get(adminB._id.toString())?.count).toBe(2);
  });

  it("narrows facets to the active action filter", async () => {
    const admin = await createUser({ role: "admin" });
    const now = new Date();
    await AdminAuditEvent.create({
      actorId: admin._id,
      actorRole: "admin",
      impersonatorId: null,
      action: "admin.loggedIn",
      resourceType: "system",
      resourceId: null,
      outcome: "success",
      at: now,
    });
    await AdminAuditEvent.create({
      actorId: admin._id,
      actorRole: "admin",
      impersonatorId: null,
      action: "therapist.verified",
      resourceType: "user",
      resourceId: null,
      outcome: "success",
      at: new Date(now.getTime() - 1000),
    });

    const res = await request(buildTestApp())
      .get("/api/admin/audit?action=therapist.verified")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.facets.actors).toHaveLength(1);
    expect(res.body.facets.actors[0]._id).toBe(admin._id.toString());
    expect(res.body.facets.actors[0].count).toBe(1);
  });
});
