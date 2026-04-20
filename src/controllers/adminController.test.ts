import request from "supertest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "../test-utils/app";
import {
  createUser,
  createProgram,
  createQuestionnaireModule,
  createAttempt,
} from "../test-utils/factories";

const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "7d",
  });

describe("GET /api/admin/overview", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  it("403s for non-admin", async () => {
    const u = await createUser({ role: "patient" });
    const res = await request(buildTestApp())
      .get("/api/admin/overview")
      .set("Cookie", [`token=${signToken(u._id.toString())}`]);
    expect(res.status).toBe(403);
  });

  it("returns populated overview shape for admin", async () => {
    const admin = await createUser({ role: "admin" });
    const programme = await createProgram("Depression");
    const phq9 = await createQuestionnaireModule({
      programId: programme._id,
      title: "PHQ-9",
      instrument: "phq9",
      clinicalCutoff: 10,
      reliableChangeDelta: 6,
    });
    const patient = await createUser({ role: "patient" });
    await createAttempt({
      userId: patient._id,
      programId: programme._id,
      moduleId: phq9._id,
      totalScore: 12,
      completedAt: new Date(),
    });

    const res = await request(buildTestApp())
      .get("/api/admin/overview")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.asOf).toBeDefined();
    expect(res.body.privacyMode).toMatch(/production|reduced/);
    expect(res.body.operational.users.total).toBeGreaterThanOrEqual(2);
    expect(
      res.body.operational.work.completedAttemptsLast7d,
    ).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.programmes)).toBe(true);
    expect(res.body.verificationQueue).toEqual({
      count: expect.any(Number),
      oldest: expect.any(Array),
    });
  });
});
