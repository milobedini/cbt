import type { Request, Response } from 'express'
import Module from '../models/moduleModel'
import { errorHandler } from '../utils/errorHandler'
import Question from '../models/questionModel'
import ScoreBand from '../models/scoreBandModel'
import User, { UserRole } from '../models/userModel'

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
    const module = await Module.findById(id).populate('program')
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

export {
  getModules,
  getModuleById,
  createModule,
  getDetailedModuleById,
  enrollUnenrollUserInModule,
}
