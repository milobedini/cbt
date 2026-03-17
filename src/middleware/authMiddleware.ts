import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/userModel'
import { Types } from 'mongoose'
import { UserRole } from '../models/userModel'

declare global {
  namespace Express {
    interface Request {
      user?: {
        _id: Types.ObjectId
        username: string
        email: string
        roles: UserRole[]
        isVerifiedTherapist?: boolean
      }
    }
  }
}

const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.cookies.token

    if (!token) {
      res.status(401).json({ message: 'Not authorized, no token' })
      return
    }

    const JWT_SECRET = process.env.JWT_SECRET
    if (!JWT_SECRET) {
      res.status(500).json({ message: 'JWT secret is not defined' })
      return
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string }

    const user = await User.findById(
      decoded.userId,
      '_id username email roles isVerifiedTherapist'
    )

    if (!user) {
      res.status(401).json({ message: 'Not authorized, user not found' })
      return
    }

    req.user = {
      _id: user._id as Types.ObjectId,
      username: user.username,
      email: user.email,
      roles: user.roles,
      isVerifiedTherapist: user.isVerifiedTherapist,
    }

    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: 'Token expired' })
      return
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: 'Invalid token' })
      return
    }

    console.error('Authentication error:', error)
    res.status(500).json({ message: 'Server error during authentication' })
    return
  }
}

export default authenticateUser
