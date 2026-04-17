import mongoose, { Schema, Document, Types } from 'mongoose'

type AssignmentStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled'
type AssignmentSource = 'therapist' | 'self'

interface IModuleAssignment extends Document {
  user: Types.ObjectId
  therapist?: Types.ObjectId // null for self-initiated
  program: Types.ObjectId
  module: Types.ObjectId
  moduleType:
    | 'questionnaire'
    | 'reading'
    | 'activity_diary'
    | 'five_areas_model'
    | 'general_goals'
    | 'weekly_goals'

  status: AssignmentStatus
  source: AssignmentSource
  createdAt: Date
  updatedAt: Date
  completedAt?: Date

  dueAt?: Date
  recurrence?: { freq: 'weekly' | 'monthly' | 'none'; interval?: number }
  recurrenceGroupId?: Types.ObjectId // links recurring chain
  latestAttempt?: Types.ObjectId
  notes?: string
}

const ModuleAssignmentSchema = new Schema<IModuleAssignment>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    therapist: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },
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
      enum: ['assigned', 'in_progress', 'completed', 'cancelled'],
      default: 'assigned',
      index: true,
    },
    source: {
      type: String,
      enum: ['therapist', 'self'],
      default: 'therapist',
    },
    completedAt: { type: Date, default: null },
    dueAt: { type: Date, index: true },
    recurrence: {
      freq: {
        type: String,
        enum: ['weekly', 'monthly', 'none'],
        default: 'none',
      },
      interval: { type: Number, default: 1 },
    },
    recurrenceGroupId: { type: Schema.Types.ObjectId, default: null },
    latestAttempt: { type: Schema.Types.ObjectId, ref: 'ModuleAttempt' },
    notes: String,
  },
  { timestamps: true, collection: 'moduleAssignments' }
)

ModuleAssignmentSchema.index({ therapist: 1, status: 1, dueAt: 1 })
export default mongoose.model<IModuleAssignment>(
  'ModuleAssignment',
  ModuleAssignmentSchema
)
export type { IModuleAssignment, AssignmentSource }
