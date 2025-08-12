import type { Request, Response } from 'express'
import Module from '../models/moduleModel'
import { errorHandler } from '../utils/errorHandler'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'
import User, { UserRole } from '../models/userModel'
import ModuleAssignment from '../models/moduleAssignmentModel'
import mongoose, { Types } from 'mongoose'

const getModules = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId | undefined
    console.log(userId)
    const { program, withMeta } = req.query as {
      program?: string
      withMeta?: string
    }

    // 1) Base filter (optional program)
    const match: any = {}
    if (program && mongoose.isValidObjectId(program)) {
      match.program = new Types.ObjectId(program)
    }

    // 2) Fetch modules (no enrolled array to keep payload light)
    const modules = await Module.find(match)
      .select(
        '_id title description program type disclaimer imageUrl accessPolicy createdAt updatedAt'
      )
      .populate('program', '_id title description')
      .sort({ createdAt: -1 })
      .lean()

    // Fast path: no meta requested
    if (!withMeta || withMeta === 'false' || withMeta === '0') {
      res.status(200).json({ success: true, modules })
      return
    }

    // 3) Build meta (bulk, no N+1)
    const moduleIds = modules.map((m) => m._id as Types.ObjectId)

    // If user not logged in -> mark all as unauthenticated
    if (!userId) {
      const items = modules.map((m) => ({
        module: m,
        meta: {
          canStart: undefined,
          canStartReason: 'unauthenticated' as const,
          source: [] as Array<'open' | 'enrolled' | 'assigned'>,
          activeAssignmentId: undefined as string | undefined,
          assignmentStatus: undefined as 'assigned' | 'in_progress' | undefined,
          dueAt: undefined as Date | undefined,
        },
      }))
      res.status(200).json({ success: true, items })
      return
    }

    // a) Active assignments for this user across these modules
    const activeAsgs = await ModuleAssignment.find({
      user: userId,
      module: { $in: moduleIds },
      status: { $in: ['assigned', 'in_progress'] },
    })
      .select('_id module status dueAt')
      .lean()

    // pick one per module (prefer in_progress, then earliest due)
    const byModule = new Map<string, (typeof activeAsgs)[number]>()
    const rank = (s: string) => (s === 'in_progress' ? 1 : 2)
    for (const a of activeAsgs) {
      const k = String(a.module)
      const prev = byModule.get(k)
      if (
        !prev ||
        rank(a.status) < rank(prev.status) ||
        (a.dueAt && (!prev.dueAt || a.dueAt < prev.dueAt))
      ) {
        byModule.set(k, a)
      }
    }

    // b) Which of these modules is the user enrolled in?
    const enrolledRows = await Module.find({
      _id: { $in: moduleIds },
      enrolled: userId,
    })
      .select('_id')
      .lean()
    const enrolledSet = new Set(enrolledRows.map((r) => String(r._id)))

    // 4) Decorate each module with meta
    const items = modules.map((m: any) => {
      const mId = String(m._id)
      const a = byModule.get(mId)
      const isEnrolled = enrolledSet.has(mId)

      const source: Array<'open' | 'enrolled' | 'assigned'> = []
      if (m.accessPolicy === 'open') source.push('open')
      if (isEnrolled) source.push('enrolled')
      if (a) source.push('assigned')

      let canStart = false
      let canStartReason: 'ok' | 'not_enrolled' | 'requires_assignment' = 'ok'

      if (m.accessPolicy === 'open') {
        canStart = true
      } else if (m.accessPolicy === 'enrolled') {
        // allow start if enrolled OR has an assignment
        canStart = isEnrolled || !!a
        if (!canStart) canStartReason = 'not_enrolled'
      } else {
        // 'assigned'
        canStart = !!a
        if (!a) canStartReason = 'requires_assignment'
      }

      return {
        module: m,
        meta: {
          canStart,
          canStartReason,
          source,
          activeAssignmentId: a?._id?.toString(),
          assignmentStatus: a?.status as 'assigned' | 'in_progress' | undefined,
          dueAt: a?.dueAt,
        },
      }
    })

    res.status(200).json({ success: true, modules: items })
  } catch (error) {
    errorHandler(res, error)
  }
}

