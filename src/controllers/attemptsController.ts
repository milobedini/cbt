import { Request, Response } from 'express'
import mongoose, { Types } from 'mongoose'
import Module from '../models/moduleModel'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'
import User, { UserRole } from '../models/userModel'
import ModuleAttempt from '../models/moduleAttemptModel'
import ModuleAssignment from '../models/moduleAssignmentModel'
import { errorHandler } from '../utils/errorHandler'
import { isAdmin, isVerifiedTherapist } from '../utils/roles'
import {
  computeWeekStart,
  findActiveAssignment,
  therapistCanSeePatient,
  makeModuleSnapshot,
  scoreToBand,
  decorateAttemptItems,
  enrichAnswersWithChoiceMetaFromSnapshot,
  enrichAnswersWithChoiceMetaFromDB,
} from '../utils/attemptUtils'
import {
  sanitizeDiaryEntries,
  decorateDiaryDetail,
  computePercentCompleteForAttempt,
  DiaryEntryInput,
} from '../utils/diaryUtils'
import { computeNextDueDate } from '../utils/practiceUtils'

// Re-export for consumers that import from this file
export { computePercentCompleteForAttempt }

// ---- Controllers ----

// POST /modules/:moduleId/attempts
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
    let assignment: Awaited<ReturnType<typeof findActiveAssignment>> = null
    if (assignmentId) {
      assignment = await ModuleAssignment.findOne({
        _id: assignmentId,
        user: userId,
        module: mod._id,
        status: { $in: ['assigned', 'in_progress'] },
      }).lean()
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
    } else {
      // Open module with no assignment provided: auto-discover or auto-create
      assignment = await findActiveAssignment(userId, mod._id as Types.ObjectId)
      if (!assignment) {
        const created = await ModuleAssignment.create({
          user: userId,
          therapist: null,
          program: mod.program,
          module: mod._id,
          moduleType: mod.type,
          status: 'in_progress',
          source: 'self',
        })
        assignment = await ModuleAssignment.findById(created._id).lean()
      }
    }

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
      dueAt: assignment?.dueAt,
      moduleSnapshot: snapshot,
    })

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

    if (attempt.moduleType === 'reading') {
      const { readerNote } = req.body as { readerNote?: string }
      if (readerNote !== undefined) attempt.readerNote = readerNote
      attempt.lastInteractionAt = new Date()
      await attempt.save()
      res.status(200).json({ success: true, attempt })
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
          const key = (e: Record<string, unknown>) =>
            `${new Date(e.at as string).getTime()}|${(e.label as string) || ''}`
          const existing = new Map(
            (attempt.diaryEntries as unknown as Record<string, unknown>[]).map((e) => [key(e), e])
          )
          for (const e of sanitized) existing.set(key(e), e)
          attempt.diaryEntries = Array.from(existing.values()).sort(
            (a, b) =>
              new Date(a.at as string).getTime() - new Date(b.at as string).getTime()
          ) as unknown as typeof attempt.diaryEntries
        } else {
          attempt.diaryEntries = sanitized as unknown as typeof attempt.diaryEntries
        }
      }

      if (typeof userNote === 'string') attempt.userNote = userNote
      attempt.lastInteractionAt = new Date()
      await attempt.save()
      res.status(200).json({ success: true, attempt })
      return
    }

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

      const qMap = new Map(
        qs.map((q) => [String(q._id), { choices: q.choices || [] }])
      )

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
      }) as unknown as typeof attempt.answers
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
export const submitAttempt = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    const { attemptId } = req.params
    const { assignmentId: providedAssignmentId } =
      (req.body as { assignmentId?: string }) || {}
    let assignmentId = providedAssignmentId

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

      const me = await User.findById(userId, 'therapist')
      attempt.therapist = me?.therapist
      await attempt.save()

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

      // Auto-generate next recurring assignment
      if (assignmentId) {
        const completedAssignment = await ModuleAssignment.findById(
          assignmentId
        ).lean()
        if (
          completedAssignment?.recurrence?.freq &&
          completedAssignment.recurrence.freq !== 'none'
        ) {
          const nextDueAt = computeNextDueDate(
            completedAssignment.dueAt,
            now,
            completedAssignment.recurrence.freq,
            completedAssignment.recurrence.interval
          )
          await ModuleAssignment.create({
            user: completedAssignment.user,
            therapist: completedAssignment.therapist,
            program: completedAssignment.program,
            module: completedAssignment.module,
            moduleType: completedAssignment.moduleType,
            status: 'assigned',
            source: (completedAssignment as any).source ?? 'therapist',
            dueAt: nextDueAt,
            recurrence: completedAssignment.recurrence,
            recurrenceGroupId:
              (completedAssignment as any).recurrenceGroupId ??
              completedAssignment._id,
            notes: completedAssignment.notes,
          })
        }
      }

      res.status(200).json({ success: true, attempt })
      return
    }

    if (attempt.moduleType === 'reading') {
      const { readerNote } = (req.body as { readerNote?: string; assignmentId?: string }) || {}
      if (readerNote) attempt.readerNote = readerNote

      attempt.completedAt = now
      attempt.lastInteractionAt = now
      attempt.status = 'submitted'
      attempt.durationSecs = attempt.startedAt
        ? Math.max(0, Math.floor((now.getTime() - attempt.startedAt.getTime()) / 1000))
        : undefined

      const me = await User.findById(userId, 'therapist')
      attempt.therapist = me?.therapist
      await attempt.save()

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

      // Auto-generate next recurring assignment
      if (assignmentId) {
        const completedAssignment = await ModuleAssignment.findById(
          assignmentId
        ).lean()
        if (
          completedAssignment?.recurrence?.freq &&
          completedAssignment.recurrence.freq !== 'none'
        ) {
          const nextDueAt = computeNextDueDate(
            completedAssignment.dueAt,
            now,
            completedAssignment.recurrence.freq,
            completedAssignment.recurrence.interval
          )
          await ModuleAssignment.create({
            user: completedAssignment.user,
            therapist: completedAssignment.therapist,
            program: completedAssignment.program,
            module: completedAssignment.module,
            moduleType: completedAssignment.moduleType,
            status: 'assigned',
            source: (completedAssignment as any).source ?? 'therapist',
            dueAt: nextDueAt,
            recurrence: completedAssignment.recurrence,
            recurrenceGroupId:
              (completedAssignment as any).recurrenceGroupId ??
              completedAssignment._id,
            notes: completedAssignment.notes,
          })
        }
      }

      res.status(200).json({ success: true, attempt })
      return
    }

    if (attempt.moduleType === 'questionnaire') {
      const questions = await Question.find({ module: attempt.module })
        .select('_id')
        .lean()
      const needed = new Set(questions.map((q) => q._id.toString()))
      const got = new Set(
        (attempt.answers || []).map((a) => (a.question as unknown as Types.ObjectId).toString())
      )
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
        enrichAnswersWithChoiceMetaFromSnapshot(attempt as unknown as Parameters<typeof enrichAnswersWithChoiceMetaFromSnapshot>[0])
      } else {
        await enrichAnswersWithChoiceMetaFromDB(attempt as unknown as Parameters<typeof enrichAnswersWithChoiceMetaFromDB>[0])
      }
    }

    const totalScore = (attempt.answers || []).reduce(
      (sum, a) => sum + ((a as unknown as { chosenScore: number }).chosenScore || 0),
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

    const me = await User.findById(userId, 'therapist')
    attempt.therapist = me?.therapist

    await attempt.save()

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

    // Auto-generate next recurring assignment
    if (assignmentId) {
      const completedAssignment = await ModuleAssignment.findById(
        assignmentId
      ).lean()
      if (
        completedAssignment?.recurrence?.freq &&
        completedAssignment.recurrence.freq !== 'none'
      ) {
        const nextDueAt = computeNextDueDate(
          completedAssignment.dueAt,
          now,
          completedAssignment.recurrence.freq,
          completedAssignment.recurrence.interval
        )
        await ModuleAssignment.create({
          user: completedAssignment.user,
          therapist: completedAssignment.therapist,
          program: completedAssignment.program,
          module: completedAssignment.module,
          moduleType: completedAssignment.moduleType,
          status: 'assigned',
          source: (completedAssignment as any).source ?? 'therapist',
          dueAt: nextDueAt,
          recurrence: completedAssignment.recurrence,
          recurrenceGroupId:
            (completedAssignment as any).recurrenceGroupId ??
            completedAssignment._id,
          notes: completedAssignment.notes,
        })
      }
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
      const match: Record<string, unknown> = { user: userId, status: 'started' }
      if (moduleId) match.module = new Types.ObjectId(String(moduleId))

      const rows = await ModuleAttempt.find(match)
        .sort({ lastInteractionAt: -1 })
        .limit(lim)
        .select(
          [
            '_id',
            'module',
            'program',
            'moduleType',
            'startedAt',
            'lastInteractionAt',
            'iteration',
            'userNote',
            'dueAt',
            'status',
            'answers',
            'moduleSnapshot.questions',
            'diaryEntries.at',
            'diaryEntries.activity',
            'diaryEntries.mood',
            'diaryEntries.achievement',
            'diaryEntries.closeness',
            'diaryEntries.enjoyment',
          ].join(' ')
        )
        .lean()
        .populate('module', 'title')

      const attempts = rows.map((a) => ({
        ...a,
        percentComplete: computePercentCompleteForAttempt(a as Parameters<typeof computePercentCompleteForAttempt>[0]),
      }))

      res.status(200).json({ success: true, attempts, nextCursor: null })
      return
    }

    const match: Record<string, unknown> = { user: userId, status: 'submitted' }
    if (moduleId) match.module = new Types.ObjectId(String(moduleId))
    if (cursor) match.completedAt = { $lt: new Date(String(cursor)) }

    const pipeline: mongoose.PipelineStage[] = [
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
      {
        $lookup: {
          from: 'modules',
          localField: 'module',
          foreignField: '_id',
          as: 'module',
        },
      },
      { $unwind: '$module' },
      { $addFields: { band: { $arrayElemAt: ['$band', 0] } } },
      { $addFields: { lastInteractionAt: '$completedAt' } },
      {
        $project: {
          _id: 1,
          module: { _id: 1, title: 1 },
          program: 1,
          moduleType: 1,
          totalScore: 1,
          scoreBandLabel: 1,
          completedAt: 1,
          lastInteraction: 1,
          weekStart: 1,
          iteration: 1,
          band: 1,
          status: 1,
        },
      },
    ]

    const rows = await ModuleAttempt.aggregate(pipeline)
    const attempts = rows.map((a) => ({
      ...a,
      percentComplete: 100,
    }))
    const nextCursor = null
    res.status(200).json({ success: true, attempts, nextCursor })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /user/score-trends
export const getMyScoreTrends = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const pipeline: mongoose.PipelineStage[] = [
      // Only submitted questionnaire attempts with scores
      {
        $match: {
          user: userId,
          status: 'submitted',
          moduleType: 'questionnaire',
          totalScore: { $ne: null },
        },
      },
      // Sort by completion date descending (newest first)
      { $sort: { completedAt: -1 } },
      // Group by module, collect last 5 scores
      {
        $group: {
          _id: '$module',
          scores: { $push: '$totalScore' },
        },
      },
      // Limit to 5 scores per module
      {
        $project: {
          _id: 1,
          scores: { $slice: ['$scores', 5] },
        },
      },
      // Lookup module title
      {
        $lookup: {
          from: 'modules',
          localField: '_id',
          foreignField: '_id',
          as: 'moduleDoc',
        },
      },
      { $unwind: '$moduleDoc' },
      // Shape the output
      {
        $project: {
          moduleId: { $toString: '$_id' },
          moduleTitle: '$moduleDoc.title',
          scores: 1,
        },
      },
    ]

    const rows = await ModuleAttempt.aggregate(pipeline)

    const trends = rows.map((row) => ({
      moduleTitle: row.moduleTitle,
      moduleId: row.moduleId,
      latestScore: row.scores[0],
      previousScore: row.scores.length > 1 ? row.scores[1] : null,
      sparkline: [...row.scores].reverse(), // oldest first for sparkline
    }))

    res.status(200).json({ success: true, trends })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /therapist/attempts/latest
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

    const {
      limit = '20',
      patientId,
      moduleId,
      severity,
      status = 'submitted',
      sort = 'newest',
      cursor,
    } = req.query as {
      limit?: string
      patientId?: string
      moduleId?: string
      severity?: string
      status?: string
      sort?: string
      cursor?: string
    }
    const lim = Math.min(parseInt(limit, 10) || 20, 100)

    // Build dynamic $match
    const match: Record<string, unknown> = { therapist: therapistId }

    // Status filter
    if (status === 'all') {
      // no status filter
    } else if (status === 'active') {
      match.status = 'started'
    } else if (status?.includes(',')) {
      match.status = { $in: status.split(',') }
    } else {
      match.status = status || 'submitted'
    }

    // Patient filter
    if (patientId) {
      if (!Types.ObjectId.isValid(patientId)) {
        res.status(400).json({ success: false, message: 'Invalid patientId' })
        return
      }
      match.user = new Types.ObjectId(patientId)
    }

    // Module filter
    if (moduleId) {
      if (!Types.ObjectId.isValid(moduleId)) {
        res.status(400).json({ success: false, message: 'Invalid moduleId' })
        return
      }
      match.module = new Types.ObjectId(moduleId)
    }

    // Severity filter (score band label regex)
    if (severity === 'severe') {
      match.scoreBandLabel = { $regex: /severe|high/i }
    } else if (severity === 'moderate') {
      match.scoreBandLabel = { $regex: /moderate/i }
    } else if (severity === 'mild') {
      match.scoreBandLabel = { $regex: /mild|minimal|low/i }
    }

    // Sort
    let sortStage: Record<string, 1 | -1>
    if (sort === 'oldest') {
      sortStage = { completedAt: 1, _id: 1 }
    } else if (sort === 'severity') {
      sortStage = { _severityWeight: -1, completedAt: -1, _id: -1 }
    } else {
      sortStage = { completedAt: -1, _id: -1 }
    }

    // Snapshot base match BEFORE cursor conditions (for totalCount)
    const baseMatch = { ...match }

    // Cursor filter (for pagination) — compound tiebreaker on (completedAt, _id)
    if (cursor && sort !== 'severity') {
      const parts = cursor.split('_')
      const cursorDate = new Date(parts[0])
      const cursorId = parts[1]
      if (!isNaN(cursorDate.getTime())) {
        if (cursorId && !Types.ObjectId.isValid(cursorId)) {
          res.status(400).json({ success: false, message: 'Invalid cursor ID' })
          return
        }
        if (sort === 'oldest') {
          if (cursorId) {
            match.$or = [
              { completedAt: { $gt: cursorDate } },
              { completedAt: cursorDate, _id: { $gt: new Types.ObjectId(cursorId) } },
            ]
          } else {
            match.completedAt = { $gt: cursorDate }
          }
        } else {
          if (cursorId) {
            match.$or = [
              { completedAt: { $lt: cursorDate } },
              { completedAt: cursorDate, _id: { $lt: new Types.ObjectId(cursorId) } },
            ]
          } else {
            match.completedAt = { $lt: cursorDate }
          }
        }
      }
    }

    const pipeline: mongoose.PipelineStage[] = [{ $match: match }]

    // Add severity weight for severity sort
    if (sort === 'severity') {
      pipeline.push({
        $addFields: {
          _severityWeight: {
            $switch: {
              branches: [
                {
                  case: {
                    $regexMatch: {
                      input: { $ifNull: ['$scoreBandLabel', ''] },
                      regex: /severe|high/i,
                    },
                  },
                  then: 3,
                },
                {
                  case: {
                    $regexMatch: {
                      input: { $ifNull: ['$scoreBandLabel', ''] },
                      regex: /moderate/i,
                    },
                  },
                  then: 2,
                },
                {
                  case: {
                    $regexMatch: {
                      input: { $ifNull: ['$scoreBandLabel', ''] },
                      regex: /mild|minimal|low/i,
                    },
                  },
                  then: 1,
                },
              ],
              default: 0,
            },
          },
        },
      })

      // Cursor for severity sort: "weight_isoDate_id"
      if (cursor) {
        const [wStr, isoDate, id] = cursor.split('_')
        const w = parseInt(wStr, 10)
        const d = new Date(isoDate)
        if (!isNaN(w) && !isNaN(d.getTime()) && id) {
          if (!Types.ObjectId.isValid(id)) {
            res.status(400).json({ success: false, message: 'Invalid cursor ID' })
            return
          }
          pipeline.push({
            $match: {
              $or: [
                { _severityWeight: { $lt: w } },
                { _severityWeight: w, completedAt: { $lt: d } },
                {
                  _severityWeight: w,
                  completedAt: d,
                  _id: { $lt: new Types.ObjectId(id) },
                },
              ],
            },
          })
        }
      }
    }

    pipeline.push(
      { $sort: sortStage },
      { $limit: lim + 1 },
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
              $project: {
                _id: 1,
                label: 1,
                interpretation: 1,
                min: 1,
                max: 1,
              },
            },
          ],
          as: 'band',
        },
      },
      { $addFields: { band: { $arrayElemAt: ['$band', 0] } } },
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
          moduleType: 1,
          totalScore: 1,
          scoreBandLabel: 1,
          band: 1,
          completedAt: 1,
          weekStart: 1,
          iteration: 1,
          _severityWeight: 1,
        },
      },
    )

    const rows = await ModuleAttempt.aggregate(pipeline)

    // Count total matching (without cursor conditions) for header subtitle
    const totalCount = await ModuleAttempt.countDocuments(baseMatch)

    // Determine nextCursor
    const hasMore = rows.length > lim
    const pageRows = hasMore ? rows.slice(0, lim) : rows

    let nextCursor: string | null = null
    if (hasMore) {
      const last = pageRows[pageRows.length - 1]
      if (sort === 'severity') {
        nextCursor = `${last._severityWeight}_${last.completedAt}_${last._id}`
      } else {
        nextCursor = new Date(last.completedAt).toISOString() + '_' + last._id
      }
    }

    // Clean up internal fields and decorate
    const decorated = pageRows.map(
      ({ _severityWeight, ...r }: { _severityWeight?: number; [key: string]: unknown }) => ({
        ...r,
        percentComplete: 100,
      }),
    )

    res.status(200).json({ success: true, rows: decorated, nextCursor, totalCount })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /therapist/patients/:patientId/modules/:moduleId/attempts
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
      severity,
    } = req.query as {
      limit?: string
      cursor?: string
      status?: string
      moduleId?: string
      severity?: string
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

    const norm = (status ?? 'submitted').toString().trim().toLowerCase()
    const rawStatuses =
      norm === 'all'
        ? []
        : norm === 'active'
          ? ['started']
          : norm
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)

    const findQuery: Record<string, unknown> = { user: patientId }
    if (moduleId) findQuery.module = moduleId

    if (rawStatuses.length > 0) {
      findQuery.status =
        rawStatuses.length === 1 ? rawStatuses[0] : { $in: rawStatuses }
    }

    if (severity === 'severe') {
      findQuery.scoreBandLabel = { $regex: /severe|high/i }
    } else if (severity === 'moderate') {
      findQuery.scoreBandLabel = { $regex: /moderate/i }
    } else if (severity === 'mild') {
      findQuery.scoreBandLabel = { $regex: /mild|minimal|low/i }
    }

    const isSubmittedView =
      rawStatuses.length === 0
        ? false
        : rawStatuses.length === 1 && rawStatuses[0] === 'submitted'

    const sortField = isSubmittedView ? 'completedAt' : 'lastInteractionAt'

    if (cursor) {
      const cursorDate = new Date(cursor)
      if (!isNaN(cursorDate.getTime())) {
        findQuery[sortField] = { $lt: cursorDate }
      }
    }

    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100)

    const attempts = await ModuleAttempt.find(findQuery)
      .sort({ [sortField]: -1 })
      .limit(pageSize + 1)
      .select(
        [
          '_id',
          'totalScore',
          'scoreBandLabel',
          'weekStart',
          'completedAt',
          'startedAt',
          'lastInteractionAt',
          'iteration',
          'moduleType',
          'module',
          'program',
          'dueAt',
          'userNote',
          'status',
          'answers',
          'moduleSnapshot.questions',
          'diaryEntries.at',
          'diaryEntries.activity',
          'diaryEntries.mood',
          'diaryEntries.achievement',
          'diaryEntries.closeness',
          'diaryEntries.enjoyment',
        ].join(' ')
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

    const rows = attempts.map((a) => ({
      ...a,
      percentComplete:
        a.status === 'submitted' ? 100 : computePercentCompleteForAttempt(a as Parameters<typeof computePercentCompleteForAttempt>[0]),
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

export const getPatientModules = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(therapistId, 'roles isVerifiedTherapist')
    if (!me || (!isAdmin(me) && !isVerifiedTherapist(me))) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const { patientId } = req.params
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

    const modules = await ModuleAttempt.aggregate([
      { $match: { user: new Types.ObjectId(patientId) } },
      { $group: { _id: '$module' } },
      {
        $lookup: {
          from: 'modules',
          localField: '_id',
          foreignField: '_id',
          as: 'mod',
        },
      },
      { $addFields: { mod: { $arrayElemAt: ['$mod', 0] } } },
      {
        $project: {
          _id: 1,
          title: '$mod.title',
        },
      },
      { $sort: { title: 1 } },
    ])

    res.status(200).json({ success: true, modules })
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

    let band = undefined
    if (attempt.moduleType === 'questionnaire' && attempt.totalScore != null) {
      band = await ScoreBand.findOne({
        module: attempt.module,
        min: { $lte: attempt.totalScore },
        max: { $gte: attempt.totalScore },
      })
        .select('_id label interpretation min max')
        .lean()
    }

    const payload: Record<string, unknown> = { ...attempt, band }
    if (attempt.moduleType === 'questionnaire') {
      payload.detail = decorateAttemptItems(attempt as unknown as Parameters<typeof decorateAttemptItems>[0])
    } else if (attempt.moduleType === 'activity_diary') {
      payload.diary = decorateDiaryDetail(attempt as unknown as Parameters<typeof decorateDiaryDetail>[0])
    }

    res.status(200).json({
      success: true,
      attempt: payload,
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

// GET /therapist/attempts/modules
export const getTherapistAttemptModules = async (req: Request, res: Response) => {
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

    const modules = await ModuleAttempt.aggregate([
      { $match: { therapist: therapistId } },
      { $group: { _id: '$module', moduleType: { $first: '$moduleType' } } },
      {
        $lookup: {
          from: 'modules',
          localField: '_id',
          foreignField: '_id',
          as: 'mod',
        },
      },
      { $addFields: { mod: { $arrayElemAt: ['$mod', 0] } } },
      {
        $project: {
          _id: 1,
          title: '$mod.title',
          moduleType: 1,
        },
      },
      { $sort: { title: 1 } },
    ])

    res.status(200).json({ success: true, modules })
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
    const isAdminUser = me.roles?.includes(UserRole.ADMIN)
    if (!isOwnerTherapist && !isAdminUser) {
      res.status(403).json({ success: false, message: 'Forbidden' })
      return
    }

    let band = undefined
    if (attempt.moduleType === 'questionnaire' && attempt.totalScore != null) {
      band = await ScoreBand.findOne({
        module: attempt.module,
        min: { $lte: attempt.totalScore },
        max: { $gte: attempt.totalScore },
      })
        .select('_id label interpretation min max')
        .lean()
    }

    const [patient, moduleDoc] = await Promise.all([
      User.findById(attempt.user).select('_id name username email').lean(),
      Module.findById(attempt.module).select('_id title type').lean(),
    ])

    const payload: Record<string, unknown> = {
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
      payload.detail = decorateAttemptItems(attempt as unknown as Parameters<typeof decorateAttemptItems>[0])
    } else if (attempt.moduleType === 'activity_diary') {
      payload.diary = decorateDiaryDetail(attempt as unknown as Parameters<typeof decorateDiaryDetail>[0])
    }

    res.status(200).json({ success: true, attempt: payload })
  } catch (error) {
    errorHandler(res, error)
  }
}
