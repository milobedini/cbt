import mongoose from "mongoose";
import type { CareTier, Instrument, MetricName } from "../shared-types/types";
import Module from "../models/moduleModel";
import ModuleAttempt from "../models/moduleAttemptModel";
import User from "../models/userModel";
import MetricsRollup from "../models/metricsRollupModel";
import JobRun from "../models/jobRunModel";
import { computeIaptMetrics } from "../utils/iaptPairing";
import { deriveCareTier } from "../utils/careTier";
import { weekBucket, monthBucket } from "../utils/londonBuckets";
import { DateTime } from "luxon";

type Bucket = {
  granularity: "week" | "month";
  startsAt: Date;
  endsAt: Date;
};

type ClinicalModule = {
  _id: mongoose.Types.ObjectId;
  instrument: Instrument;
  clinicalCutoff: number;
  reliableChangeDelta: number | null;
  programme: mongoose.Types.ObjectId;
};

const CARE_TIERS: CareTier[] = ["self_help", "cbt_guided", "pwp_guided"];

const upsertRollup = async (
  metric: MetricName,
  programmeId: mongoose.Types.ObjectId | null,
  careTier: CareTier | null,
  instrument: Instrument,
  bucket: Bucket,
  counts: { numerator: number; denominator: number },
) => {
  await MetricsRollup.updateOne(
    {
      metric,
      "dimension.programmeId": programmeId,
      "dimension.careTier": careTier,
      "dimension.instrument": instrument,
      "bucket.granularity": bucket.granularity,
      "bucket.startsAt": bucket.startsAt,
    },
    {
      $set: {
        metric,
        dimension: { programmeId, careTier, instrument },
        bucket,
        numerator: counts.numerator,
        denominator: counts.denominator,
        n: counts.denominator,
        computedAt: new Date(),
        schemaVersion: 1,
      },
    },
    { upsert: true },
  );
};

