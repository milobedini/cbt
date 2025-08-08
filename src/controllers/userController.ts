import { Request, Response } from 'express'
import User, { UserRole } from '../models/userModel'
import { errorHandler } from '../utils/errorHandler'
import { Types } from 'mongoose'

const getUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id
    const user = await User.findById(
      userId,
      '_id username email roles isVerifiedTherapist patients'
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

const getClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id
    const user = await User.findById(
      userId,
      '_id username email roles isVerifiedTherapist patients'
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
      { _id: { $in: user.patients } },
      '_id username email'
    )

    if (!patients || !patients.length) {
      res.status(200).json([])
      return
    }
    res.status(200).json(patients)
  } catch (error) {
    errorHandler(res, error)
  }
}

const addRemoveClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id
    const { clientId } = req.body

    const user = await User.findById(userId)
    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    if (!user.patients) {
      user.patients = []
    }

    const patient = await User.findById(clientId)
    if (!patient) {
      res.status(404).json({ message: 'Client not found' })
      return
    }
    if (!patient.roles.includes(UserRole.PATIENT)) {
      res.status(403).json({ message: 'Only patients can be added or removed' })
      return
    }
    const clientObjectId = patient._id as Types.ObjectId

    let message = ''
    const alreadyAdded = user.patients?.some((id) => id.equals(clientObjectId))

    if (alreadyAdded) {
      user.patients = user.patients.filter((id) => !id.equals(clientObjectId))
      message = 'Client removed successfully'
    } else {
      user.patients = [...(user.patients || []), clientObjectId]
      message = 'Client added successfully'
    }

    await user.save()
    res.status(200).json({ message, patients: user.patients })
  } catch (error) {
    errorHandler(res, error)
  }
}

export { getUser, getAllPatients, getClients, addRemoveClient }
