import { Response } from 'express'
import mongoose from 'mongoose'

export const errorHandler = (res: Response, error: unknown) => {
  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({ message: 'Invalid ID format' })
    return
  }

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ message: error.message })
    return
  }

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: number }).code === 11000
  ) {
    res.status(409).json({ message: 'Duplicate entry' })
    return
  }

  console.error(error)
  res.status(500).json({ message: 'Server Error' })
}
