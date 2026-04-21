import request from "supertest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "../test-utils/app";
import MetricsRollup from "../models/metricsRollupModel";
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

  it("programme outcomes reflect the most recent snapshot row, not a sum of buckets", async () => {
    const admin = await createUser({ role: "admin" });
    const programme = await createProgram("Depression");
    await createQuestionnaireModule({
      programId: programme._id,
      title: "PHQ-9",
      instrument: "phq9",
      clinicalCutoff: 10,
      reliableChangeDelta: 6,
    });

    // Older snapshot: 20% recovery (2/10)
    await MetricsRollup.create({
      metric: "recovery",
      dimension: {
        programmeId: programme._id,
        careTier: null,
        instrument: "phq9",
      },
      bucket: {
        granularity: "month",
        startsAt: new Date("2026-02-28T23:00:00Z"),
        endsAt: new Date("2026-03-31T23:00:00Z"),
      },
      numerator: 2,
      denominator: 10,
      n: 10,
      computedAt: new Date(),
      schemaVersion: 1,
    });
    // Newer snapshot: 50% recovery (5/10) — this is what /overview should read.
    await MetricsRollup.create({
      metric: "recovery",
      dimension: {
        programmeId: programme._id,
        careTier: null,
        instrument: "phq9",
      },
      bucket: {
        granularity: "month",
        startsAt: new Date("2026-03-31T23:00:00Z"),
        endsAt: new Date("2026-04-30T23:00:00Z"),
      },
      numerator: 5,
      denominator: 10,
      n: 10,
      computedAt: new Date(),
      schemaVersion: 1,
    });

    const res = await request(buildTestApp())
      .get("/api/admin/overview")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    const dep = res.body.programmes.find(
      (p: { title: string }) => p.title === "Depression",
    );
    expect(dep.outcomes.recovery.rate).toBeCloseTo(0.5, 2);
    expect(dep.outcomes.recovery.n).toBe(10);
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
