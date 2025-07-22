import type { Request, Response } from 'express'
import Module, { type IModule } from '../models/moduleModel'
import { errorHandler } from '../utils/errorHandler'

export const getModules = async (req: Request, res: Response) => {
  try {
    const modules = await Module.find()
      .sort({ createdAt: -1 })
      .populate('program')
    res.status(200).json({ success: true, modules })
  } catch (error) {
    errorHandler(res, error)
  }
}

export const createModule = async (req: Request, res: Response) => {
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
