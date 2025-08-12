import { Request, Response } from 'express'
import User, { UserRole } from '../models/userModel'
import ModuleAttempt from '../models/moduleAttemptModel'
import { errorHandler } from '../utils/errorHandler'
import { Types } from 'mongoose'

const getUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id
    const user = await User.findById(
      userId,
      '_id username email name roles isVerifiedTherapist patients therapist'
    ).populate('therapist', '_id username email')
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
      '_id username email name roles isVerifiedTherapist patients'
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
      '_id username email name therapist'
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
      '_id username email name roles isVerifiedTherapist patients'
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
      '_id username email name therapist'
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

const addRemoveTherapist = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?._id
    const { therapistId, patientId } = req.body

    const user = await User.findById(userId)
    if (!user) {
      res.status(404).json({ message: 'Not logged in' })
      return
    }

    if (
      !user.roles.includes(UserRole.ADMIN) &&
      !user.roles.includes(UserRole.THERAPIST)
    ) {
      res.status(403).json({ message: 'Access denied' })
      return
    }

    const patient = await User.findById(patientId)
    if (!patient) {
      res.status(404).json({ message: 'Patient not found' })
      return
    }

    const therapist = await User.findById(therapistId)
    if (!therapist) {
      res.status(404).json({ message: 'Therapist not found' })
      return
    }

    if (!therapist.roles.includes(UserRole.THERAPIST)) {
      res
        .status(403)
        .json({ message: 'Only therapists can be assigned as therapist' })
      return
    }
    if (!therapist.isVerifiedTherapist) {
      res.status(403).json({ message: 'Therapist is not verified' })
      return
    }

    if (!patient.roles.includes(UserRole.PATIENT)) {
      res
        .status(403)
        .json({ message: 'Only patients can be assigned as patient' })
      return
    }

    const patientIdObj = patient._id as Types.ObjectId
    const therapistIdObj = therapist._id as Types.ObjectId

    const alreadyAssigned =
      patient.therapist?.toString() === therapistId.toString()

    let message = ''

    if (alreadyAssigned) {
      // 🔁 Remove therapist from patient
      patient.therapist = undefined

      // 🔁 Remove patient from therapist.patients list
      therapist.patients = (therapist.patients || []).filter(
        (id) => !id.equals(patientIdObj)
      )

      message = 'Therapist removed from patient'
    } else {
      // ➕ Assign therapist to patient
      patient.therapist = therapistIdObj

      // ➕ Add patient to therapist’s list if not already present
      const alreadyInList = (therapist.patients || []).some((id) =>
        id.equals(patientIdObj)
      )

      if (!alreadyInList) {
        therapist.patients = [...(therapist.patients || []), patientIdObj]
      }

      message = 'Therapist assigned to patient'
    }

    await patient.save()
    await therapist.save()

    res
      .status(200)
      .json({ message, patient, therapistPatients: therapist.patients })
  } catch (error) {
    errorHandler(res, error)
  }
}

const adminVerifyTherapist = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?._id
    const { therapistId } = req.body

    const user = await User.findById(userId)
    if (!user) {
      res.status(404).json({ message: 'Not logged in' })
      return
    }

    if (!user.roles.includes(UserRole.ADMIN)) {
      res.status(403).json({ message: 'Only admins can verify therapists' })
      return
    }

    const therapist = await User.findById(therapistId)
    if (!therapist) {
      res.status(404).json({ message: 'Therapist not found' })
      return
    }

    if (!therapist.roles.includes(UserRole.THERAPIST)) {
      res.status(403).json({ message: 'Only therapists can be verified' })
      return
    }

    therapist.isVerifiedTherapist = true
    await therapist.save()

    res
      .status(200)
      .json({ message: 'Therapist verified successfully', therapist })
  } catch (error) {
    errorHandler(res, error)
  }
}

const adminStats = async (req: Request, res: Response): Promise<void> => {
  // Return number of users, of which therapists and patients.
  // Return unverified therapists in list
  // Return completed attempts in last 7 days
  try {
    const userId = req.user?._id
    const user = await User.findById(userId)
    if (!user || !user.roles.includes(UserRole.ADMIN)) {
      res.status(403).json({ message: 'Access denied' })
      return
    }

    const totalUsers = await User.countDocuments()
    const totalTherapists = await User.countDocuments({
      roles: UserRole.THERAPIST,
    })
    const totalPatients = await User.countDocuments({ roles: UserRole.PATIENT })
    const unverifiedTherapists = await User.find({
      roles: UserRole.THERAPIST,
      isVerifiedTherapist: false,
    })
    const completedAttempts = await ModuleAttempt.countDocuments({
      status: 'submitted',
      completedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    })

    res.status(200).json({
      totalUsers,
      totalTherapists,
      totalPatients,
      unverifiedTherapists,
      completedAttempts,
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

export {
  getUser,
  getAllPatients,
  getClients,
  addRemoveTherapist,
  adminVerifyTherapist,
  adminStats,
}
