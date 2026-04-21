// src/seeds/seedAdminDev.ts
//
// Dev-only admin-dashboard dataset. Creates 3 therapists + 30 patients with
// ~12 months of staggered PHQ-9 + GAD-7 attempts so the admin dashboard's
// trailing-90d snapshots produce a meaningful year-over-year trend.
//
// Each patient has a "lifecycle":
//  - active:    joined recently, still submitting weekly up to this week.
//  - recovered: completed a full recovery arc, stopped submitting after the
//               scores crossed the clinical cutoff.
//  - stable:    long-term in-treatment; scores hover around baseline with
//               noise.
//  - dropout:   submitted for a few weeks then stopped (common IAPT pattern).
//
// Distribution and timing parameters are explicit constants at the top so
// you can tune the dataset shape without re-reading the arithmetic.

import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import User from "../models/userModel";
import Program from "../models/programModel";
import Module from "../models/moduleModel";
import ModuleAttempt from "../models/moduleAttemptModel";

dotenv.config();

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run dev seed in production");
  process.exit(1);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_JOIN_WEEKS_AGO = 52;
const MIN_JOIN_WEEKS_AGO = 4;

type Lifecycle = "active" | "recovered" | "stable" | "dropout";

// Lifecycle distribution (must sum to 1.0)
const LIFECYCLE_WEIGHTS: Record<Lifecycle, number> = {
  active: 0.45, // 45% — still in active treatment, recent submissions
  recovered: 0.25, // 25% — crossed threshold, stopped submitting
  stable: 0.2, // 20% — long-term in-treatment, flat-ish scores
  dropout: 0.1, // 10% — short-lived engagement then silence
};

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pickLifecycle = (): Lifecycle => {
  const r = Math.random();
  let acc = 0;
  for (const [key, w] of Object.entries(LIFECYCLE_WEIGHTS) as [
    Lifecycle,
    number,
  ][]) {
    acc += w;
    if (r < acc) return key;
  }
  return "active";
};

type Trajectory = {
  startWeeksAgo: number; // when the patient joined (weeks ago)
  lastActiveWeeksAgo: number; // 0 = still submitting this week
  baselinePHQ: number; // initial PHQ-9 score
  baselineGAD: number; // initial GAD-7 score
  lifecycle: Lifecycle;
};

const buildTrajectory = (): Trajectory => {
  const lifecycle = pickLifecycle();
  const baselinePHQ = rand(14, 22); // always above PHQ-9 cutoff (10)
  const baselineGAD = rand(10, 18); // always above GAD-7 cutoff (8)

  let startWeeksAgo: number;
  let lastActiveWeeksAgo: number;

  switch (lifecycle) {
    case "active":
      startWeeksAgo = rand(4, 16);
      lastActiveWeeksAgo = rand(0, 2);
      break;
    case "recovered":
      startWeeksAgo = rand(16, 44);
      // they stopped submitting some time after recovering
      lastActiveWeeksAgo = rand(2, Math.max(3, startWeeksAgo - 10));
      break;
    case "stable":
      startWeeksAgo = rand(12, 36);
      lastActiveWeeksAgo = rand(0, 4);
      break;
    case "dropout":
      startWeeksAgo = rand(8, MAX_JOIN_WEEKS_AGO);
      // dropped out relatively early: 3-8 weeks after starting
      lastActiveWeeksAgo = Math.max(1, startWeeksAgo - rand(3, 8));
      break;
  }

  return {
    lifecycle,
    startWeeksAgo,
    lastActiveWeeksAgo,
    baselinePHQ,
    baselineGAD,
  };
};