const getModuleById = async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const module = await Module.findById(id)
    if (!module) {
      res.status(404).json({ success: false, message: 'Module not found' })
      return
    }
    res.status(200).json({ success: true, module })
  } catch (error) {
    errorHandler(res, error)
  }
}

const getDetailedModuleById = async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const module = await Module.findById(id).populate('program')
    if (!module) {
      res.status(404).json({ success: false, message: 'Module not found' })
      return
    }

    const questions = await Question.find({ module: module._id }).sort({
      order: 1,
    })
    const scoreBands = await ScoreBand.find({ module: module._id })

    let canStart: boolean | undefined
    let canStartReason:
      | 'ok'
      | 'not_enrolled'
      | 'requires_assignment'
      | 'unauthenticated'
      | undefined
    let activeAssignmentId: string | undefined

    if (!req.user?._id) {
      canStart = undefined
      canStartReason = 'unauthenticated'
    } else if (module.accessPolicy === 'open') {
      canStart = true
      canStartReason = 'ok'
    } else if (module.accessPolicy === 'enrolled') {
      const enrolled = await Module.exists({
        _id: module._id,
        enrolled: req.user._id,
      })
      canStart = !!enrolled
      canStartReason = enrolled ? 'ok' : 'not_enrolled'
    } else {
      // 'assigned'
      const a = await ModuleAssignment.findOne({
        user: req.user._id,
        module: module._id,
        status: { $in: ['assigned', 'in_progress'] },
      })
        .select('_id')
        .lean()
      canStart = !!a
      canStartReason = a ? 'ok' : 'requires_assignment'
      activeAssignmentId = a?._id?.toString()
    }

    res.status(200).json({
      success: true,
      module,
      questions,
      scoreBands,
      meta: { canStart, canStartReason, activeAssignmentId },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

const createModule = async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      imageUrl,
      program,
      type,
      disclaimer,
      accessPolicy,
    } = req.body

    if (!title || !description || !program || !type) {
      res.status(400).json({
        success: false,
        message: 'title, description, program, and type are required',
      })
      return
    }

    const allowedTypes = ['questionnaire', 'psychoeducation', 'exercise']
    if (!allowedTypes.includes(type)) {
      res.status(400).json({
        success: false,
        message: `type must be one of ${allowedTypes.join(', ')}`,
      })
      return
    }

    const allowedPolicies = ['open', 'enrolled', 'assigned']
    if (accessPolicy && !allowedPolicies.includes(accessPolicy)) {
      res.status(400).json({
        success: false,
        message: `accessPolicy must be one of ${allowedPolicies.join(', ')}`,
      })
      return
    }

    const newModule = await Module.create({
      title,
      description,
      imageUrl,
      program,
      type,
      disclaimer,
      ...(accessPolicy ? { accessPolicy } : {}), // defaults to 'enrolled' in schema
    })

    res.status(201).json({ success: true, module: newModule })
  } catch (error) {
    errorHandler(res, error)
  }
}

