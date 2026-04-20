import mongoose from "mongoose";
import User from "../models/userModel";
import Module from "../models/moduleModel";
import Program from "../models/programModel";
import ModuleAttempt from "../models/moduleAttemptModel";

type WithId<T> = T & { _id: mongoose.Types.ObjectId };

type CreateUserOpts = {
  role?: "patient" | "therapist" | "admin";
  therapistTier?: "cbt" | "pwp";
  therapist?: mongoose.Types.ObjectId;
  isVerifiedTherapist?: boolean;
};

export const createUser = async (
  opts: CreateUserOpts = {},
): Promise<WithId<typeof result>> => {
  const result = await User.create({
    username: `u-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    email: `${new mongoose.Types.ObjectId().toString()}@test.bwell`,
    password: "x".repeat(10),
    roles: [opts.role ?? "patient"],
    isVerifiedTherapist: opts.isVerifiedTherapist ?? false,
    therapistTier: opts.therapistTier,
    therapist: opts.therapist,
  });
  return result as unknown as WithId<typeof result>;
};

export const createProgram = async (title = "Depression") => {
  const result = await Program.create({
    title,
    description: `${title} programme`,
    modules: [],
  });
  return result as unknown as WithId<typeof result>;
};

export const createQuestionnaireModule = async (args: {
  programId: mongoose.Types.ObjectId;
  title: string;
  instrument?: "phq9" | "gad7" | "pdss";
  clinicalCutoff?: number;
  reliableChangeDelta?: number;
}) => {
  const result = await Module.create({
    title: args.title,
    description: args.title,
    type: "questionnaire",
    program: args.programId,
    accessPolicy: "open",
    instrument: args.instrument,
    clinicalCutoff: args.clinicalCutoff,
    reliableChangeDelta: args.reliableChangeDelta,
  });
  return result as unknown as WithId<typeof result>;
};

export const createAttempt = async (args: {
  userId: mongoose.Types.ObjectId;
  therapistId?: mongoose.Types.ObjectId;
  programId: mongoose.Types.ObjectId;
  moduleId: mongoose.Types.ObjectId;
  totalScore: number;
  completedAt: Date;
}) => {
  const result = await ModuleAttempt.create({
    user: args.userId,
    therapist: args.therapistId,
    program: args.programId,
    module: args.moduleId,
    moduleType: "questionnaire",
    status: "submitted",
    startedAt: args.completedAt,
    completedAt: args.completedAt,
    lastInteractionAt: args.completedAt,
    totalScore: args.totalScore,
  });
  return result as unknown as WithId<typeof result>;
};
