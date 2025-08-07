import { Request, Response } from 'express'
import User, { IUser, UserRole } from '../models/userModel'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
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
dotenv.config()

export const USER_ROLES_ARRAY = ['therapist', 'admin', 'patient'] as const

const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, roles, isVerifiedTherapist } = req.body

    if (!username || !email || !password) {
      res.status(400).json({ message: 'Missing credentials!' })
      return
    }
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      res.status(400).json({ message: 'At least one role is required!' })
      return
    }
    const validRoles = Object.values(UserRole)
    const hasInvalidRole = roles.some((role) => !validRoles.includes(role))

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

    const shouldVerifyTherapist =
      roles.includes(UserRole.THERAPIST) && isVerifiedTherapist

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verificationCode,
      verificationCodeExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      roles,
      isVerifiedTherapist: shouldVerifyTherapist,
    })
    await newUser.save()

    generateTokenAndSetCookie(res, newUser._id as string)

    if (!newUser.verificationCode) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate verification code!',
      })
      return
    }

    // Temporarily can only use my email
    await sendVerificationEmail(undefined, newUser.verificationCode)

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
  try {
    const user = await User.findOne({
      verificationCode: verificationCode.trim(),
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

    // Temporarily can only use my email
    await sendWelcomeEmail(undefined, user.username)
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
      res.status(400).json({ message: 'User not found!' })
      return
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      res.status(400).json({ message: 'Invalid password!' })
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
        roles: user.roles,
        isVerifiedTherapist: user.isVerifiedTherapist,
      },
    })
  } catch (error) {
    errorHandler(res, error)
  }
}

const logoutUser = async (req: Request, res: Response): Promise<void> => {
  try {
    res.clearCookie('token')
    res.status(200).json({ message: 'Logout successful!' })
  } catch (error) {
    errorHandler(res, error)
  }
}

const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body
  try {
    const user = await User.findOne({
      email: email.trim(),
    })
    if (!user) {
      res.status(400).json({ success: false, message: 'User not found!' })
      return
    }
    const resetToken = crypto.randomUUID()
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000) // 60 minutes
    user.resetPasswordToken = resetToken
    user.resetPasswordExpires = resetTokenExpires

    await user.save()

    await sendPasswordResetEmail(
      // Can only use my email temporarily
      undefined,
      `${process.env.CLIENT_URL}/reset-password/${resetToken}`
    )
    res.status(200).json({
      success: true,
      message: 'Password reset email sent successfully!',
    })
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

    const user = await User.findOne({
      resetPasswordToken: token,
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

    await sendResetSuccessEmail(
      // Can only use my email temporarily
      undefined,
      user.username
    )

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

export {
  registerUser,
  verifyEmail,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
}
