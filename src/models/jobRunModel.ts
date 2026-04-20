import mongoose, { Document, Schema } from "mongoose";

type JobStatus = "success" | "partial" | "failure";

interface IJobError {
  dimension: string;
  message: string;
}

type IJobRun = Document & {
  job: string;
  startedAt: Date;
  completedAt: Date | null;
  status: JobStatus;
  rowsWritten: number;
  failures: IJobError[];
};

const JobErrorSchema = new Schema(
  {
    dimension: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false },
);

const JobRunSchema = new Schema(
  {
    job: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["success", "partial", "failure"],
      required: true,
    },
    rowsWritten: { type: Number, default: 0 },
    failures: { type: [JobErrorSchema], default: [] },
  },
  { collection: "jobRuns" },
);

JobRunSchema.index({ job: 1, startedAt: -1 });

const JobRun = mongoose.model<IJobRun>("JobRun", JobRunSchema);
export default JobRun;
export type { IJobRun };
