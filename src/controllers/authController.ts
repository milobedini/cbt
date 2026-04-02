import { Request, Response } from 'express'
import crypto from 'crypto'
import User, { IUser, UserRole } from '../models/userModel'
import bcrypt from 'bcryptjs'
import { errorHandler } from '../utils/errorHandler'
import {
  generateTokenAndSetCookie,
  generateVerificationCode,
} from '../utils/jwtUtils'
import {
  sendPasswordResetEmail,
  sendResetSuccessEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from '../utils/emails'

export const USER_ROLES_ARRAY = Object.values(UserRole)

const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, roles } = req.body

    if (!username || !email || !password) {
      res.status(400).json({ message: 'Missing credentials!' })
      return
    }
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      res.status(400).json({ message: 'At least one role is required!' })
      return
    }
    // Only allow patient and therapist roles during self-registration
    const allowedRegistrationRoles: UserRole[] = [
      UserRole.PATIENT,
      UserRole.THERAPIST,
    ]
    const hasInvalidRole = roles.some(
      (role: UserRole) => !allowedRegistrationRoles.includes(role)
    )

    if (hasInvalidRole) {
      res.status(400).json({ message: 'One or more roles are invalid!' })
      return
    }

    const existingEmail = await User.findOne({ email })
    const existingUsername = await User.findOne({ username })
    if (existingEmail || existingUsername) {
      res.status(400).json({
        message: existingEmail
          ? 'Email already exists!'
          : 'Username already exists!',
      })
      return
    }

    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)
    const verificationCode = generateVerificationCode()
    const hashedVerificationCode = crypto
      .createHash('sha256')
      .update(verificationCode)
      .digest('hex')

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verificationCode: hashedVerificationCode,
      verificationCodeExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      roles,
      isVerifiedTherapist: false,
    })
    await newUser.save()

    generateTokenAndSetCookie(res, newUser._id as string)

    await sendVerificationEmail(newUser.email, verificationCode)

    res.status(201).json({
      success: true,
      message: 'User created successfully!',
      user: {
        _id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { verificationCode } = req.body
  if (!verificationCode) {
    res.status(400).json({ success: false, message: 'Verification code is required' })
    return
  }
  try {
    const hashedCode = crypto
      .createHash('sha256')
      .update(verificationCode.trim())
      .digest('hex')

    const user = await User.findOne({
      verificationCode: hashedCode,
      verificationCodeExpires: { $gt: new Date() },
    })
    if (!user) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code!',
      })
      return
    }
    user.isVerified = true
    user.verificationCode = undefined
    user.verificationCodeExpires = undefined
    await user.save()

    await sendWelcomeEmail(user.email, user.username)
    res.status(200).json({
      success: true,
      message: 'Email verified successfully!',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
      },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier, password } = req.body

    if (!identifier || !password) {
      res.status(400).json({ message: 'Missing credentials' })
      return
    }

    const user: IUser | null = identifier.includes('@')
      ? await User.findOne({ email: identifier }).select('+password')
      : await User.findOne({ username: identifier }).select('+password')

    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }
    if (!user.isVerified) {
      res.status(400).json({
        success: false,
        message: 'Email not verified! Please verify your email first.',
      })
      return
    }

    generateTokenAndSetCookie(res, user._id as string)
    user.lastLogin = new Date()
    await user.save()
    res.status(200).json({
      success: true,
      message: 'Login successful!',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        name: user.name,
        roles: user.roles,
        isVerifiedTherapist: user.isVerifiedTherapist,
        therapist: user.therapist,
      },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

const logoutUser = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.clearCookie('token')
    res.status(200).json({ message: 'Logout successful!' })
  } catch (error) {
    errorHandler(res, error)
  }
}

const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body
  if (!email) {
    res.status(400).json({ success: false, message: 'Email is required' })
    return
  }
  try {
    // Always return the same response to prevent user enumeration
    const genericResponse = {
      success: true,
      message: 'If an account with that email exists, a reset link has been sent.',
    }

    const user = await User.findOne({
      email: email.trim(),
    })
    if (!user) {
      res.status(200).json(genericResponse)
      return
    }
    const resetToken = crypto.randomBytes(32).toString('hex')
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex')
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000) // 60 minutes
    user.resetPasswordToken = hashedResetToken
    user.resetPasswordExpires = resetTokenExpires

    await user.save()

    // Send the unhashed token in the URL; store the hash in DB
    await sendPasswordResetEmail(
      user.email,
      `${process.env.CLIENT_URL}/reset-password/${resetToken}`
    )
    res.status(200).json(genericResponse)
  } catch (error) {
    errorHandler(res, error)
  }
}

const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params
    const { newPassword } = req.body

    if (!newPassword) {
      res.status(400).json({ message: 'New password is required!' })
      return
    }
    if (!token) {
      res.status(400).json({ message: 'Token is required!' })
      return
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex')

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    })

    if (!user) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token!',
      })
      return
    }

    const salt = await bcrypt.genSalt(10)
    user.password = await bcrypt.hash(newPassword, salt)
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined
    await user.save()

    await sendResetSuccessEmail(user.email, user.username)

    res.status(200).json({
      success: true,
      message: 'Password reset successfully!',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
      },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

const updateName = async (req: Request, res: Response): Promise<void> => {
  const { newName } = req.body
  const userId = req.user?._id

  if (!userId) {
    res.status(401).json({ message: 'Not authorized' })
    return
  }

  if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
    res.status(400).json({ message: 'Name is required!' })
    return
  }

  try {
    const user = await User.findById(userId)
    if (!user) {
      res.status(404).json({ message: 'User not found!' })
      return
    }

    user.name = newName.trim()
    await user.save()

    res.status(200).json({
      success: true,
      message: 'Name updated successfully!',
      user: {
        _id: user._id,
        name: user.name,
      },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

const changePassword = async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body
  const userId = req.user?._id

  if (!userId) {
    res.status(401).json({ message: 'Not authorized' })
    return
  }

  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: 'Current password and new password are required!' })
    return
  }

  if (newPassword.length < 8) {
    res.status(400).json({ message: 'New password must be at least 8 characters long!' })
    return
  }

  try {
    const user = await User.findById(userId).select('+password')
    if (!user) {
      res.status(404).json({ message: 'User not found!' })
      return
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password)
    if (!isMatch) {
      res.status(400).json({ message: 'Current password is incorrect!' })
      return
    }

    const salt = await bcrypt.genSalt(10)
    user.password = await bcrypt.hash(newPassword, salt)
    await user.save()

    res.status(200).json({
      success: true,
      message: 'Password changed successfully!',
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

export {
  registerUser,
  verifyEmail,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  updateName,
  changePassword,
}
