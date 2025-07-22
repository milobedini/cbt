import Program from '../models/programModel'
import { errorHandler } from '../utils/errorHandler'
import type { Request, Response } from 'express'

export const getPrograms = async (req: Request, res: Response) => {
  try {
    const programs = await Program.find().sort({ createdAt: -1 })
    res.status(200).json({ success: true, programs })
  } catch (error) {
    errorHandler(res, error)
  }
}

export const getProgramById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const program = await Program.findById(id).populate('modules')
    if (!program) {
      res.status(404).json({ success: false, message: 'Program not found' })
      return
    }
    res.status(200).json({ success: true, program })
  } catch (error) {
    errorHandler(res, error)
  }
}
