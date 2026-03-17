import { Request, Response, NextFunction } from 'express'
import User from '../models/userModel'
import { isAdmin, isVerifiedTherapist } from '../utils/roles'

const authorizeTherapistOrAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?._id
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' })
    return
  }

  const me = await User.findById(userId, 'roles isVerifiedTherapist')
  if (!me || (!isAdmin(me) && !isVerifiedTherapist(me))) {
    res.status(403).json({ success: false, message: 'Access denied' })
    return
  }

  next()
}

export default authorizeTherapistOrAdmin
