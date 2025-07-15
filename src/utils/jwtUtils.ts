import { Response } from 'express'
import { sign, Secret } from 'jsonwebtoken'
import dotenv from 'dotenv'

dotenv.config()

const JWT_SECRET: Secret = process.env.JWT_SECRET || 'secret'

const generateTokenAndSetCookie = (res: Response, userId: string) => {
  const token = sign({ userId }, JWT_SECRET, { expiresIn: '7d' })

  const expiryInSeconds = 7 * 24 * 60 * 60 // 7 days in seconds
  if (isNaN(expiryInSeconds)) {
    throw new Error('Invalid JWT_EXPIRY value')
  }

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: expiryInSeconds * 1000,
    path: '/',
  })

  return token
}

const generateVerificationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export { generateTokenAndSetCookie, generateVerificationCode }
