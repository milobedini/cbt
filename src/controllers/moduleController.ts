import type { Request, Response } from 'express'
import Module from '../models/moduleModel'
import { errorHandler } from '../utils/errorHandler'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'

const getModules = async (req: Request, res: Response) => {
  try {
    const modules = await Module.find().sort({ createdAt: -1 })
    res.status(200).json({ success: true, modules })
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
    const module = await Module.findById(id)
    const questions = await Question.find({ module: module?._id }).sort({
      order: 1,
    })
    const scoreBands = await ScoreBand.find({ module: module?._id })
    if (!module) {
      res.status(404).json({ success: false, message: 'Module not found' })
      return
    }
    res.status(200).json({ success: true, module, questions, scoreBands })
  } catch (error) {
    errorHandler(res, error)
  }
}

const createModule = async (req: Request, res: Response) => {
  try {
    const { title, description, imageUrl } = req.body

    if (!title || !description) {
      res
        .status(400)
        .json({ success: false, message: 'Title and description are required' })
      return
    }

    const newModule = new Module({
      title,
      description,
      imageUrl,
    })

    await newModule.save()
    res.status(201).json({ success: true, module: newModule })
  } catch (error) {
    errorHandler(res, error)
  }
}

export { getModules, getModuleById, createModule, getDetailedModuleById }