const enrollUnenrollUserInModule = async (req: Request, res: Response) => {
  const { patientId, moduleId } = req.body
  const currentUserId = req.user._id

  if (!currentUserId) {
    res.status(401).json({ success: false, message: 'Unauthorized' })
    return
  }

  const user = await User.findById(currentUserId)
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' })
    return
  }

  if (
    !user.roles.includes(UserRole.ADMIN) &&
    !(user.roles.includes(UserRole.THERAPIST) && user.isVerifiedTherapist)
  ) {
    res.status(403).json({
      success: false,
      message:
        'Only admins and verified therapists can enroll or unenroll patients',
    })
    return
  }

  if (!patientId || !moduleId) {
    res.status(400).json({
      success: false,
      message: 'Patient ID and Module ID are required',
    })
    return
  }

  try {
    const module = await Module.findById(moduleId)
    if (!module) {
      res.status(404).json({ success: false, message: 'Module not found' })
      return
    }

    // ⛔ prevent manual enrol for assignment-only modules (allow admin override if you want)
    if (
      module.accessPolicy === 'assigned' &&
      !user.roles.includes(UserRole.ADMIN)
    ) {
      res.status(400).json({
        success: false,
        message: 'This module is assignment-only. Use an assignment instead.',
      })
      return
    }

    const patient = await User.findById(patientId)
    if (!patient) {
      res.status(404).json({ success: false, message: 'Patient not found' })
      return
    }

    if (!patient.roles.includes(UserRole.PATIENT)) {
      res.status(403).json({
        success: false,
        message: 'Only patients can be enrolled or unenrolled',
      })
      return
    }

    if (
      String(patient.therapist) !== String(user._id) &&
      !user.roles.includes(UserRole.ADMIN)
    ) {
      console.log(patient.therapist, user._id)
      console.log(!patient.therapist !== user._id)
      res.status(403).json({
        success: false,
        message:
          'Only the assigned therapist can enroll or unenroll the patient',
      })
      return
    }
    let message = ''
    if (module.enrolled?.includes(patientId)) {
      // Unenroll user
      module.enrolled = module.enrolled.filter(
        (id) => id.toString() !== patientId
      )
      message = 'User unenrolled successfully'
    } else {
      module.enrolled?.push(patientId)
      message = 'User enrolled successfully'
    }

    await module.save()
    res.status(200).json({ success: true, message })
  } catch (error) {
    errorHandler(res, error)
  }
}

const getAvailableModules = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    // 1) Active assignments for this user (assigned/in_progress)
    const activeAsgs = await ModuleAssignment.find({
      user: userId,
      status: { $in: ['assigned', 'in_progress'] },
    })
      .select('_id module status dueAt')
      .lean()

    // Pick one assignment per module (prefer in_progress, then earliest dueAt)
    const byModule = new Map<string, (typeof activeAsgs)[number]>()
    for (const a of activeAsgs) {
      const k = String(a.module)
      const prev = byModule.get(k)
      const rank = (x: any) => (x.status === 'in_progress' ? 1 : 2)
      if (
        !prev ||
        rank(a) < rank(prev) ||
        (a.dueAt && (!prev.dueAt || a.dueAt < prev.dueAt))
      ) {
        byModule.set(k, a)
      }
    }
    const assignedIds = Array.from(byModule.keys()).map(
      (id) => new Types.ObjectId(id)
    )

    // 2) Fetch modules the user can see
    const modules = await Module.find({
      $or: [
        { accessPolicy: 'open' },
        { accessPolicy: 'enrolled', enrolled: userId },
        { _id: { $in: assignedIds } }, // include assignment-only modules
      ],
    })
      .select(
        '_id title description program type disclaimer imageUrl accessPolicy createdAt updatedAt'
      )
      .populate('program', '_id title description')
      .sort({ createdAt: -1 })
      .lean()

    // 3) Decorate with meta info for the client
    const items = modules.map((m: any) => {
      const a = byModule.get(String(m._id))
      const source: Array<'open' | 'enrolled' | 'assigned'> = []
      if (m.accessPolicy === 'open') source.push('open')
      if (m.accessPolicy === 'enrolled') source.push('enrolled')
      if (a) source.push('assigned')

      let canStart = false
      let canStartReason: 'ok' | 'not_enrolled' | 'requires_assignment' = 'ok'

      if (m.accessPolicy === 'open') {
        canStart = true
      } else if (m.accessPolicy === 'enrolled') {
        // We only included when enrolled OR assigned; both are OK to start
        canStart = true
      } else {
        // assigned
        canStart = !!a
        if (!a) canStartReason = 'requires_assignment'
      }

      return {
        module: m,
        meta: {
          canStart,
          canStartReason,
          source,
          activeAssignmentId: a?._id?.toString(),
          assignmentStatus: a?.status,
          dueAt: a?.dueAt,
        },
      }
    })

    res.status(200).json({ success: true, items })
  } catch (error) {
    errorHandler(res, error)
  }
}

export {
  getModules,
  getModuleById,
  createModule,
  getDetailedModuleById,
  enrollUnenrollUserInModule,
  getAvailableModules,
}
