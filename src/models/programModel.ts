import mongoose, { Document, Schema, Types } from 'mongoose'

type IProgram = Document & {
  title: string
  description: string
  modules: Types.ObjectId[]
}

const ProgramSchema = new Schema<IProgram>(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    modules: [{ type: Schema.Types.ObjectId, ref: 'Module' }],
  },
  { timestamps: true, collection: 'programs' }
)

const Program = mongoose.model<IProgram>('Program', ProgramSchema)
export default Program
export { IProgram }