// For a given trajectory and instrument baseline, produce the score at week
// index `w` (0 = first attempt). Weeks count forward from the patient's
// join date. `totalWeeks` is how many attempts they produced overall.
const scoreAtWeek = (
  baseline: number,
  w: number,
  totalWeeks: number,
  lifecycle: Lifecycle,
  instrument: "phq9" | "gad7",
): number => {
  const floorPHQ = 3;
  const floorGAD = 2;
  const floor = instrument === "phq9" ? floorPHQ : floorGAD;

  let progression: number;

  switch (lifecycle) {
    case "active":
      // Gentle downward drift — partial recovery over time.
      progression = baseline - ((baseline - floor) * w) / Math.max(totalWeeks, 8);
      break;
    case "recovered":
      // Full recovery arc — linear descent to floor by the last week.
      progression =
        baseline +
        ((floor - baseline) * w) / Math.max(totalWeeks - 1, 1);
      break;
    case "stable":
      // Near baseline with mild improvement.
      progression = baseline - Math.min(3, w * 0.15);
      break;
    case "dropout":
      // Flat around baseline.
      progression = baseline;
      break;
  }

  const noise = rand(-2, 2);
  return Math.max(0, Math.round(progression + noise));
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI as string);

  const depression = await Program.findOne({ title: /depression/i });
  const gad = await Program.findOne({ title: /anxiety/i });
  const phq9 = await Module.findOne({ instrument: "phq9" });
  const gad7 = await Module.findOne({ instrument: "gad7" });
  if (!depression || !gad || !phq9 || !gad7) {
    console.error(
      "Missing Depression/GAD programme or PHQ-9/GAD-7 modules. Run seed:baseline + seed:clinical-metadata first (or `npm run seed:all`).",
    );
    process.exit(1);
  }

  // 3 therapists — 2 CBT, 1 PWP so every care tier gets data.
  const therapists = await Promise.all(
    ["cbt", "pwp", "cbt"].map(async (tier, i) =>
      User.create({
        username: `dev_ther_${i}`,
        email: `dev_ther_${i}@test.bwell`,
        password: await bcrypt.hash("devpass1234", 10),
        roles: ["therapist"],
        isVerifiedTherapist: true,
        therapistTier: tier,
      }),
    ),
  );

  // 30 patients: 10 self-help, 10 CBT, 10 PWP.
  const patients = await Promise.all(
    Array.from({ length: 30 }).map(async (_, i) => {
      const assignment = i < 10 ? null : i < 20 ? therapists[0] : therapists[1];
      return User.create({
        username: `dev_pat_${i}`,
        email: `dev_pat_${i}@test.bwell`,
        password: await bcrypt.hash("devpass1234", 10),
        roles: ["patient"],
        therapist: assignment?._id,
      });
    }),
  );

  const nowMs = Date.now();
  const lifecycleTally: Record<Lifecycle, number> = {
    active: 0,
    recovered: 0,
    stable: 0,
    dropout: 0,
  };
  let attemptsWritten = 0;

  for (const p of patients) {
    const trajectory = buildTrajectory();
    lifecycleTally[trajectory.lifecycle]++;

    const totalWeeks =
      trajectory.startWeeksAgo - trajectory.lastActiveWeeksAgo + 1;
    if (totalWeeks < 2) continue; // paranoid guard — buildTrajectory should prevent this

    for (let w = 0; w < totalWeeks; w++) {
      const weeksAgo = trajectory.startWeeksAgo - w;
      const completedAt = new Date(
        nowMs - weeksAgo * WEEK_MS + rand(0, 6 * HOUR_MS),
      );
      const phqScore = scoreAtWeek(
        trajectory.baselinePHQ,
        w,
        totalWeeks,
        trajectory.lifecycle,
        "phq9",
      );
      const gadScore = scoreAtWeek(
        trajectory.baselineGAD,
        w,
        totalWeeks,
        trajectory.lifecycle,
        "gad7",
      );

      for (const [mod, score, prog] of [
        [phq9, phqScore, depression._id],
        [gad7, gadScore, gad._id],
      ] as const) {
        await ModuleAttempt.create({
          user: p._id,
          therapist: p.therapist,
          program: prog,
          module: mod._id,
          moduleType: "questionnaire",
          status: "submitted",
          startedAt: completedAt,
          completedAt,
          lastInteractionAt: completedAt,
          totalScore: score,
        });
        attemptsWritten++;
      }
    }
  }

  console.log(
    `✔ seeded ${therapists.length} therapists, ${patients.length} patients, ${attemptsWritten} attempts across ~12 months`,
  );
  console.log(`  lifecycle mix: ${JSON.stringify(lifecycleTally)}`);
  console.log(
    `  next step: run \`npm run rollup-metrics:backfill\` to populate historical snapshots`,
  );
  await mongoose.connection.close();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
