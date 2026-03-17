import mongoose, { Document, Schema, Types } from 'mongoose'

type IScoreBand = Document & {
  module: Types.ObjectId
  min: number
  max: number
  label: string
  interpretation: string
}

const ScoreBandSchema = new Schema<IScoreBand>(
  {
    module: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    min: Number,
    max: Number,
    label: String,
    interpretation: String,
  },
  { collection: 'scoreBands' }
)

ScoreBandSchema.index({ module: 1, min: 1, max: 1 })

const ScoreBand = mongoose.model<IScoreBand>('ScoreBand', ScoreBandSchema)
export default ScoreBand
export { IScoreBand }
