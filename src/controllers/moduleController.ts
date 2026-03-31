import type { Request, Response } from 'express'
import Module from '../models/moduleModel'
import { errorHandler } from '../utils/errorHandler'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'
import mongoose, { Types } from 'mongoose'
import {
  resolveModuleAccessMeta,
  fetchActiveAssignmentsByModule,
} from '../utils/moduleAccess'

const getModules = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId | undefined
    const { program, withMeta } = req.query as {
      program?: string
      withMeta?: string
    }

    // 1) Base filter (optional program)
    const match: mongoose.FilterQuery<typeof Module> = {}
    if (program && mongoose.isValidObjectId(program)) {
      match.program = new Types.ObjectId(program)
    }

    // 2) Fetch modules
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
    const authenticated = !!userId

    const byModule = authenticated
      ? await fetchActiveAssignmentsByModule(userId, moduleIds)
      : new Map()

    const items = modules.map((m) => ({
      module: m,
      meta: resolveModuleAccessMeta(
        m.accessPolicy,
        byModule.get(String(m._id)),
        authenticated
      ),
    }))

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

    const authenticated = !!req.user?._id
    const byModule = authenticated && req.user
      ? await fetchActiveAssignmentsByModule(
          req.user._id as Types.ObjectId,
          [module._id as Types.ObjectId]
        )
      : new Map()

    const meta = resolveModuleAccessMeta(
      module.accessPolicy,
      byModule.get(String(module._id)),
      authenticated
    )

    if (module.type === 'activity_diary') {
      res.status(200).json({
        success: true,
        module,
        questions: [],
        scoreBands: [],
        meta,
      })
      return
    }

    const questions = await Question.find({ module: module._id }).sort({
      order: 1,
    })
    const scoreBands = await ScoreBand.find({ module: module._id })

    res.status(200).json({
      success: true,
      module,
      questions,
      scoreBands,
      meta,
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
      content,
    } = req.body

    if (!title || !description || !program || !type) {
      res.status(400).json({
        success: false,
        message: 'title, description, program, and type are required',
      })
      return
    }

    const allowedTypes = [
      'questionnaire',
      'reading',
      'activity_diary',
    ]
    if (!allowedTypes.includes(type)) {
      res.status(400).json({
        success: false,
        message: `type must be one of ${allowedTypes.join(', ')}`,
      })
      return
    }

    const allowedPolicies = ['open', 'assigned']
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
      ...(accessPolicy ? { accessPolicy } : {}), // defaults to 'assigned' in schema
      ...(content ? { content } : {}),
    })

    res.status(201).json({ success: true, module: newModule })
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

    const byModule = await fetchActiveAssignmentsByModule(userId)
    const assignedIds = Array.from(byModule.keys()).map(
      (id) => new Types.ObjectId(id)
    )

    const modules = await Module.find({
      $or: [
        { accessPolicy: 'open' },
        { _id: { $in: assignedIds } },
      ],
    })
      .select(
        '_id title description program type disclaimer imageUrl accessPolicy createdAt updatedAt'
      )
      .populate('program', '_id title description')
      .sort({ createdAt: -1 })
      .lean()

    const items = modules.map((m) => ({
      module: m,
      meta: resolveModuleAccessMeta(
        m.accessPolicy,
        byModule.get(String(m._id)),
        true
      ),
    }))

    res.status(200).json({ success: true, modules: items })
  } catch (error) {
    errorHandler(res, error)
  }
}

export {
  getModules,
  getModuleById,
  createModule,
  getDetailedModuleById,
  getAvailableModules,
}
