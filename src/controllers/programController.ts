import Program from '../models/programModel'
import { errorHandler } from '../utils/errorHandler'
import type { Request, Response } from 'express'

export const getPrograms = async (req: Request, res: Response) => {
  try {
    const modules = await Program.find().sort({ createdAt: -1 })
    res.status(200).json({ success: true, modules })
  } catch (error) {
    errorHandler(res, error)
  }
}
