import mongoose, { Types } from 'mongoose'
import Module from '../models/moduleModel'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'
import User from '../models/userModel'
import ModuleAssignment from '../models/moduleAssignmentModel'
import { DateTime } from 'luxon'
import { LONDON_TZ } from '../shared-types/constants'

// Monday 00:00 London time, returned as UTC JS Date
export const computeWeekStart = (d: Date): Date => {
  const dt = DateTime.fromJSDate(d, { zone: LONDON_TZ })
  const mondayStart = dt.startOf('week')
  return mondayStart.toUTC().toJSDate()
}

// Active assignment finder (assigned or in_progress)
export const findActiveAssignment = async (
  userId: Types.ObjectId,
  moduleId: Types.ObjectId,
  therapistId?: Types.ObjectId
) => {
  const match: Record<string, unknown> = {
    user: userId,
    module: moduleId,
    status: { $in: ['assigned', 'in_progress'] },
  }
  if (therapistId) match.therapist = therapistId
  return ModuleAssignment.findOne(match)
    .sort({ dueAt: 1, createdAt: -1 })
    .lean()
}

// Does therapist have access to this patient?
export const therapistCanSeePatient = async (
  therapistId: Types.ObjectId,
  patientId: Types.ObjectId
): Promise<boolean> => {
  const patient = await User.findById(patientId, 'therapist')
  if (!patient) return false
  return patient.therapist?.toString() === therapistId.toString()
}

// Snapshot questions so history survives edits
export const makeModuleSnapshot = async (moduleId: Types.ObjectId) => {
  const mod = await Module.findById(moduleId, 'title disclaimer type program')
  if (!mod) return null
  const questions = await Question.find({ module: moduleId })
    .sort({ order: 1 })
    .select('_id text choices')
    .lean()
  return {
    title: mod.title,
    disclaimer: mod.disclaimer,
    questions:
      questions?.map((q) => ({
        _id: q._id,
        text: q.text,
        choices:
          q.choices?.map((c) => ({ text: c.text, score: c.score })) || [],
      })) || [],
  }
}

export const scoreToBand = async (
  moduleId: Types.ObjectId,
  totalScore: number
) => {
  const band = await ScoreBand.findOne({
    module: moduleId,
    min: { $lte: totalScore },
    max: { $gte: totalScore },
  }).lean()
  return band?.label || null
}

type AnswerLike = {
  question: string | Types.ObjectId
  chosenScore?: number
  chosenIndex?: number
  chosenText?: string
}

type QuestionLike = {
  _id: string | Types.ObjectId
  text: string
  choices: { text: string; score: number }[]
}

type AttemptLike = {
  moduleSnapshot?: { questions?: QuestionLike[] }
  answers?: AnswerLike[]
  module?: string | Types.ObjectId
}

export const decorateAttemptItems = (attempt: AttemptLike) => {
  const snapQs = attempt?.moduleSnapshot?.questions || []
  const ansMap = new Map<string, AnswerLike>(
    (attempt.answers || []).map((a) => [String(a.question), a])
  )

  const items = snapQs.map((q, idx) => {
    const a = ansMap.get(String(q._id))

    let chosenIndex = a?.chosenIndex
    let chosenText = a?.chosenText
    if ((chosenIndex == null || chosenText == null) && a?.chosenScore != null) {
      const idxByScore = (q.choices || []).findIndex(
        (c) => c.score === a.chosenScore
      )
      if (idxByScore >= 0) {
        if (chosenIndex == null) chosenIndex = idxByScore
        if (chosenText == null) chosenText = q.choices[idxByScore]?.text
      }
    }

    return {
      order: idx + 1,
      questionId: String(q._id),
      questionText: q.text,
      choices: q.choices,
      chosenScore: a?.chosenScore ?? null,
      chosenIndex: chosenIndex ?? null,
      chosenText: chosenText ?? null,
    }
  })

  const answeredCount = items.filter((i) => i.chosenScore != null).length
  const totalQuestions = items.length
  const percentComplete = totalQuestions
    ? Math.round((answeredCount / totalQuestions) * 100)
    : 0

  return { items, answeredCount, totalQuestions, percentComplete }
}

export const enrichAnswersWithChoiceMetaFromSnapshot = (
  attempt: AttemptLike
) => {
  if (!attempt?.moduleSnapshot?.questions || !Array.isArray(attempt.answers))
    return

  const qMap = new Map(
    attempt.moduleSnapshot.questions.map((q) => [
      String(q._id),
      { choices: q.choices || [] },
    ])
  )

  attempt.answers = attempt.answers.map((a) => {
    const qInfo = qMap.get(String(a.question))
    if (!qInfo) return a

    let chosenIndex: number | undefined = a.chosenIndex
    if (chosenIndex == null) {
      chosenIndex = qInfo.choices.findIndex((c) => c.score === a.chosenScore)
      if (chosenIndex < 0) chosenIndex = undefined
    }

    const chosenText =
      chosenIndex != null &&
      chosenIndex >= 0 &&
      chosenIndex < qInfo.choices.length
        ? qInfo.choices[chosenIndex].text
        : a.chosenText

    return {
      ...a,
      ...(chosenIndex != null ? { chosenIndex } : {}),
      ...(chosenText ? { chosenText } : {}),
    }
  })
}

// Fallback if there's no snapshot
export const enrichAnswersWithChoiceMetaFromDB = async (
  attempt: AttemptLike
) => {
  if (!Array.isArray(attempt.answers)) return

  const qIds = attempt.answers.map(
    (a) => new mongoose.Types.ObjectId(String(a.question))
  )
  const qs = await Question.find({ _id: { $in: qIds }, module: attempt.module })
    .select('_id choices')
    .lean()

  const qMap = new Map(
    qs.map((q) => [String(q._id), { choices: q.choices || [] }])
  )

  attempt.answers = attempt.answers.map((a) => {
    const qInfo = qMap.get(String(a.question))
    if (!qInfo) return a

    let chosenIndex: number | undefined = a.chosenIndex
    if (chosenIndex == null) {
      chosenIndex = qInfo.choices.findIndex((c) => c.score === a.chosenScore)
      if (chosenIndex < 0) chosenIndex = undefined
    }

    const chosenText =
      chosenIndex != null &&
      chosenIndex >= 0 &&
      chosenIndex < qInfo.choices.length
        ? qInfo.choices[chosenIndex].text
        : a.chosenText

    return {
      ...a,
      ...(chosenIndex != null ? { chosenIndex } : {}),
      ...(chosenText ? { chosenText } : {}),
    }
  })
}
