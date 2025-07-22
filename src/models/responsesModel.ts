import mongoose, { Document, Schema, Types } from 'mongoose'

type IResponse = Document & {
  user: Types.ObjectId
  program: Types.ObjectId
  module: Types.ObjectId
  answers: { question: Types.ObjectId; chosenScore: number }[]
  totalScore: number
  weekStart: Date
}

const AssessmentResponseSchema = new Schema<IResponse>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    program: { type: Schema.Types.ObjectId, ref: 'Program', required: true },
    module: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    answers: [
      {
        question: {
          type: Schema.Types.ObjectId,
          ref: 'Question',
          required: true,
        },
        chosenScore: { type: Number, required: true },
      },
    ],
    totalScore: { type: Number, required: true },
    weekStart: { type: Date, required: true },
  },
  { timestamps: true, collection: 'assessmentResponses' }
)

const AssessmentResponse = mongoose.model<IResponse>(
  'AssessmentResponse',
  AssessmentResponseSchema
)
export default AssessmentResponse
export { IResponse }
