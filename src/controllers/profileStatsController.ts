import { Request, Response } from 'express'
import { DateTime } from 'luxon'
import ModuleAttempt from '../models/moduleAttemptModel'
import ModuleAssignment from '../models/moduleAssignmentModel'
import { errorHandler } from '../utils/errorHandler'
import type { PatientProfileStatsResponse } from '../shared-types/types'

const LONDON_TZ = 'Europe/London'

const getWeekStart = (): Date => {
  const now = DateTime.now().setZone(LONDON_TZ)
  return now.startOf('week').toUTC().toJSDate() // Monday 00:00
}

export const getProfileStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const weekStart = getWeekStart()

    // Latest completed attempt (any module type)
    const latestAttempt = await ModuleAttempt.findOne({
      user: userId,
      status: 'submitted',
    })
      .sort({ completedAt: -1 })
      .populate('module', 'title')
      .lean()

    let latestCompletion: PatientProfileStatsResponse['latestCompletion'] = null

    if (latestAttempt?.completedAt) {
      const mod = latestAttempt.module as unknown as { title: string }
      latestCompletion = {
        attemptId: latestAttempt._id.toString(),
        moduleTitle: mod.title,
        completedAt: latestAttempt.completedAt.toISOString(),
      }
    }

    // Assignments completed this week
    const sessionsThisWeek = await ModuleAssignment.countDocuments({
      user: userId,
      status: 'completed',
      completedAt: { $gte: weekStart },
    })

    // Active assignments due
    const assignmentsDue = await ModuleAssignment.countDocuments({
      user: userId,
      status: { $in: ['assigned', 'in_progress'] },
    })

    const response: PatientProfileStatsResponse = {
      latestCompletion,
      sessionsThisWeek,
      assignmentsDue,
    }

    res.status(200).json(response)
  } catch (error) {
    errorHandler(res, error)
  }
}
