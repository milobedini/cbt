import mongoose, { Document, Schema, Types } from 'mongoose'

type IModule = Document & {
  title: string
  description: string
  program: Types.ObjectId
  type: 'questionnaire' | 'reading' | 'activity_diary' | 'five_areas_model' | 'general_goals' | 'weekly_goals'
  createdAt: Date
  updatedAt: Date
  disclaimer?: string
  imageUrl?: string
  content?: string
  accessPolicy: 'open' | 'assigned'
}

const moduleSchema = new mongoose.Schema<IModule>(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    program: { type: Schema.Types.ObjectId, ref: 'Program', required: true },
    type: {
      type: String,
      enum: ['questionnaire', 'reading', 'activity_diary', 'five_areas_model', 'general_goals', 'weekly_goals'],
      required: true,
    },
    disclaimer: String,
    imageUrl: String,
    content: String,
    accessPolicy: {
      type: String,
      enum: ['open', 'assigned'],
      default: 'assigned',
    },
  },
  { timestamps: true, collection: 'modules' }
)

const Module = mongoose.model<IModule>('Module', moduleSchema)
export default Module
export { IModule }
