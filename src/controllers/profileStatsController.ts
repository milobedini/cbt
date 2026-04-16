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

    // Latest questionnaire score
    const latestAttempt = await ModuleAttempt.findOne({
      user: userId,
      status: 'submitted',
      moduleType: 'questionnaire',
      totalScore: { $ne: null },
    })
      .sort({ completedAt: -1 })
      .populate('module', 'title')
      .lean()

    let latestScore: PatientProfileStatsResponse['latestScore'] = null

    if (latestAttempt) {
      // Find previous score for the same module to determine trend
      const previousAttempt = await ModuleAttempt.findOne({
        user: userId,
        module: latestAttempt.module,
        status: 'submitted',
        moduleType: 'questionnaire',
        totalScore: { $ne: null },
        _id: { $ne: latestAttempt._id },
      })
        .sort({ completedAt: -1 })
        .lean()

      let trend: 'improving' | 'worsening' | 'stable' = 'stable'
      if (previousAttempt?.totalScore != null && latestAttempt.totalScore != null) {
        if (latestAttempt.totalScore < previousAttempt.totalScore) trend = 'improving'
        else if (latestAttempt.totalScore > previousAttempt.totalScore) trend = 'worsening'
      }

      const mod = latestAttempt.module as unknown as { title: string }
      latestScore = {
        moduleTitle: mod.title,
        score: latestAttempt.totalScore!,
        band: latestAttempt.scoreBandLabel ?? 'unknown',
        trend,
      }
    }

    // Sessions completed this week
    const sessionsThisWeek = await ModuleAttempt.countDocuments({
      user: userId,
      status: 'submitted',
      completedAt: { $gte: weekStart },
    })

    // Active assignments due
    const assignmentsDue = await ModuleAssignment.countDocuments({
      user: userId,
      status: { $in: ['assigned', 'in_progress'] },
    })

    const response: PatientProfileStatsResponse = {
      latestScore,
      sessionsThisWeek,
      assignmentsDue,
    }

    res.status(200).json(response)
  } catch (error) {
    errorHandler(res, error)
  }
}
