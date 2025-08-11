import { Request, Response } from 'express'
import { Types } from 'mongoose'
import ModuleAssignment from '../models/moduleAssignmentModel'
import User, { UserRole } from '../models/userModel'
import Module from '../models/moduleModel'
import { errorHandler } from '../utils/errorHandler'

function isAdmin(user: any) {
  return user.roles?.includes(UserRole.ADMIN)
}
function isVerifiedTherapist(user: any) {
  return user.roles?.includes(UserRole.THERAPIST) && user.isVerifiedTherapist
}

export const createAssignment = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(therapistId)
    if (!me || (!isAdmin(me) && !isVerifiedTherapist(me))) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const { userId, moduleId, dueAt, notes, recurrence } = req.body
    const mod = await Module.findById(moduleId)
    if (!mod) {
      res.status(404).json({ success: false, message: 'Module not found' })
      return
    }

    if (mod.accessPolicy !== 'assigned') {
      const isAlreadyEnrolled = await Module.exists({
        _id: moduleId,
        enrolled: userId,
      })
      if (!isAlreadyEnrolled) {
        await Module.updateOne(
          { _id: moduleId },
          { $addToSet: { enrolled: userId } }
        )
      }
    }

    const asg = await ModuleAssignment.create({
      user: userId,
      therapist: therapistId,
      program: mod.program,
      module: mod._id,
      moduleType: mod.type,
      status: 'assigned',
      dueAt: dueAt ? new Date(dueAt) : undefined,
      recurrence,
      notes,
    })

    res.status(201).json({ success: true, assignment: asg })
  } catch (error) {
    errorHandler(res, error)
  }
}

export const listAssignmentsForTherapist = async (
  req: Request,
  res: Response
) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(therapistId)
    if (!me || (!isAdmin(me) && !isVerifiedTherapist(me))) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const items = await ModuleAssignment.find({
      therapist: therapistId,
      status: { $in: ['assigned', 'in_progress'] },
    })
      .sort({ dueAt: 1, createdAt: -1 })
      .populate('user', '_id username email')
      .populate('module', '_id title')
      .lean()

    res.status(200).json({ success: true, assignments: items })
  } catch (error) {
    errorHandler(res, error)
  }
}

export const updateAssignmentStatus = async (req: Request, res: Response) => {
  try {
    const therapistId = req.user?._id as Types.ObjectId
    const me = await User.findById(therapistId)
    if (!me || (!isAdmin(me) && !isVerifiedTherapist(me))) {
      res.status(403).json({ success: false, message: 'Access denied' })
      return
    }

    const { assignmentId } = req.params
    const { status } = req.body as {
      status: 'assigned' | 'in_progress' | 'completed' | 'cancelled'
    }

    const asg = await ModuleAssignment.findOneAndUpdate(
      { _id: assignmentId, therapist: therapistId },
      { status },
      { new: true }
    )
    if (!asg) {
      res.status(404).json({ success: false, message: 'Assignment not found' })
      return
    }
    res.status(200).json({ success: true, assignment: asg })
  } catch (error) {
    errorHandler(res, error)
  }
}

export const getMyAssignments = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id as Types.ObjectId
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const { status = 'active' } = req.query as {
      status?: 'active' | 'completed' | 'all'
    }
    const statuses =
      status === 'active'
        ? ['assigned', 'in_progress']
        : status === 'completed'
        ? ['completed']
        : ['assigned', 'in_progress', 'completed', 'cancelled']

    const items = await ModuleAssignment.find({
      user: userId,
      status: { $in: statuses },
    })
      .sort({ dueAt: 1, createdAt: -1 })
      .populate('module', '_id title type accessPolicy')
      .populate('program', '_id title description')
      .populate('latestAttempt', '_id completedAt totalScore scoreBandLabel')
      .lean()

    res.status(200).json({ success: true, assignments: items })
  } catch (error) {
    errorHandler(res, error)
  }
}
