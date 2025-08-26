import { Request, Response } from 'express'
import mongoose, { Types } from 'mongoose'
import Module from '../models/moduleModel'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'
import User, { UserRole } from '../models/userModel'
import ModuleAttempt from '../models/moduleAttemptModel'
import ModuleAssignment from '../models/moduleAssignmentModel'
import { errorHandler } from '../utils/errorHandler'
import { DateTime } from 'luxon'

// ---- Utils ----
const LONDON_TZ = 'Europe/London'

// Monday 00:00 London time, returned as UTC JS Date
function computeWeekStart(d: Date): Date {
  const dt = DateTime.fromJSDate(d, { zone: LONDON_TZ })
  const mondayStart = dt.startOf('week').plus({ days: 1 }).startOf('day') // Luxon weeks start Sunday
  // If dt is Monday already, this still yields Monday 00:00
  const normalized = mondayStart.toUTC()
  return normalized.toJSDate()
}

function isAdmin(user: any) {
  return user.roles?.includes(UserRole.ADMIN)
}
function isTherapist(user: any) {
  return user.roles?.includes(UserRole.THERAPIST)
}
function isVerifiedTherapist(user: any) {
  return isTherapist(user) && !!user.isVerifiedTherapist
}

// active assignment finder (assigned or in_progress)
async function findActiveAssignment(
  userId: Types.ObjectId,
  moduleId: Types.ObjectId,
  therapistId?: Types.ObjectId
) {
  const match: any = {
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
async function therapistCanSeePatient(
  therapistId: Types.ObjectId,
  patientId: Types.ObjectId
): Promise<boolean> {
  const patient = await User.findById(patientId, 'therapist')
  if (!patient) return false
  return patient.therapist?.toString() === therapistId.toString()
}

// Snapshot questions so history survives edits
async function makeModuleSnapshot(moduleId: Types.ObjectId) {
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

async function scoreToBand(moduleId: Types.ObjectId, totalScore: number) {
  // Inclusive bounds. If overlapping bands exist, the first match wins.
  const band = await ScoreBand.findOne({
    module: moduleId,
    min: { $lte: totalScore },
    max: { $gte: totalScore },
  }).lean()
  return band?.label || null
}

function decorateAttemptItems(attempt: any) {
  const snapQs = attempt?.moduleSnapshot?.questions || []
  const ansMap = new Map<string, any>(
    (attempt.answers || []).map((a: any) => [String(a.question), a])
  )

  const items = snapQs.map((q: any, idx: number) => {
    const a = ansMap.get(String(q._id))

    // derive when missing
    let chosenIndex = a?.chosenIndex
    let chosenText = a?.chosenText
    if ((chosenIndex == null || chosenText == null) && a?.chosenScore != null) {
      const idxByScore = (q.choices || []).findIndex(
        (c: any) => c.score === a.chosenScore
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
      choices: q.choices, // [{ text, score }]
      chosenScore: a?.chosenScore ?? null,
      chosenIndex: chosenIndex ?? null,
      chosenText: chosenText ?? null,
    }
  })

  const answeredCount = items.filter((i: any) => i.chosenScore != null).length
  const totalQuestions = items.length
  const percentComplete = totalQuestions
    ? Math.round((answeredCount / totalQuestions) * 100)
    : 0

  return { items, answeredCount, totalQuestions, percentComplete }
}

function enrichAnswersWithChoiceMetaFromSnapshot(attempt: any) {
  if (!attempt?.moduleSnapshot?.questions || !Array.isArray(attempt.answers))
    return

  const qMap = new Map<string, { choices: { text: string; score: number }[] }>(
    attempt.moduleSnapshot.questions.map((q: any) => [
      String(q._id),
      { choices: q.choices || [] },
    ])
  )

  attempt.answers = attempt.answers.map((a: any) => {
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
        : a.chosenText // keep any existing

    return {
      ...a,
      ...(chosenIndex != null ? { chosenIndex } : {}),
      ...(chosenText ? { chosenText } : {}),
    }
  })
}

export function computePercentCompleteForAttempt(attempt: any): number {
  try {
    if (!attempt) return 0

    // Submitted attempts are "complete" from a UX perspective
    if (attempt.status === 'submitted') return 100

    if (attempt.moduleType === 'questionnaire') {
      const snapQs = attempt?.moduleSnapshot?.questions || []
      const total = snapQs.length
      if (!total) return 0

      const answered = (attempt.answers || []).filter(
        (a: any) => a && a.chosenScore != null
      ).length
      return Math.round((answered / total) * 100)
    }

    if (attempt.moduleType === 'activity_diary') {
      // For diaries, show progress within the *current* London week:
      //   unique days with ≥1 entry / days elapsed this week (Mon..today).
      const now = new Date()
      const weekStart = computeWeekStart(now) // Monday 00:00 (UTC)
      const weekStartLdn = DateTime.fromJSDate(weekStart, { zone: LONDON_TZ })
      const todayLdn = DateTime.fromJSDate(now, { zone: LONDON_TZ })

      // Days elapsed this week (Mon..today), inclusive
      const daysElapsed = Math.max(
        1,
        Math.min(
          7,
          Math.floor(todayLdn.startOf('day').diff(weekStartLdn, 'days').days) +
            1
        )
      )

      const entries = Array.isArray(attempt.diaryEntries)
        ? attempt.diaryEntries
        : []

      const dayKeys = new Set<string>()
      for (const e of entries) {
        const d = new Date(e.at)
        if (isNaN(d.getTime())) continue
        if (d < weekStart || d > now) continue
        const key = DateTime.fromJSDate(d, { zone: LONDON_TZ })
          .startOf('day')
          .toISODate()
        if (key) dayKeys.add(key)
      }

      const filledDays = Math.min(dayKeys.size, daysElapsed)
      return Math.round((filledDays / daysElapsed) * 100)
    }

    // Other types default to 0 for now
    return 0
  } catch {
    return 0
  }
}

// Rare fallback if there’s no snapshot (shouldn’t happen with your start flow)
async function enrichAnswersWithChoiceMetaFromDB(attempt: any) {
  if (!Array.isArray(attempt.answers)) return

  const qIds = attempt.answers.map(
    (a: any) => new mongoose.Types.ObjectId(a.question)
  )
  const qs = await Question.find({ _id: { $in: qIds }, module: attempt.module })
    .select('_id choices')
    .lean()

  const qMap = new Map<string, { choices: { text: string; score: number }[] }>(
    qs.map((q) => [String(q._id), { choices: q.choices || [] }])
  )

  attempt.answers = attempt.answers.map((a: any) => {
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

type DiaryEntryInput = {
  at: string | Date
  label?: string
  activity?: string
  mood?: number // 0..100
  achievement?: number // 0..10
  closeness?: number // 0..10
  enjoyment?: number // 0..10
}

function clampInt(n: any, min: number, max: number) {
  if (typeof n !== 'number' || Number.isNaN(n)) return undefined
  return Math.min(max, Math.max(min, Math.round(n)))
}

function sanitizeDiaryEntries(list: DiaryEntryInput[] | undefined): any[] {
  if (!Array.isArray(list)) return []
  return list
    .map((e) => {
      const at = new Date(e.at as any)
      if (isNaN(at.getTime())) return null

      const label =
        typeof e.label === 'string' ? e.label.trim().slice(0, 100) : undefined

      // activity can be empty; trim+cap
      const activity =
        typeof e.activity === 'string' ? e.activity.trim().slice(0, 1000) : ''

      const mood = clampInt(e.mood, 0, 100)
      const achievement = clampInt(e.achievement, 0, 10)
      const closeness = clampInt(e.closeness, 0, 10)
      const enjoyment = clampInt(e.enjoyment, 0, 10)

      return {
        at,
        ...(label ? { label } : {}),
        activity,
        ...(mood != null ? { mood } : {}),
        ...(achievement != null ? { achievement } : {}),
        ...(closeness != null ? { closeness } : {}),
        ...(enjoyment != null ? { enjoyment } : {}),
      }
    })
    .filter(Boolean) as any[]
}

function decorateDiaryDetail(attempt: any) {
  const entries = Array.isArray(attempt.diaryEntries)
    ? [...attempt.diaryEntries]
    : []

  // sort by time ASC
  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // group by London calendar day
  const byDay = new Map<string, any[]>()
  for (const e of entries) {
    const dt = DateTime.fromJSDate(new Date(e.at), { zone: LONDON_TZ })
    // toISODate() can be null; fall back to a deterministic format
    const key: string = dt.toISODate() ?? dt.toFormat('yyyy-LL-dd')
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(e)
  }

  const avg = (arr: number[]) =>
    arr.length
      ? Math.round(
          (arr.reduce((s, n) => s + n, 0) / arr.length + Number.EPSILON) * 10
        ) / 10
      : null

  const days = Array.from(byDay.entries()).map(([dateISO, items]) => {
    const nums = (k: 'mood' | 'achievement' | 'closeness' | 'enjoyment') =>
      items.map((x: any) => x[k]).filter((x: any) => typeof x === 'number')
    return {
      dateISO,
      entries: items,
      avgMood: avg(nums('mood')),
      avgAchievement: avg(nums('achievement')),
      avgCloseness: avg(nums('closeness')),
      avgEnjoyment: avg(nums('enjoyment')),
    }
  })

  const all = (k: 'mood' | 'achievement' | 'closeness' | 'enjoyment') =>
    entries.map((x: any) => x[k]).filter((x: any) => typeof x === 'number')

  const totals = {
    count: entries.length,
    avgMood: avg(all('mood')),
    avgAchievement: avg(all('achievement')),
    avgCloseness: avg(all('closeness')),
    avgEnjoyment: avg(all('enjoyment')),
  }

  return { days, totals }
}

// ---- Controllers ----

// POST /modules/:moduleId/attempts
// Patient starts an attempt
export const startAttempt = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    const { moduleId } = req.params
    const { assignmentId } = (req.body as { assignmentId?: string }) || {}

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const mod = await Module.findById(moduleId)
    if (!mod) {
      res.status(404).json({ success: false, message: 'Module not found' })
      return
    }

    // link (or find) assignment if provided/required
    let assignment: any = null
    if (assignmentId) {
      assignment = await ModuleAssignment.findOne({
        _id: assignmentId,
        user: userId,
        module: mod._id,
        status: { $in: ['assigned', 'in_progress'] },
      })
      if (!assignment) {
        res.status(400).json({
          success: false,
          message: 'Assignment not found or not active',
        })
        return
      }
    } else if (mod.accessPolicy === 'assigned') {
      assignment = await findActiveAssignment(userId, mod._id as Types.ObjectId)
      if (!assignment) {
        res.status(403).json({
          success: false,
          message: 'An active assignment is required to start this module',
        })
        return
      }
    }

    // therapist snapshot
    const me = await User.findById(userId, 'therapist')
    const therapistId = me?.therapist as Types.ObjectId | undefined

    const snapshot = await makeModuleSnapshot(mod._id as Types.ObjectId)
    if (!snapshot) {
      res
        .status(500)
        .json({ success: false, message: 'Failed to snapshot module' })
      return
    }

    const count = await ModuleAttempt.countDocuments({
      user: userId,
      module: mod._id,
      status: 'submitted',
    })
    const iteration = count + 1

    const attempt = await ModuleAttempt.create({
      user: userId,
      therapist: therapistId,
      program: mod.program,
      module: mod._id,
      moduleType: mod.type,
      status: 'started',
      startedAt: new Date(),
      lastInteractionAt: new Date(),
      iteration,
      dueAt: assignment?.dueAt, // carry over due date
      moduleSnapshot: snapshot,
    })

    // If starting from an assignment, mark it in progress
    if (assignment && assignment.status === 'assigned') {
      await ModuleAssignment.updateOne(
        { _id: assignment._id },
        { status: 'in_progress', latestAttempt: attempt._id }
      )
    }

    res.status(201).json({ success: true, attempt })
  } catch (error) {
    errorHandler(res, error)
  }
}

// PATCH /attempts/:attemptId
// Save progress (answers partial, notes). Does not submit.
export const saveProgress = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    const { attemptId } = req.params
    const { answers, userNote, diaryEntries, merge } = req.body as {
      answers?: Array<{
        question: string
        chosenScore: number
        chosenIndex?: number
        chosenText?: string
      }>
      diaryEntries?: DiaryEntryInput[]
      merge?: boolean
      userNote?: string
    }

    const attempt = await ModuleAttempt.findById(attemptId)
    if (!attempt) {
      res.status(404).json({ success: false, message: 'Attempt not found' })
      return
    }
    if (attempt.user.toString() !== userId.toString()) {
      res.status(403).json({ success: false, message: 'Forbidden' })
      return
    }
    if (attempt.status === 'submitted') {
      res
        .status(400)
        .json({ success: false, message: 'Attempt already submitted' })
      return
    }

    if (attempt.moduleType === 'activity_diary') {
      if (Array.isArray(diaryEntries)) {
        const sanitized = sanitizeDiaryEntries(diaryEntries)

        if (
          merge &&
          Array.isArray(attempt.diaryEntries) &&
          attempt.diaryEntries.length
        ) {
          // merge by timestamp(ms)+label
          const key = (e: any) => `${new Date(e.at).getTime()}|${e.label || ''}`
          const existing = new Map(
            attempt.diaryEntries.map((e: any) => [key(e), e])
          )
          for (const e of sanitized) existing.set(key(e), e)
          attempt.diaryEntries = Array.from(existing.values()).sort(
            (a: any, b: any) =>
              new Date(a.at).getTime() - new Date(b.at).getTime()
          )
        } else {
          attempt.diaryEntries = sanitized
        }
      }

      if (typeof userNote === 'string') attempt.userNote = userNote
      attempt.lastInteractionAt = new Date()
      await attempt.save()
      res.status(200).json({ success: true, attempt })
      return
    }

    if (Array.isArray(answers)) {
      // Optional: validate question ids belong to this module
      if (Array.isArray(answers)) {
        const qIds = answers.map((a) => new mongoose.Types.ObjectId(a.question))
        const validQCount = await Question.countDocuments({
          _id: { $in: qIds },
          module: attempt.module,
        })
        if (validQCount !== qIds.length) {
          res.status(400).json({
            success: false,
            message: 'One or more answers reference invalid questions',
          })
          return
        }

        const qs = await Question.find({
          _id: { $in: qIds },
          module: attempt.module,
        })
          .select('_id choices')
          .lean()

        const qMap = new Map<
          string,
          { choices: { text: string; score: number }[] }
        >(qs.map((q) => [String(q._id), { choices: q.choices || [] }]))

        attempt.answers = answers.map((a) => {
          const qInfo = qMap.get(String(a.question))
          let chosenIndex: number | undefined = a.chosenIndex
          let chosenText: string | undefined = a.chosenText

          if (qInfo) {
            const { choices } = qInfo
            if (chosenIndex == null) {
              const idx = choices.findIndex((c) => c.score === a.chosenScore)
              if (idx >= 0) chosenIndex = idx
            }
            if (
              chosenText == null &&
              chosenIndex != null &&
              chosenIndex >= 0 &&
              chosenIndex < choices.length
            ) {
              chosenText = choices[chosenIndex].text
            }
          }
          return {
            question: a.question,
            chosenScore: a.chosenScore,
            ...(chosenIndex != null ? { chosenIndex } : {}),
            ...(chosenText ? { chosenText } : {}),
          }
        }) as any
      }
    }
    if (typeof userNote === 'string') attempt.userNote = userNote

    attempt.lastInteractionAt = new Date()
    await attempt.save()

    res.status(200).json({ success: true, attempt })
  } catch (error) {
    errorHandler(res, error)
  }
}

// POST /attempts/:attemptId/submit
// Finalize, compute score, band, weekStart, duration
export const submitAttempt = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    const { attemptId } = req.params
    let { assignmentId } = (req.body as { assignmentId?: string }) || {}

    const attempt = await ModuleAttempt.findById(attemptId)
    if (!attempt) {
      res.status(404).json({ success: false, message: 'Attempt not found' })
      return
    }
    if (attempt.user.toString() !== userId.toString()) {
      res.status(403).json({ success: false, message: 'Forbidden' })
      return
    }
    if (attempt.status === 'submitted') {
      res.status(400).json({ success: false, message: 'Already submitted' })
      return
    }

    const now = new Date()

    if (attempt.moduleType === 'activity_diary') {
      // No questionnaire scoring/bands; just finalize + normalize weekStart
      attempt.weekStart = computeWeekStart(now)
      attempt.completedAt = now
      attempt.lastInteractionAt = now
      attempt.status = 'submitted'
      attempt.durationSecs = attempt.startedAt
        ? Math.max(
            0,
            Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000)
          )
        : undefined

      // refresh therapist snapshot at submit
      const me = await User.findById(userId, 'therapist')
      attempt.therapist = me?.therapist
      await attempt.save()

      // Assignment sync
      if (!assignmentId) {
        const possible = await findActiveAssignment(
          attempt.user as Types.ObjectId,
          attempt.module as Types.ObjectId,
          attempt.therapist as Types.ObjectId
        )
        if (possible) assignmentId = String(possible._id)
      }
      if (assignmentId) {
        await ModuleAssignment.findByIdAndUpdate(assignmentId, {
          latestAttempt: attempt._id,
          status: 'completed',
        }).exec()
      }

      res.status(200).json({ success: true, attempt })
    }

    // For questionnaires: ensure you have answers to module questions (optional strictness)
    if (attempt.moduleType === 'questionnaire') {
      const questions = await Question.find({ module: attempt.module })
        .select('_id')
        .lean()
      const needed = new Set(questions.map((q) => q._id.toString()))
      const got = new Set(
        (attempt.answers || []).map((a) => (a.question as any).toString())
      )
      // If you want strictly all answered:
      if (needed.size > 0 && needed.size !== got.size) {
        res.status(400).json({
          success: false,
          message: 'Please answer all questions before submitting',
        })
        return
      }
    }

    if (attempt.answers?.length) {
      if (attempt.moduleSnapshot?.questions?.length) {
        enrichAnswersWithChoiceMetaFromSnapshot(attempt)
      } else {
        await enrichAnswersWithChoiceMetaFromDB(attempt)
      }
    }

    const totalScore = (attempt.answers || []).reduce(
      (sum, a: any) => sum + (a.chosenScore || 0),
      0
    )
    const band =
      attempt.moduleType === 'questionnaire'
        ? await scoreToBand(attempt.module as Types.ObjectId, totalScore)
        : null

    attempt.totalScore = totalScore
    attempt.scoreBandLabel = band || undefined
    attempt.weekStart = computeWeekStart(now)
    attempt.completedAt = now
    attempt.lastInteractionAt = now
    attempt.status = 'submitted'
    attempt.durationSecs = attempt.startedAt
      ? Math.max(
          0,
          Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000)
        )
      : undefined

    // Re-denormalize therapist at submit (in case it changed during attempt)
    const me = await User.findById(userId, 'therapist')
    attempt.therapist = me?.therapist

    await attempt.save()

    // Optional: sync assignment
    if (!assignmentId) {
      const possible = await findActiveAssignment(
        attempt.user as Types.ObjectId,
        attempt.module as Types.ObjectId,
        attempt.therapist as Types.ObjectId
      )
      // Auto find active assignment, if not explicitly provided
      if (possible) assignmentId = String(possible._id)
    }
    if (assignmentId) {
      await ModuleAssignment.findByIdAndUpdate(assignmentId, {
        latestAttempt: attempt._id,
        status: 'completed',
      }).exec()
    }

    res.status(200).json({ success: true, attempt })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /me/attempts?moduleId=&limit=&cursor=ISO
export const getMyAttempts = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const {
      moduleId,
      limit = '20',
      cursor,
      status = 'submitted',
    } = req.query as {
      moduleId?: string
      limit?: string
      cursor?: string
      status?: 'submitted' | 'active'
    }

    const lim = Math.min(parseInt(limit, 10) || 20, 100)

    if (status === 'active') {
      const match: any = { user: userId, status: 'started' }
      if (moduleId) match.module = new Types.ObjectId(String(moduleId))

      const rows = await ModuleAttempt.find(match)
        .sort({ lastInteractionAt: -1 })
        .limit(lim)
        .select(
          '_id module program moduleType startedAt lastInteractionAt iteration userNote dueAt status answers moduleSnapshot.questions diaryEntries.at'
        )
        .lean()
        .populate('module', 'title')

      const attempts = rows.map((a: any) => ({
        ...a,
        percentComplete: computePercentCompleteForAttempt(a),
      }))

      res.status(200).json({ success: true, attempts, nextCursor: null })
      return
    }

    // Default: submitted (with score band join)
    const match: any = { user: userId, status: 'submitted' }
    if (moduleId) match.module = new Types.ObjectId(String(moduleId))
    if (cursor) match.completedAt = { $lt: new Date(String(cursor)) }

    const pipeline = [
      { $match: match },
      { $sort: { completedAt: -1, _id: -1 } },
      { $limit: lim },
      {
        $lookup: {
          from: 'scoreBands',
          let: { m: '$module', s: '$totalScore' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$module', '$$m'] },
                    { $lte: ['$min', '$$s'] },
                    { $gte: ['$max', '$$s'] },
                  ],
                },
              },
            },
            {
              $project: { _id: 1, label: 1, interpretation: 1, min: 1, max: 1 },
            },
          ],
          as: 'band',
        },
      },
      // 👇 Add this block to fetch module details
      {
        $lookup: {
          from: 'modules', // collection name, check your schema
          localField: 'module',
          foreignField: '_id',
          as: 'module',
        },
      },
      { $unwind: '$module' }, // flatten from array → object
      { $addFields: { band: { $arrayElemAt: ['$band', 0] } } },
      { $addFields: { lastInteractionAt: '$completedAt' } },
      {
        $project: {
          _id: 1,
          module: { _id: 1, title: 1 }, // keep only what you want
          program: 1,
          moduleType: 1,
          totalScore: 1,
          scoreBandLabel: 1,
          completedAt: 1,
          lastInteraction: 1,
          weekStart: 1,
          iteration: 1,
          band: 1,
          status: 1, // ✅ include status explicitly
        },
      },
    ]

    const rows = await (ModuleAttempt as any).aggregate(pipeline)
    const attempts = rows.map((a: any) => ({
      ...a,
      percentComplete: 100,
    }))
    // simple time cursor (ISO). If you want 2-field cursor, we can upgrade later.
    const nextCursor = null
    res.status(200).json({ success: true, attempts, nextCursor })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /therapist/attempts/latest?limit=200
