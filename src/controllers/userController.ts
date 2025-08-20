import { Request, Response } from 'express'
import User, { UserRole } from '../models/userModel'
import ModuleAttempt from '../models/moduleAttemptModel'
import { errorHandler } from '../utils/errorHandler'
import { isValidObjectId, Types } from 'mongoose'

// Helpers
type Boolish = boolean | undefined

const parseBool = (v: any): Boolish => {
  if (v === undefined) return undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (s === 'true') return true
    if (s === 'false') return false
  }
  return undefined
}

const splitCSV = (v?: string | string[]) =>
  (Array.isArray(v) ? v.join(',') : v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const toDate = (v?: string) => (v ? new Date(v) : undefined)

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

// GetUsers - admin route
const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = req.user?._id
    const requester = await User.findById(requesterId, 'roles')
    if (!requester || !requester.roles.includes(UserRole.ADMIN)) {
      res.status(403).json({ message: 'Access denied' })
      return
    }

    // ------- Parse query options -------
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1)
    const limitRaw = Math.max(
      parseInt(String(req.query.limit || '25'), 10) || 25,
      1
    )
    const limit = Math.min(limitRaw, 200)

    const q = (req.query.q as string | undefined)?.trim()
    const roles = splitCSV(req.query.roles as any)
    const ids = splitCSV(req.query.ids as any)

    const isVerified = parseBool(req.query.isVerified)
    const isVerifiedTherapist = parseBool(req.query.isVerifiedTherapist)
    const hasTherapist = parseBool(req.query.hasTherapist)

    const therapistId = (req.query.therapistId as string | undefined)?.trim()

    const createdFrom = toDate(req.query.createdFrom as string | undefined)
    const createdTo = toDate(req.query.createdTo as string | undefined)
    const lastLoginFrom = toDate(req.query.lastLoginFrom as string | undefined)
    const lastLoginTo = toDate(req.query.lastLoginTo as string | undefined)

    const sortParam = (req.query.sort as string | undefined)?.trim()
    const selectFields = splitCSV(req.query.select as any)

    // ------- Build $match (filters) -------
    const match: Record<string, any> = {}

    if (q) {
      match.$or = [
        { username: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
      ]
    }

    if (roles.length) {
      match.roles = { $in: roles }
    }

    if (isVerified !== undefined) {
      match.isVerified = isVerified
    }

    if (isVerifiedTherapist !== undefined) {
      match.isVerifiedTherapist = isVerifiedTherapist
    }

    if (hasTherapist !== undefined) {
      match.therapist = hasTherapist
        ? { $exists: true, $ne: null }
        : { $in: [null, undefined] }
    }

    if (therapistId && isValidObjectId(therapistId)) {
      match.therapist = new (require('mongoose').Types.ObjectId)(therapistId)
    }

    if (ids.length) {
      const validIds = ids.filter(isValidObjectId)
      if (validIds.length) {
        match._id = {
          $in: validIds.map(
            (id: string) => new (require('mongoose').Types.ObjectId)(id)
          ),
        }
      } else {
        // No valid ids provided -> empty result quickly
        res.status(200).json({
          page,
          limit,
          total: 0,
          totalPages: 0,
          items: [],
          facets: {
            roles: [],
            isVerified: [],
            isVerifiedTherapist: [],
            hasTherapist: [],
          },
        })
        return
      }
    }

    if (createdFrom || createdTo) {
      match.createdAt = {}
      if (createdFrom) match.createdAt.$gte = createdFrom
      if (createdTo) match.createdAt.$lte = createdTo
    }

    if (lastLoginFrom || lastLoginTo) {
      match.lastLogin = {}
      if (lastLoginFrom) match.lastLogin.$gte = lastLoginFrom
      if (lastLoginTo) match.lastLogin.$lte = lastLoginTo
    }

    // ------- Build $sort -------
    // Default sort: most recently created first
    const sort: Record<string, 1 | -1> = {}
    if (sortParam) {
      // accept "field:asc,other:desc"
      for (const token of sortParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const [field, dirRaw] = token.split(':').map((s) => s.trim())
        if (!field) continue
        const dir = (dirRaw || 'asc').toLowerCase()
        sort[field] = dir === 'desc' ? -1 : 1
      }
    } else {
      sort.createdAt = -1
    }

    // ------- Build $project (safe default, but allow `select`) -------
    const safeDefaultProjection = {
      _id: 1,
      username: 1,
      email: 1,
      name: 1,
      roles: 1,
      isVerified: 1,
      isVerifiedTherapist: 1,
      therapist: 1,
      patients: 1, // you can swap to `$size: '$patients'` if you'd rather return a count
      createdAt: 1,
      updatedAt: 1,
      lastLogin: 1,
    } as const

    const project =
      selectFields.length > 0
        ? selectFields.reduce<Record<string, 0 | 1>>((acc, f) => {
            acc[f] = 1
            return acc
          }, {})
        : safeDefaultProjection

    // ------- Aggregation with facets (items + total + filter facets) -------
    const pipeline: any[] = [
      { $match: match },
      // small lookup to include minimal therapist info:
      {
        $lookup: {
          from: 'users-data',
          localField: 'therapist',
          foreignField: '_id',
          as: 'therapistInfo',
          pipeline: [{ $project: { _id: 1, username: 1, email: 1, name: 1 } }],
        },
      },
      { $addFields: { therapistInfo: { $first: '$therapistInfo' } } },
      {
        $facet: {
          items: [
            { $sort: sort },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: project },
          ],
          totalCount: [{ $count: 'count' }],
          roleFacets: [
            { $group: { _id: '$roles', count: { $sum: 1 } } },
            // roles is an array; explode to counts per individual role
            { $unwind: { path: '$_id', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$_id', count: { $sum: '$count' } } },
            { $sort: { _id: 1 } },
          ],
          isVerifiedFacets: [
            { $group: { _id: '$isVerified', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          isVerifiedTherapistFacets: [
            { $group: { _id: '$isVerifiedTherapist', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          hasTherapistFacets: [
            {
              $group: {
                _id: {
                  $cond: [{ $ifNull: ['$therapist', false] }, true, false],
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
      {
        $project: {
          items: 1,
          total: { $ifNull: [{ $arrayElemAt: ['$totalCount.count', 0] }, 0] },
          roleFacets: 1,
          isVerifiedFacets: 1,
          isVerifiedTherapistFacets: 1,
          hasTherapistFacets: 1,
        },
      },
    ]

    const [result] = await User.aggregate(pipeline)

    const total: number = result?.total || 0
    const totalPages = total ? Math.ceil(total / limit) : 0

    res.status(200).json({
      page,
      limit,
      total,
      totalPages,
      items: result?.items ?? [],
      facets: {
        roles: result?.roleFacets ?? [],
        isVerified: result?.isVerifiedFacets ?? [],
        isVerifiedTherapist: result?.isVerifiedTherapistFacets ?? [],
        hasTherapist: result?.hasTherapistFacets ?? [],
      },
    })
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
  getUsers,
}
