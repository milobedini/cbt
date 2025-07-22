import mongoose, { Document, Schema, Types } from 'mongoose'

type IChoice = {
  text: string
  score: number
}

type IQuestion = Document & {
  module: Types.ObjectId
  order: number
  text: string
  choices: IChoice[]
}

const QuestionSchema = new Schema<IQuestion>(
  {
    module: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    order: { type: Number, required: true },
    text: { type: String, required: true, trim: true },
    choices: [
      {
        text: { type: String, required: true },
        score: { type: Number, required: true, min: 0, max: 3 },
      },
    ],
  },
  { collection: 'questions' }
)

const Question = mongoose.model<IQuestion>('Question', QuestionSchema)
export default Question
export { IQuestion, IChoice }
