import mongoose, { Document, Schema, Types } from "mongoose";

type IModule = Document & {
  title: string;
  description: string;
  program: Types.ObjectId;
  type:
    | "questionnaire"
    | "reading"
    | "activity_diary"
    | "five_areas_model"
    | "general_goals"
    | "weekly_goals";
  createdAt: Date;
  updatedAt: Date;
  disclaimer?: string;
  imageUrl?: string;
  content?: string;
  accessPolicy: "open" | "assigned";
  instrument?: "phq9" | "gad7" | "pdss";
  clinicalCutoff?: number;
  reliableChangeDelta?: number;
};

const moduleSchema = new mongoose.Schema<IModule>(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    program: { type: Schema.Types.ObjectId, ref: "Program", required: true },
    type: {
      type: String,
      enum: [
        "questionnaire",
        "reading",
        "activity_diary",
        "five_areas_model",
        "general_goals",
        "weekly_goals",
      ],
      required: true,
    },
    disclaimer: String,
    imageUrl: String,
    content: String,
    accessPolicy: {
      type: String,
      enum: ["open", "assigned"],
      default: "assigned",
    },
    instrument: {
      type: String,
      enum: ["phq9", "gad7", "pdss"],
      default: undefined,
    },
    clinicalCutoff: { type: Number, default: undefined },
    reliableChangeDelta: { type: Number, default: undefined },
  },
  { timestamps: true, collection: "modules" },
);

moduleSchema.pre("validate", function (next) {
  if (
    this.instrument &&
    (this.clinicalCutoff === undefined || this.clinicalCutoff === null)
  ) {
    return next(new Error("clinicalCutoff is required when instrument is set"));
  }
  next();
});

const Module = mongoose.model<IModule>("Module", moduleSchema);
export default Module;
export { IModule };
