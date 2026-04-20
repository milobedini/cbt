import mongoose from "mongoose";
import dotenv from "dotenv";
import { runNightlyRollup } from "./rollupMetrics";

dotenv.config();

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI as string);
  await runNightlyRollup();
  await mongoose.connection.close();
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
