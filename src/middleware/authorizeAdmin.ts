import { Request, Response, NextFunction } from 'express'
import User from '../models/userModel'
import { isAdmin } from '../utils/roles'

const authorizeAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?._id
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' })
    return
  }

  const me = await User.findById(userId, 'roles')
  if (!me || !isAdmin(me)) {
    res.status(403).json({ success: false, message: 'Admin access required' })
    return
  }

  next()
}

export default authorizeAdmin
