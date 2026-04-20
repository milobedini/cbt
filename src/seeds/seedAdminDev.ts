// src/seeds/seedAdminDev.ts
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

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI as string);

  const depression = await Program.findOne({ title: /depression/i });
  const gad = await Program.findOne({ title: /anxiety/i });
  const phq9 = await Module.findOne({ instrument: "phq9" });
  const gad7 = await Module.findOne({ instrument: "gad7" });
  if (!depression || !gad || !phq9 || !gad7) {
    console.error(
      "Missing Depression/GAD programme or PHQ-9/GAD-7 modules. Run seed-all + seed:clinical-metadata first.",
    );
    process.exit(1);
  }

  // 3 therapists
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

  // 30 patients: 10 self-help, 10 CBT, 10 PWP
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

  // 8 weekly attempts per patient per instrument
  const now = new Date();
  for (const p of patients) {
    const baselinePHQ = rand(12, 22);
    const baselineGAD = rand(10, 18);
    // 40% reach recovery (cross threshold in last attempt)
    const willRecover = Math.random() < 0.4;

    for (let w = 0; w < 8; w++) {
      const completedAt = new Date(
        now.getTime() -
          (8 - w) * 7 * 24 * 60 * 60 * 1000 +
          rand(0, 6 * 3600 * 1000),
      );
      const progression = willRecover
        ? baselinePHQ * (1 - (w + 1) / 9)
        : baselinePHQ - rand(0, 3);
      const phqScore = Math.max(0, Math.round(progression + rand(-2, 2)));
      const gadScore = Math.max(
        0,
        Math.round(baselineGAD - (willRecover ? w * 1.2 : rand(0, 2))),
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
      }
    }
  }

  console.log(
    `✔ seeded ${therapists.length} therapists, ${patients.length} patients, ~${patients.length * 8 * 2} attempts`,
  );
  await mongoose.connection.close();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
