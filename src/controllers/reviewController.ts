import type { Request, Response } from 'express'
import { Types } from 'mongoose'
import ModuleAssignment from '../models/moduleAssignmentModel'
import ModuleAttempt from '../models/moduleAttemptModel'
import User from '../models/userModel'
import { errorHandler } from '../utils/errorHandler'
import { assignmentToPracticeItem } from '../utils/practiceUtils'
import type {
  AttentionPriority,
  AttentionReason,
  ReviewItem,
} from '../shared-types/types'

const SEVERE_LABELS = ['Severe', 'Moderately Severe']
const ATTENTION_CAP = 20

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
 * GET /api/user/therapist/review
 * Therapist review feed with needs attention and paginated submissions.
 */
export const getTherapistReview = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    if (!therapistId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const {
      sort = 'newest',
      patientId,
      moduleId,
      severity,
      dateFrom,
      dateTo,
      cursor,
      limit: limitStr,
    } = req.query as Record<string, string | undefined>
    const limit = Math.min(Number(limitStr) || 20, 50)

    // Get therapist's patients
    const therapist = await User.findById(therapistId, 'patients').lean()
    const patientIds: Types.ObjectId[] = (therapist?.patients ?? []).map(
      (p: any) => new Types.ObjectId(p.toString())
    )

    if (patientIds.length === 0) {
      res.status(200).json({
        success: true,
        needsAttention: [],
        submissions: { items: [], nextCursor: null, total: 0 },
      })
      return
    }

    // Needs Attention
    const needsAttention = await computeNeedsAttention(
      therapistId,
      patientIds
    )

    // All Submissions (paginated)
    const submissionMatch: Record<string, any> = {
      user: { $in: patientId ? [new Types.ObjectId(patientId)] : patientIds },
      status: 'completed',
    }
    if (moduleId) submissionMatch['module'] = new Types.ObjectId(moduleId)
    if (dateFrom || dateTo) {
      submissionMatch['updatedAt'] = {}
      if (dateFrom) submissionMatch['updatedAt']['$gte'] = new Date(dateFrom)
      if (dateTo) submissionMatch['updatedAt']['$lte'] = new Date(dateTo)
    }
    if (cursor) {
      submissionMatch['updatedAt'] = {
        ...(submissionMatch['updatedAt'] ?? {}),
        ...(sort === 'oldest'
          ? { $gt: new Date(cursor) }
          : { $lt: new Date(cursor) }),
      }
    }

    const sortDir = sort === 'oldest' ? 1 : -1
    const sortField =
      sort === 'severity'
        ? { totalScore: -1, updatedAt: -1 }
        : { updatedAt: sortDir }

    const submissions = await ModuleAssignment.find(submissionMatch)
      .sort(sortField as any)
      .limit(limit + 1)
      .populate(POPULATE_FIELDS)
      .populate('user', '_id name username email')
      .lean()

    const hasNext = submissions.length > limit
    const page = hasNext ? submissions.slice(0, limit) : submissions

    const submissionItems: ReviewItem[] = page.map((asg) => {
      const base = assignmentToPracticeItem({ ...asg, attemptCount: 0 })
      const userObj = asg.user as any
      return {
        ...base,
        patientId: userObj?._id?.toString() ?? '',
        patientName: userObj?.name ?? userObj?.username ?? '',
      }
    })

    // Severity filter (post-query for simplicity)
    const filteredItems = severity
      ? submissionItems.filter((item) => {
          const band = item.latestAttempt?.scoreBandLabel?.toLowerCase() ?? ''
          if (severity === 'severe')
            return band === 'severe' || band === 'moderately severe'
          if (severity === 'moderate') return band === 'moderate'
          if (severity === 'mild') return band === 'mild'
          return true
        })
      : submissionItems

    const total = await ModuleAssignment.countDocuments({
      user: { $in: patientId ? [new Types.ObjectId(patientId)] : patientIds },
      status: 'completed',
    })

    const nextCursor =
      hasNext && page.length > 0
        ? (page[page.length - 1] as any).updatedAt?.toISOString()
        : null

    res.status(200).json({
      success: true,
      needsAttention,
      submissions: { items: filteredItems, nextCursor, total },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

/**
 * Compute the "Needs Attention" list for a therapist's patients.
 */
const computeNeedsAttention = async (
  therapistId: Types.ObjectId,
  patientIds: Types.ObjectId[]
): Promise<ReviewItem[]> => {
  const items: (ReviewItem & { _sortPriority: number; _sortDate: Date })[] = []

  // 1. Severe scores
  const severeAttempts = await ModuleAttempt.find({
    user: { $in: patientIds },
    status: 'submitted',
    scoreBandLabel: { $in: SEVERE_LABELS },
  })
    .sort({ completedAt: -1 })
    .limit(ATTENTION_CAP)
    .populate('user', '_id name username')
    .populate('module', '_id title type')
    .lean()

  for (const att of severeAttempts) {
    const userObj = att.user as any
    items.push({
      assignmentId: '',
      moduleId: (att.module as any)?._id?.toString() ?? '',
      moduleTitle: (att.module as any)?.title ?? '',
      moduleType: att.moduleType,
      programTitle: '',
      source: 'therapist',
      status: 'completed',
      percentComplete: 100,
      attemptCount: 0,
      latestAttempt: {
        attemptId: att._id.toString(),
        status: att.status,
        totalScore: att.totalScore ?? undefined,
        scoreBandLabel: att.scoreBandLabel ?? undefined,
        completedAt: att.completedAt?.toISOString(),
        iteration: att.iteration ?? 1,
      },
      patientId: userObj?._id?.toString() ?? '',
      patientName: userObj?.name ?? userObj?.username ?? '',
      attentionReason: 'severe_score' as AttentionReason,
      attentionPriority: 'high' as AttentionPriority,
      _sortPriority: 0,
      _sortDate: att.completedAt ?? new Date(),
    })
  }

  // 2. Score regression
  const regressions = await ModuleAttempt.aggregate([
    {
      $match: {
        user: { $in: patientIds },
        status: 'submitted',
        moduleType: 'questionnaire',
        totalScore: { $ne: null },
      },
    },
    { $sort: { completedAt: -1 } },
    {
      $group: {
        _id: { user: '$user', module: '$module' },
        scores: {
          $push: {
            score: '$totalScore',
            completedAt: '$completedAt',
            attemptId: '$_id',
          },
        },
      },
    },
    {
      $project: {
        latest: { $arrayElemAt: ['$scores', 0] },
        previous: { $arrayElemAt: ['$scores', 1] },
      },
    },
    {
      $match: {
        previous: { $ne: null },
        $expr: { $gt: ['$latest.score', '$previous.score'] },
      },
    },
  ])

  for (const reg of regressions) {
    const attemptId = reg.latest.attemptId.toString()
    if (items.some((i) => i.latestAttempt?.attemptId === attemptId)) continue

    const att = await ModuleAttempt.findById(reg.latest.attemptId)
      .populate('user', '_id name username')
      .populate('module', '_id title type')
      .lean()
    if (!att) continue

    const userObj = att.user as any
    items.push({
      assignmentId: '',
      moduleId: (att.module as any)?._id?.toString() ?? '',
      moduleTitle: (att.module as any)?.title ?? '',
      moduleType: att.moduleType,
      programTitle: '',
      source: 'therapist',
      status: 'completed',
      percentComplete: 100,
      attemptCount: 0,
      latestAttempt: {
        attemptId: att._id.toString(),
        status: att.status,
        totalScore: att.totalScore ?? undefined,
        scoreBandLabel: att.scoreBandLabel ?? undefined,
        completedAt: att.completedAt?.toISOString(),
        iteration: att.iteration ?? 1,
      },
      patientId: userObj?._id?.toString() ?? '',
      patientName: userObj?.name ?? userObj?.username ?? '',
      attentionReason: 'score_regression' as AttentionReason,
      attentionPriority: 'high' as AttentionPriority,
      _sortPriority: 0,
      _sortDate: att.completedAt ?? new Date(),
    })
  }

  // 3. Overdue + not started (2+ days past due)
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  const overdueAssignments = await ModuleAssignment.find({
    user: { $in: patientIds },
    therapist: therapistId,
    status: 'assigned',
    dueAt: { $lt: twoDaysAgo },
  })
    .limit(ATTENTION_CAP)
    .populate('module', '_id title type')
    .populate('user', '_id name username')
    .populate('program', '_id title')
    .lean()

  for (const asg of overdueAssignments) {
    const userObj = asg.user as any
    items.push({
      assignmentId: asg._id.toString(),
      moduleId: (asg.module as any)?._id?.toString() ?? '',
      moduleTitle: (asg.module as any)?.title ?? '',
      moduleType: asg.moduleType,
      programTitle: (asg.program as any)?.title ?? '',
      source: (asg as any).source ?? 'therapist',
      status: 'not_started',
      dueAt: asg.dueAt?.toISOString(),
      percentComplete: 0,
      attemptCount: 0,
      patientId: userObj?._id?.toString() ?? '',
      patientName: userObj?.name ?? userObj?.username ?? '',
      attentionReason: 'overdue' as AttentionReason,
      attentionPriority: 'medium' as AttentionPriority,
      _sortPriority: 1,
      _sortDate: asg.dueAt ?? new Date(),
    })
  }

  // 4. First submission
  const firstSubmissions = await ModuleAttempt.aggregate([
    { $match: { user: { $in: patientIds }, status: 'submitted' } },
    {
      $group: {
        _id: '$user',
        count: { $sum: 1 },
        latest: { $first: '$$ROOT' },
      },
    },
    { $match: { count: 1 } },
  ])

  for (const fs of firstSubmissions) {
    const att = fs.latest
    const attemptId = att._id.toString()
    if (items.some((i) => i.latestAttempt?.attemptId === attemptId)) continue

    const userDoc = await User.findById(fs._id, '_id name username').lean()
    if (!userDoc) continue
    const modDoc = await ModuleAttempt.findById(att._id)
      .populate('module', '_id title type')
      .lean()
    if (!modDoc) continue

    items.push({
      assignmentId: '',
      moduleId: (modDoc.module as any)?._id?.toString() ?? '',
      moduleTitle: (modDoc.module as any)?.title ?? '',
      moduleType: att.moduleType,
      programTitle: '',
      source: 'therapist',
      status: 'completed',
      percentComplete: 100,
      attemptCount: 1,
      latestAttempt: {
        attemptId: att._id.toString(),
        status: att.status,
        totalScore: att.totalScore ?? undefined,
        scoreBandLabel: att.scoreBandLabel ?? undefined,
        completedAt: att.completedAt?.toISOString(),
        iteration: att.iteration ?? 1,
      },
      patientId: userDoc._id.toString(),
      patientName: (userDoc as any).name ?? (userDoc as any).username ?? '',
      attentionReason: 'first_submission' as AttentionReason,
      attentionPriority: 'low' as AttentionPriority,
      _sortPriority: 2,
      _sortDate: att.completedAt ?? new Date(),
    })
  }

  // Sort: priority asc, then date desc. Cap at ATTENTION_CAP.
  items.sort((a, b) => {
    if (a._sortPriority !== b._sortPriority)
      return a._sortPriority - b._sortPriority
    return b._sortDate.getTime() - a._sortDate.getTime()
  })

  // Strip internal sort fields and cap
  return items
    .slice(0, ATTENTION_CAP)
    .map(({ _sortPriority, _sortDate, ...rest }) => rest)
}
