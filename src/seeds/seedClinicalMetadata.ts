import mongoose from "mongoose";
import dotenv from "dotenv";
import Module from "../models/moduleModel";
import User from "../models/userModel";

dotenv.config();

type ClinicalRow = {
  titleMatch: RegExp;
  instrument: "phq9" | "gad7" | "pdss";
  cutoff: number;
  delta: number | null;
};

const CLINICAL_ROWS: ClinicalRow[] = [
  { titleMatch: /phq[-\s]?9/i, instrument: "phq9", cutoff: 10, delta: 6 },
  { titleMatch: /gad[-\s]?7/i, instrument: "gad7", cutoff: 8, delta: 4 },
  { titleMatch: /pdss/i, instrument: "pdss", cutoff: 8, delta: null },
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI as string);

  // 1. Module clinical metadata
  for (const row of CLINICAL_ROWS) {
    const modules = await Module.find({
      type: "questionnaire",
      title: row.titleMatch,
    });
    for (const mod of modules) {
      mod.instrument = row.instrument;
      mod.clinicalCutoff = row.cutoff;
      if (row.delta !== null) mod.reliableChangeDelta = row.delta;
      await mod.save();
      console.log(
        `✔ ${mod.title} → ${row.instrument} (cutoff ${row.cutoff}, delta ${row.delta ?? "n/a"})`,
      );
    }
  }

  // 2. Therapist tier backfill
  const res = await User.updateMany(
    {
      roles: "therapist",
      isVerifiedTherapist: true,
      therapistTier: { $exists: false },
    },
    { $set: { therapistTier: "cbt" } },
  );
  console.log(
    `✔ Backfilled therapistTier='cbt' on ${res.modifiedCount} verified therapists`,
  );

  await mongoose.connection.close();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
