import { Request, Response } from 'express'
import User, { UserRole } from '../models/userModel'
import { errorHandler } from '../utils/errorHandler'

const getUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id
    const user = await User.findById(
      userId,
      '_id username email roles isVerifiedTherapist'
    )
    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    res.status(200).json(user)
  } catch (error) {
    errorHandler(res, error)
  }
}

const getAllPatients = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id
    const user = await User.findById(
      userId,
      '_id username email roles isVerifiedTherapist'
    )
    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    if (
      !user.roles.includes(UserRole.THERAPIST) &&
      !user.roles.includes(UserRole.ADMIN)
    ) {
      res.status(403).json({ message: 'Access denied' })
      return
    }
    const patients = await User.find(
      { roles: UserRole.PATIENT },
      '_id username email'
    )

    if (!patients || !patients.length) {
      res.status(404).json({ message: 'No patients found' })
      return
    }
    res.status(200).json(patients)
  } catch (error) {
    errorHandler(res, error)
  }
}

export { getUser, getAllPatients }
