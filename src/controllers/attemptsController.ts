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

// GET /therapist/attempts/latest?limit=200
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

    const rows = await ModuleAttempt.aggregate([
      { $match: { therapist: therapistId, status: 'submitted' } },
      { $sort: { completedAt: -1, _id: -1 } },
      {
        $group: {
          _id: { user: '$user', module: '$module' },
          doc: { $first: '$$ROOT' },
        },
      },
      { $replaceWith: '$doc' },
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
        },
      },
      { $limit: lim },
    ])
    const decorated = rows.map((r) => ({
      ...r,
      percentComplete: 100,
    }))
    res.status(200).json({ success: true, rows: decorated })
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
    } = req.query as {
      limit?: string
      cursor?: string
      status?: string
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
