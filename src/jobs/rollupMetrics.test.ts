import { runRollupForBucket } from "./rollupMetrics";
import MetricsRollup from "../models/metricsRollupModel";
import {
  createUser,
  createProgram,
  createQuestionnaireModule,
  createAttempt,
} from "../test-utils/factories";

describe("rollupMetrics (integration)", () => {
  it("writes platform-wide, per-programme, and per-careTier rollups for PHQ-9", async () => {
    const programme = await createProgram("Depression");
    const phq9 = await createQuestionnaireModule({
      programId: programme._id,
      title: "PHQ-9",
      instrument: "phq9",
      clinicalCutoff: 10,
      reliableChangeDelta: 6,
    });
    const therapist = await createUser({
      role: "therapist",
      therapistTier: "cbt",
      isVerifiedTherapist: true,
    });
    const patient = await createUser({ therapist: therapist._id });
    await createAttempt({
      userId: patient._id,
      therapistId: therapist._id,
      programId: programme._id,
      moduleId: phq9._id,
      totalScore: 15,
      completedAt: new Date("2026-04-06T10:00:00Z"),
    });
    await createAttempt({
      userId: patient._id,
      therapistId: therapist._id,
      programId: programme._id,
      moduleId: phq9._id,
      totalScore: 4,
      completedAt: new Date("2026-04-10T10:00:00Z"),
    });

    const bucket = {
      granularity: "week" as const,
      startsAt: new Date("2026-04-05T23:00:00Z"), // Monday 00:00 London
      endsAt: new Date("2026-04-12T23:00:00Z"),
    };

    await runRollupForBucket(bucket);

    const platform = await MetricsRollup.findOne({
      metric: "recovery",
      "dimension.programmeId": null,
      "dimension.careTier": null,
      "dimension.instrument": "phq9",
    });
    expect(platform?.numerator).toBe(1);
    expect(platform?.denominator).toBe(1);

    const byProgramme = await MetricsRollup.findOne({
      metric: "recovery",
      "dimension.programmeId": programme._id,
      "dimension.careTier": null,
      "dimension.instrument": "phq9",
    });
    expect(byProgramme?.numerator).toBe(1);

    const byCbt = await MetricsRollup.findOne({
      metric: "recovery",
      "dimension.programmeId": programme._id,
      "dimension.careTier": "cbt_guided",
      "dimension.instrument": "phq9",
    });
    expect(byCbt?.numerator).toBe(1);
  });

  it("is idempotent: running twice yields one row per unique key", async () => {
    const programme = await createProgram("Depression");
    const phq9 = await createQuestionnaireModule({
      programId: programme._id,
      title: "PHQ-9",
      instrument: "phq9",
      clinicalCutoff: 10,
      reliableChangeDelta: 6,
    });
    const patient = await createUser({});
    await createAttempt({
      userId: patient._id,
      programId: programme._id,
      moduleId: phq9._id,
      totalScore: 15,
      completedAt: new Date("2026-04-06T10:00:00Z"),
    });
    await createAttempt({
      userId: patient._id,
      programId: programme._id,
      moduleId: phq9._id,
      totalScore: 5,
      completedAt: new Date("2026-04-10T10:00:00Z"),
    });

    const bucket = {
      granularity: "week" as const,
      startsAt: new Date("2026-04-05T23:00:00Z"),
      endsAt: new Date("2026-04-12T23:00:00Z"),
    };
    await runRollupForBucket(bucket);
    await runRollupForBucket(bucket);

    const all = await MetricsRollup.find({ "dimension.instrument": "phq9" });
    // Expected combos per metric: platform, per-programme, platform×self_help, programme×self_help
    // metrics: recovery + reliable_improvement + reliable_recovery = 3
    // => 4 combos × 3 metrics = 12 rows (no tier-aggregated row when only one tier present → still 4 combos)
    expect(all.length).toBe(12);
  });
});
