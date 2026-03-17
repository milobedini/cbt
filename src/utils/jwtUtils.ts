import { Response } from 'express'
import { sign, Secret } from 'jsonwebtoken'
import { randomInt } from 'crypto'

const getJwtSecret = (): Secret => {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required')
  }
  return secret
}

const generateTokenAndSetCookie = (res: Response, userId: string) => {
  const token = sign({ userId }, getJwtSecret(), { expiresIn: '7d' })

  const expiryInSeconds = 7 * 24 * 60 * 60 // 7 days in seconds

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: expiryInSeconds * 1000,
    path: '/',
  })

  return token
}

const generateVerificationCode = (): string => {
  return randomInt(100000, 1000000).toString()
}

export { generateTokenAndSetCookie, generateVerificationCode }
