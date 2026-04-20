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
});
