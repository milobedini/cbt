import { Response } from 'express'
import { sign, Secret } from 'jsonwebtoken'

const JWT_SECRET: Secret = process.env.JWT_SECRET || 'secret'

const generateJWT = (res: Response, userId: string) => {
  const token = sign({ userId }, JWT_SECRET, { expiresIn: '7d' })

  const expiryInSeconds = 7 * 24 * 60 * 60 // 7 days in seconds
  if (isNaN(expiryInSeconds)) {
    throw new Error('Invalid JWT_EXPIRY value')
  }

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: expiryInSeconds * 1000,
    path: '/',
  })
}

const clearJWT = (res: Response) => {
  res.cookie('jwt', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
    path: '/',
  })
}

export { generateJWT, clearJWT }