export const runRollupForBucket = async (bucket: Bucket): Promise<number> => {
  // 1. Load all clinical modules
  const modules = (await Module.find(
    { instrument: { $ne: null } },
    {
      _id: 1,
      instrument: 1,
      clinicalCutoff: 1,
      reliableChangeDelta: 1,
      program: 1,
    },
  ).lean()) as unknown as Array<{
    _id: mongoose.Types.ObjectId;
    instrument: Instrument;
    clinicalCutoff: number;
    reliableChangeDelta?: number | null;
    program: mongoose.Types.ObjectId;
  }>;
  let rowsWritten = 0;

  // 2. Therapist tier lookup (current tier, as per §5.3)
  const therapists = (await User.find(
    { roles: "therapist" },
    { _id: 1, therapistTier: 1 },
  ).lean()) as unknown as Array<{
    _id: mongoose.Types.ObjectId;
    therapistTier?: "cbt" | "pwp";
  }>;
  const tierLookup: Record<string, "cbt" | "pwp" | undefined> = {};
  for (const t of therapists) tierLookup[t._id.toString()] = t.therapistTier;

  // 3. Pull every submitted questionnaire attempt in the bucket whose module has an instrument
  const moduleIds = modules.map((m) => m._id);
  const attempts = (await ModuleAttempt.find(
    {
      status: "submitted",
      moduleType: "questionnaire",
      module: { $in: moduleIds },
      completedAt: { $gte: bucket.startsAt, $lt: bucket.endsAt },
    },
    {
      user: 1,
      therapist: 1,
      program: 1,
      module: 1,
      totalScore: 1,
      completedAt: 1,
    },
  ).lean()) as unknown as Array<{
    user: mongoose.Types.ObjectId;
    therapist?: mongoose.Types.ObjectId;
    program: mongoose.Types.ObjectId;
    module: mongoose.Types.ObjectId;
    totalScore: number;
    completedAt: Date;
  }>;

  // 4. Index modules by id for fast lookup
  const moduleById = new Map<string, ClinicalModule>();
  for (const m of modules) {
    moduleById.set(m._id.toString(), {
      _id: m._id,
      instrument: m.instrument,
      clinicalCutoff: m.clinicalCutoff,
      reliableChangeDelta: m.reliableChangeDelta ?? null,
      programme: m.program,
    });
  }

  // 5. For each dimension combo, filter attempts + compute + upsert
  // Dimensions: (programmeId | null) × (careTier | null) × instrument
  const programmes = Array.from(
    new Set(modules.map((m) => m.program.toString())),
  );
  const instruments = Array.from(new Set(modules.map((m) => m.instrument)));

  type DimKey = {
    programmeId: mongoose.Types.ObjectId | null;
    careTier: CareTier | null;
    instrument: Instrument;
  };
  const dimensions: DimKey[] = [];
  for (const instrument of instruments) {
    dimensions.push({ programmeId: null, careTier: null, instrument });
    for (const tier of CARE_TIERS) {
      dimensions.push({ programmeId: null, careTier: tier, instrument });
    }
    for (const pId of programmes) {
      const pObj = new mongoose.Types.ObjectId(pId);
      dimensions.push({ programmeId: pObj, careTier: null, instrument });
      for (const tier of CARE_TIERS) {
        dimensions.push({ programmeId: pObj, careTier: tier, instrument });
      }
    }
  }

  for (const dim of dimensions) {
    // Filter attempts for this dimension
    const filtered = attempts.filter((a) => {
      const mod = moduleById.get(a.module.toString());
      if (!mod || mod.instrument !== dim.instrument) return false;
      if (dim.programmeId && !mod.programme.equals(dim.programmeId))
        return false;
      if (dim.careTier) {
        const derived = deriveCareTier({
          attemptTherapistId: a.therapist ? a.therapist.toString() : null,
          therapistTierLookup: tierLookup,
        });
        if (derived !== dim.careTier) return false;
      }
      return true;
    });
    if (filtered.length === 0) continue;

    // Pick any matching module's clinical def for this instrument
    const anyMod = modules.find((m) => m.instrument === dim.instrument);
    if (!anyMod) continue;
    const def = {
      instrument: anyMod.instrument,
      clinicalCutoff: anyMod.clinicalCutoff,
      reliableChangeDelta: anyMod.reliableChangeDelta ?? null,
    };

    const metrics = computeIaptMetrics(
      filtered.map((a) => ({
        userId: a.user.toString(),
        completedAt: a.completedAt,
        totalScore: a.totalScore,
      })),
      def,
    );

    if (metrics.recovery.denominator > 0) {
      await upsertRollup(
        "recovery",
        dim.programmeId,
        dim.careTier,
        dim.instrument,
        bucket,
        metrics.recovery,
      );
      rowsWritten++;
    }
    if (
      metrics.reliableImprovement &&
      metrics.reliableImprovement.denominator > 0
    ) {
      await upsertRollup(
        "reliable_improvement",
        dim.programmeId,
        dim.careTier,
        dim.instrument,
        bucket,
        metrics.reliableImprovement,
      );
      rowsWritten++;
    }
    if (metrics.reliableRecovery && metrics.reliableRecovery.denominator > 0) {
      await upsertRollup(
        "reliable_recovery",
        dim.programmeId,
        dim.careTier,
        dim.instrument,
        bucket,
        metrics.reliableRecovery,
      );
      rowsWritten++;
    }
  }

  return rowsWritten;
};

export const runNightlyRollup = async (
  now: Date = new Date(),
): Promise<void> => {
  const run = await JobRun.create({
    job: "rollupMetrics",
    startedAt: now,
    status: "success",
  });
  let rowsWritten = 0;
  const failures: Array<{ dimension: string; message: string }> = [];

  try {
    // 1. Current week bucket
    const thisWeek = weekBucket(now);
    rowsWritten += await runRollupForBucket(thisWeek);
    // 2. Previous week bucket (closed)
    const prevWeek = weekBucket(new Date(thisWeek.startsAt.getTime() - 1000));
    rowsWritten += await runRollupForBucket(prevWeek);
    // 3. Month buckets — current + just-closed if first run of month
    const thisMonth = monthBucket(now);
    rowsWritten += await runRollupForBucket(thisMonth);
    // If today is the 1st London-local, previous month is just closed — run it
    const londonDay = DateTime.fromJSDate(now, { zone: "Europe/London" }).day;
    if (londonDay === 1) {
      const prevMonth = monthBucket(
        new Date(thisMonth.startsAt.getTime() - 1000),
      );
      rowsWritten += await runRollupForBucket(prevMonth);
    }
  } catch (err) {
    failures.push({ dimension: "run", message: (err as Error).message });
  }

  await JobRun.updateOne(
    { _id: run._id },
    {
      $set: {
        completedAt: new Date(),
        status: failures.length ? "partial" : "success",
        rowsWritten,
        failures,
      },
    },
  );
};
