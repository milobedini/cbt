import mongoose, { Document } from 'mongoose'

type IModule = Document & {
  title: string
  description: string
  createdAt: Date
  updatedAt: Date
  imageUrl?: string
}

const moduleSchema = new mongoose.Schema<IModule>(
  {
    title: {
      type: String,
      required: [true, 'Module title is required!'],
      trim: true,
      maxlength: [100, 'Module title cannot exceed 100 characters!'],
    },
    description: {
      type: String,
      required: [true, 'Module description is required!'],
      trim: true,
      maxlength: [500, 'Module description cannot exceed 500 characters!'],
    },
    imageUrl: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'modules',
  }
)

const Module = mongoose.model<IModule>('Module', moduleSchema)
export default Module
export { IModule }
