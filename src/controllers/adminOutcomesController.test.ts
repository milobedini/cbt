import request from "supertest";
import jwt from "jsonwebtoken";
import { buildTestApp } from "../test-utils/app";
import { createUser } from "../test-utils/factories";
import MetricsRollup from "../models/metricsRollupModel";

const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "7d",
  });

describe("GET /api/admin/outcomes", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  it("returns populated time-axis with suppressed cells when no rollup data exists", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(buildTestApp())
      .get("/api/admin/outcomes?instrument=phq9&granularity=month")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(res.status).toBe(200);
    expect(res.body.dimension.instrument).toBe("phq9");
    // Default range = last 12 months; every bucket suppressed with n=0
    expect(res.body.series.length).toBeGreaterThan(0);
    for (const b of res.body.series) {
      expect(b.recovery).toEqual({
        rate: null,
        n: 0,
        suppressed: true,
        reason: "below_k",
      });
    }
  });

  it("400s on missing instrument", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(buildTestApp())
      .get("/api/admin/outcomes")
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);
    expect(res.status).toBe(400);
  });

  it("returns series from rollup rows", async () => {
    const admin = await createUser({ role: "admin" });
    const bucket = {
      granularity: "month" as const,
      startsAt: new Date("2026-03-01T00:00:00Z"),
      endsAt: new Date("2026-04-01T00:00:00Z"),
    };
    await MetricsRollup.create({
      metric: "recovery",
      dimension: { programmeId: null, careTier: null, instrument: "phq9" },
      bucket,
      numerator: 15,
      denominator: 30,
      n: 30,
      computedAt: new Date(),
      schemaVersion: 1,
    });
    // Override thresholds so 30 is above min
    process.env.K_ANONYMITY_THRESHOLD = "1";
    process.env.METRICS_MIN_N_FOR_DISPLAY = "1";

    const from = "2026-03-01T00:00:00Z";
    const to = "2026-04-30T00:00:00Z";
    const res = await request(buildTestApp())
      .get(
        `/api/admin/outcomes?instrument=phq9&granularity=month&from=${from}&to=${to}`,
      )
      .set("Cookie", [`token=${signToken(admin._id.toString())}`]);

    expect(res.status).toBe(200);
    expect(res.body.series.length).toBe(2); // March + April
    const march = res.body.series[0];
    expect(march.recovery.rate).toBeCloseTo(0.5);
    expect(march.recovery.suppressed).toBe(false);
    // April has no data → zero-denominator bucket
    expect(res.body.series[1].recovery.n).toBe(0);
    expect(res.body.series[1].recovery.suppressed).toBe(true);
  });
});