// Therapist dashboard: latest submitted attempt per (patient,module)
export const getTherapistLatest = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(therapistId, 'roles isVerifiedTherapist')
    if (
      !me ||
      (!me.roles.includes(UserRole.ADMIN) &&
        !(me.roles.includes(UserRole.THERAPIST) && me.isVerifiedTherapist))
    ) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const { limit = '200' } = req.query as { limit?: string }
    const lim = Math.min(parseInt(limit, 10) || 200, 500)

    const rows = await (ModuleAttempt as any).aggregate([
      { $match: { therapist: therapistId, status: 'submitted' } },
      { $sort: { completedAt: -1, _id: -1 } },
      {
        $group: {
          _id: { user: '$user', module: '$module' },
          doc: { $first: '$$ROOT' },
        },
      },
      { $replaceWith: '$doc' },

      // join score band by (module, totalScore)
      {
        $lookup: {
          from: 'scoreBands',
          let: { m: '$module', s: '$totalScore' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$module', '$$m'] },
                    { $lte: ['$min', '$$s'] },
                    { $gte: ['$max', '$$s'] },
                  ],
                },
              },
            },
            {
              $project: { _id: 1, label: 1, interpretation: 1, min: 1, max: 1 },
            },
          ],
          as: 'band',
        },
      },
      { $addFields: { band: { $arrayElemAt: ['$band', 0] } } },

      // join user + module
      {
        $lookup: {
          from: 'users-data',
          localField: 'user',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $lookup: {
          from: 'modules',
          localField: 'module',
          foreignField: '_id',
          as: 'module',
        },
      },
      {
        $addFields: {
          user: { $arrayElemAt: ['$user', 0] },
          module: { $arrayElemAt: ['$module', 0] },
        },
      },

      {
        $project: {
          _id: 1,
          user: { _id: 1, username: 1, email: 1, name: 1 },
          module: { _id: 1, title: 1 },
          totalScore: 1,
          scoreBandLabel: 1,
          band: 1,
          completedAt: 1,
          weekStart: 1,
          iteration: 1,
        },
      },
      { $limit: lim },
    ])
    const decorated = rows.map((r: any) => ({
      ...r,
      percentComplete: 100,
    }))
    res.status(200).json({ success: true, rows: decorated })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /therapist/patients/:patientId/modules/:moduleId/attempts
