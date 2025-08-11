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
// enrollment check based on Module.enrolled array
async function isEnrolled(userId: Types.ObjectId, moduleId: Types.ObjectId) {
  const mod = await Module.findOne({ _id: moduleId, enrolled: userId })
    .select('_id')
    .lean()
  return !!mod
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

    // enforce enrollment for self-starts (when no assignment or policy requires it)
    if (mod.accessPolicy === 'enrolled' && !assignment) {
      const enrolled = await isEnrolled(userId, mod._id as Types.ObjectId)
      if (!enrolled) {
        res.status(403).json({
          success: false,
          message: 'You must be enrolled in this module to start it',
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
    const { answers, userNote } = req.body as {
      answers?: Array<{ question: string; chosenScore: number }>
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

    if (Array.isArray(answers)) {
      // Optional: validate question ids belong to this module
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
      attempt.answers = answers.map((a) => ({
        question: a.question,
        chosenScore: a.chosenScore,
      })) as any
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

    const now = new Date()
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
      // Drafts/in-progress, newest interaction first
      const match: any = { user: userId, status: 'started' }
      if (moduleId) match.module = new Types.ObjectId(String(moduleId))

      const rows = await ModuleAttempt.find(match)
        .sort({ lastInteractionAt: -1 })
        .limit(lim)
        .select(
          '_id module program moduleType startedAt lastInteractionAt iteration userNote dueAt'
        )
        .lean()

      res.status(200).json({ success: true, attempts: rows, nextCursor: null })
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
      { $addFields: { band: { $arrayElemAt: ['$band', 0] } } },
      {
        $project: {
          _id: 1,
          module: 1,
          program: 1,
          moduleType: 1,
          totalScore: 1,
          scoreBandLabel: 1,
          completedAt: 1,
          weekStart: 1,
          iteration: 1,
          band: 1,
        },
      },
    ] as any[]

    const rows = await (ModuleAttempt as any).aggregate(pipeline)
    // simple time cursor (ISO). If you want 2-field cursor, we can upgrade later.
    const nextCursor = null
    res.status(200).json({ success: true, attempts: rows, nextCursor })
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

    res.status(200).json({ success: true, rows })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /therapist/patients/:patientId/modules/:moduleId/attempts
// Therapist: timeline for one patient + module
export const getPatientModuleTimeline = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(therapistId, 'roles isVerifiedTherapist')
    if (!me || (!isAdmin(me) && !isVerifiedTherapist(me))) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const { patientId, moduleId } = req.params
    const canSee =
      isAdmin(me) ||
      (await therapistCanSeePatient(therapistId, new Types.ObjectId(patientId)))
    if (!canSee) {
      res.status(403).json({ success: false, message: 'Forbidden' })
      return
    }

    const attempts = await ModuleAttempt.find({
      user: patientId,
      module: moduleId,
      status: 'submitted',
    })
      .sort({ completedAt: -1 })
      .select(
        '_id totalScore scoreBandLabel weekStart completedAt iteration moduleType'
      )
      .lean()

    res.status(200).json({ success: true, attempts })
  } catch (error) {
    errorHandler(res, error)
  }
}
