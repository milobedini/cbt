import mongoose, { Schema, Document, Types } from 'mongoose'

type AttemptStatus = 'started' | 'submitted' | 'abandoned'

interface IAnswer {
  question: Types.ObjectId
  chosenScore: number
  chosenIndex?: number // NEW
  chosenText?: string // NEW
}

interface IDiaryEntry {
  at: Date // when the activity happened (or start of the slot)
  label?: string // e.g. "7–8am" (optional)
  activity: string // free text
  mood?: number // 0-100%
  achievement?: number // 0..10
  closeness?: number //0-10
  enjoyment?: number // 0..10
}

interface IFiveAreas {
  situation?: string
  thoughts?: string
  emotions?: string
  behaviours?: string
  physical?: string
  reflection?: string
}

interface IGeneralGoalEntry {
  goalText?: string
  rating?: number | null
}

interface IPreviousRating {
  date?: Date
  ratings?: number[]
}

interface IGeneralGoals {
  goals?: IGeneralGoalEntry[]
  reflection?: string
  isReRating?: boolean
  previousRatings?: IPreviousRating[]
}

interface IWeeklyGoalPlannedDiaryRef {
  at: Date
  label?: string
}

interface IWeeklyGoalEntry {
  goalText: string
  completed?: boolean
  masteryRating?: number | null
  pleasureRating?: number | null
  plannedDiaryEntryRef?: IWeeklyGoalPlannedDiaryRef | null
  completionNotes?: string | null
}

interface IWeeklyGoalsReflection {
  moodImpact?: string
  takeaway?: string
  balance?: string
  barriers?: string
}

interface IWeeklyGoals {
  goals?: IWeeklyGoalEntry[]
  reflection?: IWeeklyGoalsReflection
}

interface IModuleAttempt extends Document {
  user: Types.ObjectId
  therapist?: Types.ObjectId // snapshot for easy therapist queries
  program: Types.ObjectId
  module: Types.ObjectId
  moduleType:
    | 'questionnaire'
    | 'reading'
    | 'activity_diary'
    | 'five_areas_model'
    | 'general_goals'
    | 'weekly_goals'

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
    content?: string
    questions?: Array<{
      _id: Types.ObjectId
      text: string
      choices: Array<{ text: string; score: number }>
    }>
  }

  // Diary
  diaryEntries?: IDiaryEntry[]

  // Five Areas Model
  fiveAreas?: IFiveAreas

  // General Goals
  generalGoals?: IGeneralGoals

  // Weekly Goals
  weeklyGoals?: IWeeklyGoals

  // notes / metadata
  userNote?: string
  therapistNote?: string
  readerNote?: string
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
      enum: ['questionnaire', 'reading', 'activity_diary', 'five_areas_model', 'general_goals', 'weekly_goals'],
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

    // Diary
    diaryEntries: [
      {
        at: { type: Date, required: true, index: true },
        label: { type: String, trim: true, maxlength: 100 },
        activity: { type: String, trim: true, maxlength: 1000 },
        mood: { type: Number, min: 0, max: 100 },
        achievement: { type: Number, min: 0, max: 10 },
        closeness: { type: Number, min: 0, max: 10 },
        enjoyment: { type: Number, min: 0, max: 10 },
      },
    ],

    // Five Areas Model
    fiveAreas: {
      situation: { type: String, trim: true, maxlength: 2000 },
      thoughts: { type: String, trim: true, maxlength: 2000 },
      emotions: { type: String, trim: true, maxlength: 2000 },
      behaviours: { type: String, trim: true, maxlength: 2000 },
      physical: { type: String, trim: true, maxlength: 2000 },
      reflection: { type: String, trim: true, maxlength: 2000 },
    },

    // General Goals
    generalGoals: {
      goals: [
        {
          goalText: { type: String, trim: true, maxlength: 500 },
          rating: { type: Number, min: 0, max: 10, default: null },
        },
      ],
      reflection: { type: String, trim: true, maxlength: 2000 },
      isReRating: { type: Boolean, default: false },
      previousRatings: [
        {
          date: { type: Date },
          ratings: [{ type: Number, min: 0, max: 10 }],
        },
      ],
    },

    // Weekly Goals
    weeklyGoals: {
      goals: [
        {
          goalText: { type: String, trim: true, maxlength: 500 },
          completed: { type: Boolean, default: false },
          masteryRating: { type: Number, min: 0, max: 10, default: null },
          pleasureRating: { type: Number, min: 0, max: 10, default: null },
          plannedDiaryEntryRef: {
            at: { type: Date },
            label: { type: String, trim: true, maxlength: 100 },
          },
          completionNotes: { type: String, trim: true, maxlength: 500, default: null },
        },
      ],
      reflection: {
        moodImpact: { type: String, trim: true, maxlength: 2000 },
        takeaway: { type: String, trim: true, maxlength: 2000 },
        balance: { type: String, trim: true, maxlength: 2000 },
        barriers: { type: String, trim: true, maxlength: 2000 },
      },
    },

    contentVersion: Number,
    moduleSnapshot: {
      title: String,
      disclaimer: String,
      content: String,
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
    readerNote: String,
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
