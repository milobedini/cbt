import mongoose, { Document, Schema, Types } from "mongoose";

export type MetricName =
  | "recovery"
  | "reliable_improvement"
  | "reliable_recovery";
export type CareTier = "self_help" | "cbt_guided" | "pwp_guided";
export type Instrument = "phq9" | "gad7" | "pdss";
export type Granularity = "week" | "month";

type IMetricsRollup = Document & {
  metric: MetricName;
  dimension: {
    programmeId: Types.ObjectId | null;
    careTier: CareTier | null;
    instrument: Instrument;
  };
  bucket: {
    granularity: Granularity;
    startsAt: Date;
    endsAt: Date;
  };
  numerator: number;
  denominator: number;
  n: number;
  computedAt: Date;
  schemaVersion: number;
};

const MetricsRollupSchema = new Schema<IMetricsRollup>(
  {
    metric: {
      type: String,
      enum: ["recovery", "reliable_improvement", "reliable_recovery"],
      required: true,
    },
    dimension: {
      programmeId: {
        type: Schema.Types.ObjectId,
        ref: "Program",
        default: null,
      },
      careTier: {
        type: String,
        enum: ["self_help", "cbt_guided", "pwp_guided"],
        default: null,
      },
      instrument: {
        type: String,
        enum: ["phq9", "gad7", "pdss"],
        required: true,
      },
    },
    bucket: {
      granularity: { type: String, enum: ["week", "month"], required: true },
      startsAt: { type: Date, required: true },
      endsAt: { type: Date, required: true },
    },
    numerator: { type: Number, required: true },
    denominator: { type: Number, required: true },
    n: { type: Number, required: true },
    computedAt: { type: Date, required: true },
    schemaVersion: { type: Number, required: true, default: 1 },
  },
  { collection: "metricsRollups" },
);

MetricsRollupSchema.index({
  metric: 1,
  "dimension.programmeId": 1,
  "dimension.careTier": 1,
  "dimension.instrument": 1,
  "bucket.startsAt": 1,
});
MetricsRollupSchema.index({ computedAt: -1 });
MetricsRollupSchema.index(
  {
    metric: 1,
    "dimension.programmeId": 1,
    "dimension.careTier": 1,
    "dimension.instrument": 1,
    "bucket.granularity": 1,
    "bucket.startsAt": 1,
  },
  { unique: true, name: "rollup_unique" },
);

const MetricsRollup = mongoose.model<IMetricsRollup>(
  "MetricsRollup",
  MetricsRollupSchema,
);
export default MetricsRollup;
export type { IMetricsRollup };
