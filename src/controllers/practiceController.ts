import type { Request, Response } from 'express'
import { Types } from 'mongoose'
import ModuleAssignment from '../models/moduleAssignmentModel'
import ModuleAttempt from '../models/moduleAttemptModel'
import { errorHandler } from '../utils/errorHandler'
import { therapistCanSeePatient } from '../utils/attemptUtils'
import {
  assignmentToPracticeItem,
  bucketPracticeItems,
  computeSparklines,
} from '../utils/practiceUtils'

const POPULATE_FIELDS = [
  { path: 'module', select: '_id title type accessPolicy' },
  { path: 'program', select: '_id title' },
  { path: 'therapist', select: 'name' },
  {
    path: 'latestAttempt',
    select: [
      '_id',
      'status',
      'completedAt',
      'totalScore',
      'scoreBandLabel',
      'answers',
      'moduleSnapshot.questions',
      'diaryEntries.at',
      'diaryEntries.activity',
      'diaryEntries.mood',
      'diaryEntries.achievement',
      'diaryEntries.closeness',
      'diaryEntries.enjoyment',
      'moduleType',
      'startedAt',
      'lastInteractionAt',
      'iteration',
    ].join(' '),
  },
]

/**
 * GET /api/user/practice
 * Patient's unified practice view bucketed by time.
 */
export const getMyPractice = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    // Active items
    const activeItems = await ModuleAssignment.find({
      user: userId,
      status: { $in: ['assigned', 'in_progress'] },
    })
      .sort({ dueAt: 1, createdAt: -1 })
      .populate(POPULATE_FIELDS)
      .lean()

    // Recently completed (last 5)
    const completedItems = await ModuleAssignment.find({
      user: userId,
      status: 'completed',
    })
      .sort({ completedAt: -1 })
      .limit(5)
      .populate(POPULATE_FIELDS)
      .lean()

    // Count attempts per module for this user
    const allModuleIds = [...activeItems, ...completedItems].map((a) =>
      typeof a.module === 'object' ? (a.module as any)._id : a.module
    )
    const attemptCounts = await ModuleAttempt.aggregate([
      {
        $match: {
          user: userId,
          module: { $in: allModuleIds },
          status: 'submitted',
        },
      },
      { $group: { _id: '$module', count: { $sum: 1 } } },
    ])
    const countMap = new Map(
      attemptCounts.map((r) => [r._id.toString(), r.count as number])
    )

    const allItems = [...activeItems, ...completedItems].map((asg) => {
      const mod = asg.module as any
      const moduleId =
        mod && typeof mod === 'object' ? mod._id?.toString() : mod?.toString()
      return assignmentToPracticeItem({
        ...asg,
        attemptCount: countMap.get(moduleId) ?? 0,
      })
    })

    const bucketed = bucketPracticeItems(allItems)

    res.status(200).json({ success: true, ...bucketed })
  } catch (error) {
    errorHandler(res, error)
  }
}

/**
 * GET /api/user/practice/history
 * Patient's completed practice history with cursor pagination.
 */
export const getMyPracticeHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const {
      moduleId,
      moduleType,
      cursor,
      limit: limitStr,
    } = req.query as {
      moduleId?: string
      moduleType?: string
      cursor?: string
      limit?: string
    }
    const limit = Math.min(Number(limitStr) || 20, 50)

    const match: Record<string, any> = {
      user: userId,
      status: 'completed',
    }
    if (moduleId) match['module'] = new Types.ObjectId(moduleId)
    if (moduleType) match['moduleType'] = moduleType
    if (cursor) match['completedAt'] = { $lt: new Date(cursor) }

    const items = await ModuleAssignment.find(match)
      .sort({ completedAt: -1 })
      .limit(limit + 1)
      .populate(POPULATE_FIELDS)
      .lean()

    const hasNext = items.length > limit
    const page = hasNext ? items.slice(0, limit) : items

    // Attempt counts
    const moduleIds = page.map((a) =>
      typeof a.module === 'object' ? (a.module as any)._id : a.module
    )
    const attemptCounts = await ModuleAttempt.aggregate([
      {
        $match: {
          user: userId,
          module: { $in: moduleIds },
          status: 'submitted',
        },
      },
      { $group: { _id: '$module', count: { $sum: 1 } } },
    ])
    const countMap = new Map(
      attemptCounts.map((r) => [r._id.toString(), r.count as number])
    )

    const practiceItems = page.map((asg) => {
      const mod = asg.module as any
      const modId =
        mod && typeof mod === 'object' ? mod._id?.toString() : mod?.toString()
      return assignmentToPracticeItem({
        ...asg,
        attemptCount: countMap.get(modId) ?? 0,
      })
    })

    const nextCursor = hasNext
      ? page[page.length - 1].completedAt?.toISOString()
      : null

    res.status(200).json({
      success: true,
      items: practiceItems,
      nextCursor,
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

/**
 * GET /api/user/therapist/patients/:patientId/practice
 * Therapist's view of a patient's practice with sparklines.
 */
export const getPatientPractice = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const { patientId } = req.params

    if (!therapistId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const canSee = await therapistCanSeePatient(
      therapistId,
      new Types.ObjectId(patientId)
    )
    if (!canSee) {
      res.status(403).json({ success: false, message: 'Forbidden' })
      return
    }

    const patientObjId = new Types.ObjectId(patientId)

    // Active items
    const activeItems = await ModuleAssignment.find({
      user: patientObjId,
      status: { $in: ['assigned', 'in_progress'] },
    })
      .sort({ dueAt: 1, createdAt: -1 })
      .populate(POPULATE_FIELDS)
      .lean()

    // Recently completed (last 5)
    const completedItems = await ModuleAssignment.find({
      user: patientObjId,
      status: 'completed',
    })
      .sort({ completedAt: -1 })
      .limit(5)
      .populate(POPULATE_FIELDS)
      .lean()

    // Attempt counts
    const allModuleIds = [...activeItems, ...completedItems].map((a) =>
      typeof a.module === 'object' ? (a.module as any)._id : a.module
    )
    const attemptCounts = await ModuleAttempt.aggregate([
      {
        $match: {
          user: patientObjId,
          module: { $in: allModuleIds },
          status: 'submitted',
        },
      },
      { $group: { _id: '$module', count: { $sum: 1 } } },
    ])
    const countMap = new Map(
      attemptCounts.map((r) => [r._id.toString(), r.count as number])
    )

    const allItems = [...activeItems, ...completedItems].map((asg) => {
      const mod = asg.module as any
      const modId =
        mod && typeof mod === 'object' ? mod._id?.toString() : mod?.toString()
      return assignmentToPracticeItem({
        ...asg,
        attemptCount: countMap.get(modId) ?? 0,
      })
    })

    const bucketed = bucketPracticeItems(allItems)
    const sparklines = await computeSparklines(patientObjId)

    res.status(200).json({ success: true, ...bucketed, sparklines })
  } catch (error) {
    errorHandler(res, error)
  }
}
