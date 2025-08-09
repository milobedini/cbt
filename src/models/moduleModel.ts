import mongoose, { Document, Schema, Types } from 'mongoose'

type IModule = Document & {
  title: string
  description: string
  program: Types.ObjectId
  type: 'questionnaire' | 'psychoeducation' | 'exercise'
  createdAt: Date
  updatedAt: Date
  disclaimer?: string
  imageUrl?: string
  enrolled?: Types.ObjectId[]
}

const moduleSchema = new mongoose.Schema<IModule>(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    program: { type: Schema.Types.ObjectId, ref: 'Program', required: true },
    type: {
      type: String,
      enum: ['questionnaire', 'psychoeducation', 'exercise'],
      required: true,
    },
    disclaimer: String,
    imageUrl: String,
    enrolled: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, collection: 'modules' }
)

const Module = mongoose.model<IModule>('Module', moduleSchema)
export default Module
export { IModule }