// Therapist: timeline for one patient
export const getPatientModuleTimeline = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(therapistId, 'roles isVerifiedTherapist')
    if (!me || (!isAdmin(me) && !isVerifiedTherapist(me))) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const { patientId } = req.params
    const {
      limit = '20',
      cursor,
      status,
      moduleId,
    } = req.query as {
      limit?: string
      cursor?: string
      status?: string // 'submitted' | 'active' | 'started' | 'abandoned' | csv
      moduleId?: string
    }

    const canSee =
      isAdmin(me) ||
      (await therapistCanSeePatient(therapistId, new Types.ObjectId(patientId)))
    if (!canSee) {
      res.status(403).json({
        success: false,
        message: "You are not the patient's therapist",
      })
      return
    }

    // ----- Status normalization -----
    // Default to completed timeline
    const norm = (status ?? 'submitted').toString().trim().toLowerCase()

    // Allow csv: status=started,abandoned ; and a friendly alias: active -> started
    const rawStatuses =
      norm === 'all'
        ? [] // no filter
        : norm === 'active'
        ? ['started']
        : norm
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)

    const findQuery: Record<string, any> = { user: patientId }
    if (moduleId) findQuery.module = moduleId

    if (rawStatuses.length > 0) {
      findQuery.status =
        rawStatuses.length === 1 ? rawStatuses[0] : { $in: rawStatuses }
    } else {
      // 'all' -> no status filter; otherwise default already applied above
    }

    // Choose sort & cursor field based on status group
    const isSubmittedView =
      rawStatuses.length === 0 // 'all'
        ? false
        : rawStatuses.length === 1 && rawStatuses[0] === 'submitted'

    const sortField = isSubmittedView ? 'completedAt' : 'lastInteractionAt'

    // Cursor (ISO date string) works against the chosen sort field
    if (cursor) {
      const cursorDate = new Date(cursor)
      if (!isNaN(cursorDate.getTime())) {
        findQuery[sortField] = { $lt: cursorDate }
      }
    }

    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100)

    const attempts = await ModuleAttempt.find(findQuery)
      .sort({ [sortField]: -1 }) // newest first by chosen field
      .limit(pageSize + 1) // fetch one extra to detect next page
      .select(
        '_id totalScore scoreBandLabel weekStart completedAt startedAt lastInteractionAt iteration moduleType module program dueAt userNote status answers moduleSnapshot.questions diaryEntries.at'
      )
      .lean()
      .populate('module', 'title')

    let nextCursor: string | null = null
    if (attempts.length > pageSize) {
      const last = attempts[pageSize - 1]
      const ts = last?.[sortField] as Date | string | undefined
      nextCursor = ts ? new Date(ts).toISOString() : null
      attempts.length = pageSize
    }

    const rows = attempts.map((a: any) => ({
      ...a,
      percentComplete:
        a.status === 'submitted' ? 100 : computePercentCompleteForAttempt(a),
    }))

    res.status(200).json({
      success: true,
      attempts: rows,
      nextCursor,
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

export const getMyAttemptDetail = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const { attemptId } = req.params

    const attempt = await ModuleAttempt.findById(attemptId).lean()
    if (!attempt) {
      res.status(404).json({ success: false, message: 'Attempt not found' })

      return
    }

    if (String(attempt.user) !== String(userId)) {
      res.status(403).json({ success: false, message: 'Forbidden' })
      return
    }

    // Optionally join band for questionnaires when missing (self-view wants full context)
    let band: any = undefined
    if (attempt.moduleType === 'questionnaire' && attempt.totalScore != null) {
      band = await ScoreBand.findOne({
        module: attempt.module,
        min: { $lte: attempt.totalScore },
        max: { $gte: attempt.totalScore },
      })
        .select('_id label interpretation min max')
        .lean()
    }

    const payload: any = { ...attempt, band }
    if (attempt.moduleType === 'questionnaire') {
      payload.detail = decorateAttemptItems(attempt)
    } else if (attempt.moduleType === 'activity_diary') {
      payload.diary = decorateDiaryDetail(attempt)
    }

    res.status(200).json({
      success: true,
      attempt: payload,
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /therapist/attempts/:attemptId
export const getAttemptDetailForTherapist = async (
  req: Request,
  res: Response
) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(
      therapistId,
      'roles isVerifiedTherapist'
    ).lean()

    if (
      !me ||
      (!me.roles?.includes(UserRole.ADMIN) &&
        !(me.roles?.includes(UserRole.THERAPIST) && me.isVerifiedTherapist))
    ) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const { attemptId } = req.params
    const attempt = await ModuleAttempt.findById(attemptId).lean()
    if (!attempt) {
      res.status(404).json({ success: false, message: 'Attempt not found' })
      return
    }

    const isOwnerTherapist =
      String(attempt.therapist || '') === String(therapistId)
    const isAdmin = me.roles?.includes(UserRole.ADMIN)
    if (!isOwnerTherapist && !isAdmin) {
      res.status(403).json({ success: false, message: 'Forbidden' })
      return
    }

    // Join band if applicable
    let band: any = undefined
    if (attempt.moduleType === 'questionnaire' && attempt.totalScore != null) {
      band = await ScoreBand.findOne({
        module: attempt.module,
        min: { $lte: attempt.totalScore },
        max: { $gte: attempt.totalScore },
      })
        .select('_id label interpretation min max')
        .lean()
    }

    // Optional: join patient + module titles for header context
    const [patient, moduleDoc] = await Promise.all([
      User.findById(attempt.user).select('_id name username email').lean(),
      Module.findById(attempt.module).select('_id title type').lean(),
    ])

    const payload: any = {
      ...attempt,
      band,
      patient: patient
        ? {
            _id: patient._id,
            name: patient.name,
            username: patient.username,
            email: patient.email,
          }
        : undefined,
      module: moduleDoc
        ? { _id: moduleDoc._id, title: moduleDoc.title, type: moduleDoc.type }
        : undefined,
    }

    if (attempt.moduleType === 'questionnaire') {
      payload.detail = decorateAttemptItems(attempt)
    } else if (attempt.moduleType === 'activity_diary') {
      payload.diary = decorateDiaryDetail(attempt)
    }

    res.status(200).json({ success: true, attempt: payload })
  } catch (error) {
    errorHandler(res, error)
  }
}
