import mongoose, { Schema, Document, Types } from 'mongoose'

type AttemptStatus = 'started' | 'submitted' | 'abandoned'

interface IAnswer {
  question: Types.ObjectId
  chosenScore: number
  chosenIndex?: number // NEW
  chosenText?: string // NEW
}

interface IModuleAttempt extends Document {
  user: Types.ObjectId
  therapist?: Types.ObjectId // snapshot for easy therapist queries
  program: Types.ObjectId
  module: Types.ObjectId
  moduleType: 'questionnaire' | 'psychoeducation' | 'exercise'

  // lifecycle
  status: AttemptStatus
  startedAt: Date
  completedAt?: Date
  lastInteractionAt: Date
  durationSecs?: number
  iteration?: number // e.g., 1st, 2nd, 3rd time doing it
  dueAt?: Date // if created from an assignment

  // scoring (questionnaire)
  answers?: IAnswer[]
  totalScore?: number
  scoreBandLabel?: string // denormalized from ScoreBand at submit
  weekStart?: Date // normalized (e.g., Monday 00:00 UTC)

  // versioning + snapshot (so history remains readable if content changes)
  contentVersion?: number
  moduleSnapshot?: {
    title: string
    disclaimer?: string
    questions?: Array<{
      _id: Types.ObjectId
      text: string
      choices: Array<{ text: string; score: number }>
    }>
  }

  // notes / metadata
  userNote?: string
  therapistNote?: string
  createdAt: Date
  updatedAt: Date
}

const ModuleAttemptSchema = new Schema<IModuleAttempt>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    therapist: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    program: {
      type: Schema.Types.ObjectId,
      ref: 'Program',
      required: true,
      index: true,
    },
    module: {
      type: Schema.Types.ObjectId,
      ref: 'Module',
      required: true,
      index: true,
    },
    moduleType: {
      type: String,
      enum: ['questionnaire', 'psychoeducation', 'exercise'],
      required: true,
    },

    status: {
      type: String,
      enum: ['started', 'submitted', 'abandoned'],
      required: true,
      index: true,
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, index: true },
    lastInteractionAt: { type: Date, default: Date.now, index: true },
    durationSecs: Number,
    iteration: Number,
    dueAt: Date,

    answers: [
      {
        question: {
          type: Schema.Types.ObjectId,
          ref: 'Question',
          required: true,
        },
        chosenScore: { type: Number, required: true },
        chosenIndex: { type: Number }, // NEW
        chosenText: { type: String }, // NEW
      },
    ],
    totalScore: Number,
    scoreBandLabel: String,
    weekStart: Date,

    contentVersion: Number,
    moduleSnapshot: {
      title: String,
      disclaimer: String,
      questions: [
        {
          _id: Schema.Types.ObjectId,
          text: String,
          choices: [{ text: String, score: Number }],
        },
      ],
    },

    userNote: String,
    therapistNote: String,
  },
  { timestamps: true, collection: 'moduleAttempts' }
)

// Fast “latest per module per user”
ModuleAttemptSchema.index({ user: 1, module: 1, completedAt: -1 })
// Therapist dashboards
ModuleAttemptSchema.index({ therapist: 1, completedAt: -1 })
// Weekly uniqueness for questionnaires (optional business rule)
ModuleAttemptSchema.index(
  { user: 1, module: 1, weekStart: 1 },
  {
    partialFilterExpression: {
      status: 'submitted',
      moduleType: 'questionnaire',
    },
    unique: false,
  }
)

export default mongoose.model<IModuleAttempt>(
  'ModuleAttempt',
  ModuleAttemptSchema
)
export type { IModuleAttempt }
