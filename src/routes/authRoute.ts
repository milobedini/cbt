import {
  loginUser,
  logoutUser,
  registerUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
  updateName,
} from '../controllers/authController'
import authenticateUser from '../middleware/authMiddleware'
import rateLimit from 'express-rate-limit'
import express from 'express'
const router = express.Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  message: { message: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many verification attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

router.post('/register', authLimiter, registerUser)
router.post('/verify-email', verifyLimiter, verifyEmail)
router.post('/login', authLimiter, loginUser)
router.post('/logout', logoutUser)

router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password/:token', authLimiter, resetPassword)
router.put('/update-name', authenticateUser, updateName)

export default router
