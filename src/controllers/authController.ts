import { Request, Response } from 'express'
import User, { IUser } from '../models/userModel'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { errorHandler } from '../utils/errorHandler'
import {
  clearJWT,
  generateTokenAndSetCookie,
  generateVerificationCode,
} from '../utils/jwtUtils'
import { sendVerificationEmail, sendWelcomeEmail } from '../utils/emails'
dotenv.config()

const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body

    if (!username || !email || !password) {
      res.status(400).json({ message: 'Missing credentials!' })
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

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verificationCode,
      verificationCodeExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
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
    console.log(verificationCode)
    const user = await User.findOne({
      verificationCode: verificationCode.trim(),
      verificationCodeExpires: { $gt: new Date() }, // Check if the code is still valid
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
    generateTokenAndSetCookie(res, user._id as string)
    res.status(200).json({ success: true, message: 'Login successful!' })
  } catch (error) {
    errorHandler(res, error)
  }
}

const logoutUser = async (req: Request, res: Response): Promise<void> => {
  try {
    clearJWT(res)
    res.status(200).json({ message: 'Logout successful!' })
  } catch (error) {
    errorHandler(res, error)
  }
}

export { registerUser, verifyEmail, loginUser, logoutUser }
