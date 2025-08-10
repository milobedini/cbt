import mongoose, { Schema, Document, Types } from 'mongoose'

type AssignmentStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled'

interface IModuleAssignment extends Document {
  user: Types.ObjectId
  therapist: Types.ObjectId
  program: Types.ObjectId
  module: Types.ObjectId
  moduleType: 'questionnaire' | 'psychoeducation' | 'exercise'

  status: AssignmentStatus
  createdAt: Date
  updatedAt: Date

  dueAt?: Date
  recurrence?: { freq: 'weekly' | 'monthly' | 'none'; interval?: number } // keep simple, or store RRULE string
  latestAttempt?: Types.ObjectId // denormalized pointer
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
      required: true,
      index: true,
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
      enum: ['questionnaire', 'psychoeducation', 'exercise'],
      required: true,
    },

    status: {
      type: String,
      enum: ['assigned', 'in_progress', 'completed', 'cancelled'],
      default: 'assigned',
      index: true,
    },
    dueAt: { type: Date, index: true },
    recurrence: {
      freq: {
        type: String,
        enum: ['weekly', 'monthly', 'none'],
        default: 'none',
      },
      interval: { type: Number, default: 1 },
    },
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
export type { IModuleAssignment }
