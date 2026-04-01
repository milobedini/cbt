import { DateTime } from 'luxon'
import type { Types } from 'mongoose'
import ModuleAttempt from '../models/moduleAttemptModel'
import type { PracticeItem, PracticeItemStatus } from '../shared-types/types'
import { computePercentCompleteForAttempt } from '../controllers/attemptsController'

const LONDON_TZ = 'Europe/London'

/**
 * Bucket practice items into today / thisWeek / upcoming / recentlyCompleted
 */
export const bucketPracticeItems = (
  items: PracticeItem[]
): {
  today: PracticeItem[]
  thisWeek: PracticeItem[]
  upcoming: PracticeItem[]
  recentlyCompleted: PracticeItem[]
} => {
  const now = DateTime.now().setZone(LONDON_TZ)
  const todayEnd = now.endOf('day')
  const weekEnd = now.endOf('week') // Sunday end

  const today: PracticeItem[] = []
  const thisWeek: PracticeItem[] = []
  const upcoming: PracticeItem[] = []
  const recentlyCompleted: PracticeItem[] = []

  for (const item of items) {
    if (item.status === 'completed') {
      recentlyCompleted.push(item)
      continue
    }

    if (!item.dueAt) {
      upcoming.push(item)
      continue
    }

    const due = DateTime.fromISO(item.dueAt, { zone: LONDON_TZ })

    if (due <= todayEnd) {
      // Due today or overdue
      today.push(item)
    } else if (due <= weekEnd) {
      thisWeek.push(item)
    } else {
      upcoming.push(item)
    }
  }

  return {
    today: today.sort(sortByDueAsc),
    thisWeek: thisWeek.sort(sortByDueAsc),
    upcoming: upcoming.sort(sortByDueAsc),
    recentlyCompleted: recentlyCompleted.slice(0, 5),
  }
}

const sortByDueAsc = (a: PracticeItem, b: PracticeItem): number => {
  if (!a.dueAt && !b.dueAt) return 0
  if (!a.dueAt) return 1
  if (!b.dueAt) return -1
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
}

/**
 * Map assignment status to practice item status
 */
export const toPracticeStatus = (
  assignmentStatus: string
): PracticeItemStatus => {
  switch (assignmentStatus) {
    case 'assigned':
      return 'not_started'
    case 'in_progress':
      return 'in_progress'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'completed' // treat cancelled as done
    default:
      return 'not_started'
  }
}

/**
 * Compute the next due date for a recurring assignment.
 * Anchors to the ORIGINAL dueAt, not the completion date.
 */
export const computeNextDueDate = (
  currentDueAt: Date | undefined,
  completedAt: Date,
  freq: 'weekly' | 'monthly' | 'none',
  interval: number = 1
): Date | undefined => {
  if (freq === 'none') return undefined

  // Anchor to original due date if available, else fall back to completedAt
  const anchor = currentDueAt ?? completedAt
  const dt = DateTime.fromJSDate(anchor, { zone: LONDON_TZ })

  const next =
    freq === 'weekly'
      ? dt.plus({ weeks: interval })
      : dt.plus({ months: interval })

  return next.toJSDate()
}

/**
 * Compute sparkline data: last 5 scores per scored module for a user.
 */
export const computeSparklines = async (
  userId: Types.ObjectId
): Promise<Record<string, number[]>> => {
  const pipeline = [
    {
      $match: {
        user: userId,
        status: 'submitted',
        moduleType: 'questionnaire',
        totalScore: { $ne: null },
      },
    },
    { $sort: { completedAt: -1 as const } },
    {
      $group: {
        _id: '$module',
        scores: { $push: '$totalScore' },
      },
    },
    {
      $project: {
        scores: { $slice: ['$scores', 5] },
      },
    },
  ]

  const results = await ModuleAttempt.aggregate(pipeline)
  const sparklines: Record<string, number[]> = {}
  for (const row of results) {
    // Reverse so oldest is first (for sparkline left-to-right)
    sparklines[row._id.toString()] = (row.scores as number[]).reverse()
  }
  return sparklines
}

/**
 * Build a PracticeItem from a populated assignment document.
 * Expects assignment to have been populated with module, program, therapist, latestAttempt.
 */
export const assignmentToPracticeItem = (
  asg: any // populated lean document
): PracticeItem => {
  const la = asg.latestAttempt as any | undefined
  const percentComplete =
    asg.status === 'completed'
      ? 100
      : la
        ? computePercentCompleteForAttempt(la)
        : 0

  return {
    assignmentId: asg._id.toString(),
    moduleId: asg.module?._id?.toString() ?? '',
    moduleTitle: asg.module?.title ?? '',
    moduleType: asg.moduleType,
    programTitle: asg.program?.title ?? '',
    source: asg.source ?? 'therapist',
    therapistName: asg.therapist?.name ?? undefined,
    status: toPracticeStatus(asg.status),
    dueAt: asg.dueAt?.toISOString(),
    recurrence: asg.recurrence,
    notes: asg.notes,
    percentComplete,
    attemptCount: asg.attemptCount ?? 0,
    latestAttempt: la
      ? {
          attemptId: la._id.toString(),
          status: la.status,
          totalScore: la.totalScore ?? undefined,
          scoreBandLabel: la.scoreBandLabel ?? undefined,
          completedAt: la.completedAt?.toISOString(),
          iteration: la.iteration ?? 1,
        }
      : undefined,
  }
}
